// Real plan/hunt/shortlist pipeline. Used by the orchestrator in `real` mode.
//
// Phase 1 (plan):      Claude turns the user brief into search queries.
// Phase 2 (hunt):      Firecrawl search resolves queries into candidate listings.
//                      Top candidates are scraped to pull real prices/images.
// Phase 3 (shortlist): Claude ranks candidates into exactly 3 options (strict JSON).
//
// Every phase writes to the orchestrator Postgres via db/queries and broadcasts
// through SSE; the UI layer stays unchanged.

import { claudeJSON, firecrawlSearch, firecrawlScrape } from './wrapped.js';

const MAX_QUERIES = 3;
const RESULTS_PER_QUERY = 6;
const SCRAPE_TOP_N = 6;
const SHORTLIST_MODEL = 'claude-sonnet-4-5';
const PLAN_MODEL = 'claude-haiku-4-5';

export async function planQuest({ brief, budgetUsdc, deadline }) {
  const prompt = [
    `User brief: ${brief}`,
    `Budget (USDC ≈ USD): ${budgetUsdc}`,
    deadline ? `Deadline: ${deadline}` : null,
    '',
    'Return strict JSON with this schema:',
    '{',
    '  "canonical": string,                // normalized product description for search',
    '  "queries": string[],                // 2–3 diverse web-search queries (target likely merchants)',
    '  "merchants": string[],              // candidate merchant domains (e.g. amazon.in, amazon.com, flipkart.com, bookchor.com)',
    '  "red_flags": string[]               // things to avoid (refurbished, counterfeit, etc.)',
    '}',
    '',
    'Rules:',
    '- queries should be short, production-like web queries (not instructions).',
    '- prefer merchants likely to list this item within budget.',
    '- pick diverse queries (different phrasing, different merchants, synonyms).',
  ].filter(Boolean).join('\n');

  const { json } = await claudeJSON({
    model: PLAN_MODEL,
    prompt,
    maxTokens: 800,
    temperature: 0.2,
  });

  const queries = Array.isArray(json.queries) ? json.queries.slice(0, MAX_QUERIES) : [];
  const merchants = Array.isArray(json.merchants) ? json.merchants.slice(0, 8) : [];
  const canonical = typeof json.canonical === 'string' ? json.canonical : brief;
  const redFlags = Array.isArray(json.red_flags) ? json.red_flags : [];
  if (queries.length === 0) {
    throw new Error('plan: model returned no search queries');
  }
  return { canonical, queries, merchants, redFlags };
}

export async function huntCandidates({ plan, onProgress }) {
  const seenUrls = new Set();
  const rawResults = [];
  for (const q of plan.queries) {
    try {
      const hits = await firecrawlSearch(q, { limit: RESULTS_PER_QUERY });
      if (onProgress) await onProgress({ type: 'search', query: q, count: hits.length });
      for (const h of hits) {
        if (!h.url || seenUrls.has(h.url)) continue;
        seenUrls.add(h.url);
        rawResults.push({ ...h, query: q });
      }
    } catch (err) {
      if (onProgress) await onProgress({ type: 'search_error', query: q, error: err.message });
    }
  }

  const ranked = rankByMerchantDiversity(rawResults, plan.merchants).slice(0, SCRAPE_TOP_N);

  const settled = await Promise.all(ranked.map(async (r) => {
    try {
      const scraped = await firecrawlScrape(r.url, { formats: ['markdown'], timeoutMs: 18000 });
      if (onProgress) await onProgress({ type: 'scrape', url: r.url });
      const meta = scraped.metadata || {};
      return {
        ...r,
        image_url: meta.ogImage || meta.og_image || null,
        scraped_title: meta.title || r.title,
        markdown_snippet: truncate(scraped.markdown || '', 4000),
        metadata: meta,
      };
    } catch (err) {
      if (onProgress) await onProgress({ type: 'scrape_error', url: r.url, error: err.message });
      return { ...r, markdown_snippet: '', metadata: null };
    }
  }));
  return settled;
}

export async function shortlistOptions({ brief, budgetUsdc, plan, candidates }) {
  if (!candidates.length) {
    throw new Error('shortlist: no candidates found');
  }

  const cleaned = candidates.map((c, i) => ({
    idx: i,
    url: c.url,
    title: c.scraped_title || c.title || null,
    description: c.description || null,
    image_url: c.image_url || null,
    snippet: c.markdown_snippet || '',
    merchant_hint: extractDomain(c.url),
  }));

  const prompt = [
    `User brief: ${brief}`,
    `Budget (USDC ≈ USD): ${budgetUsdc}`,
    `Canonical product: ${plan.canonical}`,
    plan.redFlags?.length ? `Red flags to avoid: ${plan.redFlags.join('; ')}` : null,
    '',
    'Candidates (array; each has idx, url, title, description, image_url, snippet, merchant_hint):',
    JSON.stringify(cleaned).slice(0, 18000),
    '',
    'Pick EXACTLY 3 distinct, legitimate options, ranked best-to-worst. Each option must come from the candidate list (use its url verbatim, no invented products).',
    'If candidates lack prices, extract prices from the snippet text (INR ₹, USD $, etc.) and convert to USDC (assume 1 USD = 1 USDC; 1 USD = 83 INR). Drop items whose price clearly exceeds the budget unless nothing else fits.',
    'Prefer diverse merchants, meaningful price/delivery/condition trade-offs, and options that match the canonical product exactly.',
    '',
    'Return strict JSON with this schema:',
    '{',
    '  "options": [',
    '    {',
    '      "idx": number,                   // must match a candidate idx above',
    '      "merchant": string,              // human-friendly merchant name',
    '      "title": string,                 // concise product title',
    '      "url": string,                   // product page URL',
    '      "image_url": string | null,',
    '      "price_usdc": number,            // extracted or estimated; never null',
    '      "delivery_eta": string | null,   // e.g. "Wed, 24 Apr" or "3–5 days" or null',
    '      "reasoning": string,             // one sentence — why this option ranks here',
    '      "tradeoff": string               // one sentence — its main downside',
    '    }',
    '  ]',
    '}',
  ].filter(Boolean).join('\n');

  const { json } = await claudeJSON({
    model: SHORTLIST_MODEL,
    prompt,
    maxTokens: 2000,
    temperature: 0.2,
  });

  const opts = Array.isArray(json.options) ? json.options : [];
  const picked = opts.slice(0, 3).map((o, i) => {
    const price = Number(o.price_usdc);
    const src = cleaned.find((c) => c.idx === o.idx);
    return {
      idx: i,
      merchant: String(o.merchant || src?.merchant_hint || 'unknown').slice(0, 80),
      title: String(o.title || src?.title || 'Unknown product').slice(0, 200),
      url: String(o.url || src?.url || ''),
      image_url: o.image_url || src?.image_url || null,
      price_usdc: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null,
      delivery_eta: o.delivery_eta || null,
      reasoning: String(o.reasoning || '').slice(0, 280),
      tradeoff: String(o.tradeoff || '').slice(0, 280),
      raw: { source_candidate: src, model_output: o },
    };
  }).filter((o) => o.url && o.price_usdc);

  if (picked.length === 0) {
    throw new Error('shortlist: model returned no valid options');
  }
  return picked;
}

function rankByMerchantDiversity(items, preferredMerchants) {
  const preferred = new Set((preferredMerchants || []).map((m) => m.toLowerCase()));
  const seenDomain = new Map();
  const scored = items.map((it) => {
    const domain = extractDomain(it.url) || '';
    const bonus = preferred.has(domain) ? 1 : 0;
    return { it, domain, bonus };
  });
  scored.sort((a, b) => b.bonus - a.bonus);
  const out = [];
  for (const { it, domain } of scored) {
    const count = seenDomain.get(domain) || 0;
    if (count >= 2) continue;
    seenDomain.set(domain, count + 1);
    out.push(it);
  }
  return out;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
