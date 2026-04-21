"""Phase 4 — Checkout.

1. Mint a Laso virtual card scoped to (option.price + 5%) against our sub-wallet.
2. Launch Playwright + Chromium.
3. Navigate to the merchant, add to cart, proceed to guest checkout.
4. Claude-vision reads each step, Playwright fills address/contact/card fields.
5. On confirmation, extract order # and tracking URL, write receipt.
"""

from __future__ import annotations


async def run(option: dict, brief: dict, tl) -> dict:
    await tl.log("checkout", "Minting virtual Locus card")
    # TODO(day2):
    #   card = await wrapped_api("laso", "get-card", {"amount": str(option["price_usdc"] * 1.05)})
    #   await tl.log("checkout", f"Card ready ({card['last4']})", level="success")
    #   async with async_playwright() as p:
    #       browser = await p.chromium.launch(headless=True)
    #       page = await browser.new_page()
    #       await page.goto(option["url"])
    #       … Claude-vision driven steps …
    #   return {"order_number": ..., "tracking_url": ..., "final_cost_usdc": ..., "card_id": ...}
    return {}
