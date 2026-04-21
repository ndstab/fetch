// Simple in-process SSE broadcaster keyed by quest id.
// Each connection is an Express response held open; when the DB writes a new
// timeline row, the route handler calls `broadcast(questId, event)`.

const channels = new Map(); // questId -> Set<res>

export function subscribe(questId, res) {
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();

  let set = channels.get(questId);
  if (!set) {
    set = new Set();
    channels.set(questId, set);
  }
  set.add(res);

  // Keepalive comment every 20s
  const ping = setInterval(() => {
    try { res.write(':\n\n'); } catch { /* client gone */ }
  }, 20_000);

  res.on('close', () => {
    clearInterval(ping);
    set.delete(res);
    if (set.size === 0) channels.delete(questId);
  });
}

export function broadcast(questId, event) {
  const set = channels.get(questId);
  if (!set) return;
  const chunk = `event: ${event.type || 'message'}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try { res.write(chunk); } catch { /* will be cleaned on close */ }
  }
}
