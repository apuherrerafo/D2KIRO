# Wave 1 — Automated Acceptance Report

**Result: PASS**

- Run started: 2026-09-19T22:04:14.437Z  (duration 57 s)
- Git HEAD: `ea537db9d82354b1e44f79e9c3249c26db8bd5a5` (+ uncommitted working-tree changes)
- Command: `bun run test:wave1:smoke`
- Environment: headless Chromium, production web build, real engine (`index.e2e.ts`), deterministic fixture DB (50 heroes)
- Engine certification preflight: 385 pass / 0 fail
- Browser scenarios: 7/7 pass
- Soak tests: 2/2 pass — 20/20 drafts valid
- Playwright exit code: 0

## Scenarios

| Area | Scenario | Seed(s) | Result | Time |
|---|---|---|---|---|
| Browser flow: Radiant full draft | A. Radiant + Pos2, 4 ban preferences: Mid+Carry in R1, support in R3, COMPLETE | WAVE1RAD | PASS | 10.6 s |
| Browser flow: Dire full draft | B. Dire + Pos5, 0 ban preferences, roles in a different pick order: COMPLETE (side symmetry) | WAVE1DIR | PASS | 9.9 s |
| Ban flow (browser) | resolved bans appear, banned heroes cannot be selected, a 5th nomination is impossible | WAVE1BAN | PASS | 1.4 s |
| Ban flow (browser) | the configuration screen caps nominations at 4 | — | PASS | 1.0 s |
| Ban flow (browser) | FAIL CLOSED: a failing ban resolution never starts Round 1, and the retry uses the same request | WAVE1FCL | PASS | 0.9 s |
| Timers and gold penalty | expiry starts 2 gold/s per pending seat; locked seats stop; nothing is auto-picked; the Player can still pick | WAVE1TMR | PASS | 6.0 s |
| Hidden information + collision smoke | a hidden enemy pick stays selectable for the Player; picking it collides, bans it, and the pool updates | HIDE0002 | PASS | 10.4 s |
| Multi-seed soak (API) | soak: 10 radiant drafts with different seeds complete validly | SOAKR001–010 / SOAKD001–010 | PASS | 1.4 s |
| Multi-seed soak (API) | soak: 10 dire drafts with different seeds complete validly | SOAKR001–010 / SOAKD001–010 | PASS | 1.4 s |

## Browser flows (Radiant + Dire): PASS

Side, personal position, ban nominations, 2/2/1 round capacities, Mid+Carry legal in Round 1 and support in Round 3 (and the reverse order on Dire), 5 own + 5 enemy heroes, Player issues exactly 5 own-side seals, no 4xx/5xx.

## Timer: PASS

Round base times 25/25/20 s asserted from the engine timer projection in every draft; expiry (deterministic clock, no real 25 s sleep), 2 gold/s per pending seat, locked seat frozen, pending seat keeps accruing, no auto-pick, late pick accepted. Clock: browser fake clock + test-only server timer offset (`index.e2e.ts` only).

## Ban flow: PASS

0 and 1–4 nominations, resolved bans visible, banned heroes removed from (or disabled in) the selectable pool, 5th nomination impossible, failing resolution never starts Round 1 and retries the identical request.

## Hidden information: PASS

Hidden enemy slots never carry a hero id; no Simulator Truth key is ever serialized; enemy reveals equal 0/2/4/5 by phase; a hidden enemy pick stays selectable for the Player (Player-visible behaviour only).

## Collision coverage

- **Browser smoke (this suite):** deterministic collision — the Player picks the (hidden) enemy Round-1 hero; expect the collision-ban banner, the reopened single seat, the hero no longer selectable afterwards, and the draft still completing. The seed is chosen from a fixed candidate list by fixture availability, not by searching for collisions.
- **Collision #1/#2/#3 rules and first-registration-wins (Task 11):** certified at engine level by the preflight above (`simulator-authority.test.ts`, `protocol-sessions.ap-simulator.test.ts`, `ap-availability-symmetry.test.ts`); not re-driven through the browser.

## Multi-seed soak

| Seed | Side | Pos | Ban prefs | Bans | Collision bans | Result |
|---|---|---|---|---|---|---|
| SOAKR001 | radiant | 1 | 0 | 7 | 0 | PASS |
| SOAKR002 | radiant | 2 | 1 | 5 | 0 | PASS |
| SOAKR003 | radiant | 3 | 2 | 5 | 0 | PASS |
| SOAKR004 | radiant | 4 | 3 | 9 | 0 | PASS |
| SOAKR005 | radiant | 5 | 4 | 9 | 0 | PASS |
| SOAKR006 | radiant | 1 | 0 | 8 | 0 | PASS |
| SOAKR007 | radiant | 2 | 1 | 8 | 0 | PASS |
| SOAKR008 | radiant | 3 | 2 | 7 | 0 | PASS |
| SOAKR009 | radiant | 4 | 3 | 10 | 0 | PASS |
| SOAKR010 | radiant | 5 | 4 | 8 | 0 | PASS |
| SOAKD001 | dire | 1 | 0 | 7 | 1 | PASS |
| SOAKD002 | dire | 2 | 1 | 8 | 0 | PASS |
| SOAKD003 | dire | 3 | 2 | 7 | 0 | PASS |
| SOAKD004 | dire | 4 | 3 | 7 | 0 | PASS |
| SOAKD005 | dire | 5 | 4 | 8 | 0 | PASS |
| SOAKD006 | dire | 1 | 0 | 9 | 0 | PASS |
| SOAKD007 | dire | 2 | 1 | 7 | 0 | PASS |
| SOAKD008 | dire | 3 | 2 | 12 | 0 | PASS |
| SOAKD009 | dire | 4 | 3 | 9 | 0 | PASS |
| SOAKD010 | dire | 5 | 4 | 9 | 0 | PASS |

Per draft: COMPLETE, 5 own + 5 enemy heroes, no same-side duplicate, no banned hero selected, Enemy Bot heroes admissible for each round's internal seat positions, no HTTP 4xx/5xx.

## Failures

None.

## Evidence

Failure artifacts (screenshot, trace, error context) are kept by Playwright in `test-results/`; open a trace with `npx playwright show-trace <trace.zip>`. Video is not enabled (current setup does not use it).

## What still needs a human

A short visual check only: layout/legibility of the round panel, the visible countdown, the gold-penalty text and the collision banner. Everything behavioural above is automated.
