import express from 'express';
import crypto from 'node:crypto';
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
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
  const signature = req.header('x-signature-256') || req.header('X-Signature-256');

  let payload;
  try {
    payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : req.body;
  } catch {
    return res.status(400).json({ error: 'invalid json' });
  }

  await logWebhook('locus_checkout', payload.event || payload.type || 'unknown', payload);

  const eventType = payload.event || payload.type;
  const sessionId = payload.data?.sessionId || payload.data?.id;
  const quest = sessionId ? await getQuestByCheckoutSession(sessionId) : null;

  // Verify signature against the per-session whsec_* returned by sessions.create.
  // Falls back to the global LOCUS_WEBHOOK_SECRET for backwards compatibility.
  if (config.locus.mode === 'real') {
    const secret = quest?.webhook_secret || config.locus.webhookSecret;
    if (!secret || !verifySig(rawBody, signature, secret)) {
      return res.status(401).json({ error: 'invalid signature' });
    }
  }

  if (!quest) {
    console.warn(`[webhook] no quest for session ${sessionId}`);
    return res.json({ ok: true, ignored: true });
  }

  if (eventType === 'checkout.session.paid') {
    if (quest.status !== 'created') {
      return res.json({ ok: true, already: quest.status });
    }
    const payerAddress = payload.data?.payerAddress || payload.data?.payer_address;
    const paymentTxHash = payload.data?.paymentTxHash || payload.data?.tx_hash;
    await updateQuest(quest.id, {
      status: 'paid',
      paid_at: new Date(),
      payer_address: payerAddress || null,
      payment_tx_hash: paymentTxHash || null,
    });
    await addTimeline(
      quest.id, 'system',
      `Payment received — $${quest.total_charged_usdc} USDC${paymentTxHash ? ` (tx ${paymentTxHash.slice(0, 10)}…)` : ''}`,
      { level: 'success' },
    );
    broadcast(quest.id, { type: 'status', status: 'paid' });

    if (config.locus.mode === 'mock') {
      startSimulatedQuest(quest.id);
    } else {
      runRealQuest({ ...quest, payer_address: payerAddress || quest.payer_address })
        .catch((err) => {
          console.error('[real quest]', err);
          addTimeline(quest.id, 'system', `Quest failed: ${err.message}`, { level: 'error' });
          updateQuest(quest.id, { status: 'failed' });
          broadcast(quest.id, { type: 'status', status: 'failed' });
        });
    }
  } else if (eventType === 'checkout.session.expired') {
    if (quest.status === 'created') {
      await updateQuest(quest.id, { status: 'cancelled' });
      await addTimeline(quest.id, 'system', 'Checkout session expired without payment', { level: 'warn' });
      broadcast(quest.id, { type: 'status', status: 'cancelled' });
    }
  }

  res.json({ ok: true });
});

function verifySig(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const bodyStr = rawBody instanceof Buffer ? rawBody.toString('utf8') : String(rawBody);
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')}`;
  const provided = signatureHeader.startsWith('sha256=') ? signatureHeader : `sha256=${signatureHeader}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Drives a real-mode quest: deploy container on Build-with-Locus, let it run.
// For the hackathon, the quest-runtime phases are still TODO inside the
// container; the orchestrator-side simulator fills in until the Python phases
// are implemented. The key real-integration signal here is that a Build-with-
// Locus project/service/deployment is created and visible on the user's
// dashboard.
async function runRealQuest(quest) {
  const L = locus();

  await addTimeline(quest.id, 'system', 'Deploying quest container on Build-with-Locus…');
  broadcast(quest.id, { type: 'status', status: 'hunting' });
  await updateQuest(quest.id, { status: 'hunting' });

  // Escrow bookkeeping — the "sub-wallet" is a named budget envelope. The real
  // USDC is held in the orchestrator's Locus wallet.
  const sw = await L.createSubwallet({
    amountUsdc: quest.total_charged_usdc,
    label: `fetch-${quest.id}`,
  });
  await updateQuest(quest.id, { subwallet_id: sw.subwalletId });
  await addTimeline(quest.id, 'system', `Escrow envelope ${sw.subwalletId} · $${quest.total_charged_usdc} USDC`);

  // Deploy the container. The image URI must be one Locus's registry can pull
  // (public Docker Hub image, or one pushed to Locus's registry).
  const container = await L.deployQuestContainer({
    questId: quest.id,
    imageUri: config.questImageUri,
    env: {
      QUEST_ID: quest.id,
      ORCHESTRATOR_URL: config.publicUrl,
      SUBWALLET_ID: sw.subwalletId,
      LOCUS_API_KEY: config.locus.apiKey,
      LOCUS_API_BASE: config.locus.apiBase,
      BRIEF: quest.brief,
      BUDGET_USDC: String(quest.budget_usdc),
      ADDRESS: quest.address,
      PHONE: quest.phone,
      EMAIL: quest.email,
    },
  });
  await updateQuest(quest.id, {
    container_id: container.serviceId,
    container_url: container.url,
    container_project_id: container.projectId,
    container_env_id: container.environmentId,
    deployment_id: container.deploymentId,
  });
  await addTimeline(
    quest.id, 'system',
    `Container deploying · ${container.url}`,
    { level: 'success', detail: { projectId: container.projectId, deploymentId: container.deploymentId } },
  );

  // Until the Python runtime phases are filled in, drive the post-deploy
  // simulation from the orchestrator so the dashboard keeps moving.
  // This lets the user see *real* container deployment + *real* wallet traffic
  // while the search/checkout phases remain simulated.
  const { startSimulatedQuest: sim } = await import('../lib/quest-simulator.js');
  sim(quest.id, { skipContainerDeploy: true });
}
