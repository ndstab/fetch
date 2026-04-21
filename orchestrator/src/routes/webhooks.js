import express from 'express';
import {
  getQuestByCheckoutSession, updateQuest, addTimeline, logWebhook,
} from '../db/queries.js';
import { locus } from '../locus/index.js';
import { broadcast } from '../lib/sse.js';
import { startSimulatedQuest } from '../lib/quest-simulator.js';
import { config } from '../config.js';

export const router = express.Router();

// Raw body required for signature verification.
// Mounted with express.raw() in index.js for this route.
router.post('/checkout', async (req, res) => {
  const L = locus();
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
  const signature = req.header('x-locus-signature') || req.header('x-signature-256');

  // Mock mode: always trust. Real mode: must verify.
  if (config.locus.mode === 'real' && !L.verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  let payload;
  try {
    payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : req.body;
  } catch {
    return res.status(400).json({ error: 'invalid json' });
  }

  await logWebhook('locus_checkout', payload.type || 'unknown', payload);

  if (payload.type === 'checkout.session.paid') {
    const sessionId = payload.data?.sessionId || payload.data?.id;
    const quest = await getQuestByCheckoutSession(sessionId);
    if (!quest) {
      console.warn(`[webhook] no quest for session ${sessionId}`);
      return res.json({ ok: true, ignored: true });
    }
    if (quest.status !== 'created') {
      return res.json({ ok: true, already: quest.status });
    }
    await updateQuest(quest.id, { status: 'paid', paid_at: new Date() });
    await addTimeline(quest.id, 'system', `Payment received — $${quest.total_charged_usdc} USDC`, { level: 'success' });
    broadcast(quest.id, { type: 'status', status: 'paid' });

    if (config.locus.mode === 'mock') {
      // In mock mode, drive the whole quest locally.
      startSimulatedQuest(quest.id);
    } else {
      // In real mode, deploy the container; it handles the rest.
      deployQuestInBackground(quest).catch((err) => console.error('[deploy]', err));
    }
  }

  res.json({ ok: true });
});

async function deployQuestInBackground(quest) {
  const L = locus();
  await addTimeline(quest.id, 'system', 'Deploying quest container on Build with Locus…');
  broadcast(quest.id, { type: 'status', status: 'hunting' });
  await updateQuest(quest.id, { status: 'hunting' });

  const sw = await L.createSubwallet({
    amountUsdc: quest.total_charged_usdc,
    label: `fetch-quest-${quest.id}`,
  });
  await updateQuest(quest.id, { subwallet_id: sw.subwalletId });
  await addTimeline(quest.id, 'system', `Sub-wallet funded: ${sw.subwalletId}`);

  const container = await L.deployQuestContainer({
    questId: quest.id,
    imageUri: config.questImageUri,
    env: {
      QUEST_ID: quest.id,
      ORCHESTRATOR_URL: config.publicUrl,
      SUBWALLET_ID: sw.subwalletId,
      LOCUS_API_KEY: config.locus.apiKey,
    },
  });
  await updateQuest(quest.id, {
    container_id: container.serviceId,
    container_url: container.url,
  });
  await addTimeline(quest.id, 'system', `Container deployed: ${container.url}`, { level: 'success' });
}
