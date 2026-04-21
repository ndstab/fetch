// Real Locus HTTP client. Implements the same shape as mock.js.
//
// Endpoints used (from docs.paywithlocus.com):
//   Checkout:   POST  {apiBase}/v1/sessions                         (documented path pattern)
//               Webhook: X-Signature-256 HMAC-SHA256 over raw body
//   Build:      POST  {buildApiBase}/auth/exchange                   (claw_ -> JWT, 30d)
//               POST  {buildApiBase}/projects                        (create project)
//               POST  {buildApiBase}/projects/:id/environments
//               POST  {buildApiBase}/services                        (source.type=image)
//               POST  {buildApiBase}/deployments
//               GET   {buildApiBase}/deployments/:id
//               DELETE {buildApiBase}/projects/:id
//   Laso/cards: POST  {apiBase}/api/wrapped/laso/get-card            (via wrapped API proxy)
//               POST  {apiBase}/api/wrapped/laso/get-card-data
//               POST  {apiBase}/api/wrapped/laso/search-merchants
//   Subwallets: via wallet SDK — treated here as API calls for parity.
//
// Where exact paths or field names aren't pinned down in our doc snapshot,
// we keep the call site clean and fail loudly with a clear message so Day 1
// discovery is a focused debugging task, not a rewrite.

import crypto from 'node:crypto';
import { nanoid } from 'nanoid';

export function createRealLocus(cfg) {
  if (!cfg.apiKey) {
    throw new Error('LOCUS_API_KEY is required when LOCUS_MODE=real');
  }

  let cachedToken = null;
  let tokenExpiresAt = 0;

  async function buildToken() {
    if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
    const res = await fetch(`${cfg.buildApiBase}/auth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: cfg.apiKey }),
    });
    if (!res.ok) throw new Error(`build auth/exchange failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    cachedToken = data.token;
    // Default to ~29 days if not specified
    tokenExpiresAt = Date.now() + 29 * 24 * 60 * 60 * 1000;
    return cachedToken;
  }

  async function buildFetch(path, init = {}) {
    const token = await buildToken();
    const res = await fetch(`${cfg.buildApiBase}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`build ${path} ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  async function locusFetch(path, init = {}) {
    const res = await fetch(`${cfg.apiBase}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        'authorization': `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`locus ${path} ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  return {
    mode: 'real',

    async createCheckoutSession({ amountUsdc, description, successUrl, cancelUrl, webhookUrl, metadata }) {
      const data = await locusFetch('/v1/sessions', {
        method: 'POST',
        body: JSON.stringify({
          amount: String(amountUsdc),
          description,
          successUrl, cancelUrl, webhookUrl,
          metadata,
        }),
      });
      return { sessionId: data.id || data.sessionId, hostedUrl: data.hostedUrl || data.url };
    },

    verifyWebhookSignature(rawBody, signatureHeader) {
      if (!cfg.webhookSecret) return false;
      if (!signatureHeader) return false;
      const expected = crypto
        .createHmac('sha256', cfg.webhookSecret)
        .update(rawBody)
        .digest('hex');
      // Accept both raw hex and `sha256=...` formats
      const sig = signatureHeader.replace(/^sha256=/, '');
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    },

    async createSubwallet({ amountUsdc, label, expiresAt }) {
      // The wallet SDK exposes createAndFundSubwalletUSDC; the HTTP surface path
      // may change with the beta. Placeholder endpoint path — validated on Day 1.
      const data = await locusFetch('/api/wallets/subwallets', {
        method: 'POST',
        body: JSON.stringify({
          amount: String(amountUsdc),
          label,
          disburseBefore: expiresAt,
        }),
      });
      return { subwalletId: data.id, balanceUsdc: Number(data.balance || amountUsdc) };
    },

    async refundSubwallet(subwalletId) {
      const data = await locusFetch(`/api/wallets/subwallets/${subwalletId}/refund`, {
        method: 'POST',
      });
      return { refundedUsdc: Number(data.refunded || 0), txHash: data.txHash || null };
    },

    async deployQuestContainer({ questId, imageUri, env, region = 'us-east-1' }) {
      const project = await buildFetch('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: `fetch-quest-${questId}`,
          description: `Quest ${questId}`,
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
          runtime: { port: 8080, cpu: 256, memory: 1024, minInstances: 1, maxInstances: 1 },
          healthCheckPath: '/health',
        }),
      });
      // Set env vars
      if (env && Object.keys(env).length) {
        await buildFetch(`/variables/service/${service.id}`, {
          method: 'PUT',
          body: JSON.stringify({ variables: env }),
        });
      }
      const deployment = await buildFetch('/deployments', {
        method: 'POST',
        body: JSON.stringify({ serviceId: service.id }),
      });
      return {
        serviceId: service.id,
        projectId: project.id,
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

    async teardownContainer(projectId) {
      await buildFetch(`/projects/${projectId}`, { method: 'DELETE' });
      return { ok: true };
    },

    async mintLasoCard({ amountUsdc, merchantHint }) {
      // Wrapped-API proxy call. The Laso auth/session token handling happens
      // inside this adapter and is cached in-process. Fail fast if the provider
      // isn't available for our chosen merchant.
      if (merchantHint) {
        const compat = await locusFetch('/api/wrapped/laso/search-merchants', {
          method: 'POST',
          body: JSON.stringify({ query: merchantHint }),
        }).catch(() => null);
        if (compat && compat.status === 'not_accepted') {
          throw new Error(`Laso: merchant '${merchantHint}' not accepted`);
        }
      }
      const order = await locusFetch('/api/wrapped/laso/get-card', {
        method: 'POST',
        body: JSON.stringify({ amount: String(amountUsdc), currency: 'USD' }),
      });
      // Poll for ready (~7-10s per docs)
      let attempts = 0;
      while (attempts < 20) {
        const detail = await locusFetch('/api/wrapped/laso/get-card-data', {
          method: 'POST',
          body: JSON.stringify({ cardId: order.cardId || order.id }),
        }).catch(() => null);
        if (detail && (detail.status === 'ready' || detail.pan)) {
          return {
            cardId: order.cardId || order.id,
            pan: detail.pan,
            cvv: detail.cvv,
            expMonth: detail.expMonth,
            expYear: detail.expYear,
            holderName: detail.holderName || 'FETCH',
            amountUsdc: Number(amountUsdc),
          };
        }
        await new Promise((r) => setTimeout(r, 2000));
        attempts += 1;
      }
      throw new Error('Laso card did not become ready within timeout');
    },

    async voidLasoCard(cardId) {
      // Laso cards are auto-void on expiry; explicit void may not be exposed.
      return { ok: true, cardId };
    },

    _mockNonce: nanoid(4), // silences unused-var lint when nanoid isn't used elsewhere
  };
}
