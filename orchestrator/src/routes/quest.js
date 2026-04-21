import express from 'express';
import { nanoid } from 'nanoid';
import {
  insertQuest, getQuest, listTimeline, listOptions, updateQuest, addTimeline,
} from '../db/queries.js';
import { subscribe, broadcast } from '../lib/sse.js';
import { locus } from '../locus/index.js';
import { continueAfterPick } from '../lib/quest-simulator.js';
import { config } from '../config.js';

export const router = express.Router();

// ── POST /api/quest/create ─────────────────────────────────────────────────
// Body: { brief, address, phone, email, budgetUsdc, deadline?, autoconfirm? }
// Creates a quest row (status='created') and a Locus checkout session.
// Returns the session so the frontend can redirect or embed it.
router.post('/create', async (req, res) => {
  try {
    const { brief, address, phone, email, budgetUsdc, deadline, autoconfirm = false } = req.body || {};
    if (!brief || !address || !phone || !email || !budgetUsdc) {
      return res.status(400).json({ error: 'missing required field(s)' });
    }
    const budget = Number(budgetUsdc);
    if (!(budget > 0)) return res.status(400).json({ error: 'budget must be > 0' });

    const fee = Math.round(budget * config.serviceFeeBps / 10_000 * 100) / 100;
    const total = Math.round((budget + fee) * 100) / 100;
    const id = `qst_${nanoid(10)}`;

    const L = locus();
    const session = await L.createCheckoutSession({
      amountUsdc: total,
      description: `Fetch quest: ${brief.slice(0, 60)}`,
      successUrl: `${config.frontendUrl}/quest/${id}`,
      cancelUrl: `${config.frontendUrl}/?cancelled=${id}`,
      webhookUrl: `${config.publicUrl}/webhooks/checkout`,
      metadata: { questId: id },
    });

    let quest = await insertQuest({
      id, userId: null, brief, address, phone, email,
      budgetUsdc: budget, serviceFeeUsdc: fee, totalChargedUsdc: total,
      deadline: deadline || null, autoconfirm,
      checkoutSessionId: session.sessionId,
    });
    if (session.webhookSecret) {
      quest = await updateQuest(id, { webhook_secret: session.webhookSecret });
    }

    res.json({
      quest,
      checkout: { sessionId: session.sessionId, hostedUrl: session.hostedUrl },
    });
  } catch (err) {
    console.error('[quest.create]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/quest/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const q = await getQuest(req.params.id);
  if (!q) return res.status(404).json({ error: 'not found' });
  const [timeline, options] = await Promise.all([
    listTimeline(req.params.id),
    listOptions(req.params.id),
  ]);
  res.json({ quest: q, timeline, options });
});

// ── GET /api/quest/:id/stream ──────────────────────────────────────────────
// SSE endpoint — emits `timeline`, `status`, `options` events.
router.get('/:id/stream', async (req, res) => {
  const q = await getQuest(req.params.id);
  if (!q) return res.status(404).json({ error: 'not found' });
  subscribe(req.params.id, res);

  // Replay what's already persisted so a reconnect doesn't miss anything
  const [timeline, options] = await Promise.all([
    listTimeline(req.params.id),
    listOptions(req.params.id),
  ]);
  res.write(`event: snapshot\ndata: ${JSON.stringify({ quest: q, timeline, options })}\n\n`);
});

// ── POST /api/quest/:id/pick  { idx } ──────────────────────────────────────
router.post('/:id/pick', async (req, res) => {
  const { id } = req.params;
  const { idx } = req.body || {};
  if (typeof idx !== 'number') return res.status(400).json({ error: 'idx required' });
  const q = await getQuest(id);
  if (!q) return res.status(404).json({ error: 'not found' });
  if (q.status !== 'awaiting_pick') {
    return res.status(409).json({ error: `cannot pick while status=${q.status}` });
  }
  // Both modes: drive Phase 4+5 from the orchestrator. In real mode, the Laso
  // mint + USDC refund are real network calls; in mock mode they're in-memory.
  // The Python container's own checkout phase will eventually take over the
  // Playwright step once it's implemented; until then the orchestrator owns
  // the state machine so the pick-to-settle flow is never stranded.
  await updateQuest(id, { chosen_option_idx: idx, status: 'buying' });
  continueAfterPick(id, idx).catch((err) => console.error('[pick]', err));
  res.json({ ok: true });
});

// ── POST /api/quest/:id/cancel ─────────────────────────────────────────────
router.post('/:id/cancel', async (req, res) => {
  const { id } = req.params;
  const q = await getQuest(id);
  if (!q) return res.status(404).json({ error: 'not found' });
  if (['complete', 'cancelled', 'failed'].includes(q.status)) {
    return res.json({ ok: true, already: true });
  }
  await updateQuest(id, { status: 'cancelled' });
  // Best-effort teardown + refund. Never throw back from cancel; a user-driven
  // cancel must always succeed locally even if remote cleanup fails.
  try {
    const L = locus();
    if (q.container_project_id) {
      await L.teardownContainer(q.container_project_id).catch((err) => console.warn('[cancel teardown]', err.message));
    }
    if (config.locus.mode === 'real' && q.payer_address && q.status !== 'created') {
      // Refund budget (not the fee) since no purchase happened.
      const refundAmount = Number(q.budget_usdc);
      if (refundAmount > 0) {
        await L.sendUsdc({
          to: q.payer_address,
          amountUsdc: refundAmount,
          reason: `Fetch quest ${q.id} cancelled`,
        }).catch((err) => console.warn('[cancel refund]', err.message));
      }
    } else if (q.subwallet_id) {
      await L.refundSubwallet(q.subwallet_id).catch(() => null);
    }
  } catch (err) {
    console.error('[cancel teardown]', err);
  }
  res.json({ ok: true });
});

router.post('/:id/reconcile-payment', async (req, res) => {
  const { id } = req.params;
  const q = await getQuest(id);
  if (!q) return res.status(404).json({ error: 'not found' });
  if (!q.checkout_session_id) return res.status(400).json({ error: 'missing checkout_session_id' });
  if (q.status !== 'created') return res.json({ ok: true, already: q.status, reconciled: false });

  const L = locus();
  const session = await L.getCheckoutSession(q.checkout_session_id);
  const status = String(session.status || '').toUpperCase();

  if (status !== 'PAID') {
    return res.json({ ok: true, reconciled: false, sessionStatus: session.status || 'unknown' });
  }

  const payload = {
    type: 'checkout.session.paid',
    data: {
      sessionId: q.checkout_session_id,
      payerAddress: session.payerAddress || null,
      paymentTxHash: session.paymentTxHash || null,
    },
  };
  const webhookRes = await fetch(`${config.publicUrl}/webhooks/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!webhookRes.ok) {
    await updateQuest(id, {
      status: 'paid',
      paid_at: new Date(),
      payer_address: session.payerAddress || null,
      payment_tx_hash: session.paymentTxHash || null,
    });
    await addTimeline(
      id,
      'system',
      `Payment received — $${q.total_charged_usdc} USDC${session.paymentTxHash ? ` (tx ${session.paymentTxHash.slice(0, 10)}…)` : ''}`,
      { level: 'success' },
    );
    broadcast(id, { type: 'status', status: 'paid' });
  }

  const refreshed = await getQuest(id);
  res.json({
    ok: true,
    reconciled: true,
    sessionStatus: session.status || 'PAID',
    questStatus: refreshed?.status || 'paid',
  });
});
