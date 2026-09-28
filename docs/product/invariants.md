# Product Invariants — Ownership (AP Ranked Roles V1)

D2KIRO Phase 1 (Ownership Invariant Gate). These invariants are executable, independent contract
checks (`qa/invariants/ownership.test.ts`), not aspirational documentation — every row below is
mechanically verified against the real `ProtocolSessionStore` through the real public routes, for
every legal human-control set (PD-026), on both sides.

"Human action" means anything the recommendation surface (V2 `RecommendationSetV2.decision` or the
Coach's `RecommendationOutputV3.primaryAction`/`shortlist`) presents as something the Player can
execute right now. "Ownership truth" means `ProtocolSessionStore.controlledPositions` /
`humanOpenPositions` — session-layer facts, never re-derived from chronology or from the
recommendation layer itself.

| ID | Rule | Source PD | Enforcement |
|---|---|---|---|
| INV-OWN-001 | Every position the product presents as the human's action must belong to `humanOpenPositions`. Checked on BOTH: (A) the human-facing primary/action target (Coach `primaryAction.strategy` target position(s); V2 `decision.controlledSlots` positions); (B) every shortlist/card position rendered as part of that human action (Coach `shortlist`). This is NOT equivalent to the separate sanity property `humanOpenPositions ⊆ controlledPositions` (asserted on its own, below the invariant tests, as a precondition check on session-layer truth) — that property can hold while INV-OWN-001 fails (a position IS a legal human-open position, but the product still offers it to the wrong human-facing surface or alongside stale sibling positions), and the two are verified by separate assertions. | PD-003, PD-023, PD-026, PD-027 | `qa/invariants/ownership.test.ts` — `describe("INV-OWN-001 ...")`, one test per checkpoint. **Unlisted**: any violation is a real, visible red test — never a known failure. **Currently FAILING on real product code**: 285 confirmed violations, all `REVEAL_POSITION` fallback cases (`positionFallback()` in `reveal-strategy.ts` — the honest "no evidence, uncovered seat" path can select a position outside `humanOpenPositions`). Canonical minimal counterexample: Solo Pos2 (`controlledPositions=[2]`, `humanOpenPositions=[2]`), Coach's human-facing `primaryAction` targets Pos1. Fixing this is Phase 2 product work, out of scope for the oracle-correction task that produced this note. |
| INV-OWN-002 | While humans still have own-team action capacity in the current round, every `humanOpenPosition` must remain offerable by the recommendation surface (V2 `controlledSlots` / Coach shortlist). | PD-001, PD-020, PD-026, PD-027 | `qa/invariants/ownership.test.ts` — aggregate test `INV-OWN-002 (known failure registry) ...`. **Known failure** (`qa/invariants/known-failures.json`): not merely that round-slot capacity (2/2/1) limits HOW MANY `humanOpenPositions` fit this round — `apps/engine/src/recommendation/build.ts` zips `humanOpenPositions` onto open own-side round slots via `sort(humanOpenPositions)[i]` (fixed ascending order) THEN truncates to round capacity, so round capacity ends up determining WHICH specific positions are offered (always the lowest-numbered ones first), not just how many. The separate Position != Chronology remediation, not fixed here. |
| INV-OWN-003 | After a human pick binds position P, P must never again be presented as a current human action. | PD-026, PD-027 | `qa/invariants/ownership.test.ts` — `describe("INV-OWN-003 ...")`, one test per checkpoint after the first bound position. Checked against the actual human-facing recommendation surface (V2 `controlledSlots`; Coach `primaryAction`/`shortlist` positions) — never against `humanOpenPositions` itself, which excludes bound positions by construction and would make the check vacuous. **Unlisted**: any violation is a real, visible red test. **Currently PASSING** (0 real violations). |
| INV-OWN-004 | When humans have zero round capacity right now (`humanRoundCapacity = hasYieldedCurrentRound ? 0 : min(open own-side round slots this round, humanOpenPositions.length)` is `0` — covers both "no `humanOpenPositions` left" and "the human explicitly yielded the round via PD-020, PD-027 point 4, even while `humanOpenPositions` is still non-empty"), no human PICK action is presented: V2 `controlledSlots` is empty and the Coach `primaryAction` names no position target. | PD-026, PD-027 | `qa/invariants/ownership.test.ts` — `describe("INV-OWN-004 ...")`, one test per checkpoint with zero `humanRoundCapacity`. Checked against the recommendation surface, never against `snapshot.legalActions`/`ProtocolSessionStore.authorizedLegalActions` — that field is own-SIDE protocol legality (it advertises every open own-side round slot for the Ally Bot to fill too, by design) and asserting it directly false-positives whenever round capacity outlives the human's own capacity. **Unlisted**: any violation is a real, visible red test. **Currently PASSING** (0 real violations). |
| INV-CHRONO-001 | Metamorphic: the SET of positions the recommendation surface offers must not depend on the chronological order in which earlier human positions were filled (Position != Pick Order). | PD-001, PD-020, PD-027 | `qa/invariants/ownership.test.ts` — aggregate test `INV-CHRONO-001 (known failure registry) ...`. **Measured, not reproduced**: exhaustive ascending/descending/deferred pairing across all 26 control sets found zero violations (see `known-failures.json`'s `shrunkEntries` for why) — `apps/engine/src/recommendation/build.ts`'s own position-tagging is a pure, order-independent function of the current `humanOpenPositions` content + round capacity. Test now asserts `=== 0` unconditionally, as a real (currently passing) invariant, not a known failure. |
| INV-LEAK-001 | Observable outputs must remain byte-identical when only the Enemy Bot's PRIVATE internal assignment (or a sealed-but-unrevealed enemy hero identity) changes, holding every PUBLIC input (including `simulatorSeed`, which is public metadata — NOT private truth) fixed. No enemy private role/assignment may leak. | PD-005, PD-009, PD-012, PD-027 | `qa/invariants/ownership.test.ts` — `describe("INV-LEAK-001 ...")`: (a) per-checkpoint structural checks across the full matrix (no `internalPositionAssignments` text, no HIDDEN enemy slot exposing a `heroId`); (b) one dedicated differential non-interference test — two sessions built with the SAME public `simulatorSeed`/inputs/history, differing ONLY in the Enemy Bot's sealed round-1 hero (constructed via `ProtocolSessionStore.apply()`, since production derives the Enemy Bot's pick deterministically from the public seed alone and offers no public knob to vary only its private pick) — asserting byte-identical observable output aside from the session id. **Unlisted**: any violation is a real, visible red test. **Currently PASSING**. |

## Known-failure registry discipline

`qa/invariants/known-failures.json` is the only place an invariant may be marked "expected to fail
today." Semantics (enforced mechanically, not by convention):

- A listed ID's own aggregate test asserts `violations.length > 0` — if the registry entry stops
  reproducing (the measured violation count drops to zero), that test **fails the suite**: the
  registry must shrink deliberately (with a documented `shrunkEntries` reason), never silently.
- Any ID **not** listed asserts `violations.length === 0` (or, for the per-checkpoint invariants,
  every individual checkpoint test must pass) — an unlisted failure is never hidden.
- INV-OWN-001, INV-OWN-003, INV-OWN-004 may **never** appear in `knownFailures` for this phase —
  they are the invariants this gate exists to expose as real, current, unexpected defects.

## Independence

`qa/invariants/**` never imports decision logic from `apps/engine/src/coach/**` or
`apps/engine/src/recommendation/**` — mechanically verified by `qa/invariants/oracle-independence.test.ts`.
The oracle observes only the public HTTP route surface (serialized JSON) plus the session-layer
ownership truth (`controlledPositions` / `humanOpenPositions`) the task explicitly allows as truth
input.
