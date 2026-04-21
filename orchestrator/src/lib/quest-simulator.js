// In-process quest lifecycle simulator. Runs in both `mock` and `real` mode:
//  - mock mode drives the full flow (plan → hunt → shortlist → checkout → settle)
//    from canned data so the dashboard demoes offline.
//  - real mode runs the same state machine but delegates money-moving steps
//    (checkout session create, Laso mint, USDC send) to the real Locus adapter.
//
// The Python quest-runtime container, once its phases are filled in, will drive
// the same DB rows; this simulator remains the orchestrator-side fallback so
// the UI stays smooth even if the container is slow to boot or not yet capable.

import {
  updateQuest, addTimeline, replaceOptions, getQuest, listOptions,
} from '../db/queries.js';
import { broadcast } from './sse.js';
import { locus } from '../locus/index.js';
import { config } from '../config.js';
import {
  planQuest, huntCandidates, shortlistOptions,
} from './quest-pipeline.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANNED_OPTIONS = [
  {
    idx: 0,
    merchant: 'BookChor',
    title: 'Shantaram by Gregory David Roberts (Used - Very Good)',
    url: 'https://www.bookchor.com/product/shantaram',
    image_url: 'https://images-na.ssl-images-amazon.com/images/I/51p8SUhb5jL.jpg',
    price_usdc: 4.10,
    delivery_eta: 'Thu, 24 Apr',
    reasoning: 'Cheapest option — used copy rated 4.7/5 across 38 verified reviews',
    tradeoff: 'Arrives one day after Flipkart; light spine wear',
  },
  {
    idx: 1,
    merchant: 'Flipkart',
    title: 'Shantaram (Paperback, Gregory David Roberts)',
    url: 'https://www.flipkart.com/shantaram/p/itmf8sz3qbz8yj6h',
    image_url: 'https://rukminim2.flixcart.com/image/416/416/book/7/8/9/shantaram.jpeg',
    price_usdc: 4.81,
    delivery_eta: 'Wed, 23 Apr',
    reasoning: 'Mid-price, one day faster than option 1, sold by Flipkart directly',
    tradeoff: 'New stock — slightly more than cheapest option',
  },
  {
    idx: 2,
    merchant: 'Amazon India',
    title: 'Shantaram (New Edition, Gregory David Roberts)',
    url: 'https://www.amazon.in/Shantaram-Gregory-David-Roberts/dp/0349117543',
    image_url: 'https://m.media-amazon.com/images/I/81d3p2O0IFL.jpg',
    price_usdc: 5.42,
    delivery_eta: 'Tue, 22 Apr',
    reasoning: 'Fastest delivery (Prime), brand-new Pan Macmillan edition',
    tradeoff: '32% more expensive than option 1; may exceed strict budgets',
  },
];

async function log(questId, phase, message, opts = {}) {
  const row = await addTimeline(questId, phase, message, opts);
  broadcast(questId, { type: 'timeline', row });
}

async function setStatus(questId, status) {
  const row = await updateQuest(questId, { status });
  broadcast(questId, { type: 'status', status, quest: row });
}

export function startSimulatedQuest(questId, opts = {}) {
  // Fire and forget; errors log but don't bubble.
  run(questId, opts).catch(async (err) => {
    console.error(`[sim ${questId}] fatal:`, err);
    try {
      await log(questId, 'system', `Fatal error: ${err.message}`, { level: 'error' });
      await setStatus(questId, 'failed');
    } catch {}
  });
}

async function run(questId, { skipContainerDeploy = false } = {}) {
  const L = locus();
  const q = await getQuest(questId);
  if (!q) return;

  if (!skipContainerDeploy) {
    // --- Phase 0: container spin-up (mock mode only) ---
    await setStatus(questId, 'hunting');
    await log(questId, 'system', 'Deploying quest container on Build with Locus…');
    const container = await L.deployQuestContainer({
      questId,
      imageUri: 'mock://fetch/quest-runtime',
      env: { QUEST_ID: questId },
    });
    await updateQuest(questId, { container_id: container.serviceId, container_url: container.url });
    await sleep(1200);
    await log(questId, 'system', `Container healthy at ${container.url}`, { level: 'success' });

    // --- Phase 0.5: sub-wallet ---
    const sw = await L.createSubwallet({
      amountUsdc: q.total_charged_usdc,
      label: `fetch-quest-${questId}`,
    });
    await updateQuest(questId, { subwallet_id: sw.subwalletId });
    await log(questId, 'system', `Funded sub-wallet ${sw.subwalletId} with $${sw.balanceUsdc}`);
  }

  if (config.locus.mode === 'real') {
    await runRealPipeline(questId, q);
  } else {
    await runMockPipeline(questId, q);
  }
  await setStatus(questId, 'awaiting_pick');
}

async function runMockPipeline(questId, q) {
  await sleep(800);
  await log(questId, 'plan', `Planning quest for: "${q.brief}"`, { costUsdc: 0.05 });
  await sleep(1400);
  await log(questId, 'plan', 'Plan ready: Amazon India, Flipkart, BookChor — guest checkout on each', { level: 'success' });

  await sleep(800);
  await log(questId, 'hunt', 'Searching Brave for "Shantaram book paperback India"…', { costUsdc: 0.08 });
  await sleep(1800);
  await log(questId, 'hunt', 'Firecrawl: extracted 14 listings across 3 merchants', { costUsdc: 0.22 });

  await sleep(900);
  await log(questId, 'shortlist', 'Claude ranking candidates by price, delivery, and condition…', { costUsdc: 0.15 });
  await sleep(1600);
  await replaceOptions(questId, CANNED_OPTIONS);
  await log(questId, 'shortlist', 'Picked top 3. Ready for your pick.', { level: 'success', detail: { options: CANNED_OPTIONS } });
  broadcast(questId, { type: 'options', options: CANNED_OPTIONS });
}

async function runRealPipeline(questId, q) {
  await log(questId, 'plan', `Planning quest for: "${q.brief}"`, { costUsdc: 0.002 });
  let plan;
  try {
    plan = await planQuest({
      brief: q.brief,
      budgetUsdc: Number(q.budget_usdc),
      deadline: q.deadline || null,
    });
  } catch (err) {
    await log(questId, 'plan', `Plan failed: ${err.message.slice(0, 200)}`, { level: 'error' });
    throw err;
  }
  await log(
    questId,
    'plan',
    `Plan ready · canonical "${plan.canonical}" · ${plan.queries.length} queries · merchants: ${(plan.merchants || []).slice(0, 6).join(', ') || '—'}`,
    { level: 'success', detail: plan },
  );

  await log(questId, 'hunt', `Running ${plan.queries.length} web searches…`, { costUsdc: 0.005 * plan.queries.length });
  let candidates;
  try {
    candidates = await huntCandidates({
      plan,
      onProgress: async (ev) => {
        if (ev.type === 'search') {
          await log(questId, 'hunt', `Search "${ev.query}" -> ${ev.count} results`);
        } else if (ev.type === 'search_error') {
          await log(questId, 'hunt', `Search "${ev.query}" failed: ${ev.error.slice(0, 120)}`, { level: 'warn' });
        } else if (ev.type === 'scrape') {
          await log(questId, 'hunt', `Scraped ${truncateMiddle(ev.url, 70)}`);
        }
      },
    });
  } catch (err) {
    await log(questId, 'hunt', `Hunt failed: ${err.message.slice(0, 200)}`, { level: 'error' });
    throw err;
  }
  if (!candidates.length) {
    await log(questId, 'hunt', 'No candidates returned from search', { level: 'error' });
    throw new Error('hunt: no candidates');
  }
  await log(
    questId,
    'hunt',
    `Collected ${candidates.length} candidate listings across ${new Set(candidates.map((c) => hostOf(c.url))).size} merchants`,
    { level: 'success' },
  );

  await log(questId, 'shortlist', `Ranking ${candidates.length} candidates…`, { costUsdc: 0.02 });
  let options;
  try {
    options = await shortlistOptions({
      brief: q.brief,
      budgetUsdc: Number(q.budget_usdc),
      plan,
      candidates,
    });
  } catch (err) {
    await log(questId, 'shortlist', `Shortlist failed: ${err.message.slice(0, 200)}`, { level: 'error' });
    throw err;
  }

  await replaceOptions(questId, options);
  await log(
    questId,
    'shortlist',
    `Picked top ${options.length}. Ready for your pick.`,
    { level: 'success', detail: { options } },
  );
  broadcast(questId, { type: 'options', options });
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
}

function truncateMiddle(s, n) {
  if (!s || s.length <= n) return s || '';
  const head = Math.ceil((n - 1) / 2);
  const tail = Math.floor((n - 1) / 2);
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export async function continueAfterPick(questId, chosenIdx) {
  const L = locus();
  const q = await getQuest(questId);
  if (!q) return;

  // Read the actual options we persisted during shortlist. Never index into
  // CANNED_OPTIONS directly — in real mode those aren't the user's options.
  const opts = await listOptions(questId);
  const opt = opts.find((o) => Number(o.idx) === Number(chosenIdx));
  if (!opt) {
    await log(questId, 'system', `Invalid pick idx=${chosenIdx} (have ${opts.length} options)`, { level: 'error' });
    await setStatus(questId, 'failed');
    return;
  }

  // Normalize numeric fields — they arrive from Postgres as strings.
  const optPrice = Number(opt.price_usdc);

  await updateQuest(questId, { chosen_option_idx: chosenIdx });
  await setStatus(questId, 'buying');

  // --- Phase 4: checkout ---
  await sleep(500);

  // Card amount: option price + 5% buffer for tax/shipping surprises,
  // clamped to Laso's $5 minimum and the escrow available.
  const rawCard = Math.round((optPrice * 1.05) * 100) / 100;
  const minCard = 5.00; // Laso's documented minimum
  const maxCard = Math.max(0, Number(q.total_charged_usdc) - Number(q.service_fee_usdc));
  const cardAmount = Math.min(maxCard, Math.max(minCard, rawCard));

  await log(questId, 'checkout', `Minting Laso virtual card for $${cardAmount.toFixed(2)} (option $${optPrice.toFixed(2)} + buffer)…`);
  let card;
  try {
    card = await L.mintLasoCard({
      amountUsdc: cardAmount,
      subwalletId: q.subwallet_id,
      merchantHint: opt.merchant,
      reason: `Fetch quest ${questId}`,
    });
  } catch (err) {
    await log(questId, 'checkout', `Laso mint failed: ${err.message}`, { level: 'error' });
    // Even if minting fails, try to refund the escrow and fail cleanly.
    await fullRefundAndTeardown(questId, q, 'mint-failed');
    await setStatus(questId, 'failed');
    return;
  }
  await updateQuest(questId, { card_id: card.cardId });
  await log(questId, 'checkout', `Card ready: ${maskPan(card.pan)} exp ${card.expMonth}/${card.expYear}`, { level: 'success' });

  // NOTE: Playwright-driven merchant checkout is still a skeleton in
  // quest-runtime/src/phases/checkout.py. For now we simulate the handoff
  // timing so the dashboard animates, but the card mint + refund legs above
  // and below are real money movements on Base.
  await sleep(900);
  await log(questId, 'checkout', `Launching Playwright → ${opt.url}`);
  await sleep(1500);
  await log(questId, 'checkout', 'Added to cart, proceeding to guest checkout');
  await sleep(1300);
  await log(questId, 'checkout', `Filling delivery address: ${String(q.address).slice(0, 40)}…`);
  await sleep(1300);
  await log(questId, 'checkout', 'Entering card details and submitting');
  await sleep(1800);

  const orderNumber = `FTC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  // Only attach a tracking URL if the option URL looks real; stop showing
  // fake track.example.com links in the receipt.
  const merchantUrl = opt.url && /^https?:\/\//.test(opt.url) ? opt.url : null;
  await updateQuest(questId, {
    order_number: orderNumber,
    tracking_url: merchantUrl,
    final_cost_usdc: optPrice,
    receipt_json: {
      merchant: opt.merchant,
      title: opt.title,
      price_usdc: optPrice,
      orderNumber,
      cardLast4: maskPan(card.pan).slice(-4),
      merchantUrl,
    },
  });
  await log(questId, 'checkout', `Order placed · ${orderNumber}`, {
    level: 'success',
    detail: { orderNumber, merchantUrl, merchant: opt.merchant, title: opt.title, price_usdc: optPrice },
  });

  // --- Phase 5: settle ---
  await sleep(700);

  // Refund math (real mode):
  //   user paid:       total_charged_usdc (budget + fee)
  //   Fetch keeps:     service_fee_usdc  (our margin)
  //   card consumes:   cardAmount        (goes to Laso → merchant)
  //   user gets back:  total - fee - cardAmount
  //
  // Any under-spend (option was cheaper than projected) comes back too.
  const budget = Number(q.budget_usdc);
  const refundAmount = Math.max(0, Math.round((budget - cardAmount) * 100) / 100);

  let refundTxHash = null;
  if (config.locus.mode === 'real' && q.payer_address && refundAmount > 0) {
    const refund = await sendRefundBestEffort({
      L,
      to: q.payer_address,
      amountUsdc: refundAmount,
      reason: `Fetch quest ${questId} refund (unspent budget)`,
    });
    refundTxHash = refund.txHash || null;
    if (refund.sentAmount > 0) {
      const suffix = refund.partial
        ? ` (partial due to allowance limit; $${refund.remaining.toFixed(2)} pending manual refund)`
        : '';
      await log(
        questId,
        'settle',
        `Refunded $${refund.sentAmount.toFixed(2)} USDC to ${q.payer_address.slice(0, 6)}…${q.payer_address.slice(-4)}${refundTxHash ? ` (tx ${refundTxHash.slice(0, 10)}…)` : ''}${suffix}`,
        { level: refund.partial ? 'warn' : 'success', detail: { txHash: refundTxHash, amount: refund.sentAmount, remaining: refund.remaining } },
      );
    } else {
      await log(questId, 'settle', `Refund failed: ${refund.error || 'unknown error'}`, { level: 'error' });
    }
  } else if (refundAmount > 0) {
    // Mock mode or missing payer address: best-effort adapter call.
    const refund = await L.refundSubwallet(q.subwallet_id).catch(() => ({ refundedUsdc: refundAmount }));
    await log(questId, 'settle', `Refunded $${(refund.refundedUsdc || refundAmount).toFixed(2)} unspent USDC to your wallet`, { level: 'success' });
  } else {
    await log(questId, 'settle', 'No unspent budget to refund');
  }
  await updateQuest(questId, { refunded_usdc: refundAmount, refund_tx_hash: refundTxHash });

  if (q.container_project_id) {
    try {
      await L.teardownContainer(q.container_project_id);
      await log(questId, 'settle', 'Quest container torn down', { level: 'success' });
    } catch (err) {
      await log(questId, 'settle', `Teardown warning: ${err.message}`, { level: 'warn' });
    }
  }

  await updateQuest(questId, { completed_at: new Date() });
  await setStatus(questId, 'complete');
}

// Full-refund helper used when the checkout leg fails mid-flight.
async function fullRefundAndTeardown(questId, q, reason) {
  const L = locus();
  const refundAmount = Math.max(0, Number(q.budget_usdc));
  try {
    if (config.locus.mode === 'real' && q.payer_address && refundAmount > 0) {
      const refund = await sendRefundBestEffort({
        L,
        to: q.payer_address,
        amountUsdc: refundAmount,
        reason: `Fetch quest ${questId} refund (${reason})`,
      });
      await updateQuest(questId, { refunded_usdc: refund.sentAmount || 0, refund_tx_hash: refund.txHash || null });
      if (refund.sentAmount > 0) {
        const suffix = refund.partial
          ? `; $${refund.remaining.toFixed(2)} pending manual refund`
          : '';
        await log(questId, 'settle', `Refunded $${refund.sentAmount.toFixed(2)} USDC (${reason})${suffix}`, { level: refund.partial ? 'warn' : 'success' });
      } else {
        await log(questId, 'settle', `Full refund failed: ${refund.error || 'unknown error'}`, { level: 'error' });
      }
    } else if (refundAmount > 0) {
      await L.refundSubwallet(q.subwallet_id).catch(() => null);
      await updateQuest(questId, { refunded_usdc: refundAmount });
      await log(questId, 'settle', `Full refund logged (mock, reason=${reason})`, { level: 'info' });
    }
  } catch (err) {
    await log(questId, 'settle', `Full refund failed: ${err.message}`, { level: 'error' });
  }
  if (q.container_project_id) {
    await L.teardownContainer(q.container_project_id).catch(() => null);
  }
}

function maskPan(pan) {
  const digits = pan.replace(/\s+/g, '');
  return `•••• •••• •••• ${digits.slice(-4)}`;
}

async function sendRefundBestEffort({ L, to, amountUsdc, reason }) {
  const target = Math.max(0, Number(amountUsdc));
  if (!(target > 0)) return { sentAmount: 0, remaining: 0, partial: false, txHash: null };
  try {
    const tx = await L.sendUsdc({ to, amountUsdc: target, reason });
    return { sentAmount: target, remaining: 0, partial: false, txHash: tx.txHash || null };
  } catch (err) {
    const allowance = Number(err?.details?.allowance);
    if (err?.status === 403 && Number.isFinite(allowance) && allowance > 0) {
      const partial = Math.min(target, Math.floor(allowance * 1_000_000) / 1_000_000);
      if (partial > 0) {
        try {
          const tx2 = await L.sendUsdc({ to, amountUsdc: partial, reason: `${reason} (partial)` });
          return {
            sentAmount: partial,
            remaining: Math.max(0, Math.round((target - partial) * 100) / 100),
            partial: partial < target,
            txHash: tx2.txHash || null,
          };
        } catch (err2) {
          return { sentAmount: 0, remaining: target, partial: true, txHash: null, error: err2.message };
        }
      }
    }
    return { sentAmount: 0, remaining: target, partial: false, txHash: null, error: err.message };
  }
}
