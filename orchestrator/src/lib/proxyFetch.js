// Optional HTTPS/HTTP proxy for all outbound fetches. Laso's paid endpoint
// `POST /api/x402/laso-get-card` is IP-locked to the United States (see
// https://paywithlocus.com/laso.md). Set HTTPS_PROXY to a US egress proxy so
// Locus and laso.finance see a US client IP. Deploying on a US region VPS
// (e.g. AWS us-east-1, Fly sjc/iad) achieves the same without a proxy.

import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { config } from '../config.js';

let cachedAgent = null;
let noProxy;

function getProxyAgent() {
  const p = (config.proxy?.https || config.proxy?.http || '').trim();
  if (!p) return null;
  if (cachedAgent) return cachedAgent;
  cachedAgent = new ProxyAgent(p);
  return cachedAgent;
}

function shouldBypassProxy(urlStr) {
  if (!urlStr) return true;
  noProxy = noProxy || (config.proxy?.noProxy || '')
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (noProxy.length === 0) return false;
  let host;
  try { host = new URL(urlStr).hostname.toLowerCase(); } catch { return false; }
  if (noProxy.includes('*')) return true;
  for (const rule of noProxy) {
    if (rule === 'localhost' || rule === '127.0.0.1') {
      if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) return true;
    } else if (host === rule || host.endsWith(`.${rule}`)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string | URL} url
 * @param {RequestInit & { dispatcher?: import('undici').Dispatcher }} [init]
 */
export function proxyFetch(url, init = {}) {
  if (init.dispatcher) return undiciFetch(url, init);
  if (shouldBypassProxy(String(url))) return undiciFetch(url, init);
  const agent = getProxyAgent();
  if (agent) return undiciFetch(url, { ...init, dispatcher: agent });
  return undiciFetch(url, init);
}
