"""Timeline helper — writes phase events back to the orchestrator.

Preferred path: direct INSERT into the orchestrator's Postgres (fewer moving
parts). Fallback: POST to /api/internal/timeline if DB isn't reachable.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any


@dataclass
class Timeline:
    quest_id: str
    orchestrator_url: str

    async def log(self, phase: str, message: str, level: str = "info", detail: Any = None, cost_usdc: float | None = None) -> None:
        # TODO(day2): write to Postgres via psycopg, or POST to orchestrator.
        # For now just print; orchestrator-side simulator drives real rows.
        print(f"[{self.quest_id} {phase:9}] {message}")

    async def fetch_brief(self) -> dict:
        # TODO(day2): GET /api/quest/{id} and return quest fields
        return {"id": self.quest_id, "brief": "(fetch me)"}

    async def wait_for_pick(self, options: list[dict]) -> int | None:
        # TODO(day2): poll GET /api/quest/{id} until chosen_option_idx != null,
        # or timeout after 30 minutes and return 0.
        await asyncio.sleep(0)
        return 0
