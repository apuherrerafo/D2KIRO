# Implementation Plan

<!-- Source documents: requirements.md · design.md · product-decisions.md (AP Ranked Roles V1) -->
<!-- Any deviation from the approved design requires an explicit STOP / escalation. -->

---

## Overview

This implementation plan converts the approved AP Ranked Roles V1 design into 38 executable tasks across 6 waves. It targets the Dota 2 Ranked Roles All Pick mode, patch 7.41f, with all 10 product decisions and 21 requirements from the approved spec.

Wave 0 runs in parallel with Waves 1–3 and gates Wave 4. Each wave ends with a manual acceptance checkpoint. No wave may begin implementation until its predecessor wave's checkpoint is approved.

## Tasks

See wave sections below for full task details.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 0,
      "name": "Data Readiness Gate",
      "tasks": [1],
      "runsInParallelWith": [1, 2, 3],
      "gates": "Wave 4 cannot start until Task 1 is approved by Product Owner"
    },
    {
      "wave": 1,
      "name": "Simulator Fidelity Core",
      "tasks": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      "dependencies": {}
    },
    {
      "wave": 2,
      "name": "Coach Orchestration",
      "tasks": [14, 15, 16, 17, 18, 19],
      "dependencies": {"14": [], "15": [14], "16": [15], "17": [14], "18": [16, 17], "19": [14, 15, 16, 18]}
    },
    {
      "wave": 3,
      "name": "Personal Position + Hero Pool + Flex",
      "tasks": [20, 21, 22, 23],
      "dependencies": {"20": [18, 19], "21": [18, 20], "22": [14, 19], "23": [14, 22]}
    },
    {
      "wave": 4,
      "name": "Contextual Intelligence",
      "prerequisite": "Wave 0 Task 1 approved by Product Owner",
      "tasks": [24, 25, 26, 27],
      "dependencies": {"24": [18, 19], "25": [18, 24], "26": [16, 19], "27": [18, 25]}
    },
    {
      "wave": 5,
      "name": "Product Certification",
      "tasks": [28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
      "dependencies": {
        "28": [],
        "29": [28],
        "30": [11, 28],
        "31": [],
        "32": [20, 21, 28],
        "33": [22, 23, 28],
        "34": [8, 9],
        "35": [28, 29, 30, 31, 32, 33, 34],
        "36": [35],
        "37": [24, 35, 36],
        "38": [18, 37]
      }
    }
  ],
  "withinWave1": {
    "2": [],
    "3": [2],
    "4": [3],
    "5": [2, 3, 4],
    "6": [5],
    "7": [6],
    "8": [4, 7],
    "9": [5, 6],
    "10": [7],
    "11": [5],
    "12": [7, 8],
    "13": [3, 5]
  }
}
```

## Notes

- Wave 0 (Task 1) runs in parallel with Waves 1–3. Wave 4 is BLOCKED until Task 1 is complete and the Product Owner approves DATA_FRESHNESS_REPORT.
- Task 5 (SOLO_MID replacement) must update ALL call sites in a single atomic commit. No partial state is acceptable.
- Task 13 (verifiedThroughPatch update) must update ALL dependent test expectations in the same commit.
- Task 27 (one-ply lookahead) is conditional — if existing lookahead tests fail, the task STOPS and escalates. The lookahead implementation is not modified.
- Thresholds for Flex entropy cutoff, Safe Core, pool-break gap, and shortlist size are deferred to Wave 5 Task 37 calibration. Preceding tasks use named configurable constants, not hardcoded magic numbers.
- No wave may be started without explicit Product Owner approval of the previous wave's manual acceptance checkpoint.

---

## Wave 0 — Data Readiness Gate

> This wave runs in PARALLEL with Waves 1–3. Wave 4 cannot start until task 2 is complete
> and reviewed by the Product Owner.

- [ ] 1. Audit dataset provenance and produce DATA_FRESHNESS_REPORT
  - Objective: Establish the actual verified source patch and freshness of every dataset consumed by V6 scoring before any scoring work in Wave 4 begins.
  - Files/areas likely affected:
    - `docs/DATA_FRESHNESS_REPORT.md` (new file to create)
    - `apps/engine/src/meta/` (patchStats / MetaSnapshot)
    - `apps/engine/data/hero-positions.json`
    - `apps/engine/data/hero-counters.json`
    - SQLite tables with hero matchup data (inspect via `apps/engine/src/db/`)
  - Implementation intent:
    - For each dataset record: source URL or pipeline, the actual verified patch/time window of the data, sample size / freshness date, whether a refresh pipeline exists and whether it succeeds.
    - Track Ruleset Mechanics Version (`verifiedThroughPatch`) and Data Snapshot Version as independent axes — never conflate them.
    - Do NOT rename 7.41e data as 7.41f. If data is still 7.41e while the ruleset targets 7.41f, the system MUST expose `metaIsStale: true` (already supported by V6 MetaSnapshot) — it must not silently claim 7.41f data.
    - Write findings to `docs/DATA_FRESHNESS_REPORT.md` with stale/not-stale conclusion per dataset.
  - Acceptance criteria:
    - `docs/DATA_FRESHNESS_REPORT.md` exists and lists every dataset with source, verified patch window, freshness date, pipeline status, and stale conclusion.
    - No dataset is labelled with a patch version that has not been independently verified.
  - Tests required:
    - None for this task (read-only audit + documentation). Wave 4 tasks that depend on data freshness will carry the relevant tests.
  - Manual verification:
    - Product Owner reviews DATA_FRESHNESS_REPORT and explicitly approves before Wave 4 may begin.
  - Dependencies: None.
  - STOP / escalation conditions:
    - Any dataset has a provenance that cannot be independently verified → STOP, escalate to Product Owner.
    - Refresh pipeline is broken or produces partial data → STOP, escalate before continuing.

---

## Wave 1 — Simulator Fidelity Core

> All tasks in this wave collectively deliver: a complete draft playable from Radiant OR Dire,
> Player controlling all 5 own-team picks, Enemy Bot with internal position constraints,
> ban phase, hidden picks, symmetric availability, correct collision mechanics, timers, and
> gold penalty. No Radiant hardcode. No Mid hardcode. Position ≠ pick order.

- [ ] 2. Audit and document SOLO_MID_SIMULATOR_POLICY call sites (read-only)
  - Objective: Produce a complete inventory of every location in the codebase that references the old solo-mid policy before touching any code, so the subsequent replacement can be done atomically.
  - Files/areas likely affected:
    - `apps/engine/src/simulator/solo-mid-policy.ts`
    - `apps/engine/src/server/routes/protocol-sessions.ts`
    - `apps/engine/src/server/protocol-session.ts`
    - `apps/engine/src/recommendation/decision.ts`
    - Any other file that imports `SOLO_MID_SIMULATOR_POLICY`, `isSoloMidSimulatorMetadata`, `humanRosterSlot`, `humanSide: "radiant"`, `rosterPositions` (grep exhaustively)
  - Implementation intent:
    - Run a grep across the entire repo for: `SOLO_MID_SIMULATOR_POLICY`, `isSoloMidSimulatorMetadata`, `humanRosterSlot`, `humanSide.*radiant`, `rosterPositions`, `humanPosition.*2`.
    - Produce a concise written list (inline code comment, a doc entry, or a checklist in this file below) of every call site with file path + line number.
    - Make zero code changes in this task.
  - Acceptance criteria:
    - The call-site inventory exists and is complete (verified by a second grep pass after writing).
    - No code has been modified.
  - Tests required: None (read-only task).
  - Dependencies: None.
  - STOP / escalation conditions:
    - Any call site is found that is not covered by the list in design.md §22 → STOP, document the discrepancy, escalate before proceeding to task 3.

- [ ] 3. Define SimulatorSessionConfig and isApSimulatorMetadata()
  - Objective: Establish the canonical configuration type for AP Ranked Roles V1 sessions and the type-guard that replaces `isSoloMidSimulatorMetadata`.
  - Files/areas likely affected:
    - `apps/engine/src/simulator/session-config.ts` (new file)
    - `apps/engine/src/simulator/solo-mid-policy.ts` (add or export `isApSimulatorMetadata` alongside old guard; full removal happens in task 5)
  - Implementation intent:
    - Create `apps/engine/src/simulator/session-config.ts` and export:
      ```typescript
      interface SimulatorSessionConfig {
        side: TeamSide;
        playerPersonalPosition: 1 | 2 | 3 | 4 | 5;   // required — no null in V1 AP sessions
        ownTeamRoleAssignments: Record<1 | 2 | 3 | 4 | 5, "assigned">;
        simulatorSeed: string;
        playerBanPreferences: (HeroId | null)[];       // length <= 4
        patch: string;
      }
      ```
    - Export `isApSimulatorMetadata(metadata: ProtocolSessionMetadata): boolean` — verifies `adapterKind === "simulator"` AND `simulatorSeed !== null`. Does NOT verify `humanSide === "radiant"` or `humanPosition === 2`.
    - `ProtocolSessionMetadata.humanPosition` retains `| null` for legacy compatibility.
  - Acceptance criteria:
    - `SimulatorSessionConfig` is importable and fully typed.
    - `isApSimulatorMetadata()` returns `true` for any `{adapterKind: "simulator", simulatorSeed: "<non-null>"}` regardless of `humanSide` or `humanPosition`.
    - `isApSimulatorMetadata()` returns `false` when `adapterKind !== "simulator"` or `simulatorSeed` is null/undefined.
  - Tests required:
    - `isApSimulatorMetadata` returns true for Dire + position 1 combo.
    - `isApSimulatorMetadata` returns true for Radiant + position 5 combo.
    - `isApSimulatorMetadata` returns false when `adapterKind !== "simulator"`.
    - `isApSimulatorMetadata` returns false when `simulatorSeed` is null.
  - Dependencies: Task 2 (call-site inventory must exist first).
  - STOP / escalation conditions:
    - `playerPersonalPosition` needs to be optional/null for any V1 AP session path → STOP. The design requires it as mandatory for AP sessions (design.md §10, §26 Wave 1).

- [ ] 4. Generalize deriveExternalDecisionSeed and chooseExternalSuggestion as pure utilities
  - Objective: Extract the two reusable Enemy Bot utilities from `SOLO_MID_SIMULATOR_POLICY` as standalone pure functions, decoupled from the old policy, so the Enemy Bot generalisation (task 7) can depend on them.
  - Files/areas likely affected:
    - `apps/engine/src/simulator/solo-mid-policy.ts` (source of truth for current implementations)
    - `apps/engine/src/simulator/enemy-bot-utils.ts` (new file for the extracted pure functions)
  - Implementation intent:
    - Extract `deriveExternalDecisionSeed(draftSeed: string, participant: { side: TeamSide; rosterSlot: number }, decisionIndex: number): string` as a standalone pure function — same logic, no reference to `SOLO_MID_SIMULATOR_POLICY`.
    - Extract `chooseExternalSuggestion` quality-band logic (top-`maxCandidates` within `qualityBandPoints` using `stableHash`) as a standalone pure function that accepts `maxCandidates` and `qualityBandPoints` as parameters instead of reading them from `SOLO_MID_SIMULATOR_POLICY`.
    - Keep the old wiring in `solo-mid-policy.ts` calling the new functions (backward compatibility until task 5 removes the old policy).
  - Acceptance criteria:
    - Both functions are importable from the new module independently of `SOLO_MID_SIMULATOR_POLICY`.
    - Existing `solo-mid-policy.ts` delegates to the new functions — no duplicated logic.
  - Tests required:
    - `deriveExternalDecisionSeed` is deterministic: same (draftSeed, participant, decisionIndex) → same string.
    - `deriveExternalDecisionSeed` produces different strings for different rosterSlot values.
    - `chooseExternalSuggestion` selects within the quality band (never picks a candidate > qualityBandPoints below the top score).
    - `chooseExternalSuggestion` is deterministic given the same seed.
  - Dependencies: Task 3.
  - STOP / escalation conditions: None specific beyond global conditions.

- [ ] 5. Replace SOLO_MID_SIMULATOR_POLICY with GeneralizedApSimulatorPolicy — all call sites in one commit
  - Objective: Remove the hardcoded Radiant/Mid/last-pick assumptions from the Simulator. This commit must update every call site identified in task 2 atomically — no partial state.
  - Files/areas likely affected:
    - `apps/engine/src/simulator/solo-mid-policy.ts` (GeneralizedApSimulatorPolicy replaces SOLO_MID_SIMULATOR_POLICY; file may be renamed or kept with updated exports)
    - `apps/engine/src/server/routes/protocol-sessions.ts`
    - `apps/engine/src/server/protocol-session.ts`
    - `apps/engine/src/recommendation/decision.ts`
    - All other call sites from the task 2 inventory
  - Implementation intent:
    - Create `GeneralizedApSimulatorPolicy` (or replace the constant in-place) that reads all side/position/slot values from `SimulatorSessionConfig` rather than hardcoding them.
    - Remove: `humanSide: "radiant"` hardcode, `humanPosition: 2` hardcode, `humanRosterSlot: 4` hardcode, `rosterPositions` fixed slot-ordinal → position mapping.
    - Retain as pure utilities (move to a neutral module if appropriate): `rosterSlotForRoundSlot`, `participantForRoundSlot` (adapted to not assume fixed positions).
    - Replace every call to `isSoloMidSimulatorMetadata()` with `isApSimulatorMetadata()` in `protocol-sessions.ts` and `protocol-session.ts`.
    - `deriveLegalDecision` in `decision.ts`: generalise the `rosterSlotForRoundSlot` dependency so it does not assume the `SOLO_MID_SIMULATOR_POLICY.rosterPositions` mapping. Verify that behaviour for any existing CM sessions is unaffected.
  - Acceptance criteria:
    - Grep for `SOLO_MID_SIMULATOR_POLICY`, `isSoloMidSimulatorMetadata`, `humanSide.*radiant`, `humanRosterSlot.*4`, `humanPosition.*2` returns zero results in production code (test files that verified old behaviour are updated or deleted).
    - All previously passing tests continue to pass.
    - A draft session with `side: "dire"` and `playerPersonalPosition: 1` can be created without error.
  - Tests required:
    - `isApSimulatorMetadata` returns true for both Radiant and Dire metadata (already covered by task 3 tests — confirm still pass).
    - `deriveLegalDecision` produces correct `controlledSlots` when `partySize: 5` and `side: "dire"`.
    - Side symmetry: creating a session with `side: "dire"` + `playerPersonalPosition: 3` results in a valid `DraftProtocolState` with Dire as own side.
  - Dependencies: Tasks 2, 3, 4.
  - STOP / escalation conditions:
    - Any partial update leaves the codebase in a state where some call sites use the old policy and others use the new one → revert and re-do in a single commit.
    - `deriveLegalDecision` change inadvertently breaks CM session behaviour → STOP, revert, escalate.

- [ ] 6. Update ProtocolSessionMetadata and CreateProtocolSessionInput for AP
  - Objective: Wire `SimulatorSessionConfig.playerPersonalPosition` into the session creation path so that `ProtocolSessionMetadata.humanPosition` is populated from the Player's explicit declaration rather than from a hardcoded policy constant.
  - Files/areas likely affected:
    - `apps/engine/src/server/protocol-session.ts` (`ProtocolSessionStore.create()`, `authorizedLegalActions()`)
    - `apps/engine/src/server/routes/protocol-sessions.ts` (route that creates a protocol session)
    - `apps/engine/src/draft-protocol/types.ts` — READ ONLY; must not be changed
  - Implementation intent:
    - `ProtocolSessionStore.create()` reads `playerPersonalPosition` from the incoming `SimulatorSessionConfig` and stores it in `ProtocolSessionMetadata.humanPosition`.
    - `ProtocolSessionMetadata.humanPosition` retains `| null` for legacy sessions that predate this requirement.
    - `authorizedLegalActions()` uses `isApSimulatorMetadata()` (from task 3) instead of the old guard.
    - No changes to kernel types (`DraftProtocolState`, `RankedApState`) — those are frozen.
  - Acceptance criteria:
    - A session created with `{side: "dire", playerPersonalPosition: 3}` results in `metadata.humanPosition === 3` and `metadata.localSide === "dire"`.
    - Legacy sessions with `humanPosition: null` continue to function.
    - `authorizedLegalActions()` accepts commands from AP sessions regardless of side or position.
  - Tests required:
    - `ProtocolSessionStore.create()` with `playerPersonalPosition: 5` sets `metadata.humanPosition === 5`.
    - `ProtocolSessionStore.create()` legacy path (no `playerPersonalPosition`) produces `metadata.humanPosition === null`.
    - `authorizedLegalActions()` returns a non-empty set for `{side: "dire", simulatorSeed: "abc"}` session.
  - Dependencies: Tasks 3, 5.
  - STOP / escalation conditions:
    - Any change requires modifying `DraftProtocolState` or `RankedApState` type definitions → STOP immediately and escalate.

- [ ] 7. 5-slot Own Team PartyContext
  - **SUPERSEDED by PD-026 (2026-09-27)** — the `partySize: 5` / all-seats-controlled semantics below now
    describe only Party 5. AP control is by position (`controlledPositions`, session layer); `PartyContext`
    is structural and inert for AP Simulator (`controlledSlots: []`). See design §11 ("Party control model",
    "Rejected designs register") and PD-027. Historical text retained below.
  - Objective: Configure Own Team party context for AP sessions as `partySize: 5` with all 5 slots controlled by the Player, replacing the old `partySize: 1` / single-slot model.
  - Files/areas likely affected:
    - `apps/engine/src/server/routes/protocol-sessions.ts` (session creation input)
    - `apps/engine/src/recommendation/decision.ts` (`deriveLegalDecision`, `controlledSlots` population)
    - `apps/engine/src/simulator/session-config.ts` (already created in task 3)
  - Implementation intent:
    - When creating an AP session, pass `partyContext = { partySize: 5, side: config.side, controlledSlots: [0,1,2,3,4].map(i => ({ side: config.side, slotIndex: i, controllerId: "player" })) }` to the kernel.
    - `deriveLegalDecision`: ensure `controlledSlots` is populated with all 5 slots for the player's side. Do NOT re-introduce any fixed slot-ordinal → position mapping.
    - Verify that the change does not affect CM sessions (which use a different `partyContext`).
  - Acceptance criteria:
    - AP session `protocolState.partyContext.controlledSlots` has 5 entries, all for the player's declared side.
    - `deriveLegalDecision` returns legal decisions for each of the 5 own-team slot indices.
    - Existing CM session tests pass unmodified.
  - Tests required:
    - AP session created with `side: "radiant"` → `controlledSlots` contains indices 0–4, all for Radiant.
    - AP session created with `side: "dire"` → `controlledSlots` contains indices 0–4, all for Dire.
    - `deriveLegalDecision` for AP session returns valid options for slot indices 0, 1, 2, 3, and 4.
  - Dependencies: Tasks 5, 6.
  - STOP / escalation conditions:
    - `deriveLegalDecision` change inadvertently affects CM session behaviour → revert, escalate.

- [ ] 8. EnemyBotConfig and Enemy Bot with internal position assignments
  - Objective: Implement a generalised Enemy Bot that assigns positions to its 5 slots deterministically from the session seed and uses `buildRecommendationSetV2` scoped to those positions — without exposing internal assignments to the Coach pipeline.
  - Files/areas likely affected:
    - `apps/engine/src/simulator/enemy-bot.ts` (new or significantly extended)
    - `apps/engine/src/simulator/enemy-bot-utils.ts` (utilities from task 4)
    - `apps/engine/src/recommendation/build.ts` (called by Enemy Bot with position-scoped inputs)
    - `apps/engine/src/draft-protocol/perspective.ts` (called for Enemy Bot's own-side view)
  - Implementation intent:
    - Define `EnemyBotConfig { side: TeamSide; internalPositionAssignments: Record<number, 1|2|3|4|5>; seed: string }`.
    - Generate `internalPositionAssignments` deterministically from `simulatorSeed` before the draft starts (one assignment per roster slot 0–4, each maps to a distinct position 1–5, derived via stable PRNG from seed).
    - Enemy Bot decision pipeline for each open slot: `project(protocolState, enemySide)` → retrieve `internalAssignedPosition` from `internalPositionAssignments[slotIndex]` → filter candidate universe to heroes valid for that position from `hero-positions.json` → call `buildRecommendationSetV2(view, ...)` with `targetPosition = internalAssignedPosition` → quality band (top-3 within 5 score points) → `deriveExternalDecisionSeed(seed, {side: enemySide, rosterSlot: slotIndex}, decisionIndex)` → select hero → `SUBMIT_SEALED_SELECTION`.
    - `EnemyBotInternalState.positionsByRosterSlot` and `pendingSelections` must NEVER be passed to any Coach pipeline function.
    - Enemy Bot consults `isSealedSelectionLegal(protocolState, enemySide, slotIndex, heroId)` for availability — does not know about Own Team's current-round sealed selections.
  - Acceptance criteria:
    - Same seed + same draft state → same 5 enemy hero selections.
    - Different seeds → meaningfully different selections in at least one pick.
    - All 5 enemy picks are valid heroes for their internally assigned position per `hero-positions.json`.
    - No `internalPositionAssignments` value is readable from any function in the Coach pipeline (enforced by not passing the object).
    - Enemy Bot does NOT exclude Own Team's current-round hidden picks from its candidate pool.
  - Tests required:
    - Determinism: two Enemy Bot runs with identical seed produce identical pick sequence.
    - Seed variation: two runs with different seeds produce different pick in at least 1 slot.
    - Position validity: for each of the 5 slots, the selected hero appears in `hero-positions.json` for the assigned position.
    - No position-assignment leak: a function that receives only `PerspectiveDraftView` cannot read `internalPositionAssignments` from it.
    - Symmetry: Enemy Bot operates correctly as both Radiant (when Player is Dire) and Dire (when Player is Radiant).
  - Dependencies: Tasks 4, 7.
  - STOP / escalation conditions:
    - `buildRecommendationSetV2` must be called with `DraftProtocolState` directly (instead of `PerspectiveDraftView`) for the Enemy Bot to function → STOP, design conflict, escalate.

- [ ] 9. BanResolutionPolicy
  - Objective: Implement the pre-draft ban resolution system with its observable guarantees: unique bans prioritised, 4-full-preferences guarantee, variable-length output, deterministic by seed, fail-closed.
  - Files/areas likely affected:
    - `apps/engine/src/simulator/ban-resolution.ts` (new file)
    - `apps/engine/src/server/routes/protocol-sessions.ts` (BAN_CONFIGURATION → BAN_RESOLUTION transition)
    - `apps/engine/src/simulator/session-config.ts` (playerBanPreferences already defined)
  - Implementation intent:
    - Define and implement `BanResolutionPolicy`:
      ```typescript
      interface BanPreferenceSet { playerId: string; preferences: (HeroId | null)[]; }
      interface BanResolutionPolicy { resolve(preferences: BanPreferenceSet[], seed: string): HeroId[]; }
      ```
    - `preferences[0]` = Player preferences. `preferences[1..9]` = 9 simulated player preferences generated deterministically from seed using `deriveExternalDecisionSeed`-style PRNG.
    - Observable guarantees: unique heroes in output (no duplicates); player with 4 full preference slots has at least 1 preference in the resolved ban set; variable-length (no fixed count assumed).
    - Fail-closed: if `resolve()` throws or produces an invalid result (null, duplicate hero IDs, non-existent hero IDs), the Simulator session does NOT advance to `PICK_ROUND_1`. The session returns to `BAN_CONFIGURATION` with an error state. An empty ban set is only valid when all 9 players have all preference slots empty.
    - After resolution: Simulator sends `RECORD_RESOLVED_BANS(resolvedBans)` + `BAN_RESOLUTION_COMPLETE` to the kernel.
    - The Coach receives only the final `resolvedBans` array — not individual player preferences, not the resolution algorithm state.
  - Acceptance criteria:
    - `resolve(samePrefs, sameSeed)` returns byte-identical output across invocations.
    - `resolve(samePrefs, differentSeed)` returns meaningfully different output.
    - Player with 4 full preference slots has at least 1 hero in `resolvedBans`.
    - Hero appearing in multiple players' preferences appears only once in `resolvedBans`.
    - Policy error → session stays in `BAN_CONFIGURATION` with error state; `PICK_ROUND_1` is NOT entered.
  - Tests required:
    - Determinism: same inputs same output.
    - Seed variation: different seeds produce different outputs.
    - 4-preferences guarantee.
    - Deduplication: same hero in 3 players' preferences → appears once in result.
    - Fail-closed: simulate `resolve()` throwing → session stays in BAN_CONFIGURATION.
    - Baned hero not pickable: hero in `resolvedBans` fails `isSealedSelectionLegal` after `BAN_RESOLUTION_COMPLETE`.
  - Dependencies: Tasks 5, 6.
  - STOP / escalation conditions:
    - Design requires disclosing individual player ban preferences to the Coach → STOP (violates Req 2.5, PD-009).

- [ ] 10. Hero availability symmetry — explicit regression tests
  - Objective: Add explicit regression tests that verify the symmetric availability invariant (hidden current-round picks do NOT exclude heroes from the opposing team's pool). The underlying `isSealedSelectionLegal` logic is already correct; this task adds the safety net.
  - Files/areas likely affected:
    - `apps/engine/src/draft-protocol/ranked-all-pick.test.ts` (or adjacent test file for the kernel)
    - `apps/engine/src/draft-protocol/perspective.test.ts`
  - Implementation intent:
    - Write tests that put a known hero (e.g., Puck heroId) into Enemy's `sealed` in the current round, then assert:
      1. `project(state, playerSide).enemyPicks` contains `{ visibility: "HIDDEN" }` with no `heroId` field.
      2. `isSealedSelectionLegal(state, playerSide, slot, puck)` returns `true`.
      3. `project(state, playerSide).bannedHeroes` does NOT contain Puck.
    - Write the symmetric test from the Enemy Bot's perspective.
    - Write a post-reveal test: after `resolveRound()` with Puck as a collision, Puck is in `bannedHeroes` and `isSealedSelectionLegal(_, _, _, puck) === false`.
    - Write: after `resolveRound()` normally (no collision), both teams' revealed heroes are removed from the available pool.
  - Acceptance criteria:
    - All four test cases described in Implementation intent are present and pass.
  - Tests required: (these ARE the task — all four cases above).
  - Dependencies: Task 7 (5-slot context must be stable before writing full-draft availability tests).
  - STOP / escalation conditions:
    - Any of these tests fail on the current kernel code → STOP; do NOT silently fix the kernel without understanding why — escalate.

- [ ] 11. Collision #3 first-registration-wins — patch resolveSimulatorCollisionAuthority
  - Objective: Replace the random PRNG winner selection in `resolveSimulatorCollisionAuthority` with the canonical first-registration-wins rule (PD-022, Req 1.5, design.md §9).
  - Files/areas likely affected:
    - `apps/engine/src/draft-protocol/adapters/simulator-authority.ts`
    - `apps/engine/src/draft-protocol/ranked-all-pick.test.ts` (add mandatory test)
  - Implementation intent:
    - Identify how `state.rankedAp.round.sealed` records insertion order (array index or a timestamp/ordinal field on `SealedSelection`).
    - Patch `resolveSimulatorCollisionAuthority`: for collision event #3, compare the two contenders' entries in `sealed[]` by insertion position (earlier index = registered first); the earlier registrant wins; the later registrant's slot is reopened.
    - Remove the `mulberry32` random draw for collision winner selection.
    - Add the mandatory test from design.md §9: contender whose `SUBMIT_SEALED_SELECTION` appears earlier in `sealed[]` retains the hero; later registrant must re-pick.
  - Acceptance criteria:
    - No random element in `resolveSimulatorCollisionAuthority`.
    - Given identical state, `resolveSimulatorCollisionAuthority` produces the same winner deterministically.
    - The mandatory first-registration test passes.
  - Tests required:
    - Collision event #3: earlier registrant retains hero; later registrant's slot re-opens.
    - `resolveSimulatorCollisionAuthority` called twice with identical state → same winner.
    - Collision events #1 and #2 behaviour is unchanged (hero banned, both slots reopen).
  - Dependencies: Task 5.
  - STOP / escalation conditions:
    - `sealed[]` does not preserve insertion order and no ordinal field exists → STOP; do not invent an ordering; escalate to understand the kernel data model before patching.
    - Patch produces non-deterministic results on any test run → STOP, do not merge.

- [ ] 12. Draft timers (25/25/20 s) + gold penalty state
  - Objective: Implement `RoundTimerState` and `GoldPenaltyState` as part of `AllPickSimulatorState` to model timer countdown and per-slot gold penalty — entirely outside the kernel.
  - Files/areas likely affected:
    - `apps/engine/src/simulator/all-pick-simulator-state.ts` (new or extended)
    - `apps/engine/src/simulator/timer.ts` (new timer logic module)
    - `apps/engine/src/server/routes/protocol-sessions.ts` (timer start / penalty tracking)
    - `apps/web` draft view component (timer countdown display, gold penalty display)
  - Implementation intent:
    - Define:
      ```typescript
      interface RoundTimerState { round: 1|2|3; startedAt: number; durationMs: number; penaltyStartedAt: number | null; }
      interface GoldPenaltyState { bySlot: number[]; penaltyRatePerSecond: number; } // penaltyRatePerSecond = 2
      ```
    - On round start: set `timerState = { round, startedAt: Date.now(), durationMs: ROUND_TIMER_MS[round], penaltyStartedAt: null }`.
    - When `durationMs` elapses without all Own Team slots confirmed: set `penaltyStartedAt = Date.now()` for each pending slot. Begin incrementing `bySlot[slotIndex]` at 2 gold/second.
    - Penalty is per-slot independently. A slot that confirms stops accruing penalty. Other pending slots continue.
    - Player retains the ability to pick and confirm while penalty is active.
    - Kernel does NOT receive timer events — timer state lives only in the Simulator layer.
    - UI: timer countdown is visible during each round; gold penalty counter visible per slot when penalty is active.
    - `ROUND_TIMER_MS` must match kernel identity `{1:25000, 2:25000, 3:20000}` (verify against `ranked-all-pick.ts`).
  - Acceptance criteria:
    - Timer durations match `ROUND_TIMER_MS = {1:25000, 2:25000, 3:20000}`.
    - Gold penalty starts at 2 gold/second per slot after base timer expires.
    - A confirmed slot stops accruing penalty; other pending slots continue independently.
    - Timer and penalty state are not part of `DraftProtocolState`.
  - Tests required:
    - Timer durations: `RoundTimerState.durationMs` for rounds 1, 2, 3 equals 25000, 25000, 20000.
    - Penalty increment: after 1 second past expiry, unconfirmed slot has `bySlot[i] === 2`.
    - Slot confirmation stops penalty: after confirming slot 0, `bySlot[0]` stops changing; `bySlot[1]` continues if slot 1 is still pending.
    - Two pending slots accumulate penalty independently.
  - Dependencies: Tasks 7, 8.
  - STOP / escalation conditions:
    - Timer implementation requires modifying kernel state or dispatching kernel commands on timeout → STOP, redesign the timer to stay in the Simulator layer only.

- [ ] 13. verifiedThroughPatch metadata update + SOLO_MID constant cleanup — single commit
  - Objective: Update `RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch` from `"7.41e"` to `"7.41f"` and rename the legacy recommendation output limit constant. All dependent tests must be updated in the same commit.
  - Files/areas likely affected:
    - `apps/engine/src/draft-protocol/rulesets/ranked-all-pick.ts` (`verifiedThroughPatch` field)
    - `apps/engine/src/draft-protocol/identity-hash.ts` (READ — confirm what feeds `rulesHash` before changing)
    - `apps/engine/src/recommendation/build.ts` (`SOLO_MID_RECOMMENDATION_OUTPUT_LIMIT` → `AP_RECOMMENDATION_OUTPUT_LIMIT`)
    - All test files that compare `ruleset.verifiedThroughPatch` or `basedOn.rulesHash` against a string/hash literal
  - Implementation intent:
    - First: read `identity-hash.ts` to confirm exactly which fields of `RANKED_ALL_PICK_IDENTITY` feed into `rulesHash()`. If `verifiedThroughPatch` is included in the hash input, the hash will change and ALL tests comparing `rulesHash` values must be updated. If it is NOT included, the hash is stable and only string-comparison tests need updating.
    - Update `verifiedThroughPatch: "7.41f"` in `ranked-all-pick.ts`.
    - Rename `SOLO_MID_RECOMMENDATION_OUTPUT_LIMIT` → `AP_RECOMMENDATION_OUTPUT_LIMIT` everywhere it is used.
    - Update all test expectations in the same commit (no broken test left with stale expected value).
  - Acceptance criteria:
    - `RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch === "7.41f"`.
    - No test references `"7.41e"` in a hard-coded expected value.
    - `AP_RECOMMENDATION_OUTPUT_LIMIT` is the only name in production code.
    - All tests pass.
  - Tests required:
    - Existing test that verifies `verifiedThroughPatch`: update expected value to `"7.41f"`.
    - If `rulesHash` is affected: update the expected hash in all tests that hardcode it.
  - Dependencies: Tasks 3, 5.
  - STOP / escalation conditions:
    - `verifiedThroughPatch` change causes `rulesHash` to change in a way that is not fully understood → STOP; audit `identity-hash.ts` fully before proceeding.
    - Any test is left with a stale expected value after this commit → not acceptable; fix all before merging.

### Wave 1 — Manual Acceptance Checkpoint

> Wave 1 cannot close on unit tests alone.
>
> Before marking Wave 1 complete, the Product Owner must:
> 1. Open the app in a browser and play a complete draft from **Radiant**: ban phase → Round 1 → Round 2 → Round 3 → COMPLETE.
> 2. Open the app in a browser and play a complete draft from **Dire**: same flow.
> 3. Verify: timers count down, round reveal works, picks are hidden until reveal, collision is detected and resolved, gold penalty counter appears on late picks.
> 4. Sign off with: *"This feels like Ranked Roles All Pick."*

---

## Wave 2 — Coach Orchestration

> All tasks in Wave 2 collectively deliver: the Coach producing a `RevealStrategy` from the
> start of the draft, recalculating after every Own Team pick and every round reveal, never using
> hidden enemy information, and emitting `RecommendationOutputV3` with `primaryAction` and
> `shortlist`.

- [ ] 14. CoachObservableState definition and hidden-information boundary
  - Objective: Define `CoachObservableState` and guarantee that all inputs to it trace back to `PerspectiveDraftView` or legal evidence — never to `DraftProtocolState` or `EnemyBotInternalState`.
  - Files/areas likely affected:
    - `apps/engine/src/coach/observable-state.ts` (new file)
    - `apps/engine/src/draft-protocol/architecture-guard.test.ts` (extend existing guard)
  - Implementation intent:
    - Define `CoachObservableState`:
      ```typescript
      interface CoachObservableState {
        view: PerspectiveDraftView;
        enemyRoleBeliefs: Map<HeroId, RoleBelief>;
        ownRoleBeliefs: Map<HeroId, RoleBelief>;
        playerPositionAssignments: Map<HeroId, 1|2|3|4|5>;
        personalContext: PlayerPersonalContext | null;
        confirmedBans: HeroId[];
      }
      interface PlayerPersonalContext { position: 1|2|3|4|5; heroPool: HeroId[]; }
      ```
    - `confirmedBans` is derived from `view.bannedHeroes` — not from `protocolState` directly.
    - `enemyRoleBeliefs` is populated only from `view.enemyPicks` entries with `visibility: "REVEALED"` — not from `EnemyBotInternalState`.
    - Extend `architecture-guard.test.ts`: no file under `src/recommendation/` or `src/coach/` may import from a type or module that exposes `EnemyBotInternalState` or raw `DraftProtocolState`.
  - Acceptance criteria:
    - `CoachObservableState` is fully typed and exported.
    - `architecture-guard.test.ts` passes and covers the new Coach modules.
    - No import of `EnemyBotInternalState` or `DraftProtocolState` in any Coach or recommendation module.
  - Tests required:
    - Architecture guard: import from `EnemyBotInternalState` in a Coach module → guard test fails.
    - `buildCoachObservableState(view, ...)`: `confirmedBans` equals `view.bannedHeroes`; `enemyRoleBeliefs` contains only heroes from `view.enemyPicks` with `visibility: "REVEALED"`.
  - Dependencies: Tasks 7, 8.
  - STOP / escalation conditions:
    - Any necessary data about the draft state cannot be derived from `PerspectiveDraftView` without accessing `DraftProtocolState` → STOP, escalate; do not bridge the hidden information boundary.

- [ ] 15. deriveDecisionContextFromView — PerspectiveDraftView adapter
  - Objective: Create a parallel function that derives `DraftDecisionContext` from `PerspectiveDraftView` without modifying the existing legacy `deriveDecisionContext(DraftState)`.
  - Files/areas likely affected:
    - `apps/engine/src/drafter/decision-context.ts` (add new export; do NOT change existing function)
  - Implementation intent:
    - Export `deriveDecisionContextFromView(view: PerspectiveDraftView): DraftDecisionContext`.
    - Logic:
      - `ownPicksConfirmed = view.ownPicks.filter(p => p.visibility !== "HIDDEN").length`
      - `revealedEnemyPicks = view.enemyPicks.filter(p => p.visibility === "REVEALED").length`
      - `team_opening` when `view.rankedAp.phase === "PICK_ROUND_1"` AND `ownPicksConfirmed === 0`
      - `blind_second_pick` when `PICK_ROUND_1` AND `ownPicksConfirmed === 1`
      - `response_pick` when `revealedEnemyPicks >= 2`
      - `closing_pick` when `revealedEnemyPicks >= 4`
      - (exact thresholds: align with design.md §16 logic)
    - Do NOT touch the existing `deriveDecisionContext(DraftState)` — legacy path must continue working.
  - Acceptance criteria:
    - `deriveDecisionContextFromView` is exported and testable independently.
    - Existing `deriveDecisionContext` tests pass unmodified.
  - Tests required:
    - `PICK_ROUND_1` + 0 own confirmed picks → `team_opening`.
    - `PICK_ROUND_1` + 1 own confirmed pick → `blind_second_pick`.
    - 2 enemy revealed picks → `response_pick`.
    - 4+ enemy revealed picks → `closing_pick`.
  - Dependencies: Task 14.
  - STOP / escalation conditions: None specific.

- [ ] 16. RevealStrategy type + deriveRevealStrategy()
  - Objective: Implement the Level-1 Coach orchestration layer that maps draft state and V6 recommendations to a `RevealStrategy` — the primary output answering "what is the best reveal decision now?"
  - Files/areas likely affected:
    - `apps/engine/src/coach/reveal-strategy.ts` (new file)
  - Implementation intent:
    - Define `RevealStrategy` discriminated union exactly as in design.md §4:
      `REVEAL_POSITION | REVEAL_HERO | DEFER_POSITION | REVEAL_FLEX | OPPORTUNITY`
    - Implement `deriveRevealStrategy(view, recommendations, playerPersonalPosition, heroPool, decisionContext): RevealStrategy`.
    - Support-first prior: `team_opening` or `blind_second_pick` with no strong counter/meta signal favouring a core → `REVEAL_POSITION(position=5)` or `REVEAL_POSITION(position=4)`.
    - `REVEAL_HERO` ONLY when evidence justifies hero-level specificity (high V6 confidence, dominant counter or meta signal) — do NOT fabricate a named hero from a weak signal.
    - `OPPORTUNITY(subtype=SAFE_CORE)` deferred to Wave 4 (no `detectSafeCoreWindow` yet — emit `REVEAL_POSITION` as fallback).
    - `DEFER_POSITION` when draft evidence supports strategic deferral.
    - `REVEAL_FLEX` when own picked hero is Flex with unresolved position.
    - If only role-level evidence → `REVEAL_POSITION` (never force hero-level output).
  - Acceptance criteria:
    - `deriveRevealStrategy` returns a typed `RevealStrategy` discriminated union value.
    - Support-first prior fires for `team_opening` / `blind_second_pick` context without a dominant core signal.
    - `REVEAL_HERO` not produced when only role-level evidence exists.
    - Function is pure (same inputs → same output).
  - Tests required:
    - `team_opening` + no strong core signal → kind is `REVEAL_POSITION`, position is 4 or 5.
    - `response_pick` + dominant counter signal for a specific hero → kind is `REVEAL_HERO`.
    - `REVEAL_FLEX` when own Flex hero is unresolved.
    - All four `RevealStrategy` kinds are reachable (at least one test each).
  - Dependencies: Tasks 14, 15.
  - STOP / escalation conditions:
    - Design requires consulting `EnemyBotInternalState` or `DraftProtocolState` directly to derive strategy → STOP.

- [ ] 17. HeroCard, HeroBadge types and badge derivation logic
  - Objective: Define `HeroCard` and `HeroBadge` and implement badge derivation from `Recommendation.evidence[]` so that `translateToRecommendationOutputV3` can populate the shortlist.
  - Files/areas likely affected:
    - `apps/engine/src/coach/hero-card.ts` (new file)
    - `apps/engine/src/recommendation/build.ts` (evidence[] structure — read only)
  - Implementation intent:
    - Define `HeroBadge` union and `HeroCard` interface exactly as in design.md §4.
    - Implement `deriveHeroBadges(recommendation: Recommendation, heroPool: HeroId[]): HeroBadge[]` — maps `evidence[]` fields to badge labels. Badge selection is based on actual signal evidence, not on hero identity heuristics.
    - `isFromPool: boolean` = `heroPool.includes(heroId)`.
  - Acceptance criteria:
    - `HeroCard` is fully typed with all fields from design.md §4.
    - `deriveHeroBadges` produces `YOUR_POOL` when hero is in the pool, `OUTSIDE_YOUR_POOL` when it is not and pool is configured, and appropriate signal badges from evidence.
    - No badge is fabricated without corresponding evidence.
  - Tests required:
    - Hero in pool → `YOUR_POOL` badge present.
    - Hero not in pool but pool is configured → `OUTSIDE_YOUR_POOL` badge present.
    - Hero with dominant `counter` signal in evidence → `COUNTERS_BANNED` or signal badge present (verify against actual evidence field name in `Recommendation`).
    - Empty evidence → no spurious badges.
  - Dependencies: Task 14 (CoachObservableState provides heroPool context).
  - STOP / escalation conditions: None specific.

- [ ] 18. RecommendationOutputV3 + translateToRecommendationOutputV3()
  - Objective: Define the full `RecommendationOutputV3` contract and the translation function that maps `RecommendationSetV2` + `RevealStrategy` + `CoachObservableState` into it.
  - Files/areas likely affected:
    - `apps/engine/src/coach/recommendation-output-v3.ts` (new file)
    - `apps/engine/src/recommendation/build.ts` (read-only — source of `RecommendationSetV2`)
  - Implementation intent:
    - Define `RecommendationOutputV3` exactly as in design.md §17, including `primaryAction`, `shortlist: HeroCard[]`, optional `opportunity`, optional `personalHeroView`, optional `outsidePoolRecommendation`, and `meta`.
    - Implement `translateToRecommendationOutputV3(recommendationSet, revealStrategy, coachState, config): RecommendationOutputV3`.
    - `primaryAction.label`: derived from `revealStrategy.kind` + `revealStrategy.rationale` — NOT a hardcoded string switch.
    - `shortlist`: top 5 `HeroCard[]` (exact number to be calibrated in Wave 5 QA; use 5 as initial default).
    - `opportunity`: absent unless `detectSafeCoreWindow` returns `isSafeWindow=true` (wired in Wave 4 — absent in Wave 2).
    - `personalHeroView`: absent when `config.playerPersonalPosition` is null/undefined (Wave 3 provides the full implementation; Wave 2 may emit null).
    - `outsidePoolRecommendation`: absent when pool is empty (full logic in Wave 3).
    - `meta.confidence`: derived from `recommendationSet.recommendations[0]` score gap vs. second candidate.
    - Stale detection: `meta.basedOn` propagated from `recommendationSet.basedOn`.
  - Acceptance criteria:
    - `translateToRecommendationOutputV3` returns a valid `RecommendationOutputV3`.
    - `opportunity` absent when no safe core evidence (Wave 2 baseline).
    - `personalHeroView` absent when `playerPersonalPosition` not declared.
    - `outsidePoolRecommendation` absent when pool is empty.
    - `shortlist` has at most 5 heroes.
    - `primaryAction.label` is a non-empty string for all `RevealStrategy` kinds.
  - Tests required:
    - `opportunity` absent in Wave 2 output (no `detectSafeCoreWindow` yet).
    - `personalHeroView` absent when no position declared.
    - `outsidePoolRecommendation` absent when pool is empty.
    - `shortlist` length ≤ 5.
    - `meta.basedOn` equals the source `recommendationSet.basedOn`.
  - Dependencies: Tasks 16, 17.
  - STOP / escalation conditions: None specific.

- [ ] 19. Coach orchestration — recompute triggers
  - Objective: Wire the three recalculation triggers so that every relevant draft event produces a fresh `RecommendationOutputV3` with a new `basedOn.stateIdentity`.
  - Files/areas likely affected:
    - `apps/engine/src/coach/orchestrator.ts` (new file or extension of `protocol-session.ts`)
    - `apps/engine/src/server/protocol-session.ts` (session event handlers)
  - Implementation intent:
    - Wire three triggers:
      1. `onOwnPickConfirmed(heroId, slotIndex)` → rebuild `CoachObservableState` → `deriveRevealStrategy` → `translateToRecommendationOutputV3` → push to WebSocket.
      2. `onRoundReveal(newEnemyPicks)` → same pipeline.
      3. `onPlayerPositionAssigned(heroId, position)` → same pipeline.
    - Each trigger must produce a new `basedOn.stateIdentity` if the draft state changed (different state → different hash).
    - No calculation lock: no trigger is suppressed while another is being processed (async processing may queue, but never drops).
    - Coach initial recommendation: produced once at `BAN_RESOLUTION_COMPLETE` (start of draft picks phase).
  - Acceptance criteria:
    - After `onOwnPickConfirmed`, WebSocket receives a new recommendation with a different `stateIdentity` than before.
    - After `onRoundReveal`, recommendation incorporates the newly revealed enemy heroes.
    - After `onPlayerPositionAssigned`, recommendation recalculates using the new assignment.
    - No hidden enemy pick influences any recommendation (architecture guard from task 14 still passes).
  - Tests required:
    - Own pick confirmed → `stateIdentity` changes in new recommendation output.
    - Round reveal → `basedOn.evidenceVersion` changes; new enemy hero appears in recommendation evidence context.
    - Player assigns enemy position → `enemyRoleBeliefs` updated; Coach recalculates.
    - Player picks a hero the Coach did not recommend → Coach recalculates without warning or rejection.
  - Dependencies: Tasks 14, 15, 16, 18.
  - STOP / escalation conditions:
    - Trigger implementation requires reading `EnemyBotInternalState` or `DraftProtocolState` directly → STOP.

### Wave 2 — Manual Acceptance Checkpoint

> 1. After selecting the first allied hero, confirm that the recommendation for the second pick visibly changes in the UI.
> 2. Player deliberately ignores the recommendation and selects a different hero — Coach accepts without warning or UI penalty and recalculates.
> 3. Verify at no point does a hidden enemy selection affect the Coach recommendation (check architecture-guard test is still green).

---

## Wave 3 — Personal Position + Hero Pool + Flex

- [ ] 20. PersonalHeroView — independent evaluation pipeline
  - Objective: Implement the "YOUR [POSITION] NOW" panel with its own V6 evaluation scoped to `playerPersonalPosition`, running in parallel with (not filtering) the team-level recommendation.
  - Files/areas likely affected:
    - `apps/engine/src/coach/personal-hero-view.ts` (new file)
    - `apps/engine/src/coach/orchestrator.ts` (trigger parallel evaluation)
    - `apps/web` draft view component (panel display)
  - Implementation intent:
    - Implement `buildPersonalPositionRecommendation(view, playerPersonalPosition, heroPool, patch, computeSuggestions): RecommendationSetV2`.
    - This is a SEPARATE call to `buildRecommendationSetV2` with `targetPosition = playerPersonalPosition` and `heroPool = personalPool` — NOT a filter of the team-level set.
    - Panel shows top-N heroes from `personalRecommendationSet` that are in the hero pool, ordered by V6 score.
    - Panel label: `"TU MID AHORA"` / `"TU CARRY AHORA"` / etc., derived from `playerPersonalPosition`.
    - Panel is absent when `playerPersonalPosition` is not declared or when pool is empty and no heroes score above a minimum threshold (threshold to be calibrated in Wave 5 QA).
    - Recalculate after every draft event (same triggers as task 19).
    - "Best outside your pool" comparison: best personal-position hero INSIDE pool vs. best personal-position hero OUTSIDE pool — within personal position only, NOT global top hero vs. pool.
  - Acceptance criteria:
    - When team recommendation is evaluating Pos5 candidates (support-first prior), `personalHeroView` still shows Mid heroes if `playerPersonalPosition === 2`.
    - `personalHeroView` updates after every pick/reveal event.
    - "Best outside pool" comparison is within `playerPersonalPosition` only.
    - `personalHeroView` absent when `playerPersonalPosition` is null.
  - Tests required:
    - Independent evaluation: team primary action = REVEAL_POSITION(5), `personalHeroView` shows heroes for Pos2 (not filtered by team action).
    - `personalHeroView` updates after round reveal.
    - "Best outside pool" does NOT compare global top hero (any position) against pool.
    - Pool empty → `personalHeroView` absent (or omitted from output).
  - Dependencies: Tasks 18, 19.
  - STOP / escalation conditions: None specific.

- [ ] 21. Hero Pool scoping to personal position
  - Objective: Ensure `hero_pool_fit` signal is `applicable: true` only for the Player's personal slot evaluation, and `applicable: false` for all other 4 own-team slot evaluations.
  - Files/areas likely affected:
    - `apps/engine/src/recommendation/build.ts` (hero_pool_fit signal input construction)
    - `apps/engine/src/signals/hero-pool-fit.ts` (signal implementation — read first)
  - Implementation intent:
    - When calling `buildRecommendationSetV2` for team-level evaluation of a non-personal slot: pass `heroPool = []` (or set `applicable: false` in the signal config) so `hero_pool_fit` abstains from voting.
    - When calling `buildPersonalPositionRecommendation`: pass the full personal hero pool so `hero_pool_fit` participates.
    - Verify the invariant holds across all 5 slot evaluations when `playerPersonalPosition` is declared.
  - Acceptance criteria:
    - Signal breakdown for Pos1 evaluation (when `playerPersonalPosition === 2`) shows `applicable: false` for `hero_pool_fit`.
    - Signal breakdown for personal position evaluation shows `applicable: true` and uses the correct pool.
  - Tests required:
    - Pos1 evaluation with `playerPersonalPosition === 2`: `hero_pool_fit.applicable === false`.
    - Personal position evaluation with configured pool: `hero_pool_fit.applicable === true`.
    - Pool empty: `hero_pool_fit.applicable === false` for ALL slots.
  - Dependencies: Tasks 18, 20.
  - STOP / escalation conditions:
    - `hero_pool_fit` signal does not support an `applicable: false` bypass → STOP; understand the signal contract before modifying the pipeline.

- [ ] 22. Own Team Flex — display and assignment
  - Objective: When an own-team picked hero has a Flex `RoleBelief` (meaningful entropy across 2+ positions), display the slot as FLEX and allow the Player to explicitly assign a position.
  - Files/areas likely affected:
    - `apps/engine/src/draft-protocol/roles/role-belief.ts` (read — understand entropy output)
    - `apps/engine/src/coach/observable-state.ts` (ownRoleBeliefs population)
    - `apps/web` draft view component (FLEX slot display, assignment control)
    - `apps/engine/src/coach/orchestrator.ts` (handle position assignment event)
  - Implementation intent:
    - For each own confirmed pick: call `computeRoleBelief({heroId, heroPositions, occupiedPositions: ownHardConfirmedPositions, confirmedPosition: playerAssignment})`.
    - `ownHardConfirmedPositions`: Set containing ONLY positions with explicit Player assignment (`CONFIRMED` status). LIKELY/UNRESOLVED beliefs do NOT contribute structural constraints to other heroes' belief calculations — no feedback loop.
    - If `RoleBelief.status === "LIKELY"` or `"UNRESOLVED"` and top-2 positions jointly hold significant probability mass (threshold to calibrate in QA): slot is displayed as `FLEX X/Y`.
    - Player can assign position via a lightweight control in the draft state view. Assignment: `playerPositionAssignments.set(heroId, position)` in `CoachObservableState`. Next `computeRoleBelief` call for that hero uses `confirmedPosition = position` → `CONFIRMED`.
    - Coach recalculates after any Player position assignment (trigger `onPlayerPositionAssigned`).
  - Acceptance criteria:
    - Flex hero picked without assignment → slot shows `FLEX X/Y` in draft state display.
    - Player assigns position → slot updates to show single position; Coach recalculates.
    - No LIKELY belief is passed as an `occupiedPositions` hard constraint to any other hero's `computeRoleBelief` call.
  - Tests required:
    - Flex hero with LIKELY status → `CoachObservableState.ownRoleBeliefs` shows LIKELY status with entropy.
    - Player assigns position → belief changes to CONFIRMED; Coach produces new recommendation.
    - LIKELY belief not in `occupiedPositions` for a second hero's belief computation.
  - Dependencies: Tasks 14, 19.
  - STOP / escalation conditions:
    - Any code path passes a LIKELY belief as a hard structural occupied position to another hero's belief computation → STOP (feedback loop; design.md §13, §14 explicitly forbid this).

- [ ] 23. Enemy Flex — inference and display
  - Objective: Connect `computeRoleBelief` to the Coach pipeline for revealed enemy heroes, and display enemy Flex qualitatively without auto-resolving.
  - Files/areas likely affected:
    - `apps/engine/src/coach/observable-state.ts` (`enemyRoleBeliefs` construction)
    - `apps/engine/src/draft-protocol/roles/role-belief.ts` (reuse as-is — read only)
    - `apps/web` draft view component (enemy hero position label display)
  - Implementation intent:
    - For each entry in `view.enemyPicks` with `visibility: "REVEALED"`: call `computeRoleBelief({heroId, heroPositions, occupiedPositions: enemyHardConfirmedPositions, confirmedPosition: playerAssignment?.get(heroId) ?? null})`.
    - `enemyHardConfirmedPositions`: Set of positions where the Player has explicitly assigned a position to an enemy hero (`playerPositionAssignments`, status `CONFIRMED` only). LIKELY beliefs for OTHER enemy heroes do NOT contribute — no feedback loop.
    - Display when `entropy > threshold` (threshold to calibrate in QA): `"Likely Pos3 / Possible Pos2"`. Threshold must NOT be hardcoded as a specific numeric constant — it must be a named configurable parameter.
    - Player can manually assign position to revealed enemy hero → `playerPositionAssignments.set(heroId, position)`. Next belief call uses `confirmedPosition` → CONFIRMED. Player can update or remove assignment.
    - Coach recalculates after any enemy position assignment.
  - Acceptance criteria:
    - Revealed Flex enemy hero shows multiple position labels, not a single auto-assigned one.
    - Player assignment of enemy position → Coach recalculates; belief is CONFIRMED.
    - Player can change or remove enemy assignment.
    - No LIKELY enemy belief is passed as a hard structural constraint to another enemy hero's belief calculation.
  - Tests required:
    - Flex enemy hero (high-entropy belief) → display shows 2 positions; status is LIKELY or UNRESOLVED.
    - Player assigns enemy position → `enemyRoleBeliefs` for that hero → CONFIRMED.
    - Player removes assignment → belief reverts to inferred (LIKELY/UNRESOLVED).
    - `enemyHardConfirmedPositions` contains ONLY positions with explicit CONFIRMED assignment; LIKELY belief does NOT appear in it.
  - Dependencies: Tasks 14, 22.
  - STOP / escalation conditions:
    - Any code path passes a LIKELY enemy belief as an `occupiedPositions` structural constraint to another enemy hero's `computeRoleBelief` call → STOP (feedback loop; design.md §13 explicitly forbids this).

### Wave 3 — Manual Acceptance Checkpoint

> 1. Player declares Pos2 (Mid) as personal position and configures a Mid hero pool. Team primary action says "Open Pos5". Verify that "YOUR MID NOW" panel shows valid Mid heroes from the pool independently of the team action.
> 2. Pick a hero known to be Flex (plays Pos3/Pos4). Verify the slot shows `FLEX 3/4`, not auto-assigned. Assign the position manually. Verify the slot updates and the Coach recommendation changes.
> 3. Enemy team picks a Flex hero. Verify the Coach shows "Likely PosX / Possible PosY" rather than a single position.

---

## Wave 4 — Contextual Intelligence

> **PREREQUISITE: Wave 0 task (task 1) must be COMPLETE and reviewed / approved by the Product Owner before starting any task in Wave 4.**

- [ ] 24. detectSafeCoreWindow()
  - Objective: Implement the contextual Safe Core detector that identifies when a core hero can be revealed early with strategic safety.
  - Files/areas likely affected:
    - `apps/engine/src/coach/safe-core.ts` (new file)
    - `apps/engine/data/hero-counters.json` (read only — hard counter data from Fase 8)
  - Implementation intent:
    - Define:
      ```typescript
      interface SafeCoreSignal { isSafeWindow: boolean; evidence: string; }
      function detectSafeCoreWindow(heroId, view, v6Signals, heroCounters): SafeCoreSignal
      ```
    - Input signals: `counter` signal V6 score, hard counter list from `hero-counters.json`, fraction of hard counters already in `view.bannedHeroes` or `view.ownPicks` (as own-team picks do not counter yourself), `patch_meta` signal V6, `position_fit` signal V6.
    - `isSafeWindow` = holistic assessment of low contextual threat. Do NOT hardcode numeric thresholds (no `"4 of 7"`, no `"> 0.6"`). The threshold MUST be a named, configurable parameter — value to be calibrated in Wave 5 QA.
    - `evidence`: human-readable string derived from actual data (e.g., `"3 of 5 hard counters banned"`).
    - The function is pure — no network, no DB, no side effects.
  - Acceptance criteria:
    - `isSafeWindow === false` when hard counters are available and unbanned and counter signal is unfavourable.
    - `isSafeWindow === true` when most hard counters are banned and counter + meta signals are strong.
    - `evidence` string reflects the actual computed evidence (not a template).
    - Threshold is a named configurable parameter, not a magic number.
  - Tests required:
    - Hard counters all unbanned + poor counter signal → `isSafeWindow === false`.
    - All hard counters banned + strong meta signal → `isSafeWindow === true`.
    - Threshold parameter accepted and changes the boundary.
    - `evidence` string changes based on how many counters are banned.
  - Dependencies: Tasks 18, 19. Wave 0 gate must be approved.
  - STOP / escalation conditions:
    - Dataset used by `hero-counters.json` has a different provenance than recorded in DATA_FRESHNESS_REPORT → STOP (rule from Wave 0 gate).

- [ ] 25. Wire opportunity block into RecommendationOutputV3
  - Objective: Connect `detectSafeCoreWindow` output to the `opportunity` field in `translateToRecommendationOutputV3`.
  - Files/areas likely affected:
    - `apps/engine/src/coach/recommendation-output-v3.ts`
    - `apps/engine/src/coach/safe-core.ts` (from task 24)
  - Implementation intent:
    - In `translateToRecommendationOutputV3`: call `detectSafeCoreWindow` for the top shortlist hero. If `isSafeWindow === true`, populate `opportunity = { label: ..., heroId, evidence }`. If `false`, omit `opportunity` entirely (field must be absent, not `null`).
    - `opportunity` is informational — it does NOT change shortlist ordering or `primaryAction`.
    - `opportunity` label is a human-readable sentence derived from `SafeCoreSignal.evidence`.
  - Acceptance criteria:
    - `opportunity` absent when `isSafeWindow === false`.
    - `opportunity` present with correct evidence when `isSafeWindow === true`.
    - Shortlist ordering unchanged by `opportunity` presence.
    - `primaryAction` unchanged by `opportunity` presence.
  - Tests required:
    - `isSafeWindow === false` → `opportunity` field absent from output.
    - `isSafeWindow === true` → `opportunity.evidence` matches `SafeCoreSignal.evidence`.
    - `opportunity` present does not reorder `shortlist`.
  - Dependencies: Tasks 18, 24.
  - STOP / escalation conditions: None specific.

- [ ] 26. Side context as tiebreaker
  - Objective: Use side context as a tiebreaker in `deriveRevealStrategy` only when statistically reliable evidence exists in `patchStats` for a Radiant/Dire differential. Side must NOT influence scores by default.
  - Files/areas likely affected:
    - `apps/engine/src/coach/reveal-strategy.ts`
    - `apps/engine/src/meta/` (patchStats read — read only)
  - Implementation intent:
    - Define a `hasSideSpecificEvidence(heroId, side, patchStats): boolean` helper — returns true only when the hero's Radiant/Dire win-rate differential in `patchStats` is statistically significant (threshold: configurable, to be calibrated in QA; NOT simply "Radiant WR > Dire WR globally").
    - In `deriveRevealStrategy`: when two candidates are within a very close score range (configurable threshold) AND `hasSideSpecificEvidence` returns true for one of them: use side differential as tiebreaker.
    - Without evidence: candidates rank purely on V6 score regardless of side.
    - Both `side: "radiant"` and `side: "dire"` paths must be covered by tests.
  - Acceptance criteria:
    - Without side-specific evidence: same candidates in same order regardless of side.
    - With sufficient evidence: side-specific candidate is favoured over near-equal non-side candidate.
    - Tests cover both Radiant and Dire perspectives.
  - Tests required:
    - No side evidence → ranking identical for Radiant and Dire sessions.
    - Sufficient side evidence present → favoured candidate advances in tiebreaker.
    - Tiebreaker activates only within the close-score threshold, not for large score gaps.
    - Test from Dire perspective produces correct Dire-side tiebreaker.
  - Dependencies: Tasks 16, 19. Wave 0 gate must be approved (patchStats provenance verified).
  - STOP / escalation conditions:
    - patchStats does not contain Radiant/Dire differential data → side tiebreaker cannot be implemented; STOP and escalate before silently omitting it.

- [ ] 27. One-ply lookahead wiring (conditional on existing implementation)
  - Objective: Wire the existing one-ply lookahead into `RecommendationOutputV3` evidence if and only if it passes its own tests. Do NOT rewrite it.
  - Files/areas likely affected:
    - `apps/engine/src/recommendation/lookahead.ts` (read first — verify existing tests pass)
    - `apps/engine/src/coach/recommendation-output-v3.ts`
  - Implementation intent:
    - Run existing tests for `recommendation/lookahead.ts`. If all pass: wire `opponentResponse` and `steal` fields into `RecommendationOutputV3.shortlist[*].rationale` or `evidence` metadata.
    - If any lookahead test fails or the implementation has known issues: STOP immediately. Document the issue. Do not wire a broken lookahead.
    - Do NOT rewrite, refactor, or fix the lookahead implementation in this task. This is a conditional wiring task only.
  - Acceptance criteria:
    - Lookahead is wired only if its existing tests all pass.
    - No change is made to the lookahead implementation itself.
    - If lookahead is not wired (tests fail): a clear note in this tasks.md entry records the reason and the escalation.
  - Tests required:
    - Existing lookahead tests pass (pre-condition check).
    - If wired: `RecommendationOutputV3` evidence includes lookahead output when available.
  - Dependencies: Tasks 18, 25.
  - STOP / escalation conditions:
    - Lookahead tests fail → STOP. Do NOT wire. Document the failure and escalate.
    - Wiring lookahead requires modifying `lookahead.ts` to fix a bug → STOP; do not fix lookahead in this task.

### Wave 4 — Manual Acceptance Checkpoint

> Scenario A: Draft state where supports are clearly the right pick → verify recommendation correctly favours support reveal (no OPPORTUNITY block).
> Scenario B: A carry's primary hard counters are all banned → verify OPPORTUNITY block `"Ventana Early Carry..."` appears.
> Scenario C: Hard counters are NOT banned → verify OPPORTUNITY block is absent.
> Product Owner reviews and approves all three scenarios.

---

## Wave 5 — Product Certification

- [ ] 28. Playwright E2E — Radiant happy path
  - Objective: End-to-end browser test of a complete draft from Radiant side.
  - Files/areas likely affected:
    - `apps/web/e2e/ap-ranked-roles-radiant.spec.ts` (new file)
  - Implementation intent:
    - Full flow: `PRE_DRAFT` → side select Radiant + position declaration → `BAN_CONFIGURATION` → ban confirmation → `PICK_ROUND_1` → `PICK_ROUND_2` → `PICK_ROUND_3` → `COMPLETE`.
    - Assertions: timer countdown visible during each round; recommendation changes after each pick confirmation; Puck remains available for Own Team while Enemy Bot has it sealed (check DOM availability list during blind round); after round reveal, enemy picks appear in draft state.
    - Carry picked in Round 1 → accepted without warning.
  - Acceptance criteria: Test passes consistently (no flakiness allowed).
  - Tests required: (this task IS the test).
  - Dependencies: All Wave 1–3 tasks must be complete.
  - STOP / escalation conditions:
    - Test is flaky more than once → STOP; diagnose root cause before merging.

- [ ] 29. Playwright E2E — Dire happy path
  - Objective: End-to-end browser test of a complete draft from Dire side.
  - Files/areas likely affected:
    - `apps/web/e2e/ap-ranked-roles-dire.spec.ts` (new file)
  - Implementation intent:
    - Same flow as task 28 but with `side: "dire"`. Enemy Team is Radiant. Assertions: all own-team picks are Dire; recommendation output references Dire context (`basedOn.perspectiveIdentity` includes "dire"); no behavioral asymmetry vs. Radiant run.
  - Acceptance criteria: Test passes. Explicit check that no behavior is exclusive to Radiant.
  - Tests required: (this task IS the test).
  - Dependencies: Task 28.
  - STOP / escalation conditions:
    - Any behavioral asymmetry found between Radiant and Dire tests → STOP; this is a defect (PD-019).

- [ ] 30. Playwright E2E — collision scenarios
  - Objective: Browser-level verification of collision mechanics.
  - Files/areas likely affected:
    - `apps/web/e2e/ap-ranked-roles-collision.spec.ts` (new file)
  - Implementation intent:
    - Scenario 1: engineer a draft state where Player and Enemy Bot select the same hero in the same round. Verify: collision detected after round resolution; hero appears in banned list; both teams must re-select; round does not advance to next until re-selection is complete.
    - Scenario 2: engineer collision event #3 (requires two prior collisions in the same round). Verify: `WAITING_FOR_COLLISION_AUTHORITY` state; first-registered contender retains the hero; other side re-picks.
  - Acceptance criteria: Both collision scenarios complete without error and produce the correct state transitions.
  - Tests required: (this task IS the test).
  - Dependencies: Tasks 11, 28.
  - STOP / escalation conditions:
    - Collision scenario cannot be reliably triggered in an E2E test (timing-dependent) → escalate to design a helper that forces a collision in test setup.

- [ ] 31. Full hidden information test suite
  - Objective: Verify all hidden information barrier test cases from design.md §7 and §15 are present and passing after all Wave changes.
  - Files/areas likely affected:
    - `apps/engine/src/draft-protocol/perspective.test.ts`
    - `apps/engine/src/draft-protocol/architecture-guard.test.ts`
    - `apps/engine/src/draft-protocol/ranked-all-pick.test.ts`
  - Implementation intent:
    - Audit the test files against the mandatory test list in design.md §7 (5 cases) and §15 (5 cases). Add any missing cases.
    - Verify `architecture-guard.test.ts` still passes after all wave changes (it may need updating if new modules were added to the Coach pipeline).
    - All 10 cases must be present and green.
  - Acceptance criteria: All 10 hidden-information test cases from design.md §7 and §15 are present and passing.
  - Tests required: (this task IS the audit and any additions needed to reach full coverage).
  - Dependencies: All previous tasks.
  - STOP / escalation conditions:
    - Any of the 10 mandatory cases fails → STOP; do not proceed to certification until fixed.

- [ ] 32. Personal Hero Pool E2E test
  - Objective: Verify that the Hero Pool and personal hero view work correctly across a full draft.
  - Files/areas likely affected:
    - `apps/web/e2e/ap-ranked-roles-hero-pool.spec.ts` (new file)
  - Implementation intent:
    - Player declares Pos2 (Mid). Configures 3 Mid heroes as pool. Runs a complete draft.
    - Assertions: `YOUR MID NOW` panel appears and shows pool heroes; panel updates after each round reveal; at least one pool hero appears in shortlist; when evaluating Pos1/3/4/5 slots, `hero_pool_fit` signal is `applicable: false` (verify via recommendation metadata if exposed to UI, or via API response).
    - Best outside pool section: configure a pool of heroes that all score poorly for Mid in the current draft state. Verify `outsidePoolRecommendation` appears with a hero outside the pool.
  - Acceptance criteria: All assertions pass.
  - Tests required: (this task IS the test).
  - Dependencies: Tasks 20, 21, 28.
  - STOP / escalation conditions: None specific.

- [ ] 33. Flex E2E test suite
  - Objective: Browser-level verification of Flex display and assignment for own and enemy heroes.
  - Files/areas likely affected:
    - `apps/web/e2e/ap-ranked-roles-flex.spec.ts` (new file)
  - Implementation intent:
    - Own Flex: pick a known Flex hero (verify against `hero-positions.json`). Assert slot displays `FLEX X/Y`. Assign position via UI control. Assert slot updates to single position and Coach recommendation changes.
    - Enemy Flex: Enemy Bot picks a known Flex hero (requires a seeded session). Assert enemy slot shows `Likely PosX / Possible PosY`. Player assigns enemy position. Assert Coach recalculates.
  - Acceptance criteria: Both own and enemy Flex scenarios complete correctly.
  - Tests required: (this task IS the test).
  - Dependencies: Tasks 22, 23, 28.
  - STOP / escalation conditions: None specific.

- [ ] 34. Deterministic seed regression test suite
  - Objective: Verify that identical seeds produce byte-identical ban and Enemy Bot decision results across separate session instantiations.
  - Files/areas likely affected:
    - `apps/engine/src/simulator/ban-resolution.test.ts`
    - `apps/engine/src/simulator/enemy-bot.test.ts`
  - Implementation intent:
    - Run two complete ban resolution sequences with identical `(preferences, seed)`. Assert arrays are deep-equal.
    - Run two complete Enemy Bot decision sequences with identical `(protocolState, seed)`. Assert hero selections are identical for all 5 picks.
    - Run with 3 different seeds. Assert all 3 produce different enemy picks in at least 1 slot.
  - Acceptance criteria: All determinism and variation assertions pass.
  - Tests required: (this task IS the test — extends or consolidates tests already written in tasks 8 and 9).
  - Dependencies: Tasks 8, 9.
  - STOP / escalation conditions:
    - Any run produces different results for the same seed → STOP; non-determinism is a critical defect (Req 6.4, Req 2.2).

- [ ] 35. Manual QA — 5–10 complete drafts with Product Owner
  - Objective: Human validation that the draft experience feels like Ranked Roles All Pick.
  - Files/areas likely affected: None (manual QA activity).
  - Implementation intent:
    - Play 5–10 complete drafts manually, mix of Radiant and Dire.
    - Include at least one draft per scenario: all-support-open, early-carry-safe, collision occurring, Flex pick present, ban preferences all 4 slots filled.
    - Record observations for each draft: mechanical correctness, recommendation quality, panel correctness.
  - Acceptance criteria:
    - Product Owner signs off: *"This feels like Ranked Roles All Pick."*
    - No scenario produces obviously wrong recommendations or mechanical failures.
    - If failures found: create specific bug entries, fix before closing this task.
  - Tests required: N/A (manual activity with documented outcomes).
  - Manual verification: This task IS the manual verification activity.
  - Dependencies: Tasks 28–34.
  - STOP / escalation conditions:
    - Any scenario produces a mechanical failure (collision not detected, hidden pick leaks to Coach, timer does not start) → STOP immediately; task cannot close until the defect is fixed and the scenario is re-run.

- [ ] 36. Dota domain quality review
  - Objective: Validate recommendation quality against Dota 2 domain knowledge.
  - Files/areas likely affected: None (review activity).
  - Implementation intent:
    - Review at least 3 full drafts with Dota domain knowledge (Product Owner or external Dota reviewer).
    - Verify: support-first prior fires correctly and makes strategic sense; Safe Core fires on appropriate heroes in appropriate game states; outside-pool recommendation makes domain sense; `RevealStrategy` labels are human-readable and contextually correct.
    - Document observations.
  - Acceptance criteria: Domain reviewer confirms recommendation quality is sensible across all 3 drafts.
  - Tests required: N/A (review activity).
  - Manual verification: This task IS the review activity.
  - Dependencies: Task 35.
  - STOP / escalation conditions:
    - Reviewer identifies a systematic recommendation quality issue (e.g., Safe Core fires on every hero regardless of state, or support-first prior never fires) → STOP; diagnose root cause in the relevant Wave 2/4 task before closing certification.

- [ ] 37. UX calibration — threshold QA
  - Objective: Calibrate all deferred thresholds from the design that must be determined empirically.
  - Files/areas likely affected:
    - `apps/engine/src/coach/safe-core.ts` (Safe Core threshold parameter)
    - `apps/engine/src/coach/observable-state.ts` (Flex entropy cutoff parameter)
    - `apps/engine/src/coach/recommendation-output-v3.ts` (shortlist size, pool-break threshold)
    - `docs/QA_CALIBRATION.md` (new file documenting calibrated values)
  - Implementation intent:
    - Flex entropy cutoff: test with heroes of well-known single positions (Lone Druid → Pos1 only) and genuinely Flex heroes (e.g., heroes with significant play at 2+ positions). Find the entropy cutoff that correctly classifies both without false positives/negatives.
    - "Best outside your pool" score gap threshold: calibrate with a pool of weaker heroes vs. strong outside-pool hero; find the gap that makes the section appear only when it is genuinely useful.
    - Shortlist size: review visually at 3, 4, and 5 heroes; choose the size that provides real choice without overload.
    - Safe Core threshold: calibrate using the scenarios from task 35/36; find the value that fires in scenario B but not in scenario C (design.md Wave 4 manual checkpoint).
    - Document all calibrated values in `docs/QA_CALIBRATION.md` with rationale.
  - Acceptance criteria:
    - All four thresholds have documented calibrated values in `QA_CALIBRATION.md`.
    - Calibrated values are applied in code (not magic numbers — named configurable constants).
    - Wave 4 manual acceptance scenarios A/B/C hold with calibrated thresholds.
  - Tests required:
    - After calibration: update any tests that used placeholder threshold values to use the calibrated values.
  - Manual verification: Product Owner reviews `QA_CALIBRATION.md` and approves.
  - Dependencies: Tasks 24, 35, 36.
  - STOP / escalation conditions:
    - A threshold cannot be calibrated to a stable value (e.g., Safe Core fires inconsistently regardless of threshold) → STOP; root cause may be in signal quality, not threshold value; escalate.

- [ ] 38. Performance measurement — computedInMs p95
  - Objective: Verify that the recommendation engine meets the performance budget from SPEC.md §4 and invariantes.md.
  - Files/areas likely affected:
    - `apps/engine/src/tools/batch-harness.ts` (read — use for measurement; do NOT run from `apps/engine` at runtime)
    - `apps/engine/src/recommendation/build.ts` (read — no changes unless p95 exceeds budget)
  - Implementation intent:
    - Use `apps/engine/src/tools/batch-harness.ts` to generate N draft states (PRNG deterministic) and call `buildRecommendationSetV2` directly for each. Measure p95 of `computedInMs`.
    - Budget: ≤ 300 ms p95 (source: SPEC.md §4, invariantes.md). Hard cutoff: ≤ 500 ms.
    - Report: p50, p95, p99, and max in a measurement log.
    - If p95 > 300 ms: do NOT silently accept. STOP and escalate for investigation before closing Wave 5.
    - If p95 ≤ 300 ms: record result, close task.
  - Acceptance criteria:
    - p95 ≤ 300 ms on the target hardware.
    - Measurement results documented.
  - Tests required:
    - Batch harness run with ≥ 100 synthetic drafts; p95 ≤ 300 ms.
  - Manual verification: Results reviewed by Product Owner.
  - Dependencies: Tasks 18, 37.
  - STOP / escalation conditions:
    - p95 > 300 ms → STOP; do not close Wave 5 certification. Escalate to performance investigation track before claiming compliance.

---

## Global STOP Conditions

The following conditions require an immediate STOP and escalation from ANY task in ANY wave:

1. A contradiction with `requirements.md` or `product-decisions.md` is discovered.
2. A product decision needs to change (e.g., position determines pick order, or hidden enemy info reaches Coach).
3. A real Dota 2 mechanic needs to be simplified without explicit Product Owner approval (PD-014).
4. Hidden enemy information from any source reaches the Coach recommendation pipeline.
5. V6 scoring engine needs rewriting without empirical evidence from the eval harness.
6. A dependency does not behave as design.md describes (e.g., kernel types are not frozen).
7. A dataset has a different provenance than documented in `DATA_FRESHNESS_REPORT` (Wave 0).
8. The same root cause fails after a fix + reverify cycle — do not patch-loop; escalate.
9. `resolveSimulatorCollisionAuthority` patch produces non-deterministic results.
10. Any feedback loop is detected in role belief inference (LIKELY → occupiedPositions → LIKELY).

---

## Commit Guidelines

- Each task maps to 1–2 commits where possible.
- Commits must be coherent and independently reversible.
- Do NOT bundle all of Wave 1 into a single commit.
- Test changes and implementation changes may share a commit when tightly coupled (TDD pattern).
- `verifiedThroughPatch` update and its dependent test changes **must** be in the same commit.
- `SOLO_MID_SIMULATOR_POLICY` replacement and **all** its call site updates must be in the same commit (no partial state).
