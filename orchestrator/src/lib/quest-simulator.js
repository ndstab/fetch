// In-process quest lifecycle simulator. Used when LOCUS_MODE=mock so the
// dashboard can be demoed without a real container. Writes timeline rows and
// options to Postgres on the same schedule a real quest-runtime would.
//
// The real quest-runtime (Python, running inside a Build-with-Locus container)
// will write identical rows, so the frontend doesn't care which is driving.

import {
  updateQuest, addTimeline, replaceOptions, getQuest,
} from '../db/queries.js';
import { broadcast } from './sse.js';
import { locus } from '../locus/index.js';

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

export function startSimulatedQuest(questId) {
  // Fire and forget; errors log but don't bubble.
  run(questId).catch(async (err) => {
    console.error(`[sim ${questId}] fatal:`, err);
    try {
      await log(questId, 'system', `Fatal error: ${err.message}`, { level: 'error' });
      await setStatus(questId, 'failed');
    } catch {}
  });
}

async function run(questId) {
  const L = locus();
  const q = await getQuest(questId);
  if (!q) return;

  // --- Phase 0: container spin-up ---
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

  // --- Phase 1: plan ---
  await sleep(800);
  await log(questId, 'plan', `Planning quest for: "${q.brief}"`, { costUsdc: 0.05 });
  await sleep(1400);
  await log(questId, 'plan', 'Plan ready: Amazon India, Flipkart, BookChor — guest checkout on each', { level: 'success' });

  // --- Phase 2: hunt ---
  await sleep(800);
  await log(questId, 'hunt', 'Searching Brave for "Shantaram book paperback India"…', { costUsdc: 0.08 });
  await sleep(1800);
  await log(questId, 'hunt', 'Firecrawl: extracted 14 listings across 3 merchants', { costUsdc: 0.22 });

  // --- Phase 3: shortlist ---
  await sleep(900);
  await log(questId, 'shortlist', 'Claude ranking candidates by price, delivery, and condition…', { costUsdc: 0.15 });
  await sleep(1600);
  await replaceOptions(questId, CANNED_OPTIONS);
  await log(questId, 'shortlist', 'Picked top 3. Ready for your pick.', { level: 'success', detail: { options: CANNED_OPTIONS } });
  broadcast(questId, { type: 'options', options: CANNED_OPTIONS });

  await setStatus(questId, 'awaiting_pick');
  // Quest pauses here. continueAfterPick() below drives Phase 4+5.
}

export async function continueAfterPick(questId, chosenIdx) {
  const L = locus();
  const q = await getQuest(questId);
  if (!q) return;
  const opt = CANNED_OPTIONS[chosenIdx];
  if (!opt) {
    await log(questId, 'system', `Invalid pick idx=${chosenIdx}`, { level: 'error' });
    return;
  }

  await updateQuest(questId, { chosen_option_idx: chosenIdx });
  await setStatus(questId, 'buying');

  // --- Phase 4: checkout ---
  await sleep(500);
  await log(questId, 'checkout', `Minting virtual Locus card for $${opt.price_usdc} + 5% buffer…`);
  const cardAmount = Math.round((opt.price_usdc * 1.05) * 100) / 100;
  const card = await L.mintLasoCard({
    amountUsdc: cardAmount,
    subwalletId: q.subwallet_id,
    merchantHint: opt.merchant,
  });
  await updateQuest(questId, { card_id: card.cardId });
  await log(questId, 'checkout', `Card ready: ${maskPan(card.pan)} exp ${card.expMonth}/${card.expYear}`, { level: 'success' });

  await sleep(900);
  await log(questId, 'checkout', `Launching Playwright → ${opt.url}`);
  await sleep(1500);
  await log(questId, 'checkout', 'Added to cart, proceeding to guest checkout');
  await sleep(1300);
  await log(questId, 'checkout', `Filling delivery address: ${q.address.slice(0, 40)}…`);
  await sleep(1300);
  await log(questId, 'checkout', 'Entering card details and submitting');
  await sleep(1800);

  const orderNumber = `FTC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const trackingUrl = `https://track.example.com/${orderNumber}`;
  await updateQuest(questId, {
    order_number: orderNumber,
    tracking_url: trackingUrl,
    final_cost_usdc: opt.price_usdc,
    receipt_json: { merchant: opt.merchant, title: opt.title, price_usdc: opt.price_usdc, orderNumber, trackingUrl },
  });
  await log(questId, 'checkout', `Order placed! ${orderNumber}`, {
    level: 'success',
    detail: { orderNumber, trackingUrl, merchant: opt.merchant, title: opt.title, price_usdc: opt.price_usdc },
  });

  // --- Phase 5: settle ---
  await sleep(700);
  const refund = await L.refundSubwallet(q.subwallet_id);
  await updateQuest(questId, { refunded_usdc: refund.refundedUsdc });
  await log(questId, 'settle', `Refunded $${refund.refundedUsdc.toFixed(2)} unspent USDC to your wallet`, { level: 'success' });

  await L.teardownContainer(`proj_for_${q.container_id}`);
  await log(questId, 'settle', 'Quest container torn down', { level: 'success' });

  await updateQuest(questId, { completed_at: new Date() });
  await setStatus(questId, 'complete');
}

function maskPan(pan) {
  const digits = pan.replace(/\s+/g, '');
  return `•••• •••• •••• ${digits.slice(-4)}`;
}
