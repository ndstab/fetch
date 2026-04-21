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
    apiBase: process.env.LOCUS_API_BASE || 'https://api.paywithlocus.com',
    buildApiBase: process.env.LOCUS_BUILD_API_BASE || 'https://api.buildwithlocus.com/v1',
    webhookSecret: process.env.LOCUS_WEBHOOK_SECRET || '',
  },

  questImageUri: process.env.QUEST_IMAGE_URI || 'registry.example.com/fetch/quest-runtime:latest',
  serviceFeeBps: Number(process.env.SERVICE_FEE_BPS || 1000), // basis points (1000 = 10%)
};
