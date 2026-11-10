# P2P Rooms — friend testing checklist

Goal: two people (or two accounts/browsers) exercise the real mutual-room
journey on https://engganyo.com and report anything that breaks. Everything
below uses the visible UI only — no API tools needed.

**Before you start**

- Use your own normal accounts. Each room reserves **25 credits per player**
  up front; on agreement the room collects **50 credits total**; on completion
  each player earns **1 P2P point** (never wallet credits). Unfinished rooms
  refund the 25-credit reservation automatically at the deadline.
- A room has a **fixed 30-minute deadline** starting when the second player
  joins. Plan to finish inside it — expiry refunds both contributions.
- reCAPTCHA is enabled; log in normally. If login fails, note the time and
  exact error — do not retry in a tight loop.

## Journey checklist

| # | Step | What should happen | Report if… |
|---|------|--------------------|------------|
| 1 | **Create** — Rooms → Create room, title + optional private password | Room opens in "waiting for a partner" state | Create fails, balance wrong, or you land somewhere unexpected |
| 2 | **Join** — partner opens the room link (or finds it in browse) → Review & join → Confirm & join | Partner lands **immediately in the workspace**, sees your name/avatar | Join button missing, preview stuck, "couldn't load", or wrong balance reserved |
| 3 | **Chat** — both type in Room chat and press Enter | Messages appear on the partner's screen **without refresh**, both directions; status shows **ready** (not stuck on "connecting…") | Messages missing until reload, status stuck on connecting/failed, "connection failed" with no working Retry |
| 4 | **Reconnect** — reload one side's page mid-chat | Status returns to **ready**; messages sent while away appear **once** (not duplicated) | Duplicated messages, status stuck, or missed history |
| 5 | **Offers** — each player proposes their task (action + link); no deadline picker — terms share the room deadline | Both offers visible to both sides | Offer form errors, deadline confusion, offer not visible to partner |
| 6 | **Approval** — each player approves the partner's current offer | Room reaches **AGREED**; exactly **one 50-credit room charge**; no second debit | Charged twice, never reaches AGREED, or approval button dead-ends |
| 7 | **Proofs** — after AGREED, each uploads proof for the *partner's* task via the visible upload control (image file) | Proof shows as submitted; partner sees "proof in" state without refresh | Upload rejected for a valid image, proof state not visible to partner |
| 8 | **Reviews** — each player approves/rejects the partner's submitted proof | Both proofs approved → room **COMPLETED**; +1 P2P point each | Review buttons missing/inverted, room stuck in SUBMITTED |
| 9 | **Rating** — after completion, each rates the partner 1–5 + optional review | Rating saved; visible in closed room history | Rating fails, wrong score stored, retaliation window confusion |
| 10 | **Expiry/refund** *(separate room)* — join a room, do nothing until the 30-min deadline | Room shows **EXPIRED**; both 25-credit reservations refunded **exactly once**; slots released | Missing refund, double refund, room stuck ACTIVE |

## What to capture when something fails

For every failure, report:

1. **Room ID** — the URL `/rooms/<id>` (e.g. `cmwaigb4m0012tf4k5lpcvi4f`)
2. **Timestamp** — your local time + timezone when it happened
3. **Affected action** — which checklist step, what you clicked, what you saw
   (screenshot if possible — especially any error text like "Status
   unavailable", "Couldn't load this room", "connection failed")
4. **Your account username** and whether the partner saw the same thing

Send reports to the owner. Labeled agent test accounts are
`devin_p2p_a` / `devin_p2p_b` — do not use or modify them.

## Known-good reference

Room `cmwa73su9001c5jsb68emjdzi` completed the full journey on 2026-11-10
(deployed `b333b95`): join → chat → offers → AGREED → proofs → reviews →
COMPLETED → 5/5 ratings → closed history, ledger verified. If your run
diverges from that behavior, it is a real finding.
