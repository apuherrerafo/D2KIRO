/**
 * Product Semantics Recovery WP4 -- COHERENCE gates over the public V4 CurrentHumanDecision.
 *
 * INDEPENDENCE (guarded by oracle-independence.test.ts): nothing here imports decision logic from
 * `apps/engine/src/coach/**` or `apps/engine/src/recommendation/**`. The oracle drives the REAL store
 * through the REAL routes (qa/scenarios/generate.ts), reads session-layer ownership truth, and judges
 * the serialized JSON. Hero credibility is derived from the fixture's own numbering
 * (`position * 100 + offset`, every fixture hero credible at exactly one position), never from an
 * engine helper.
 *
 * Every invariant runs over EVERY checkpoint of the deterministic matrix (26 control sets x 2 sides x
 * fill-order variants). The UI-only halves of COHERENCE-001/002/005/010/012/013/014 live in apps/web
 * component/hook tests with the same IDs in their titles; `gate completeness` below checks mechanically
 * that every ID 001..014 has at least one test somewhere.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createFixtureRoutes, enumerateScenarios, runScenario, type Checkpoint, type Position, type PublicV4 } from "../scenarios/generate";

// Oracle-side list, written independently of the engine's own constant.
const RANKING_INVALIDATING = new Set(["SNAPSHOT_UNAVAILABLE", "NO_LEGAL_HERO_UNIVERSE", "no_signal_available"]);

interface RunRecord {
  scenarioId: string;
  orderLabel: string;
  controlSetId: string;
  side: string;
  checkpoints: Checkpoint[];
}

async function buildMatrix(): Promise<RunRecord[]> {
  const runs: RunRecord[] = [];
  for (const spec of enumerateScenarios()) {
    const { store, routes } = createFixtureRoutes();
    const result = await runScenario(routes, store, spec);
    runs.push({ scenarioId: spec.id, orderLabel: spec.orderLabel, controlSetId: spec.controlSet.id, side: spec.side, checkpoints: result.checkpoints });
  }
  return runs;
}

const MATRIX = await buildMatrix();
const CHECKPOINTS = MATRIX.flatMap((run) => run.checkpoints.map((checkpoint, index) => ({ run, checkpoint, index })));

function label(checkpoint: Checkpoint, index: number): string {
  return `${checkpoint.scenarioId} @ ${checkpoint.step}${checkpoint.round !== null ? ` r${checkpoint.round}` : ""} #${index}`;
}

function fixturePosition(heroId: number): Position {
  return Math.floor(heroId / 100) as Position;
}

function ownRoundSlots(checkpoint: Checkpoint): number {
  return checkpoint.snapshot.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === checkpoint.side).length;
}

function expectedCapacity(checkpoint: Checkpoint): number {
  if (checkpoint.snapshot.view.status === "COMPLETE" || checkpoint.hasYieldedCurrentRound) return 0;
  return Math.min(ownRoundSlots(checkpoint), checkpoint.humanOpenPositions.length);
}

function visibleHeroes(v4: PublicV4): number[] {
  if (v4.decision.kind !== "ACTIONABLE") return [];
  const { candidates } = v4.decision;
  if (candidates.state === "RANKED") return candidates.cards.map((card) => card.heroId);
  if (candidates.state === "UNRANKED_POSITIONAL") return candidates.alternatives.map((alternative) => Number(alternative.heroId));
  return [];
}

function unavailableHeroes(checkpoint: Checkpoint): Set<number> {
  const view = checkpoint.snapshot.view;
  const gone = new Set<number>(view.bannedHeroes);
  for (const slot of [...view.ownPicks, ...view.enemyPicks]) if (slot.heroId !== undefined) gone.add(slot.heroId);
  return gone;
}

function fail(id: string, checkpoint: Checkpoint, extra: Record<string, unknown>): void {
  console.error(JSON.stringify({ gate: id, scenario: checkpoint.scenarioId, step: checkpoint.step, round: checkpoint.round, humanOpenPositions: checkpoint.humanOpenPositions, decision: checkpoint.v4?.decision, ...extra }, null, 2));
}

test("the V4 surface is present at every checkpoint (no vacuous pass)", () => {
  expect(CHECKPOINTS.length).toBeGreaterThan(500);
  const missing = CHECKPOINTS.filter(({ checkpoint }) => checkpoint.v4 === null);
  expect(missing.map(({ checkpoint, index }) => label(checkpoint, index))).toEqual([]);
  expect(CHECKPOINTS.some(({ checkpoint }) => checkpoint.v4?.decision.kind === "ACTIONABLE")).toBe(true);
  expect(CHECKPOINTS.some(({ checkpoint }) => checkpoint.v4?.decision.kind === "NO_HUMAN_ACTION")).toBe(true);
});

describe("COHERENCE-001 -- one current decision, one target, every candidate belongs to it", () => {
  for (const { checkpoint, index } of CHECKPOINTS) {
    if (checkpoint.v4?.decision.kind !== "ACTIONABLE") continue;
    test(`COHERENCE-001 ${label(checkpoint, index)}`, () => {
      const decision = checkpoint.v4!.decision as Extract<PublicV4["decision"], { kind: "ACTIONABLE" }>;
      const positions = decision.candidates.state === "RANKED"
        ? decision.candidates.cards.map((card) => card.position)
        : decision.candidates.state === "UNRANKED_POSITIONAL" ? decision.candidates.alternatives.map((alternative) => alternative.position as Position) : [];
      const ok = decision.candidates.targetPosition === decision.viewedPosition && positions.every((position) => position === decision.viewedPosition)
        && decision.actionablePositions.includes(decision.viewedPosition) && decision.actionablePositions.includes(decision.targetPosition);
      if (!ok) fail("COHERENCE-001", checkpoint, { positions });
      expect(ok).toBe(true);
    });
  }
});

describe("COHERENCE-002 -- no independent singular-seat panel exists in the V4 decision", () => {
  for (const { checkpoint, index } of CHECKPOINTS) {
    if (!checkpoint.v4) continue;
    test(`COHERENCE-002 ${label(checkpoint, index)}`, () => {
      const ok = !checkpoint.v4RawText.includes("personalHeroView") && !checkpoint.v4RawText.includes("AHORA") && !checkpoint.v4RawText.includes("solo tu asiento");
      if (!ok) fail("COHERENCE-002", checkpoint, {});
      expect(ok).toBe(true);
    });
  }
});

describe("COHERENCE-003 / COHERENCE-004 -- an unranked result never carries ranked presentation, and says it is unranked", () => {
  for (const { checkpoint, index } of CHECKPOINTS) {
    if (checkpoint.v4?.decision.kind !== "ACTIONABLE") continue;
    test(`COHERENCE-003/004 ${label(checkpoint, index)}`, () => {
      const { candidates } = checkpoint.v4!.decision as Extract<PublicV4["decision"], { kind: "ACTIONABLE" }>;
      const invalidating = candidates.degradations.some((degradation) => RANKING_INVALIDATING.has(degradation.reason));
      let ok = true;
      if (candidates.state === "RANKED") {
        ok = !invalidating && candidates.cards.length > 0 && candidates.cards.every((card, cardIndex) => card.rank === cardIndex + 1 && typeof card.score === "number" && typeof card.confidence === "string");
      } else if (candidates.state === "UNRANKED_POSITIONAL") {
        ok = candidates.reason.length > 0 && candidates.alternatives.every((alternative) => Object.keys(alternative).sort().join(",") === "heroId,position");
      } else {
        ok = candidates.reason.length > 0;
      }
      if (!ok) fail("COHERENCE-003", checkpoint, { invalidating });
      expect(ok).toBe(true);
    });
  }
});

describe("COHERENCE-005 -- PSR-001: the engine never claims STRATEGIC (no cross-position priority signal exists); the basis is honest", () => {
  for (const { checkpoint, index } of CHECKPOINTS) {
    if (checkpoint.v4?.decision.kind !== "ACTIONABLE") continue;
    test(`COHERENCE-005 ${label(checkpoint, index)}`, () => {
      const decision = checkpoint.v4!.decision as Extract<PublicV4["decision"], { kind: "ACTIONABLE" }>;
      const ok = decision.targetBasis === "DETERMINISTIC_DEFAULT" && decision.targetRationale.length > 0;
      if (!ok) fail("COHERENCE-005", checkpoint, {});
      expect(ok).toBe(true);
    });
  }
});

describe("COHERENCE-006 -- every visible card is legal and credible for the active target", () => {
  for (const { checkpoint, index } of CHECKPOINTS) {
    if (checkpoint.v4?.decision.kind !== "ACTIONABLE") continue;
    test(`COHERENCE-006 ${label(checkpoint, index)}`, () => {
      const decision = checkpoint.v4!.decision as Extract<PublicV4["decision"], { kind: "ACTIONABLE" }>;
      const gone = unavailableHeroes(checkpoint);
      const offending = visibleHeroes(checkpoint.v4!).filter((hero) => gone.has(hero) || fixturePosition(hero) !== decision.viewedPosition);
      if (offending.length > 0) fail("COHERENCE-006", checkpoint, { offending });
      expect(offending).toEqual([]);
    });
  }
});

describe("COHERENCE-007 -- the personal pool applies only when the target is the personal position", () => {
  for (const { checkpoint, index } of CHECKPOINTS) {
    if (checkpoint.v4?.decision.kind !== "ACTIONABLE") continue;
    test(`COHERENCE-007 ${label(checkpoint, index)}`, () => {
      const decision = checkpoint.v4!.decision as Extract<PublicV4["decision"], { kind: "ACTIONABLE" }>;
      const poolCards = decision.candidates.state === "RANKED" ? decision.candidates.cards.filter((card) => card.isFromPool) : [];
      const ok = (!decision.personalPoolApplied || decision.viewedPosition === checkpoint.humanPosition) && (decision.personalPoolApplied || poolCards.length === 0);
      if (!ok) fail("COHERENCE-007", checkpoint, { humanPosition: checkpoint.humanPosition });
      expect(ok).toBe(true);
    });
  }
});

// Greptile PR #9 (P2) -- the matrix above is anonymous, so personalPoolApplied is always false there and
// a pool leak into another position would leave it green. This focused scenario sends a REAL account
// through the route, with a configured pool holding one hero of each human position.
describe("COHERENCE-007 (account-backed) -- a configured pool shapes the personal position and never another", () => {
  const ACCOUNT = 4242;
  // Offset 19: never inside the fixture's natural top-6 for its position, so it only shows up if the pool put it there.
  const POOL_POS2 = 219;
  const POOL_POS3 = 319;
  const PERSONAL: Position = 2;
  const OTHER: Position = 3;

  async function v4At(routes: ReturnType<typeof createFixtureRoutes>["routes"], sessionId: string, accountId: number | null, target: Position | null) {
    const query = target === null ? "format=v4" : `format=v4&target=${target}`;
    const response = await routes.getRecommendations(sessionId, new URL(`http://qa.local/${sessionId}/recommendations?${query}`), accountId);
    expect(response.status).toBe(200);
    const { output } = (await response.json()) as { output: PublicV4 };
    expect(output.decision.kind).toBe("ACTIONABLE");
    return output.decision as Extract<PublicV4["decision"], { kind: "ACTIONABLE" }>;
  }
  const rankedHeroes = (decision: Extract<PublicV4["decision"], { kind: "ACTIONABLE" }>) => (decision.candidates.state === "RANKED" ? decision.candidates.cards.map((card) => card.heroId) : []);
  const poolCards = (decision: Extract<PublicV4["decision"], { kind: "ACTIONABLE" }>) => (decision.candidates.state === "RANKED" ? decision.candidates.cards.filter((card) => card.isFromPool).map((card) => card.heroId) : []);

  test("viewing P (personal) the pool applies; navigating to Q it does not, and Q's ranking carries no pool overlay", async () => {
    const { routes } = createFixtureRoutes(undefined, new Map([[ACCOUNT, [POOL_POS2, POOL_POS3]]]));
    const postJson = (body: unknown) => new Request("http://qa.local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const created = await routes.post(postJson({
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41f",
      localSide: "radiant",
      adapterKind: "simulator",
      partyContext: { partySize: 2, side: "radiant", controlledSlots: [] },
      controlledPositions: [PERSONAL, OTHER],
      humanPosition: PERSONAL,
      simulatorSeed: "COH007-ACCOUNT",
    }));
    expect(created.status).toBe(201);
    const { sessionId } = (await created.json()) as { sessionId: string };
    expect((await routes.postResolveBans(postJson({ playerBanPreferences: [] }), sessionId)).status).toBe(200);
    expect(((await (await routes.postAutoDrive(sessionId)).json()) as { stopReason?: string }).stopReason).toBe("human_input");

    const personal = await v4At(routes, sessionId, ACCOUNT, null);
    expect(personal.actionablePositions).toEqual([PERSONAL, OTHER]);
    expect(personal.viewedPosition).toBe(PERSONAL);
    expect(personal.personalPoolApplied).toBe(true);
    expect(poolCards(personal)).toEqual([POOL_POS2]);
    expect(rankedHeroes(personal)[0]).toBe(POOL_POS2);

    const other = await v4At(routes, sessionId, ACCOUNT, OTHER);
    const otherAnonymous = await v4At(routes, sessionId, null, OTHER);
    expect(other.viewedPosition).toBe(OTHER);
    expect(other.targetPosition).toBe(PERSONAL);
    expect(other.personalPoolApplied).toBe(false);
    expect(poolCards(other)).toEqual([]);
    expect(rankedHeroes(other)).not.toContain(POOL_POS3);
    expect(rankedHeroes(other).length).toBeGreaterThan(0);
    expect(rankedHeroes(other)).toEqual(rankedHeroes(otherAnonymous));
  });
});

describe("COHERENCE-008 -- actionable positions are the whole eligible set, never truncated by round capacity", () => {
  for (const { checkpoint, index } of CHECKPOINTS) {
    if (!checkpoint.v4) continue;
    test(`COHERENCE-008 ${label(checkpoint, index)}`, () => {
      const capacity = expectedCapacity(checkpoint);
      const decision = checkpoint.v4!.decision;
      const expectedPositions = capacity > 0 ? [...checkpoint.humanOpenPositions].sort((a, b) => a - b) : [];
      const ok = decision.roundCapacity === capacity && JSON.stringify(decision.actionablePositions) === JSON.stringify(expectedPositions)
        && (decision.kind === "ACTIONABLE") === capacity > 0;
      if (!ok) fail("COHERENCE-008", checkpoint, { expectedCapacity: capacity, expectedPositions });
      expect(ok).toBe(true);
    });
  }
});

describe("COHERENCE-009 -- after a yield no human action is exposed", () => {
  const yielded = CHECKPOINTS.filter(({ checkpoint }) => checkpoint.hasYieldedCurrentRound && checkpoint.snapshot.view.status !== "COMPLETE");
  test("the matrix really contains yielded checkpoints", () => expect(yielded.length).toBeGreaterThan(0));
  for (const { checkpoint, index } of yielded) {
    test(`COHERENCE-009 ${label(checkpoint, index)}`, () => {
      const decision = checkpoint.v4!.decision;
      const ok = decision.kind === "NO_HUMAN_ACTION" && decision.reason === "YIELDED" && (checkpoint.v2?.decision.controlledSlots.length ?? 0) === 0;
      if (!ok) fail("COHERENCE-009", checkpoint, {});
      expect(ok).toBe(true);
    });
  }
});

test("COHERENCE-009 -- a human submission after a yield is refused and never reaches the kernel", async () => {
  const spec = enumerateScenarios().find((candidate) => candidate.deferRound1 && candidate.controlSet.id === "party2-2-5");
  if (!spec) throw new Error("fixture: party2-2-5 deferred scenario missing");
  const { store, routes } = createFixtureRoutes();
  const post = (body: unknown) => new Request("http://qa.local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const created = await routes.post(post({ rulesetId: "dota2/ranked-all-pick", patch: "7.41f", localSide: spec.side, adapterKind: "simulator", partyContext: { partySize: 2, side: spec.side, controlledSlots: [] }, controlledPositions: [2, 5], humanPosition: 2, simulatorSeed: spec.seed }));
  const { sessionId } = (await created.json()) as { sessionId: string };
  await routes.postResolveBans(post({ playerBanPreferences: [] }), sessionId);
  expect((await routes.postYield(sessionId)).status).toBe(200);
  const before = store.get(sessionId);
  const slot = store.authorizedLegalActions(sessionId)!.find((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === spec.side) as { slotIndex: number };
  const response = await routes.postCommand(post({ command: { type: "SUBMIT_SEALED_SELECTION", side: spec.side, slotIndex: slot.slotIndex, heroId: 220 }, assignedPosition: 2 }), sessionId);
  expect(response.status).toBe(409);
  expect(store.get(sessionId)).toBe(before);
});

describe("COHERENCE-010 -- the V4 response carries no legacy recommendation set next to the decision", () => {
  for (const { checkpoint, index } of CHECKPOINTS) {
    if (!checkpoint.v4) continue;
    test(`COHERENCE-010 ${label(checkpoint, index)}`, () => {
      const body = JSON.parse(checkpoint.v4RawText) as Record<string, unknown>;
      const ok = Object.keys(body).join(",") === "output" && !checkpoint.v4RawText.includes("recommendation-set/v2") && !checkpoint.v4RawText.includes("recommendation-output/v3");
      if (!ok) fail("COHERENCE-010", checkpoint, { keys: Object.keys(body) });
      expect(ok).toBe(true);
    });
  }
});

// COHERENCE-011 -- position is never inferred from pick chronology (metamorphic): two fill orders of the
// SAME control set that reach the same ownership state (same unbound positions, same round, same open
// own slots, same yield state) expose the same actionable positions and the same round capacity.
function chronologyViolations(): { a: string; b: string; key: string }[] {
  const violations: { a: string; b: string; key: string }[] = [];
  const byKey = new Map<string, { scenarioId: string; value: string }[]>();
  for (const { run, checkpoint } of CHECKPOINTS) {
    if (!checkpoint.v4) continue;
    const key = [run.controlSetId, run.side, [...checkpoint.humanOpenPositions].sort().join(""), checkpoint.round, ownRoundSlots(checkpoint), checkpoint.hasYieldedCurrentRound, checkpoint.snapshot.view.status].join("|");
    const value = JSON.stringify([checkpoint.v4.decision.kind, checkpoint.v4.decision.actionablePositions, checkpoint.v4.decision.roundCapacity]);
    const seen = byKey.get(key) ?? [];
    for (const other of seen) if (other.scenarioId !== run.scenarioId && other.value !== value) violations.push({ a: other.scenarioId, b: run.scenarioId, key });
    byKey.set(key, [...seen, { scenarioId: run.scenarioId, value }]);
  }
  return violations;
}

test("COHERENCE-011 -- same ownership state reached by different pick orders => same actionability", () => {
  const pairsCompared = (() => {
    const counts = new Map<string, Set<string>>();
    for (const { run, checkpoint } of CHECKPOINTS) {
      const key = [run.controlSetId, run.side, [...checkpoint.humanOpenPositions].sort().join(""), checkpoint.round, ownRoundSlots(checkpoint), checkpoint.hasYieldedCurrentRound].join("|");
      counts.set(key, new Set([...(counts.get(key) ?? []), run.scenarioId]));
    }
    return [...counts.values()].filter((scenarios) => scenarios.size >= 2).length;
  })();
  expect(pairsCompared).toBeGreaterThan(0); // not vacuous: different orders really meet in the same state
  const violations = chronologyViolations();
  if (violations.length > 0) console.error(JSON.stringify({ gate: "COHERENCE-011", first: violations[0], total: violations.length }, null, 2));
  expect(violations).toEqual([]);
});

describe("COHERENCE-012 -- degradations are carried only by the candidate result they belong to", () => {
  for (const { checkpoint, index } of CHECKPOINTS) {
    if (!checkpoint.v4) continue;
    test(`COHERENCE-012 ${label(checkpoint, index)}`, () => {
      const output = JSON.parse(checkpoint.v4RawText).output as Record<string, unknown>;
      const meta = output.meta as Record<string, unknown>;
      const decision = output.decision as Record<string, unknown>;
      const ok = !("degradations" in output) && !("degradations" in meta) && !("degradations" in decision);
      if (!ok) fail("COHERENCE-012", checkpoint, {});
      expect(ok).toBe(true);
    });
  }
});

test("COHERENCE-013 -- a requested view moves ONLY viewedPosition (candidates); the Coach recommendation never moves; an ineligible view never applies", async () => {
  const spec = enumerateScenarios().find((candidate) => candidate.controlSet.id === "party5" && candidate.side === "radiant")!;
  const { store, routes } = createFixtureRoutes();
  const post = (body: unknown) => new Request("http://qa.local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const created = await routes.post(post({ rulesetId: "dota2/ranked-all-pick", patch: "7.41f", localSide: "radiant", adapterKind: "simulator", partyContext: { partySize: 5, side: "radiant", controlledSlots: [] }, controlledPositions: [1, 2, 3, 4, 5], humanPosition: 2, simulatorSeed: spec.seed }));
  const { sessionId } = (await created.json()) as { sessionId: string };
  await routes.postResolveBans(post({ playerBanPreferences: [] }), sessionId);
  const baseline = (await (await routes.getRecommendations(sessionId, new URL("http://qa.local/x?format=v4"))).json()) as { output: PublicV4 };
  const baselineDecision = baseline.output.decision;
  if (baselineDecision.kind !== "ACTIONABLE") throw new Error("expected ACTIONABLE");
  for (const position of [1, 2, 3, 4, 5] as Position[]) {
    const response = await routes.getRecommendations(sessionId, new URL(`http://qa.local/x?format=v4&target=${position}`));
    const { output } = (await response.json()) as { output: PublicV4 };
    if (output.decision.kind !== "ACTIONABLE") throw new Error("expected ACTIONABLE");
    expect(output.decision.viewedPosition).toBe(position);
    expect(output.decision.targetPosition).toBe(baselineDecision.targetPosition); // PSR-002: recommendation untouched
    expect(output.decision.targetBasis).toBe(baselineDecision.targetBasis);
    expect(output.decision.actionablePositions).toEqual(baselineDecision.actionablePositions);
    expect(visibleHeroes(output).every((hero) => fixturePosition(hero) === position)).toBe(true);
  }
  const slot = store.authorizedLegalActions(sessionId)!.find((action) => action.type === "SUBMIT_SEALED_SELECTION") as { slotIndex: number };
  await routes.postCommand(post({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: slot.slotIndex, heroId: 420 }, assignedPosition: 4 }), sessionId);
  const { output } = (await (await routes.getRecommendations(sessionId, new URL("http://qa.local/x?format=v4&target=4"))).json()) as { output: PublicV4 };
  // Position 4 is now sealed: an ineligible view is ignored and falls back to the (recomputed) recommendation.
  expect(output.decision.kind === "ACTIONABLE" && output.decision.viewedPosition).not.toBe(4);
  expect(output.decision.kind === "ACTIONABLE" && output.decision.targetPosition).not.toBe(4);
});

describe("COHERENCE-014 -- after an own pick the decision is recomputed: no bound position, no picked hero survives", () => {
  for (const { checkpoint, index } of CHECKPOINTS) {
    if (checkpoint.step !== "after_own_pick" || checkpoint.filledPosition === null || !checkpoint.v4) continue;
    test(`COHERENCE-014 ${label(checkpoint, index)}`, () => {
      const decision = checkpoint.v4!.decision;
      const gone = unavailableHeroes(checkpoint);
      const staleTarget = decision.kind === "ACTIONABLE" && (!checkpoint.humanOpenPositions.includes(decision.targetPosition) || !checkpoint.humanOpenPositions.includes(decision.viewedPosition));
      const ok = !decision.actionablePositions.includes(checkpoint.filledPosition!) && !staleTarget && visibleHeroes(checkpoint.v4!).every((hero) => !gone.has(hero));
      if (!ok) fail("COHERENCE-014", checkpoint, { filledPosition: checkpoint.filledPosition });
      expect(ok).toBe(true);
    });
  }
});

describe("Party5 visual acceptance contract (engine half)", () => {
  const party5Round1 = CHECKPOINTS.filter(({ run, checkpoint }) => run.controlSetId === "party5" && checkpoint.step === "before_human_turn" && checkpoint.round === 1);
  test("Party5 Round 1 checkpoints exist", () => expect(party5Round1.length).toBeGreaterThan(0));
  for (const { checkpoint, index } of party5Round1) {
    test(`PARTY5-R1 ${label(checkpoint, index)}: 5 actionable, capacity 2, one target, ally bots none`, () => {
      const decision = checkpoint.v4!.decision;
      expect(decision.kind).toBe("ACTIONABLE");
      expect(decision.actionablePositions).toEqual([1, 2, 3, 4, 5]);
      expect(decision.roundCapacity).toBe(2);
      expect(checkpoint.controlledPositions).toEqual([1, 2, 3, 4, 5]);
    });
  }
});

// Gate completeness: every COHERENCE id 001..014 is asserted by at least one test title somewhere in the
// repo's QA or web test trees. A gate that silently lost its test would fail HERE.
test("gate completeness -- COHERENCE-001..COHERENCE-014 each have at least one test", () => {
  const root = resolve(import.meta.dir, "..", "..");
  const trees = [resolve(root, "qa", "invariants"), resolve(root, "apps", "web", "features", "random-draft-simulator")];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(entry)) files.push(full);
    }
  };
  trees.forEach(walk);
  const text = files.map((file) => readFileSync(file, "utf8")).join("\n");
  const missing: string[] = [];
  for (let id = 1; id <= 14; id += 1) {
    const code = `COHERENCE-${String(id).padStart(3, "0")}`;
    const titled = new RegExp(`(test|describe)\\(\\s*[\`"'][^\`"']*${code}`).test(text) || new RegExp(`${code}[^\\n]*\\/`).test(text.split("\n").filter((line) => /(test|describe)\(/.test(line)).join("\n"));
    if (!titled) missing.push(code);
  }
  expect(missing).toEqual([]);
});
