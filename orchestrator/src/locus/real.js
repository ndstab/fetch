// Real Locus HTTP client. Same shape as mock.js — swappable via LOCUS_MODE.
//
// Every endpoint below was verified against:
//   https://paywithlocus.com/skill.md        (canonical agent API reference)
//   https://paywithlocus.com/checkout.md     (Checkout with Locus)
//   https://paywithlocus.com/laso.md         (Laso Finance)
//   https://buildwithlocus.com/SKILL.md      (Build with Locus)
// plus live probes against the beta environment on 2026-04-21.
//
// Endpoint map (only endpoints Locus actually exposes — no guesses):
//
//   Main API (cfg.apiBase, e.g. https://beta-api.paywithlocus.com/api):
//     GET    /pay/balance
//     POST   /pay/send                        body: { to_address, amount, memo }
//     POST   /pay/send-email                  body: { email, amount, memo, expires_in_days? }
//     GET    /pay/transactions[/:id]
//     POST   /checkout/sessions               merchant creates a session
//     GET    /checkout/sessions/:id           fetch session state
//     GET    /checkout/agent/preflight/:id    agent-side preflight before paying
//     POST   /checkout/agent/pay/:id          agent pays a session
//     GET    /checkout/agent/payments[/:txId] payment history / status
//     POST   /x402/laso-auth                  Laso paid auth ($0.001) — returns id_token
//     POST   /x402/laso-get-card              Laso order card (dynamic cost, US only)
//     GET    /status                          wallet deployment status
//     POST   /feedback
//
//   Laso free endpoints (https://laso.finance, Bearer id_token from laso-auth):
//     GET    /get-card-data?card_id=...
//     GET    /search-merchants?q=...
//     GET    /get-account-balance
//     POST   /withdraw                        body: { amount }
//
//   Build-with-Locus API (cfg.buildApiBase):
//     Beta:       https://beta-api.buildwithlocus.com/v1
//     Production: https://api.buildwithlocus.com/v1
//     POST   /auth/exchange                   body: { apiKey } -> { token, expiresIn }
//     POST   /projects
//     POST   /projects/:id/environments
//     POST   /services
//     GET    /services/:id?include=runtime
//     PUT    /variables/service/:id
//     POST   /deployments
//     GET    /deployments/:id
//     DELETE /projects/:id
//
// Things that are NOT HTTP endpoints (do not try to reach them):
//   - Sub-wallets are an on-chain primitive (ERC-4337 UserOperation calling
//     `createAndFundSubwalletUSDC` on the smart wallet). There is no REST API
//     for it. We therefore model per-quest budgets as a synthetic "envelope"
//     tracked locally, while real USDC still moves through Checkout -> Laso ->
//     /pay/send. This is the documented pattern in CLAUDE.md.
//   - There is no JS SDK on npm for merchant-side session creation. The
//     `locus-agent-sdk` reference in checkout.md is for *paying* sessions,
//     not creating them. Session creation is only via the HTTP POST above.

import crypto from 'node:crypto';
import { proxyFetch } from '../lib/proxyFetch.js';

const LASO_FREE_BASE = 'https://laso.finance';
const FALLBACK_IMAGE_URI = 'nginxinc/nginx-unprivileged:stable-alpine';
const IMAGE_URI_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*(?::[a-zA-Z0-9._\-]+)?(?:@sha256:[a-f0-9]+)?$/;

export function createRealLocus(cfg) {
  if (!cfg.apiKey) {
    throw new Error('LOCUS_API_KEY is required when LOCUS_MODE=real');
  }
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    console.log('[locus] HTTPS_PROXY set — x402 and laso.finance calls route via proxy (Laso get-card is US-IP-locked: https://paywithlocus.com/laso.md)');
  }
  if (!/\/api\/?$/.test(cfg.apiBase)) {
    console.warn(`[locus] LOCUS_API_BASE should end in "/api" (got ${cfg.apiBase}). Requests may 404 until this is fixed.`);
  }

  const apiBase = cfg.apiBase.replace(/\/$/, '');
  const buildApiBase = cfg.buildApiBase.replace(/\/$/, '');

  let cachedBuildToken = null;
  let buildTokenExpiresAt = 0;

  let lasoSession = null;

  async function buildToken(force = false) {
    if (!force && cachedBuildToken && Date.now() < buildTokenExpiresAt - 60_000) return cachedBuildToken;
    const res = await proxyFetch(`${buildApiBase}/auth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: cfg.apiKey }),
    });
    if (!res.ok) {
      throw new Error(`build auth/exchange failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    cachedBuildToken = data.token || data.accessToken || data.jwt;
    if (!cachedBuildToken) {
      throw new Error(`build auth/exchange returned no token: ${JSON.stringify(data)}`);
    }
    buildTokenExpiresAt = Date.now() + 29 * 24 * 60 * 60 * 1000; // 29d
    return cachedBuildToken;
  }

  async function buildFetch(pathStr, init = {}, { retriedAuth = false } = {}) {
    const token = await buildToken();
    const res = await proxyFetch(`${buildApiBase}${pathStr}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });
    if (res.status === 401 && !retriedAuth) {
      cachedBuildToken = null;
      await buildToken(true);
      return buildFetch(pathStr, init, { retriedAuth: true });
    }
    if (!res.ok) {
      throw new Error(`build ${pathStr} ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async function locusFetch(pathStr, init = {}, { ok404 = false } = {}) {
    const res = await proxyFetch(`${apiBase}${pathStr}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        authorization: `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json',
      },
    });
    if (ok404 && res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch {}
      const detail = parsed?.message || parsed?.error || text;
      const err = new Error(`locus ${pathStr} ${res.status}: ${detail}`);
      err.status = res.status;
      err.body = parsed;
      err.details = parsed?.details || null;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  function unwrap(resp) {
    if (resp && typeof resp === 'object' && 'success' in resp && 'data' in resp) return resp.data;
    return resp;
  }

  async function lasoAuth(force = false) {
    if (!force && lasoSession && Date.now() < lasoSession.expiresAt - 60_000) return lasoSession;
    const d = unwrap(await locusFetch('/x402/laso-auth', {
      method: 'POST',
      body: JSON.stringify({}),
    }));
    const auth = d?.auth || d;
    const idToken = auth?.id_token || auth?.idToken;
    if (!idToken) {
      throw new Error(`laso-auth returned no id_token: ${JSON.stringify(d).slice(0, 200)}`);
    }
    const ttlSec = Number(auth?.expires_in || auth?.expiresIn || 3600);
    lasoSession = {
      idToken,
      refreshToken: auth?.refresh_token || auth?.refreshToken || null,
      userId: d?.user_id || d?.userId || null,
      expiresAt: Date.now() + ttlSec * 1000,
    };
    return lasoSession;
  }

  async function lasoFreeFetch(pathStr, init = {}) {
    const sess = await lasoAuth();
    const res = await proxyFetch(`${LASO_FREE_BASE}${pathStr}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        authorization: `Bearer ${sess.idToken}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (res.status === 401) {
      await lasoAuth(true);
      return lasoFreeFetch(pathStr, init);
    }
    if (!res.ok) {
      throw new Error(`laso.finance ${pathStr} ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    mode: 'real',

    async walletBalance() {
      const d = unwrap(await locusFetch('/pay/balance'));
      return {
        balanceUsdc: Number(d.usdc_balance ?? d.balance ?? d.balanceUsdc ?? 0),
        walletAddress: d.wallet_address || d.walletAddress || cfg.walletAddress || '',
        workspaceId: d.workspace_id || d.workspaceId || null,
        allowance: Number(d.allowance ?? 0),
      };
    },

    async sendUsdc({ to, amountUsdc, reason }) {
      if (!to) throw new Error('sendUsdc: `to` is required');
      const amt = Number(amountUsdc);
      if (!(amt > 0)) throw new Error(`sendUsdc: amount must be > 0, got ${amountUsdc}`);
      const memo = reason ? String(reason).slice(0, 500) : 'Fetch transfer';
      const isEmail = /@/.test(to);
      const path = isEmail ? '/pay/send-email' : '/pay/send';
      const body = isEmail
        ? { email: to, amount: amt, memo }
        : { to_address: to, amount: amt, memo };
      const d = unwrap(await locusFetch(path, {
        method: 'POST',
        body: JSON.stringify(body),
      }));
      return {
        txHash: d.tx_hash || d.txHash || null,
        transactionId: d.transaction_id || d.transactionId || null,
        amountUsdc: Number(d.amount || amt),
        status: d.status || 'QUEUED',
        approvalUrl: d.approval_url || d.approvalUrl || null,
      };
    },

    async createCheckoutSession({ amountUsdc, description, successUrl, cancelUrl, webhookUrl, metadata, expiresInMinutes = 30 }) {
      const baseBody = {
        amount: String(amountUsdc),
        description,
        ...(successUrl ? { successUrl } : {}),
        ...(cancelUrl ? { cancelUrl } : {}),
        ...(metadata ? { metadata } : {}),
        expiresInMinutes,
        receiptConfig: { enabled: true, whiteLabel: false },
      };
      let raw;
      try {
        raw = await locusFetch('/checkout/sessions', {
          method: 'POST',
          body: JSON.stringify({
            ...baseBody,
            ...(webhookUrl ? { webhookUrl } : {}),
          }),
        });
      } catch (err) {
        // Locus beta currently returns a generic 500 for localhost/non-public
        // webhook URLs. For local dev, retry once without webhookUrl so quest
        // creation can proceed. Webhook-less sessions require manual poll/pay flow.
        const isWebhookCreate500 = err?.status === 500 && /Failed to create checkout session/i.test(err?.message || '');
        if (isWebhookCreate500 && webhookUrl) {
          console.warn(`[locus] checkout session create failed with webhookUrl (${webhookUrl}); retrying without webhookUrl`);
          raw = await locusFetch('/checkout/sessions', {
            method: 'POST',
            body: JSON.stringify(baseBody),
          });
        } else {
          throw err;
        }
      }
      const d = unwrap(raw);
      const sessionId = d.id || d.sessionId || d.session_id;
      if (!sessionId) {
        throw new Error(`checkout.sessions.create: no session id in response: ${JSON.stringify(d).slice(0, 200)}`);
      }
      return {
        sessionId,
        hostedUrl: d.checkoutUrl || d.hostedUrl || d.hosted_url || d.url || null,
        expiresAt: d.expiresAt || d.expires_at || null,
        webhookSecret: d.webhookSecret || d.webhook_secret || null,
      };
    },

    async getCheckoutSession(sessionId) {
      const d = unwrap(await locusFetch(`/checkout/sessions/${sessionId}`));
      return {
        id: d.id,
        status: d.status,
        amountUsdc: Number(d.amount || 0),
        currency: d.currency || 'USDC',
        paymentTxHash: d.paymentTxHash || d.payment_tx_hash || null,
        payerAddress: d.payerAddress || d.payer_address || null,
        paidAt: d.paidAt || d.paid_at || null,
        expiresAt: d.expiresAt || d.expires_at || null,
      };
    },

    async preflightCheckoutSession(sessionId) {
      const resp = await locusFetch(`/checkout/agent/preflight/${sessionId}`);
      return {
        canPay: !!resp.canPay,
        blockers: resp.blockers || [],
        agent: resp.agent || null,
        session: resp.session || null,
      };
    },

    async payCheckoutSession(sessionId, { payerEmail } = {}) {
      const d = unwrap(await locusFetch(`/checkout/agent/pay/${sessionId}`, {
        method: 'POST',
        body: JSON.stringify(payerEmail ? { payerEmail } : {}),
      }));
      return {
        transactionId: d.transaction_id || d.transactionId || d.id || null,
        status: d.status || 'PENDING',
      };
    },

    async getCheckoutPayment(transactionId) {
      const d = unwrap(await locusFetch(`/checkout/agent/payments/${transactionId}`));
      return {
        id: d.id || transactionId,
        status: d.status,
        txHash: d.tx_hash || d.txHash || null,
        sessionId: d.session_id || d.sessionId || null,
      };
    },

    verifyWebhookSignature(rawBody, signatureHeader, overrideSecret) {
      const secret = overrideSecret || cfg.webhookSecret;
      if (!secret || !signatureHeader) return false;
      const bodyStr = rawBody instanceof Buffer ? rawBody.toString('utf8') : String(rawBody);
      const expected = `sha256=${crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')}`;
      const sig = signatureHeader.startsWith('sha256=') ? signatureHeader : `sha256=${signatureHeader}`;
      const a = Buffer.from(expected);
      const b = Buffer.from(sig);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    },

    // Locus does NOT expose a REST sub-wallet API — sub-wallets are on-chain
    // only (`createAndFundSubwalletUSDC` via a UserOperation on the user's
    // smart wallet). For hackathon scope we track budgets as synthetic
    // envelopes here and move real USDC through Checkout / Laso / /pay/send.
    async createSubwallet({ amountUsdc, label }) {
      return {
        subwalletId: `sw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        balanceUsdc: Number(amountUsdc),
        label,
        synthetic: true,
      };
    },

    async refundSubwallet(subwalletId) {
      return { refundedUsdc: 0, txHash: null, synthetic: true, subwalletId };
    },

    async deployQuestContainer({ questId, imageUri, env, region = 'us-east-1', healthCheckPath = '/health' }) {
      const normalizedImageUri = String(imageUri || '').trim();
      const safeImageUri = IMAGE_URI_PATTERN.test(normalizedImageUri) ? normalizedImageUri : FALLBACK_IMAGE_URI;
      if (!IMAGE_URI_PATTERN.test(normalizedImageUri)) {
        console.warn(`[build] invalid imageUri "${normalizedImageUri}" — falling back to ${FALLBACK_IMAGE_URI}`);
      }
      const project = await buildFetch('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: `fetch-quest-${String(questId).replace(/_/g, '-').slice(0, 30)}`,
          description: `Fetch quest ${questId}`,
          region,
        }),
      });
      const projectId = project.id || project.projectId;
      const envObj = await buildFetch(`/projects/${projectId}/environments`, {
        method: 'POST',
        body: JSON.stringify({ name: 'production', type: 'production' }),
      });
      const envId = envObj.id || envObj.environmentId;
      const service = await buildFetch('/services', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          environmentId: envId,
          name: 'runtime',
          source: { type: 'image', imageUri: safeImageUri },
          runtime: {
            port: 8080,
            cpu: 256,
            memory: 1024,
            minInstances: 1,
            maxInstances: 1,
          },
          healthCheckPath,
        }),
      });
      const serviceId = service.id || service.serviceId;
      if (env && Object.keys(env).length) {
        const variables = Object.fromEntries(
          Object.entries(env).map(([k, v]) => [k, String(v)]),
        );
        await buildFetch(`/variables/service/${serviceId}`, {
          method: 'PUT',
          body: JSON.stringify({ variables }),
        }).catch((err) => console.warn('[build] variables PUT failed:', err.message));
      }
      let deploymentId = null;
      try {
        const deployment = await buildFetch('/deployments', {
          method: 'POST',
          body: JSON.stringify({ serviceId }),
        });
        deploymentId = deployment.id || deployment.deploymentId || null;
      } catch (err) {
        console.warn('[build] explicit deploy trigger failed (may auto-deploy on service create):', err.message);
      }
      return {
        serviceId,
        projectId,
        environmentId: envId,
        deploymentId,
        url: service.url || `https://svc-${serviceId}.buildwithlocus.com`,
      };
    },

    async containerStatus(serviceId) {
      const svc = await buildFetch(`/services/${serviceId}?include=runtime`);
      return {
        status: svc.runtimeStatus || svc.status || 'unknown',
        url: svc.url,
        runtimeInstances: svc.runtime_instances || svc.runtimeInstances || null,
      };
    },

    async deploymentStatus(deploymentId) {
      const d = await buildFetch(`/deployments/${deploymentId}`);
      return {
        status: d.status,
        durationMs: d.durationMs || null,
        lastLogs: d.lastLogs || [],
        phaseTimestamps: d.metadata?.phaseTimestamps || null,
      };
    },

    async teardownContainer(projectId) {
      if (!projectId) return { ok: true, skipped: true };
      await buildFetch(`/projects/${projectId}`, { method: 'DELETE' });
      return { ok: true };
    },

    async lasoMerchantCompat(merchantHint) {
      if (!merchantHint) return { status: 'unknown' };
      try {
        const q = encodeURIComponent(merchantHint);
        const resp = await lasoFreeFetch(`/search-merchants?q=${q}`);
        const merchants = resp?.merchants || [];
        if (!merchants.length) return { status: 'unknown', merchants: [] };
        const best = merchants[0];
        return {
          status: best.status || 'unknown',
          merchants,
          match: best,
        };
      } catch (err) {
        console.warn('[laso] search-merchants failed:', err.message);
        return { status: 'unknown', error: err.message };
      }
    },

    async mintLasoCard({ amountUsdc, merchantHint, reason }) {
      const amt = Number(amountUsdc);
      if (!(amt >= 5)) {
        throw new Error(`Laso: card amount $${amt} is below the $5.00 minimum`);
      }
      if (amt > 1000) {
        throw new Error(`Laso: card amount $${amt} exceeds the $1,000.00 maximum`);
      }

      if (merchantHint) {
        const compat = await this.lasoMerchantCompat(merchantHint);
        if (compat?.status === 'not_accepted') {
          throw new Error(`Laso: merchant '${merchantHint}' does not accept prepaid cards`);
        }
      }

      const order = unwrap(await locusFetch('/x402/laso-get-card', {
        method: 'POST',
        body: JSON.stringify({ amount: amt }),
      }));
      if (order?.auth?.id_token) {
        const ttlSec = Number(order.auth.expires_in || 3600);
        lasoSession = {
          idToken: order.auth.id_token,
          refreshToken: order.auth.refresh_token || null,
          userId: order.user_id || null,
          expiresAt: Date.now() + ttlSec * 1000,
        };
      }
      const cardId = order?.card?.card_id || order?.card?.cardId || order?.cardId;
      if (!cardId) {
        throw new Error(`Laso get-card returned no card_id: ${JSON.stringify(order).slice(0, 200)}`);
      }

      let detail = null;
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 2500));
        try {
          detail = await lasoFreeFetch(`/get-card-data?card_id=${encodeURIComponent(cardId)}`);
        } catch (err) {
          console.warn('[laso] get-card-data poll failed:', err.message);
          continue;
        }
        if (detail?.status === 'ready' && detail?.card_details) break;
      }
      const cd = detail?.card_details;
      if (!cd?.card_number) {
        throw new Error('Laso card did not become ready within timeout');
      }
      return {
        cardId,
        pan: cd.card_number,
        cvv: cd.cvv,
        expMonth: cd.exp_month,
        expYear: cd.exp_year,
        holderName: cd.cardholder_name || 'FETCH',
        amountUsdc: amt,
        reason,
      };
    },

    async voidLasoCard() {
      // Laso cards auto-expire once the balance is spent. There's no explicit
      // void endpoint. Leftover balance can be reclaimed via `withdraw`:
      //   POST https://laso.finance/withdraw  { amount }
      // We leave that to an ops script rather than blocking the quest flow.
      return { ok: true };
    },

    async lasoWithdraw(amountUsdc) {
      const amt = Number(amountUsdc);
      if (!(amt >= 0.01)) throw new Error('laso withdraw: amount must be >= $0.01');
      const resp = await lasoFreeFetch('/withdraw', {
        method: 'POST',
        body: JSON.stringify({ amount: amt }),
      });
      return resp?.withdrawal || resp;
    },
  };
}
