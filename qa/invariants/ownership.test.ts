/**
 * D2KIRO Phase 1 -- Ownership Invariant Gate (independent executable ownership oracle).
 *
 * INDEPENDENCE (guarded mechanically by oracle-independence.test.ts): this file, and everything it
 * imports transitively within `qa/**`, never imports decision logic from `apps/engine/src/coach/**`
 * or `apps/engine/src/recommendation/**`. It only:
 *   - drives the real ProtocolSessionStore through the real public routes (the system under test);
 *   - reads session-layer OWNERSHIP TRUTH the task explicitly allows (`controlledPositions`,
 *     `humanOpenPositions`, round human capacity -- all computed by `ProtocolSessionStore`, never by
 *     the Coach/recommendation layer);
 *   - judges the serialized public JSON the routes return.
 * It never calls `deriveRevealStrategy`, `buildRecommendationSetV2`, or any other production
 * recommendation function directly -- those are the functions this gate exists to catch, not tools it
 * may borrow.
 *
 * Every invariant here is checked against EVERY checkpoint of EVERY scenario in the deterministic
 * matrix built by `qa/scenarios/generate.ts` (26 control sets x 2 sides x fill-order variant).
 */
import { describe, test, expect } from "bun:test";
import { enumerateScenarios, createFixtureRoutes, runScenario, fetchRecommendations, type Checkpoint, type Position } from "../scenarios/generate";
import { primaryActionPositions } from "../mvp/oracles/coach-primary-action-oracle";
import knownFailuresRegistry from "./known-failures.json";

// ---------------------------------------------------------------------------------------------
// Known-failure registry wiring (task section 9). No silent xfail: every checkpoint for an
// UNLISTED invariant is a real `test()` that fails red on a violation. Every LISTED invariant is
// checked in aggregate -- one visible test asserting the registry is still justified (at least one
// real violation exists); if that count ever drops to zero the registry has "shrunk" and this
// aggregate test must fail, per the exact semantics the task specifies.
// ---------------------------------------------------------------------------------------------
const KNOWN_FAILURE_IDS = new Set(knownFailuresRegistry.knownFailures.map((entry) => entry.id));

function isKnown(id: string): boolean {
  return KNOWN_FAILURE_IDS.has(id);
}

// ---------------------------------------------------------------------------------------------
// Deterministic matrix -- built once, reused by every invariant's test loop below. Running the
// real routes multiple times (once per invariant) would multiply an already large matrix for no
// reason; the matrix is pure/deterministic (fixed seeds), so building it once is safe and it is
// never mutated by any invariant check.
// ---------------------------------------------------------------------------------------------
interface RunRecord {
  scenarioId: string;
  checkpoints: Checkpoint[];
}

async function buildMatrix(): Promise<RunRecord[]> {
  const specs = enumerateScenarios();
  const runs: RunRecord[] = [];
  for (const spec of specs) {
    const { store, routes } = createFixtureRoutes();
    const result = await runScenario(routes, store, spec);
    runs.push({ scenarioId: spec.id, checkpoints: result.checkpoints });
  }
  return runs;
}

const MATRIX = await buildMatrix();

function minimalCounterexample(id: string, checkpoint: Checkpoint, extra: Record<string, unknown>): string {
  return JSON.stringify(
    {
      inv: id,
      controlSet: checkpoint.controlSetId,
      side: checkpoint.side,
      seed: checkpoint.seed,
      orderLabel: checkpoint.orderLabel,
      progressionStep: checkpoint.step,
      round: checkpoint.round,
      humanOpenPositions: checkpoint.humanOpenPositions,
      controlledPositions: checkpoint.controlledPositions,
      roundCapacity: checkpoint.snapshot.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === checkpoint.side).length,
      ...extra,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------------------------
// INV-OWN-001 -- human action target must be in humanOpenPositions (=> humanOpenPositions is a
// subset of controlledPositions, checked separately below as a cheap sanity assertion).
// UNLISTED: any violation is a real, visible red test.
// ---------------------------------------------------------------------------------------------
describe("INV-OWN-001 -- human-facing action target must belong to humanOpenPositions", () => {
  for (const run of MATRIX) {
    for (const checkpoint of run.checkpoints) {
      if (!checkpoint.v3 || checkpoint.humanOpenPositions.length === 0) continue; // nothing to claim ownership of, or Coach unavailable this checkpoint
      test(`INV-OWN-001 ${checkpoint.scenarioId} @ ${checkpoint.step}${checkpoint.round !== null ? ` round ${checkpoint.round}` : ""}`, () => {
        const targets = primaryActionPositions(checkpoint.v3!.primaryAction.strategy);
        if (targets === null) return; // strategy kind carries no position claim (e.g. a hero-only OPPORTUNITY) -- nothing to check
        const offending = targets.filter((position) => !checkpoint.humanOpenPositions.includes(position));
        const ok = offending.length === 0;
        if (!ok) {
          console.error(
            minimalCounterexample("INV-OWN-001", checkpoint, {
              primaryActionStrategy: checkpoint.v3!.primaryAction.strategy,
              claimedTargets: targets,
              offendingPositions: offending,
            }),
          );
        }
        expect(ok).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------
// INV-OWN-002 (KNOWN_FAIL) -- reachability: while humans still have own-team action capacity this
// round, every humanOpenPosition must remain offerable (V2 controlledSlots / Coach surface).
// ---------------------------------------------------------------------------------------------
function ownTwoViolations(runs: RunRecord[]): { checkpoint: Checkpoint; unoffered: Position[] }[] {
  const violations: { checkpoint: Checkpoint; unoffered: Position[] }[] = [];
  for (const run of runs) {
    for (const checkpoint of run.checkpoints) {
      const ownCapacityThisRound = checkpoint.snapshot.legalActions.some((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === checkpoint.side);
      if (!ownCapacityThisRound || checkpoint.humanOpenPositions.length === 0) continue;
      const offeredV2 = new Set((checkpoint.v2?.decision.controlledSlots ?? []).map((slot) => slot.position).filter((p): p is Position => p != null));
      const offeredCoach = new Set((checkpoint.v3?.shortlist ?? []).map((card) => card.position).filter((p): p is Position => p != null));
      const unoffered = checkpoint.humanOpenPositions.filter((position) => !offeredV2.has(position) && !offeredCoach.has(position));
      if (unoffered.length > 0) violations.push({ checkpoint, unoffered });
    }
  }
  return violations;
}

test("INV-OWN-002 (known failure registry) -- reachability gap must still be real, or the registry has to shrink", () => {
  const violations = ownTwoViolations(MATRIX);
  if (violations.length > 0) {
    const first = violations[0]!;
    console.error(minimalCounterexample("INV-OWN-002", first.checkpoint, { unofferedPositions: first.unoffered, totalViolations: violations.length }));
  }
  if (isKnown("INV-OWN-002")) {
    // "a listed expected failure that unexpectedly PASSES => fail the suite" -- the registry must shrink deliberately, never silently.
    expect(violations.length, "INV-OWN-002 is listed as a known failure but found ZERO violations across the whole matrix -- shrink known-failures.json deliberately, do not leave it stale").toBeGreaterThan(0);
  } else {
    expect(violations.length).toBe(0);
  }
});

// ---------------------------------------------------------------------------------------------
// INV-OWN-003 -- after a human pick binds position P, P must never again be presented as a
// current human action. UNLISTED: any violation is a real, visible red test.
//
// Corrected twice from the original (D2KIRO Phase 1.5 premise review, ORACLE_OVERREACH):
//   1. Closure bug: `describe()` bodies (this outer loop) run synchronously at registration time,
//      but `test()` bodies run later, after the whole file has finished registering. A `test()`
//      closure that reads the SAME mutable `boundSoFar` Set therefore always saw its FINAL value
//      (every position bound by the end of the run), never the value AT that checkpoint -- so
//      every assertion silently compared "positions bound so far" against itself. Fixed by
//      snapshotting `[...boundSoFar]` into a fresh array literal at registration time, one per
//      checkpoint: each `test()` closure captures its own frozen snapshot, immune to the outer
//      Set's later mutation.
//   2. Category error: checking `checkpoint.humanOpenPositions` (session-layer truth, computed as
//      `controlledPositions` minus bound positions -- see ProtocolSessionStore.humanOpenPositions)
//      can never itself contain a just-bound position, by construction, whether or not the
//      recommendation surface has a bug. That made the invariant vacuously true. Corrected to
//      check the ACTUAL human-facing output -- V2 `controlledSlots` positions, the Coach
//      `primaryAction` target position(s), and the Coach shortlist positions -- the three surfaces
//      INV-OWN-001 already defines as "presented as the human's action" (docs/product/invariants.md).
// ---------------------------------------------------------------------------------------------
function humanFacingOfferedPositions(checkpoint: Checkpoint): ReadonlySet<Position> {
  const offeredV2 = (checkpoint.v2?.decision.controlledSlots ?? []).map((slot) => slot.position).filter((p): p is Position => p != null);
  const primaryTargets = checkpoint.v3 ? (primaryActionPositions(checkpoint.v3.primaryAction.strategy) ?? []) : [];
  const shortlistTargets = (checkpoint.v3?.shortlist ?? []).map((card) => card.position).filter((p): p is Position => p != null);
  return new Set([...offeredV2, ...primaryTargets, ...shortlistTargets]);
}

describe("INV-OWN-003 -- a bound position is never offered again", () => {
  for (const run of MATRIX) {
    const boundSoFar = new Set<Position>();
    for (const checkpoint of run.checkpoints) {
      if (checkpoint.step === "after_own_pick" && checkpoint.filledPosition !== null) boundSoFar.add(checkpoint.filledPosition);
      if (boundSoFar.size === 0) continue;
      const boundAtCheckpoint = [...boundSoFar]; // frozen NOW -- see the closure-bug note above
      test(`INV-OWN-003 ${checkpoint.scenarioId} @ ${checkpoint.step}${checkpoint.round !== null ? ` round ${checkpoint.round}` : ""} (checkpoint #${run.checkpoints.indexOf(checkpoint)})`, () => {
        const offered = humanFacingOfferedPositions(checkpoint);
        const reoffered = boundAtCheckpoint.filter((position) => offered.has(position));
        const ok = reoffered.length === 0;
        if (!ok) {
          console.error(minimalCounterexample("INV-OWN-003", checkpoint, { boundPositions: boundAtCheckpoint, reofferedPositions: reoffered, humanFacingOffered: [...offered] }));
        }
        expect(ok).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------
// INV-OWN-004 -- when humans have zero own-team action capacity right now, no human PICK action is
// presented. UNLISTED: any violation is a real, visible red test.
//
// Corrected (D2KIRO Phase 1.5 premise review, ORACLE_CATEGORY_ERROR): the original test asserted
// zero `SUBMIT_SEALED_SELECTION` in `snapshot.legalActions` (== `ProtocolSessionStore.authorizedLegalActions`)
// for the side. That field is own-SIDE protocol legality, not human capacity -- for a
// controlledPositions session it deliberately advertises EVERY open own-side round slot regardless
// of whether a human or the Ally Bot will fill it next (protocol-session.ts, authorizedLegalActions:
// "every currently open own-side round slot is advertised -- which human-controlled position it
// will bind to is the client's choice at submission time"). So a checkpoint captured the instant the
// LAST human position is bound, with round capacity still open for the Ally Bot to fill later in the
// same round, would false-positive this invariant even though no human action was ever offered.
//
// Corrected to compute humanRoundCapacity directly, the same formula production already uses
// (protocol-session.ts, ensureSimulatorTimer): zero once the human has explicitly yielded the round
// (PD-020's "the human decides WHEN"), else min(open own-side round slots, humanOpenPositions) --
// and to assert against the human-facing recommendation surface (V2 controlledSlots; Coach
// primaryAction position target), never against protocol/side legality itself.
// ---------------------------------------------------------------------------------------------
function ownRoundSlotCount(checkpoint: Checkpoint): number {
  return checkpoint.snapshot.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === checkpoint.side).length;
}

function humanRoundCapacity(checkpoint: Checkpoint): number {
  if (checkpoint.hasYieldedCurrentRound) return 0;
  return Math.min(ownRoundSlotCount(checkpoint), checkpoint.humanOpenPositions.length);
}

describe("INV-OWN-004 -- zero human round capacity means no human pick action is presented", () => {
  for (const run of MATRIX) {
    for (const checkpoint of run.checkpoints) {
      if (humanRoundCapacity(checkpoint) !== 0) continue; // capacity remains -- not this invariant's concern
      test(`INV-OWN-004 ${checkpoint.scenarioId} @ ${checkpoint.step}${checkpoint.round !== null ? ` round ${checkpoint.round}` : ""} (checkpoint #${run.checkpoints.indexOf(checkpoint)})`, () => {
        const offeredV2 = checkpoint.v2?.decision.controlledSlots ?? [];
        const primaryTargets = checkpoint.v3 ? (primaryActionPositions(checkpoint.v3.primaryAction.strategy) ?? []) : [];
        const ok = offeredV2.length === 0 && primaryTargets.length === 0;
        if (!ok) {
          console.error(
            minimalCounterexample("INV-OWN-004", checkpoint, {
              hasYieldedCurrentRound: checkpoint.hasYieldedCurrentRound,
              ownRoundSlotCount: ownRoundSlotCount(checkpoint),
              offeredV2,
              primaryTargets,
            }),
          );
        }
        expect(ok).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------
// INV-CHRONO-001 (KNOWN_FAIL) -- metamorphic: the SET of positions offered must not depend on the
// chronological order in which earlier human positions were filled. Paired by matching
// (controlSetId, side, humanOpenPositions AS A SET) across every order variant of the same control
// set (ascending / descending / deferred -- up to 3 for Party2/Party3, 2 for Party5, 1 for Solo).
// Greedy round-capacity-first filling makes ascending and descending converge onto the SAME
// per-round partition for most control sets (round capacity absorbs everything immediately, so
// there is nothing left to reorder) -- "deferred" (round 1 explicitly yielded, PD-020) is what
// actually forces a genuinely different round-partition of the same positions to compare.
// ---------------------------------------------------------------------------------------------
function chronoViolations(runs: RunRecord[]): { a: Checkpoint; b: Checkpoint; offeredA: Position[]; offeredB: Position[] }[] {
  const byControlSetSide = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const [, controlSetId, side] = /^(.+)-(radiant|dire)-(ascending|descending|deferred)$/.exec(run.scenarioId) ?? [];
    if (!controlSetId || !side) continue;
    const key = `${controlSetId}:${side}`;
    byControlSetSide.set(key, [...(byControlSetSide.get(key) ?? []), run]);
  }
  const violations: { a: Checkpoint; b: Checkpoint; offeredA: Position[]; offeredB: Position[] }[] = [];
  for (const variantRuns of byControlSetSide.values()) {
    if (variantRuns.length < 2) continue; // solo control sets have only one order variant -- nothing to pair
    for (let i = 0; i < variantRuns.length; i += 1) {
      for (let j = i + 1; j < variantRuns.length; j += 1) {
        const runA = variantRuns[i]!;
        const runB = variantRuns[j]!;
        for (const a of runA.checkpoints) {
          const humanOpenSetA = [...a.humanOpenPositions].sort().join(",");
          // Matched by (humanOpenPositions content, round) -- round determines this round's own-side
          // capacity (2/2/1), which is what actually bounds how many positions can be offered; the
          // harness's own bookkeeping `step` label carries no product meaning and would either hide
          // or fabricate matches that don't reflect a real comparable decision state.
          const b = runB.checkpoints.find((candidate) => [...candidate.humanOpenPositions].sort().join(",") === humanOpenSetA && candidate.round === a.round);
          if (!b) continue; // no matching logical point in the other order -- not comparable
          const offeredA = [...new Set((a.v2?.decision.controlledSlots ?? []).map((slot) => slot.position).filter((p): p is Position => p != null))].sort();
          const offeredB = [...new Set((b.v2?.decision.controlledSlots ?? []).map((slot) => slot.position).filter((p): p is Position => p != null))].sort();
          if (offeredA.join(",") !== offeredB.join(",")) violations.push({ a, b, offeredA, offeredB });
        }
      }
    }
  }
  return violations;
}

test("INV-CHRONO-001 (known failure registry) -- order-dependence gap must still be real, or the registry has to shrink", () => {
  const violations = chronoViolations(MATRIX);
  if (violations.length > 0) {
    const first = violations[0]!;
    console.error(
      JSON.stringify(
        { inv: "INV-CHRONO-001", controlSet: first.a.controlSetId, side: first.a.side, ascendingSeed: first.a.seed, descendingSeed: first.b.seed, offeredAscending: first.offeredA, offeredDescending: first.offeredB, totalViolations: violations.length },
        null,
        2,
      ),
    );
  }
  if (isKnown("INV-CHRONO-001")) {
    expect(violations.length, "INV-CHRONO-001 is listed as a known failure but found ZERO violations across the whole matrix -- shrink known-failures.json deliberately, do not leave it stale").toBeGreaterThan(0);
  } else {
    expect(violations.length).toBe(0);
  }
});

// ---------------------------------------------------------------------------------------------
// INV-LEAK-001 -- Enemy Bot PRIVATE assignment must never leak into any observable response.
// UNLISTED: any violation is a real, visible red test.
//
// Corrected (D2KIRO Phase 1.5 premise review, ORACLE_DESIGN_ERROR): the original test asserted the
// response text never contains `checkpoint.seed` -- but `simulatorSeed` is PUBLIC metadata (the
// Player chose it / it identifies the Simulator run), not private Enemy Bot truth. A string-match
// against a session's OWN public seed does not test information leakage at all: it would fail on a
// legitimate feature (echoing the seed back) and would never catch a real leak of what the seed
// actually seeds privately (Enemy Bot internal role assignment / sealed-but-unrevealed hero).
//
// Kept: the two structural, still-valid checks below (no `internalPositionAssignments` text, no
// HIDDEN enemy slot exposing a heroId).
// ---------------------------------------------------------------------------------------------
describe("INV-LEAK-001 -- Enemy Bot private truth never leaks into an observable response", () => {
  for (const run of MATRIX) {
    for (const checkpoint of run.checkpoints) {
      test(`INV-LEAK-001 structural ${checkpoint.scenarioId} @ ${checkpoint.step}${checkpoint.round !== null ? ` round ${checkpoint.round}` : ""} (checkpoint #${run.checkpoints.indexOf(checkpoint)})`, () => {
        const leaksPrivateAssignment = checkpoint.rawResponseText.includes("internalPositionAssignments");
        const hiddenEnemyWithHero = checkpoint.snapshot.view.enemyPicks.some((slot) => slot.visibility !== "REVEALED" && slot.heroId !== undefined);
        const ok = !leaksPrivateAssignment && !hiddenEnemyWithHero;
        if (!ok) {
          console.error(minimalCounterexample("INV-LEAK-001", checkpoint, { leaksPrivateAssignment, hiddenEnemyWithHero }));
        }
        expect(ok).toBe(true);
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Differential non-interference (the actual INV-LEAK-001 test the task premise review asked
  // for): two otherwise-equivalent sessions, SAME public seed/inputs/history, that differ ONLY in
  // the Enemy Bot's sealed-but-unrevealed hero identity for round 1 -- every observable output
  // (aside from the session id itself) must be byte-identical while that hero stays hidden.
  //
  // Production's public route surface derives the Enemy Bot's pick deterministically from the
  // public `simulatorSeed` alone (`createEnemyBotConfig(metadata.simulatorSeed!, oppositeSide(...))`
  // in server/routes/protocol-sessions.ts) -- there is no public input that varies ONLY the enemy's
  // private pick while holding every other public input fixed, so this cannot be built by driving
  // the public routes with two different request bodies. Built instead with `store.apply()`
  // (ProtocolSessionStore, apps/engine/src/server/protocol-session.ts -- outside the forbidden
  // coach/recommendation trees, verified by oracle-independence.test.ts): a bare kernel-command
  // pass-through with no client-authorization gate, the SAME seam `apps/engine/src/coach/session-harness.fixtures.ts`
  // already uses to seal an enemy pick directly for coach/*.test.ts. No apps/** file is modified to
  // build this -- store.apply() already exists and is already used this way elsewhere in the repo.
  // -------------------------------------------------------------------------------------------
  test("INV-LEAK-001 differential: same public seed + inputs, only the Enemy Bot's sealed pick differs -> observable output identical", async () => {
    const createBody = {
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41f",
      localSide: "radiant" as const,
      adapterKind: "simulator" as const,
      partyContext: { partySize: 1 as const, side: "radiant" as const, controlledSlots: [] as const },
      controlledPositions: [2] as const,
      humanPosition: 2 as const,
      simulatorSeed: "OWNGATE-LEAK-TWIN-0001", // identical for both twins: the public input under test
    };

    async function buildTwin(enemyHeroId: number) {
      const { store, routes } = createFixtureRoutes();
      const created = await routes.post(
        new Request("http://qa.local/session/protocol", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(createBody) }),
      );
      if (created.status !== 201) throw new Error(`leak twin: session creation failed with ${created.status}`);
      const { sessionId } = (await created.json()) as { sessionId: string };
      const bansResponse = await routes.postResolveBans(
        new Request("http://qa.local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerBanPreferences: [] }) }),
        sessionId,
      );
      if (bansResponse.status !== 200) throw new Error(`leak twin: ban resolution failed with ${bansResponse.status}`);

      // Seal ONLY the enemy's round-1 slot, with a hero identity that differs between twins. The
      // human's own side is deliberately left untouched -- this isolates the ONE variable this
      // invariant is about (the enemy's private, still-sealed pick), nothing else.
      const stateBeforeSeal = store.get(sessionId);
      const round = stateBeforeSeal?.rankedAp?.round;
      if (!round) throw new Error("leak twin: expected an open round after ban resolution");
      const enemySlot = round.openSlots.find((slot) => slot.side === "dire");
      if (!enemySlot) throw new Error("leak twin: expected an open dire round slot");
      const sealResult = store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: enemySlot.slotIndex, heroId: enemyHeroId });
      if (!sealResult || sealResult.rejected) throw new Error(`leak twin: enemy seal rejected: ${sealResult?.rejected}`);

      const snapshotResponse = routes.get(sessionId, new URL(`http://qa.local/${sessionId}`));
      const snapshotText = await snapshotResponse.text();
      const rec = await fetchRecommendations(routes, sessionId);
      return { sessionId, snapshotText, recText: rec.rawText };
    }

    // Two distinct, arbitrary hero identities for the enemy's hidden pick -- both from the fixture's
    // documented bot-pick offset range (HERO_POSITIONS, offsets 0..19 reserved for ally/enemy bots).
    const twinA = await buildTwin(500);
    const twinB = await buildTwin(501);

    // The session id is the only legitimately-differing, non-semantic identifier in this fixture (no
    // wall-clock timestamps/durations are embedded in these responses) -- stripped before comparing.
    const normalize = (text: string, sessionId: string) => text.split(sessionId).join("<SESSION_ID>");
    expect(normalize(twinA.snapshotText, twinA.sessionId)).toBe(normalize(twinB.snapshotText, twinB.sessionId));
    expect(normalize(twinA.recText, twinA.sessionId)).toBe(normalize(twinB.recText, twinB.sessionId));
  });
});

// ---------------------------------------------------------------------------------------------
// Cheap sanity assertion (not one of the 6 catalogued invariants, but a direct restatement of
// INV-OWN-001's own definition, section 5): humanOpenPositions must always be a subset of
// controlledPositions. If this ever fails the session-layer truth itself is broken, which would
// invalidate every other check above -- so it is asserted once, globally, up front.
// ---------------------------------------------------------------------------------------------
test("sanity: humanOpenPositions is always a subset of controlledPositions", () => {
  for (const run of MATRIX) {
    for (const checkpoint of run.checkpoints) {
      const offending = checkpoint.humanOpenPositions.filter((position) => !checkpoint.controlledPositions.includes(position));
      expect(offending, minimalCounterexample("humanOpenPositions-subset-sanity", checkpoint, { offending })).toEqual([]);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// VACUOUS-PASS PROTECTION (task section 8): whenever a human action is expected, the Coach output
// must be non-empty/actionable, not just structurally present. And no-snapshot degradation must be
// distinguishable from a real result, never silently confused with one.
// ---------------------------------------------------------------------------------------------
test("vacuous-pass guard: whenever humans have open capacity, the Coach shortlist is non-empty", () => {
  for (const run of MATRIX) {
    for (const checkpoint of run.checkpoints) {
      if (checkpoint.humanOpenPositions.length === 0 || !checkpoint.v3) continue;
      expect(checkpoint.v3.shortlist.length, minimalCounterexample("vacuous-pass-guard", checkpoint, {})).toBeGreaterThan(0);
    }
  }
});

test("vacuous-pass guard: a deliberately broken computeSuggestions degrades explicitly, never as a silent empty success", async () => {
  const { ProtocolSessionStore } = await import("../../apps/engine/src/server/protocol-session");
  const { createProtocolSessionRoutes } = await import("../../apps/engine/src/server/routes/protocol-sessions");
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions: async () => {
      throw new Error("QA fixture: deliberately broken computeSuggestions");
    },
  });
  const created = await routes.post(
    new Request("http://qa.local/session/protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rulesetId: "dota2/ranked-all-pick",
        patch: "7.41f",
        localSide: "radiant",
        adapterKind: "simulator",
        partyContext: { partySize: 1, side: "radiant", controlledSlots: [] },
        controlledPositions: [2],
        humanPosition: 2,
        simulatorSeed: "OWNGATE-BROKEN",
      }),
    }),
  );
  expect(created.status).toBe(201);
  const { sessionId } = (await created.json()) as { sessionId: string };
  // Must reach an actual PICK decision (not BAN_RESOLUTION) or build-from-perspective returns
  // "no_action" for an unrelated reason before ever calling computeSuggestions -- that would not
  // exercise the failure path this test targets.
  await routes.postResolveBans(
    new Request("http://qa.local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerBanPreferences: [] }) }),
    sessionId,
  );
  // A crashing computeSuggestions must surface as an EXPLICIT, machine-readable degradation --
  // either a thrown rejection surfacing as a non-200 response, or (the system's actual, intentional
  // design: graceful degradation per .claude/rules/invariantes.md "una señal rota nunca tira el
  // motor completo") a 200 whose body explicitly flags the failure via `degradations` and an empty
  // shortlist -- never a 200 that LOOKS like an ordinary, non-degraded recommendation.
  let status: number | null = null;
  let threw = false;
  let body: { output: { shortlist?: unknown[] } | null; recommendationSet: { degradations: { reason: string }[]; decision: { actionKind: string | null } } } | null = null;
  try {
    const response = await routes.getRecommendations(sessionId, new URL(`http://qa.local/${sessionId}/recommendations?format=v3`));
    status = response.status;
    if (status === 200) body = (await response.json()) as typeof body;
  } catch {
    threw = true;
  }
  if (threw || status !== 200) {
    expect(threw || status !== 200).toBe(true);
    return;
  }
  expect(body).not.toBeNull();
  const flaggedDegraded = (body!.recommendationSet.degradations ?? []).length > 0;
  const looksLikeOrdinarySuccess = (body!.output?.shortlist?.length ?? 0) > 0 && !flaggedDegraded;
  expect(flaggedDegraded, `computeSuggestions threw but the response was a 200 with no degradations flagged: ${JSON.stringify(body)}`).toBe(true);
  expect(looksLikeOrdinarySuccess).toBe(false);
});

// ---------------------------------------------------------------------------------------------
// RANKED_BRANCH_COVERAGE_GUARD (task section 11): the deterministic fixture must exercise BOTH of
// the Coach's two reachable branches, not just the fallback -- a suite that only ever hits
// `deriveRevealStrategy`'s "no ranking of heroes available" path would still pass every invariant
// above while leaving the ranked path completely untested.
//
// The literal rationale text is the exact, precise, PUBLIC-observable marker for that branch
// (reveal-strategy.ts, `positionFallback`'s `!top` case): "No hay ranking de héroes disponible para
// este estado." -- any OTHER primaryAction rationale means V6 DID produce a ranking that informed
// the reveal choice (the ranked branch). Measured directly against the MATRIX this suite already
// built (no separate run): 248 ranked / 404 fallback of 652 v3 checkpoints, both already non-zero
// with the current fixture -- so no fixture change was needed to satisfy this guard, only the guard
// itself, which now fails loudly (not silently) if that measured coverage ever regresses to zero.
// ---------------------------------------------------------------------------------------------
test("RANKED_BRANCH_COVERAGE_GUARD -- both the V6-ranked branch and the no-ranking fallback branch are exercised", () => {
  const NO_RANKING_MARKER = "No hay ranking de héroes disponible";
  let rankedBranchCheckpoints = 0;
  let fallbackBranchCheckpoints = 0;
  for (const run of MATRIX) {
    for (const checkpoint of run.checkpoints) {
      if (!checkpoint.v3) continue;
      if (checkpoint.rawResponseText.includes(NO_RANKING_MARKER)) fallbackBranchCheckpoints += 1;
      else rankedBranchCheckpoints += 1;
    }
  }
  console.log(JSON.stringify({ guard: "RANKED_BRANCH_COVERAGE", COACH_RANKED_BRANCH_CHECKPOINTS: rankedBranchCheckpoints, COACH_FALLBACK_BRANCH_CHECKPOINTS: fallbackBranchCheckpoints }, null, 2));
  expect(rankedBranchCheckpoints, "COACH_RANKED_BRANCH_CHECKPOINTS dropped to zero -- the fixture no longer exercises the V6-ranked path").toBeGreaterThan(0);
  expect(fallbackBranchCheckpoints, "COACH_FALLBACK_BRANCH_CHECKPOINTS dropped to zero -- the fixture no longer exercises the no-ranking fallback path").toBeGreaterThan(0);
});
