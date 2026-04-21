import express from 'express';
import { nanoid } from 'nanoid';
import {
  insertQuest, getQuest, listTimeline, listOptions, updateQuest,
} from '../db/queries.js';
import { subscribe } from '../lib/sse.js';
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

    const quest = await insertQuest({
      id, userId: null, brief, address, phone, email,
      budgetUsdc: budget, serviceFeeUsdc: fee, totalChargedUsdc: total,
      deadline: deadline || null, autoconfirm,
      checkoutSessionId: session.sessionId,
    });

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
  // In mock mode, simulator runs Phase 4+5 locally. In real mode, the quest
  // container polls for the pick and drives its own checkout.
  if (config.locus.mode === 'mock') {
    continueAfterPick(id, idx).catch((err) => console.error('[pick]', err));
  } else {
    // Stamp the pick; the running container's poller picks it up.
    await updateQuest(id, { chosen_option_idx: idx, status: 'buying' });
  }
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
  // Best-effort teardown + refund
  try {
    const L = locus();
    if (q.container_id) await L.teardownContainer(`proj_for_${q.container_id}`);
    if (q.subwallet_id) await L.refundSubwallet(q.subwallet_id);
  } catch (err) {
    console.error('[cancel teardown]', err);
  }
  res.json({ ok: true });
});
