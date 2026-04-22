// Thin wrappers around the Locus wrapped-API catalog.
// Base: `${LOCUS_API_BASE}/wrapped/<provider>/<endpoint>`
// Auth: Bearer claw_* key (LOCUS_API_KEY).
// Cost: billed per-call to the platform wallet (per provider catalog rates).

import { config } from '../config.js';
import { proxyFetch } from './proxyFetch.js';

const API_KEY = () => config.locus.apiKey;
const BASE = () => config.locus.apiBase.replace(/\/$/, '');

async function wrappedPost(endpoint, body) {
  const res = await proxyFetch(`${BASE()}/wrapped/${endpoint}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${API_KEY()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
    const err = new Error(`wrapped ${endpoint} ${res.status}: ${String(msg).slice(0, 300)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json?.data ?? json;
}

export async function claudeChat({
  model = 'claude-sonnet-4-5',
  system,
  messages,
  maxTokens = 2048,
  temperature = 0.3,
} = {}) {
  const data = await wrappedPost('anthropic/chat', {
    model,
    max_tokens: maxTokens,
    temperature,
    ...(system ? { system } : {}),
    messages,
  });
  const text = (data?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return { text, raw: data };
}

export async function claudeJSON({
  model = 'claude-sonnet-4-5',
  system,
  prompt,
  maxTokens = 2048,
  temperature = 0.2,
} = {}) {
  const sys = [
    'You reply with a single JSON object that matches the requested schema exactly.',
    'Do not wrap the JSON in markdown fences. Do not include commentary before or after.',
    system || '',
  ].filter(Boolean).join('\n\n');
  const { text, raw } = await claudeChat({
    model,
    system: sys,
    messages: [{ role: 'user', content: prompt }],
    maxTokens,
    temperature,
  });
  const parsed = tryParseJSON(text);
  if (!parsed) {
    throw new Error(`claudeJSON: could not parse model output as JSON: ${text.slice(0, 300)}`);
  }
  return { json: parsed, text, raw };
}

function tryParseJSON(s) {
  if (!s) return null;
  const trimmed = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(trimmed); } catch {}
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch {}
  }
  return null;
}

export async function firecrawlSearch(query, { limit = 6 } = {}) {
  const data = await wrappedPost('firecrawl/search', { query, limit });
  const inner = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
  return inner.map((r) => ({
    url: r.url || r.link || null,
    title: r.title || null,
    description: r.description || r.snippet || null,
  })).filter((r) => r.url);
}

export async function firecrawlScrape(url, { formats = ['markdown'], timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await proxyFetch(`${BASE()}/wrapped/firecrawl/scrape`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${API_KEY()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url, formats }),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`firecrawl/scrape ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    }
    const d = json?.data?.data || json?.data || {};
    return {
      url,
      markdown: d.markdown || null,
      metadata: d.metadata || null,
    };
  } finally {
    clearTimeout(t);
  }
}
