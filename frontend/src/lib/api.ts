import type { Option, Quest, TimelineRow } from './types';

export const API_BASE = (import.meta.env.VITE_API_BASE as string) || 'http://localhost:3001';

export async function getConfig(): Promise<{
  mode: 'mock' | 'real';
  walletAddress: string | null;
  apiBase: string;
  serviceFeeBps: number;
}> {
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) throw new Error(`getConfig: ${res.status}`);
  return res.json();
}

export async function createQuest(body: {
  brief: string;
  address: string;
  phone: string;
  email: string;
  budgetUsdc: number;
  deadline?: string;
  autoconfirm?: boolean;
}): Promise<{ quest: Quest; checkout: { sessionId: string; hostedUrl: string } }> {
  const res = await fetch(`${API_BASE}/api/quest/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createQuest: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getQuest(id: string): Promise<{ quest: Quest; timeline: TimelineRow[]; options: Option[] }> {
  const res = await fetch(`${API_BASE}/api/quest/${id}`);
  if (!res.ok) throw new Error(`getQuest: ${res.status}`);
  return res.json();
}

export async function pickOption(id: string, idx: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/quest/${id}/pick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idx }),
  });
  if (!res.ok) throw new Error(`pickOption: ${res.status}`);
}

export async function cancelQuest(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/quest/${id}/cancel`, { method: 'POST' });
  if (!res.ok) throw new Error(`cancelQuest: ${res.status}`);
}

export function streamQuest(
  id: string,
  handlers: {
    onSnapshot?: (d: { quest: Quest; timeline: TimelineRow[]; options: Option[] }) => void;
    onTimeline?: (row: TimelineRow) => void;
    onStatus?: (status: string, quest?: Quest) => void;
    onOptions?: (options: Option[]) => void;
  },
): () => void {
  const es = new EventSource(`${API_BASE}/api/quest/${id}/stream`);
  es.addEventListener('snapshot', (e) => {
    try { handlers.onSnapshot?.(JSON.parse((e as MessageEvent).data)); } catch {}
  });
  es.addEventListener('timeline', (e) => {
    try { handlers.onTimeline?.(JSON.parse((e as MessageEvent).data).row); } catch {}
  });
  es.addEventListener('status', (e) => {
    try {
      const d = JSON.parse((e as MessageEvent).data);
      handlers.onStatus?.(d.status, d.quest);
    } catch {}
  });
  es.addEventListener('options', (e) => {
    try { handlers.onOptions?.(JSON.parse((e as MessageEvent).data).options); } catch {}
  });
  es.onerror = () => {/* let browser retry */};
  return () => es.close();
}
