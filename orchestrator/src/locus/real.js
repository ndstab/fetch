// Real Locus HTTP client. Same shape as mock.js — swappable via LOCUS_MODE.
//
// Endpoint map (from docs.paywithlocus.com, scraped 2026-04):
//
//   Main API (cfg.apiBase, e.g. https://beta-api.paywithlocus.com/api):
//     POST   /checkout/sessions           create a buyer-pays-merchant session (*)
//     GET    /checkout/sessions/:id       fetch session state
//     POST   /checkout/agent/pay/:id      agent pays an existing session programmatically
//     GET    /pay/balance                 wallet USDC balance
//     POST   /pay/send                    send USDC to address or email
//     POST   /wrapped/laso/search-merchants
//     POST   /wrapped/laso/get-card
//     POST   /wrapped/laso/get-card-data
//     GET    /status                      wallet deployment status
//
//   Build-with-Locus API (cfg.buildApiBase, https://api.buildwithlocus.com/v1):
//     POST   /auth/exchange               exchange claw_ key for 30d JWT
//     POST   /auth/refresh                refresh JWT
//     POST   /projects
//     POST   /projects/:id/environments
//     POST   /services
//     GET    /services/:id?include=runtime
//     PUT    /variables/service/:id
//     POST   /deployments
//     GET    /deployments/:id
//     DELETE /projects/:id
//
//   Webhook signature: HMAC-SHA256(rawBody, whsec_*) — header `X-Signature-256: sha256=<hex>`
//
// (*) The create-session endpoint is the merchant side of the Locus Checkout
// SDK (`@locus/agent-sdk` -> `locus.sessions.create(...)`). The SDK isn't on
// public npm yet, so we call it over HTTP. If the path is different on your
// environment, set LOCUS_CHECKOUT_CREATE_PATH in .env to override.

import crypto from 'node:crypto';

export function createRealLocus(cfg) {
  if (!cfg.apiKey) {
    throw new Error('LOCUS_API_KEY is required when LOCUS_MODE=real');
  }

  const sessionCreatePath = process.env.LOCUS_CHECKOUT_CREATE_PATH || '/checkout/sessions';

  let cachedBuildToken = null;
  let buildTokenExpiresAt = 0;

  async function buildToken() {
    if (cachedBuildToken && Date.now() < buildTokenExpiresAt - 60_000) return cachedBuildToken;
    const res = await fetch(`${cfg.buildApiBase}/auth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: cfg.apiKey }),
    });
    if (!res.ok) {
      throw new Error(`build auth/exchange failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    cachedBuildToken = data.token;
    buildTokenExpiresAt = Date.now() + 29 * 24 * 60 * 60 * 1000; // 29d
    return cachedBuildToken;
  }

  async function buildFetch(pathStr, init = {}) {
    const token = await buildToken();
    const res = await fetch(`${cfg.buildApiBase}${pathStr}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`build ${pathStr} ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async function locusFetch(pathStr, init = {}) {
    const res = await fetch(`${cfg.apiBase}${pathStr}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        authorization: `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`locus ${pathStr} ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? null : res.json();
  }

  // Unwraps the {success, data} envelope used by the main Locus API.
  function unwrap(resp) {
    if (resp && typeof resp === 'object' && 'success' in resp && 'data' in resp) return resp.data;
    return resp;
  }

  return {
    mode: 'real',

    // ─────────────────────── Wallet / balance ───────────────────────

    async walletBalance() {
      const d = unwrap(await locusFetch('/pay/balance'));
      return {
        balanceUsdc: Number(d.balance ?? d.balanceUsdc ?? 0),
        walletAddress: d.wallet_address || d.walletAddress || cfg.walletAddress || '',
      };
    },

    async sendUsdc({ to, amountUsdc, reason }) {
      // `to` may be an address or email. Docs: POST /pay/send.
      const body = {
        amount: String(amountUsdc),
        ...(to.includes('@') ? { email: to } : { address: to }),
        ...(reason ? { reason } : {}),
      };
      const d = unwrap(await locusFetch('/pay/send', {
        method: 'POST',
        body: JSON.stringify(body),
      }));
      return {
        txHash: d.txHash || d.transaction_hash || null,
        amountUsdc: Number(d.amount || amountUsdc),
      };
    },

    // ─────────────────────── Checkout (merchant side) ───────────────────────

    async createCheckoutSession({ amountUsdc, description, successUrl, cancelUrl, webhookUrl, metadata, receiptConfig }) {
      const d = unwrap(await locusFetch(sessionCreatePath, {
        method: 'POST',
        body: JSON.stringify({
          amount: String(amountUsdc),
          description,
          successUrl,
          cancelUrl,
          webhookUrl,
          metadata,
          ...(receiptConfig ? { receiptConfig } : {}),
        }),
      }));
      return {
        sessionId: d.id || d.sessionId,
        hostedUrl: d.hostedUrl || d.url || `${cfg.checkoutUrl}/${d.id || d.sessionId}`,
        expiresAt: d.expiresAt || null,
        webhookSecret: d.webhookSecret || null, // whsec_*
      };
    },

    async getCheckoutSession(sessionId) {
      const d = unwrap(await locusFetch(`/checkout/sessions/${sessionId}`));
      return {
        id: d.id,
        status: d.status, // PENDING | PAID | EXPIRED | CANCELLED
        amountUsdc: Number(d.amount || 0),
        paymentTxHash: d.paymentTxHash || null,
        payerAddress: d.payerAddress || null,
        paidAt: d.paidAt || null,
      };
    },

    verifyWebhookSignature(rawBody, signatureHeader) {
      if (!cfg.webhookSecret) return false;
      if (!signatureHeader) return false;
      const bodyStr = rawBody instanceof Buffer ? rawBody.toString('utf8') : String(rawBody);
      const expected = `sha256=${crypto
        .createHmac('sha256', cfg.webhookSecret)
        .update(bodyStr)
        .digest('hex')}`;
      const sig = signatureHeader.startsWith('sha256=') ? signatureHeader : `sha256=${signatureHeader}`;
      const a = Buffer.from(expected);
      const b = Buffer.from(sig);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    },

    // ─────────────────────── Sub-wallet (simulated escrow) ───────────────────────
    //
    // On the beta there is no documented HTTP endpoint for creating on-chain
    // ERC-4337 sub-wallets (they are a smart-contract primitive). For the
    // hackathon we model the "sub-wallet" as a named budget envelope backed by
    // the main Locus wallet. The user still gets real on-chain settlement:
    // they pay via Checkout (real USDC in), Laso pulls USDC out for the card,
    // and any remainder is refunded via /pay/send back to the payer's address.
    //
    // Returning a synthetic ID keeps the rest of the app simple.

    async createSubwallet({ amountUsdc, label }) {
      return {
        subwalletId: `sw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        balanceUsdc: Number(amountUsdc),
        label,
        synthetic: true,
      };
    },

    async refundSubwallet(/* subwalletId */) {
      // No-op here — real refund is driven by routes/quest.js via sendUsdc().
      return { refundedUsdc: 0, txHash: null, synthetic: true };
    },

    // ─────────────────────── Build-with-Locus ───────────────────────

    async deployQuestContainer({ questId, imageUri, env, region = 'us-east-1' }) {
      const project = await buildFetch('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: `fetch-quest-${String(questId).replace(/_/g, '-').slice(0, 30)}`,
          description: `Fetch quest ${questId}`,
          region,
        }),
      });
      const envObj = await buildFetch(`/projects/${project.id}/environments`, {
        method: 'POST',
        body: JSON.stringify({ name: 'production', type: 'production' }),
      });
      const service = await buildFetch('/services', {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.id,
          environmentId: envObj.id,
          name: 'runtime',
          source: { type: 'image', imageUri },
          runtime: {
            port: 8080,
            cpu: 256,
            memory: 1024,
            minInstances: 1,
            maxInstances: 1,
          },
          healthCheckPath: '/health',
        }),
      });
      if (env && Object.keys(env).length) {
        const variables = Object.entries(env).map(([key, value]) => ({ key, value: String(value) }));
        await buildFetch(`/variables/service/${service.id}`, {
          method: 'PUT',
          body: JSON.stringify({ variables }),
        }).catch(async (err) => {
          // Some environments accept a flat `{KEY: value}` object instead.
          console.warn('[build] variables PUT (array shape) failed, retrying flat:', err.message);
          await buildFetch(`/variables/service/${service.id}`, {
            method: 'PUT',
            body: JSON.stringify({ variables: env }),
          });
        });
      }
      const deployment = await buildFetch('/deployments', {
        method: 'POST',
        body: JSON.stringify({ serviceId: service.id }),
      });
      return {
        serviceId: service.id,
        projectId: project.id,
        environmentId: envObj.id,
        deploymentId: deployment.id,
        url: service.url || `https://svc-${service.id}.buildwithlocus.com`,
      };
    },

    async containerStatus(serviceId) {
      const svc = await buildFetch(`/services/${serviceId}?include=runtime`);
      return {
        status: svc.runtimeStatus || svc.status || 'unknown',
        url: svc.url,
        lastLogs: svc.lastLogs || [],
      };
    },

    async deploymentStatus(deploymentId) {
      const d = await buildFetch(`/deployments/${deploymentId}`);
      return { status: d.status, logs: d.logs || [] };
    },

    async teardownContainer(projectId) {
      if (!projectId) return { ok: true, skipped: true };
      await buildFetch(`/projects/${projectId}`, { method: 'DELETE' });
      return { ok: true };
    },

    // ─────────────────────── Laso Finance (wrapped API) ───────────────────────

    async lasoMerchantCompat(merchantHint) {
      if (!merchantHint) return { status: 'unknown' };
      const d = unwrap(await locusFetch('/wrapped/laso/search-merchants', {
        method: 'POST',
        body: JSON.stringify({ query: merchantHint }),
      }).catch(() => null));
      return d || { status: 'unknown' };
    },

    async mintLasoCard({ amountUsdc, merchantHint }) {
      if (merchantHint) {
        const compat = await this.lasoMerchantCompat(merchantHint);
        if (compat?.status === 'not_accepted') {
          throw new Error(`Laso: merchant '${merchantHint}' does not accept prepaid cards`);
        }
      }
      const order = unwrap(await locusFetch('/wrapped/laso/get-card', {
        method: 'POST',
        body: JSON.stringify({ amount: String(amountUsdc) }),
      }));
      const cardId = order.cardId || order.id || order.card_id;
      if (!cardId) {
        throw new Error(`Laso get-card did not return a card id: ${JSON.stringify(order)}`);
      }

      // Poll until status=ready (~7-10s per docs, cap at 40s)
      let detail = null;
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        detail = unwrap(await locusFetch('/wrapped/laso/get-card-data', {
          method: 'POST',
          body: JSON.stringify({ cardId }),
        }).catch(() => null));
        if (detail && (detail.status === 'ready' || detail.pan || detail.number)) break;
      }
      if (!detail || (!detail.pan && !detail.number)) {
        throw new Error('Laso card did not become ready within timeout');
      }
      return {
        cardId,
        pan: detail.pan || detail.number,
        cvv: detail.cvv,
        expMonth: detail.expMonth || detail.exp_month,
        expYear: detail.expYear || detail.exp_year,
        holderName: detail.holderName || detail.holder_name || 'FETCH',
        amountUsdc: Number(amountUsdc),
      };
    },

    async voidLasoCard(/* cardId */) {
      // Laso does not expose an explicit void — cards auto-expire once funds are spent.
      // Unused funds can be reclaimed via the `withdraw` wrapped endpoint; we defer
      // that to an ops task rather than blocking the quest settle path.
      return { ok: true };
    },
  };
}
