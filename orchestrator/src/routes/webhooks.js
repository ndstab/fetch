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
  const signature =
    req.header('x-signature-256') ||
    req.header('X-Signature-256') ||
    req.header('x-locus-signature'); // beta variants have been observed

  let payload;
  try {
    payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : req.body;
  } catch {
    return res.status(400).json({ error: 'invalid json' });
  }

  await logWebhook('locus_checkout', payload.event || payload.type || 'unknown', payload);

  const eventType = payload.event || payload.type;
  const sessionId =
    payload.data?.sessionId ||
    payload.data?.id ||
    payload.data?.session_id ||
    payload.sessionId;
  const quest = sessionId ? await getQuestByCheckoutSession(sessionId) : null;

  // Verify signature against the per-session whsec_* returned by sessions.create,
  // falling back to the global LOCUS_WEBHOOK_SECRET. If neither is configured
  // AND LOCUS_ALLOW_UNSIGNED_WEBHOOK is true, we accept the webhook with a
  // warning — this is the demo-tolerant default, because some beta environments
  // do not return a per-session secret yet.
  if (config.locus.mode === 'real') {
    const secret = quest?.webhook_secret || config.locus.webhookSecret;
    if (secret) {
      if (!verifySig(rawBody, signature, secret)) {
        console.warn(`[webhook] signature mismatch for session ${sessionId}`);
        return res.status(401).json({ error: 'invalid signature' });
      }
    } else if (!config.locus.allowUnsignedWebhook) {
      console.warn(`[webhook] no secret configured, rejecting (allowUnsigned=false)`);
      return res.status(401).json({ error: 'no webhook secret configured' });
    } else {
      console.warn(`[webhook] accepting UNSIGNED webhook for session ${sessionId} — set LOCUS_WEBHOOK_SECRET to tighten`);
    }
  }

  if (!quest) {
    console.warn(`[webhook] no quest for session ${sessionId}`);
    return res.json({ ok: true, ignored: true });
  }

  if (eventType === 'checkout.session.paid' || eventType === 'session.paid' || eventType === 'paid') {
    if (quest.status !== 'created') {
      return res.json({ ok: true, already: quest.status });
    }
    const payerAddress =
      payload.data?.payerAddress ||
      payload.data?.payer_address ||
      payload.data?.payer ||
      payload.data?.from ||
      payload.data?.sourceAddress ||
      null;
    const paymentTxHash =
      payload.data?.paymentTxHash ||
      payload.data?.payment_tx_hash ||
      payload.data?.tx_hash ||
      payload.data?.txHash ||
      payload.data?.transactionHash ||
      null;
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
  } else if (eventType === 'checkout.session.expired' || eventType === 'session.expired' || eventType === 'expired') {
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

  broadcast(quest.id, { type: 'status', status: 'hunting' });
  await updateQuest(quest.id, { status: 'hunting' });

  // Escrow bookkeeping. Tries the real sub-wallet endpoint first and falls
  // back to a budget envelope keyed by the main Locus wallet (still
  // accounted for end-to-end: Checkout in → Laso out → /pay/send refund).
  let subwalletId = null;
  try {
    const sw = await L.createSubwallet({
      amountUsdc: Number(quest.total_charged_usdc),
      label: `fetch-${quest.id}`,
    });
    subwalletId = sw.subwalletId;
    await updateQuest(quest.id, { subwallet_id: sw.subwalletId });
    await addTimeline(
      quest.id,
      'system',
      sw.synthetic
        ? `Budget envelope ${sw.subwalletId} · $${quest.total_charged_usdc} USDC (held in main wallet)`
        : `Sub-wallet ${sw.subwalletId} · $${quest.total_charged_usdc} USDC`,
      { level: 'success', detail: { synthetic: !!sw.synthetic, address: sw.address || null } },
    );
  } catch (err) {
    console.warn('[real quest] subwallet create failed:', err.message);
    await addTimeline(quest.id, 'system', `Sub-wallet setup skipped: ${err.message}`, { level: 'warn' });
  }

  // Container deploy — non-fatal. If Build-with-Locus is unreachable or the
  // image isn't pullable, we log a warning and continue with the orchestrator-
  // side flow so the quest still completes. Fresh accounts may not have the
  // Build API enabled yet; we don't want that to block money movement.
  try {
    await addTimeline(quest.id, 'system', `Container image: ${config.questImageUri}`);
    await addTimeline(quest.id, 'system', 'Deploying quest container on Build-with-Locus…');
    const container = await L.deployQuestContainer({
      questId: quest.id,
      imageUri: config.questImageUri,
      healthCheckPath: config.questHealthPath || '/health',
      env: {
        QUEST_ID: quest.id,
        ORCHESTRATOR_URL: config.publicUrl,
        SUBWALLET_ID: subwalletId || quest.subwallet_id || '',
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
  } catch (err) {
    console.warn('[real quest] container deploy failed:', err.message);
    await addTimeline(
      quest.id, 'system',
      `Container deploy skipped: ${err.message.slice(0, 200)}`,
      { level: 'warn' },
    );
  }

  // Drive plan/hunt/shortlist from the orchestrator. The Python quest-runtime
  // can take over once its phases are implemented; until then this ensures
  // users see motion on the dashboard and reach an `awaiting_pick` state.
  const { startSimulatedQuest: sim } = await import('../lib/quest-simulator.js');
  sim(quest.id, { skipContainerDeploy: true });
}
