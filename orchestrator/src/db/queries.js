// Thin SQL helpers. Kept at the boundary so route handlers stay small.

import { query } from './pool.js';

export async function insertQuest(q) {
  const {
    id, userId, brief, address, phone, email,
    budgetUsdc, serviceFeeUsdc, totalChargedUsdc,
    deadline, autoconfirm, checkoutSessionId,
  } = q;
  const { rows } = await query(
    `INSERT INTO quests
       (id, user_id, brief, address, phone, email,
        budget_usdc, service_fee_usdc, total_charged_usdc,
        deadline, autoconfirm, checkout_session_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [id, userId, brief, address, phone, email,
     budgetUsdc, serviceFeeUsdc, totalChargedUsdc,
     deadline, autoconfirm, checkoutSessionId],
  );
  return rows[0];
}

export async function getQuest(id) {
  const { rows } = await query('SELECT * FROM quests WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function getQuestByCheckoutSession(sessionId) {
  const { rows } = await query('SELECT * FROM quests WHERE checkout_session_id = $1', [sessionId]);
  return rows[0] || null;
}

export async function updateQuest(id, patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return getQuest(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => patch[k]);
  const { rows } = await query(
    `UPDATE quests SET ${sets} WHERE id = $1 RETURNING *`,
    [id, ...values],
  );
  return rows[0];
}

export async function addTimeline(questId, phase, message, { level = 'info', detail = null, costUsdc = null } = {}) {
  const { rows } = await query(
    `INSERT INTO quest_timeline (quest_id, phase, level, message, detail, cost_usdc)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [questId, phase, level, message, detail, costUsdc],
  );
  return rows[0];
}

export async function listTimeline(questId) {
  const { rows } = await query(
    `SELECT * FROM quest_timeline WHERE quest_id = $1 ORDER BY created_at ASC, id ASC`,
    [questId],
  );
  return rows;
}

export async function timelineSince(questId, sinceId) {
  const { rows } = await query(
    `SELECT * FROM quest_timeline
     WHERE quest_id = $1 AND id > $2
     ORDER BY id ASC`,
    [questId, sinceId],
  );
  return rows;
}

export async function replaceOptions(questId, options) {
  await query('DELETE FROM quest_options WHERE quest_id = $1', [questId]);
  for (const o of options) {
    await query(
      `INSERT INTO quest_options
         (quest_id, idx, merchant, title, url, image_url, price_usdc, delivery_eta, reasoning, tradeoff, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [questId, o.idx, o.merchant, o.title, o.url, o.image_url,
       o.price_usdc, o.delivery_eta, o.reasoning, o.tradeoff, o.raw || null],
    );
  }
}

export async function listOptions(questId) {
  const { rows } = await query(
    `SELECT * FROM quest_options WHERE quest_id = $1 ORDER BY idx ASC`,
    [questId],
  );
  return rows;
}

export async function logWebhook(source, eventType, raw) {
  await query(
    `INSERT INTO webhook_events (source, event_type, raw) VALUES ($1,$2,$3)`,
    [source, eventType, raw],
  );
}
