# Owner-Assisted Acceptance Session

One guided session covering the returning-user tour fix and the refined
blog carousel. Run on `https://engganyo.com` in a normal browser session -
the checker logs in personally (reCAPTCHA is on; no test tokens).

Record every result below as PASS / FAIL / NOT REPRODUCED with a note.
Nothing here is pre-verified by database inspection - these are the
rendered-behavior checks only a real session can produce.

## A. Returning-user tours (PR #173, `d9f2a03`)

Setup: the production check used `platform_configs` - no
`beginner_tour_new_user_days` row exists, so the new-user window is the
**14-day default**. Pick accounts accordingly:

- An "old" account created more than 14 days ago with NO tour history
  (e.g. `cmvi99hcz`, `cmw47zqnt`, or any devin_* test account).
- A "paused" account created within 14 days holding an IN_PROGRESS
  beginner row (e.g. `cmwsx09jy`).
- A "new" account created within 14 days with no rows (e.g. `cmwti2364`).

| # | Check | Expected | Result |
|---|---|---|---|
| A1 | Old account, browser 1: log in | No tour modal, no Continue card | |
| A2 | Same account: reload the page | Still nothing - no restart | |
| A3 | Same account: log in from a second browser/device | Still nothing | |
| A4 | Paused account: log in | Nonblocking Continue card (Continue / Not now / Skip tour) - NOT the modal | |
| A5 | Card -> Not now | Card dismisses; tour does not start; card does not reappear on next login this session | |
| A6 | Paused account again -> Continue | Tour resumes at the saved step, not step 1 | |
| A7 | Paused account again -> Skip tour | Durable dismissal: card never re-offers on later logins | |
| A8 | New account: log in | Beginner tour auto-starts (intended) | |
| A9 | Complete or dismiss it, log out, log in again | Never restarts | |
| A10 | Settings: turn automatic tours OFF, log in from the second browser | No modal, no card (preference follows the account) | |
| A11 | Settings -> replay tour manually | Tour opens from step 1, completes normally | |
| A12 | Any account: if a tour write visibly fails (network offline test optional) | Failure stays visible/recoverable - state is not silently lost | |

## B. Blog carousel (PRs #174 `45d914b`, #176 `91ae4a5`)

Desktop (>=1024px) and mobile (~390px), landing page blog rail:

| # | Check | Expected | Result |
|---|---|---|---|
| B1 | Play/Pause control position | Horizontally centered in the control row directly below the cards; clear of article text/links | |
| B2 | Resting appearance | Transparent/translucent background, subdued but visible icon - visible without hovering | |
| B3 | Mouse hover | Blue/gold brand highlight | |
| B4 | Keyboard focus | Same highlight + visible focus ring; reachable via Tab | |
| B5 | Touch target | At least 44x44px | |
| B6 | Autoplay cadence | Advances about every 5 seconds; transition is smooth | |
| B7 | Explicit pause | Pauses and stays paused until Play is pressed - hovering away does NOT resume it | |
| B8 | Pause on hover / focus-in | Autoplay suspends while pointer or focus is inside the rail | |
| B9 | Offscreen / hidden tab | No advancing while the rail is offscreen or the tab is hidden | |
| B10 | Reduced motion (OS setting) | Autoplay off; transitions minimized | |
| B11 | Side arrows (desktop) | Sit beside the cards, never covering article content; wrap at both ends | |
| B12 | Mobile layout | Arrows at the row edges with 44px targets; no native scrollbar visible | |
| B13 | Touch swipe | Native touch scrolling still works | |
| B14 | Article links | Cards remain clickable to the blog post; controls never intercept | |
| B15 | Page overflow | No horizontal page scrollbar at any tested width | |
| B16 | Keyboard | Arrow-key scrolling inside the rail still works | |
| B17 | Single-post state (fixture only, `/rail-fixture?posts=1`, test build) | No broken controls; single card renders cleanly | |

## C. Evidence to capture

- Screen recording of A4-A7 (card flows) and A9 (no restart).
- Desktop + mobile recordings of B6-B9 (autoplay, pause, resume) and B11-B13.
- Any FAIL gets a repro note + new ticket entry in
  `docs/JOMAR_IMMEDIATE_PRIORITIES.md` - do not mark passed from logs alone.
