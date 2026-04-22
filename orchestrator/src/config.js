import 'dotenv/config';

const required = (key) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
};

export const config = {
  port: Number(process.env.PORT || 3001),
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3001',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  databaseUrl: required('DATABASE_URL'),

  locus: {
    mode: process.env.LOCUS_MODE || 'mock', // 'mock' | 'real'
    apiKey: process.env.LOCUS_API_KEY || '',
    // Beta default: https://beta-api.paywithlocus.com/api
    // Production:   https://api.paywithlocus.com/api
    // The /api suffix is required — every path in locus/real.js is relative to this base.
    apiBase: process.env.LOCUS_API_BASE || 'https://beta-api.paywithlocus.com/api',
    // Beta claw_dev_ keys authenticate against the beta build API; prod keys use
    // https://api.buildwithlocus.com/v1. Keep the environment consistent with apiBase.
    buildApiBase: process.env.LOCUS_BUILD_API_BASE || 'https://beta-api.buildwithlocus.com/v1',
    webhookSecret: process.env.LOCUS_WEBHOOK_SECRET || '',
    allowUnsignedWebhook: String(process.env.LOCUS_ALLOW_UNSIGNED_WEBHOOK || 'true').toLowerCase() === 'true',
    walletAddress: process.env.LOCUS_WALLET_ADDRESS || '',
  },

  // A public arm64 image that passes an HTTP-200 health check. The default is a
  // well-known nginx image that works out-of-the-box; override with your own
  // quest-runtime image once you push it to a pullable registry.
  questImageUri: process.env.QUEST_IMAGE_URI || 'nginxinc/nginx-unprivileged:stable-alpine',
  questHealthPath: process.env.QUEST_HEALTH_PATH || '/',
  serviceFeeBps: Number(process.env.SERVICE_FEE_BPS || 1000), // basis points (1000 = 10%)

  // When set, Locus and laso.finance HTTP(S) use this proxy. Required for
  // /api/x402/laso-get-card if your runtime is outside the US (see
  // https://paywithlocus.com/laso.md — the endpoint is IP-locked to the US).
  proxy: {
    https: (process.env.HTTPS_PROXY || process.env.https_proxy || '').trim(),
    http: (process.env.HTTP_PROXY || process.env.http_proxy || '').trim(),
    noProxy: process.env.NO_PROXY || process.env.no_proxy || 'localhost,127.0.0.1',
  },
};
