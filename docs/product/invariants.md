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
| INV-OWN-001 | Every position the product presents as the human's action (Coach `primaryAction.strategy` target position(s); any shortlist position rendered as the human's action) must belong to `humanOpenPositions`. Equivalently: `humanOpenPositions ⊆ controlledPositions`. | PD-003, PD-023, PD-026, PD-027 | `qa/invariants/ownership.test.ts` — `describe("INV-OWN-001 ...")`, one test per checkpoint. **Unlisted**: any violation is a real, visible red test — never a known failure. |
| INV-OWN-002 | While humans still have own-team action capacity in the current round, every `humanOpenPosition` must remain offerable by the recommendation surface (V2 `controlledSlots` / Coach shortlist). | PD-001, PD-020, PD-026, PD-027 | `qa/invariants/ownership.test.ts` — aggregate test `INV-OWN-002 (known failure registry) ...`. **Known failure** (`qa/invariants/known-failures.json`): round-slot capacity (2/2/1) structurally under-serves `humanOpenPositions` when it exceeds the round's open-slot count — the separate Position != Chronology remediation, not fixed here. |
| INV-OWN-003 | After a human pick binds position P, P must never again be offered as a human action. | PD-026, PD-027 | `qa/invariants/ownership.test.ts` — `describe("INV-OWN-003 ...")`, one test per checkpoint after the first bound position. **Unlisted**: any violation is a real, visible red test. |
| INV-OWN-004 | When humans have zero own-team action capacity in the current round (`humanOpenPositions` is empty), no human PICK action (`SUBMIT_SEALED_SELECTION` for the human's own side) is presented. | PD-026, PD-027 | `qa/invariants/ownership.test.ts` — `describe("INV-OWN-004 ...")`, one test per checkpoint with empty `humanOpenPositions`. **Unlisted**: any violation is a real, visible red test. |
| INV-CHRONO-001 | Metamorphic: the SET of positions the recommendation surface offers must not depend on the chronological order in which earlier human positions were filled (Position != Pick Order). | PD-001, PD-020, PD-027 | `qa/invariants/ownership.test.ts` — aggregate test `INV-CHRONO-001 (known failure registry) ...`. **Measured, not reproduced**: exhaustive ascending/descending/deferred pairing across all 26 control sets found zero violations (see `known-failures.json`'s `shrunkEntries` for why) — `apps/engine/src/recommendation/build.ts`'s own position-tagging is a pure, order-independent function of the current `humanOpenPositions` content + round capacity. Test now asserts `=== 0` unconditionally, as a real (currently passing) invariant, not a known failure. |
| INV-LEAK-001 | Observable outputs must remain byte-identical when only the Enemy Bot's PRIVATE internal assignment / private seed changes. No enemy private role/assignment may leak. | PD-005, PD-009, PD-012, PD-027 | `qa/invariants/ownership.test.ts` — `describe("INV-LEAK-001 ...")`, one test per checkpoint. **Unlisted**: any violation is a real, visible red test. |

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
