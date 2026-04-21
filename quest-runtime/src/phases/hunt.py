"""Phase 2 — Hunt. Brave Search + Firecrawl → raw candidate listings."""

from __future__ import annotations


async def run(plan: dict, tl) -> list[dict]:
    """
    Returns a flat list of candidate dicts with at least:
      {merchant, title, url, price_usdc, delivery_eta, image_url, raw}
    """
    await tl.log("hunt", "Searching merchants via Brave + Firecrawl", cost_usdc=0.30)
    # TODO(day2):
    #   for q in plan["queries"].values():
    #       results = await wrapped_api("brave", "web-search", {"q": q})
    #       for url in top N:
    #           page = await wrapped_api("firecrawl", "scrape", {"url": url, "formats": ["markdown", "json"]})
    #           extract price, title, image, delivery
    return []
