"""Phase 3 — Shortlist. Claude ranks candidates into exactly 3 options."""

from __future__ import annotations


async def run(candidates: list[dict], tl) -> list[dict]:
    """
    Returns exactly 3 option dicts:
      {idx, merchant, title, url, image_url, price_usdc,
       delivery_eta, reasoning, tradeoff, raw}
    """
    await tl.log("shortlist", f"Ranking {len(candidates)} candidates", cost_usdc=0.15)
    # TODO(day2): send candidates to Claude with a strict JSON schema prompt,
    # enforce exactly 3 items, persist via POST /api/quest/{id}/options.
    return []
