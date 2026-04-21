import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { router as questRouter } from './routes/quest.js';
import { router as webhookRouter } from './routes/webhooks.js';
import { locus } from './locus/index.js';

const app = express();
app.use(cors());

// Webhook route uses raw body for signature verification
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRouter);

// Everything else is JSON
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, mode: config.locus.mode }));

app.use('/api/quest', questRouter);

// Mock-only helper: render a tiny stand-in checkout page
app.get('/mock/checkout/:sessionId', (req, res) => {
  res.type('html').send(`<!doctype html>
<meta charset="utf-8"><title>Fetch · Mock Checkout</title>
<style>body{font:16px ui-sans-serif,system-ui;max-width:520px;margin:80px auto;padding:0 24px;color:#111}
.card{border:1px solid #e5e7eb;border-radius:16px;padding:32px;background:#fff}
h1{margin:0 0 8px;font-size:22px}
p{color:#4b5563}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style>
<div class="card">
  <h1>Mock Checkout</h1>
  <p>Session <code>${req.params.sessionId}</code> was auto-paid ~2s after creation.</p>
  <p>In a real integration this page is rendered by Locus Checkout. You can now close this tab or return to the quest dashboard.</p>
</div>`);
});

// Boot
locus(); // warm up adapter + log mode
app.listen(config.port, () => {
  console.log(`[orchestrator] listening on http://localhost:${config.port}`);
  console.log(`[orchestrator] public url: ${config.publicUrl}`);
});
