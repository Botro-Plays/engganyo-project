# Proposal: user-to-user credit trading

**Status: design review — no implementation authorized.**

Jomar requested a marketplace where users can trade credits with each other. Credits are currently non-cashable, platform-issued units used for campaign funding and rewards. This proposal frames the open product and accounting decisions before any code is written.

## What "trading" could mean (pick one)

1. **Peer transfer** — user A sends X credits to user B (like a wallet transfer). Simplest; closest to existing wallet ledger.
2. **Escrowed swap** — credits exchanged for goods/services off-platform ("I will design your thumbnail for 50cr"). Needs dispute handling.
3. **Order book / exchange** — users post bids/offers and a matching engine clears trades. Largest scope; probably overkill for current scale.

Recommendation: start with **peer transfer** (option 1) if approved at all; defer order-book matching.

## Product decisions required

- **Cashability**: credits are purchased with real money (PayMongo/PayPal/crypto). Allowing P2P transfer creates a secondary market — decide whether transfers are permitted at all, capped per day, or restricted to credits earned (not purchased). Purchased-credit resale would functionally make credits cashable and may trigger money-transmission/money-services regulation depending on jurisdiction (PH + international users).
- **Fees**: flat fee, percentage, or free? Any fee creates ledger asymmetry that must be defined.
- **Limits**: per-transfer cap, daily cap, new-account hold period (e.g. credits earned < 7 days cannot be transferred — anti-fraud).
- **Counterparties**: can you transfer to any user, or only mutual followers / accepted connections? Open transfers enable scam funnels ("send credits to verify").
- **Chargeback exposure**: if a deposit is charged back after credits were transferred onward, who eats the loss? Recommend: transferred credits become non-recoverable; the sender's account is flagged.

## Accounting / ledger design (if approved)

- New ledger entry types: `TRANSFER_OUT` / `TRANSFER_IN` (or reuse existing credit/debit with a `counterpartyId`), never `PlatformRevenue`.
- Atomicity: single `prisma.$transaction` — debit sender (optimistic version check, same as existing wallet ops) + credit receiver + write both ledger rows + optional escrow row. Unique idempotency key per transfer (same pattern as wheel spin attempts).
- Balance floor: sender cannot go negative; insufficient balance → 400 before any write.
- No new money enters or leaves the platform — total credit supply is unchanged; this must be auditable (supply-invariant check in tests).

## Abuse / fraud controls

- Velocity limits + new-account hold (above).
- Report/block user; admin freeze on disputed transfers.
- Pattern detection: ring transfers (A→B→C→A), transfer-then-chargeback, transfer-to-self via alt accounts (IP/session heuristics already exist for self-farming).
- Transfers are irreversible once accepted unless a dispute window is defined — decide whether recipients can refuse (request/accept flow) or transfers are push-only.

## Tax / legal

- Credits purchased with money then transferred may constitute stored value / e-money in some jurisdictions. Philippine BSP e-money rules and VAT treatment of the platform fee need review before launch. **This is a hard gate — get legal/accounting sign-off first.**

## Open questions for the owner

1. Peer transfer only, or also escrowed swaps?
2. Are purchased credits transferable, or only earned credits?
3. Fee structure and limits?
4. Push-only transfers or request/accept?
5. Jurisdictional review owner?
