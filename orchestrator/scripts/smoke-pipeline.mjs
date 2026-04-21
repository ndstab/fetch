import { planQuest, huntCandidates, shortlistOptions } from '../src/lib/quest-pipeline.js';

const brief = process.argv[2] || 'a stainless steel reusable water bottle 750ml under $20';
const budget = Number(process.argv[3] || 20);

console.log('[smoke] brief:', brief, '| budget:', budget);

const plan = await planQuest({ brief, budgetUsdc: budget });
console.log('[smoke] plan:', JSON.stringify(plan, null, 2));

const candidates = await huntCandidates({
  plan,
  onProgress: async (ev) => console.log('[smoke] hunt', ev.type, ev.query || ev.url || '', ev.count ?? ev.error ?? ''),
});
console.log(`[smoke] candidates: ${candidates.length}`);

const options = await shortlistOptions({ brief, budgetUsdc: budget, plan, candidates });
console.log('[smoke] options:');
for (const o of options) {
  console.log(`  #${o.idx} · ${o.merchant} · $${o.price_usdc} · ${o.title.slice(0, 60)}`);
  console.log(`     ${o.url}`);
  console.log(`     reasoning: ${o.reasoning}`);
}
