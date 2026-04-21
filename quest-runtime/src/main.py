"""Fetch quest runtime entrypoint.

Deployed one-per-quest by the orchestrator via the Build-with-Locus API.
Environment it receives:
  QUEST_ID           — which quest this container is for
  ORCHESTRATOR_URL   — where to post timeline rows + poll for user pick
  SUBWALLET_ID       — Locus sub-wallet scoped to this quest's budget
  LOCUS_API_KEY      — claw_ key for wrapped-API calls (billed to sub-wallet)
  DATABASE_URL       — shared orchestrator Postgres (preferred over HTTP if reachable)

Container exposes a tiny HTTP server on :8080 so Build-with-Locus health checks
pass while the agent does its work in a background task.

This file is a skeleton for Day 2 — the actual phase implementations are in
src/phases/. The in-process simulator in the orchestrator currently provides
identical behavior for demos, so the dashboard doesn't need to change when this
file goes live.
"""

from __future__ import annotations

import asyncio
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

from .phases import plan, hunt, shortlist, checkout, settle
from .timeline import Timeline


class _Health(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *_args):
        pass  # silence


def _start_health_server():
    srv = ThreadingHTTPServer(("0.0.0.0", 8080), _Health)
    Thread(target=srv.serve_forever, daemon=True).start()


async def run():
    _start_health_server()

    quest_id = os.environ["QUEST_ID"]
    orch_url = os.environ["ORCHESTRATOR_URL"]
    tl = Timeline(quest_id=quest_id, orchestrator_url=orch_url)

    await tl.log("system", "Quest runtime booted.", level="success")

    brief = await tl.fetch_brief()
    plan_out = await plan.run(brief, tl)
    candidates = await hunt.run(plan_out, tl)
    options = await shortlist.run(candidates, tl)

    chosen_idx = await tl.wait_for_pick(options)
    if chosen_idx is None:
        await tl.log("system", "No pick received — defaulting to top option", level="warn")
        chosen_idx = 0

    receipt = await checkout.run(options[chosen_idx], brief, tl)
    await settle.run(receipt, tl)
    await tl.log("settle", "Quest complete.", level="success")


if __name__ == "__main__":
    asyncio.run(run())
