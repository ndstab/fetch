"""Phase 5 — Settle. Refund unspent sub-wallet USDC, void card, trigger teardown."""

from __future__ import annotations


async def run(receipt: dict, tl) -> None:
    await tl.log("settle", "Refunding unspent USDC to user wallet")
    # TODO(day2):
    #   refund = await locus.refund_subwallet(SUBWALLET_ID)
    #   await tl.log("settle", f"Refunded ${refund['amount']}")
    #   # Orchestrator will call DELETE /v1/projects/:id for teardown when status=complete
