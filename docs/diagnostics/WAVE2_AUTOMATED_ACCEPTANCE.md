# Wave 2 — Automated Acceptance Report (Coach orchestration)

**Result: PASS**

- Run started: 2026-09-19T23:45:21.069Z  (duration 38 s)
- Git HEAD: `53c6ef3dc2694345b3f84c9a8be578532ea91f2a` (+ uncommitted working-tree changes)
- Command: `bun run test:wave2:smoke`
- Environment: headless Chromium, production web build, real engine (`index.e2e.ts`), deterministic fixture DB (50 heroes)
- Engine certification preflight: 252 pass / 0 fail
- Browser scenarios: 4/4 pass
- Playwright exit code: 0

## Scenarios

| Area | Scenario | Seed(s) | Coach primary action per round | Result | Time |
|---|---|---|---|---|---|
| Radiant: Coach orchestration across a full draft | A. Radiant: Coach action before the first pick, recomputed after own pick #1 (before the reveal) and after each enemy reveal | WAVE1RAD | REVEAL_POSITION[revela Hard support (Pos 5)],REVEAL_POSITION[revela Hard support (Pos 5)],REVEAL_POSITION[revela Hard support (Pos 5)] | PASS | 11.1 s |
| Dire: Coach orchestration across a full draft | B. Dire: same Coach behaviour from the other side | WAVE1DIR | REVEAL_POSITION[revela Hard support (Pos 5)],REVEAL_POSITION[revela Carry (Pos 1)],REVEAL_POSITION[revela Midlane (Pos 2)] | PASS | 10.3 s |
| Player ignores the advice | C. The Player ignores the advice: a different legal hero is accepted, no 'wrong choice', and the Coach recomputes | WAVE1RAD | — | PASS | 1.7 s |
| Hidden information isolation | D. two worlds differing ONLY in the hidden enemy identity: identical Coach output before the reveal; the reveal may then legally change it | WAVE2HID | — | PASS | 0.3 s |

## What each scenario proves

- **A / B (Radiant, Dire):** in every round an actionable Coach primary action + shortlist is on screen before the Player picks; right after own pick #1 (round not closed, nothing revealed) the Coach has recomputed (`trigger = OWN_PICK_CONFIRMED`, new revision, new state identity, own hero gone from the shortlist); after each enemy reveal it recomputes again (`ROUND_REVEALED`); revisions are monotonic; the full draft still completes; no HTTP 4xx/5xx; no Simulator Truth key is ever serialized.
- **C (ignore the advice):** a legal hero outside the Coach shortlist is accepted with no rejection notice and no 'wrong choice' text, and the Coach recomputes; the draft continues.
- **D (hidden information):** two sessions with the same seed and bans whose Enemy Bot seats are forced (test-only seam) to DIFFERENT hidden heroes produce a byte-identical Coach output AND V2 set before the reveal; after the reveal the state identity legally diverges. Hidden slots never carry a hero id in any response.

## Failures

None.

## Scope

Certifies ORCHESTRATION (legal observable state, no hidden-information cheating, continuous recompute, hierarchy of primary action over shortlist, evidence-scaled specificity, Player authority) — **not** hero quality. Personal position / Hero Pool / Flex UX (Wave 3) and Safe Core / contextual intelligence (Wave 4) are not exercised.

## What still needs a human

A short visual check only: layout and legibility of the Coach panel (primary action, shortlist cards, badges) next to the round panel.
