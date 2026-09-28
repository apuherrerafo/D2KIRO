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
import { enumerateScenarios, createFixtureRoutes, runScenario, type Checkpoint, type Position } from "../scenarios/generate";
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
// INV-OWN-003 -- after a human pick binds position P, P must never again be offered.
// UNLISTED: any violation is a real, visible red test.
// ---------------------------------------------------------------------------------------------
describe("INV-OWN-003 -- a bound position is never offered again", () => {
  for (const run of MATRIX) {
    const boundSoFar = new Set<Position>();
    for (const checkpoint of run.checkpoints) {
      if (checkpoint.step === "after_own_pick" && checkpoint.filledPosition !== null) boundSoFar.add(checkpoint.filledPosition);
      if (boundSoFar.size === 0) continue;
      test(`INV-OWN-003 ${checkpoint.scenarioId} @ ${checkpoint.step}${checkpoint.round !== null ? ` round ${checkpoint.round}` : ""} (checkpoint #${run.checkpoints.indexOf(checkpoint)})`, () => {
        const reoffered = [...boundSoFar].filter((position) => checkpoint.humanOpenPositions.includes(position));
        const ok = reoffered.length === 0;
        if (!ok) {
          console.error(minimalCounterexample("INV-OWN-003", checkpoint, { boundPositions: [...boundSoFar], reofferedPositions: reoffered }));
        }
        expect(ok).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------
// INV-OWN-004 -- when humans have zero own-team action capacity right now, no human PICK action
// is presented (the public `legalActions` surface must not advertise a SUBMIT_SEALED_SELECTION for
// the human's own side once every human-controlled position is already bound).
// UNLISTED: any violation is a real, visible red test.
// ---------------------------------------------------------------------------------------------
describe("INV-OWN-004 -- zero human capacity means no human pick action is presented", () => {
  for (const run of MATRIX) {
    for (const checkpoint of run.checkpoints) {
      if (checkpoint.humanOpenPositions.length !== 0) continue; // capacity remains -- not this invariant's concern
      test(`INV-OWN-004 ${checkpoint.scenarioId} @ ${checkpoint.step}${checkpoint.round !== null ? ` round ${checkpoint.round}` : ""} (checkpoint #${run.checkpoints.indexOf(checkpoint)})`, () => {
        const offeredOwnActions = checkpoint.snapshot.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === checkpoint.side);
        const ok = offeredOwnActions.length === 0;
        if (!ok) {
          console.error(minimalCounterexample("INV-OWN-004", checkpoint, { offeredOwnActions }));
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
// INV-LEAK-001 -- Enemy Bot PRIVATE assignment/seed must never leak into any observable response.
// UNLISTED: any violation is a real, visible red test.
// ---------------------------------------------------------------------------------------------
describe("INV-LEAK-001 -- Enemy Bot private truth never leaks into an observable response", () => {
  for (const run of MATRIX) {
    for (const checkpoint of run.checkpoints) {
      test(`INV-LEAK-001 ${checkpoint.scenarioId} @ ${checkpoint.step}${checkpoint.round !== null ? ` round ${checkpoint.round}` : ""} (checkpoint #${run.checkpoints.indexOf(checkpoint)})`, () => {
        const leaksPrivateAssignment = checkpoint.rawResponseText.includes("internalPositionAssignments");
        const leaksSeed = checkpoint.rawResponseText.includes(checkpoint.seed);
        const hiddenEnemyWithHero = checkpoint.snapshot.view.enemyPicks.some((slot) => slot.visibility !== "REVEALED" && slot.heroId !== undefined);
        const ok = !leaksPrivateAssignment && !leaksSeed && !hiddenEnemyWithHero;
        if (!ok) {
          console.error(minimalCounterexample("INV-LEAK-001", checkpoint, { leaksPrivateAssignment, leaksSeed, hiddenEnemyWithHero }));
        }
        expect(ok).toBe(true);
      });
    }
  }
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
