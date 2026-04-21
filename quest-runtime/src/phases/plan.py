"""Phase 1 — Plan. Claude turns the quest brief into a structured search plan."""

from __future__ import annotations


async def run(brief: dict, tl) -> dict:
    """
    Returns:
      {
        "canonical": "product description normalized for search",
        "merchants": ["amazon.in", "flipkart.com", ...],
        "queries": {"amazon.in": "...", "flipkart.com": "..."},
        "constraints": {"max_usdc": float, "deadline": str | None},
        "red_flags": ["refurbished", "third-party seller when user asked for authentic"],
      }
    """
    await tl.log("plan", f"Planning quest for: {brief.get('brief', '?')}", cost_usdc=0.05)
    # TODO(day2): call wrapped-Claude via POST /api/wrapped/anthropic/messages
    return {"canonical": brief.get("brief", ""), "merchants": [], "queries": {}, "constraints": {}, "red_flags": []}
