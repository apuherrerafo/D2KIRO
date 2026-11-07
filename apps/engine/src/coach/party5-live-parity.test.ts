import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { ProtocolCommand } from "../draft-protocol/types";
import { LiveCaptureRegistry } from "../live/live-capture-registry";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import { ProtocolSessionStore } from "../server/protocol-session";
import type { RecommendationSetV2 } from "../recommendation/types";
import type { RecommendationOutputV3 } from "./recommendation-output-v3";
import type { TeamCoachBoard } from "./team-coach-board";
import { fakeCompute, HERO_POSITIONS, POOL, strongOpenerCounters } from "./session-harness.fixtures";

// Parity harness, deliberately test-only. It drives the two real ingestion paths into the
// same TeamCoachBoard projection. It compares player-visible strategy, not session ids, revision
// counters, or capture-readiness metadata (which are intentionally different sources of truth).

const POSITIONS = [1, 2, 3, 4, 5] as Position[];
// Live validates observations at its capture boundary (1..999); keep the shared fact valid in
// both flows. The fixture-only 9999 case is a capture rejection, not a strategic divergence.
const BANNED = 99;

type ProductDecision = {
  scoreByPosition: Record<number, number | null>;
  composition: { actionable: Position[]; recommended: Position | null };
  chooseNow: { position: Position | null; hero: number | null; basis: string | null };
  warn: unknown[];
  steals: unknown[];
  reasons: string[];
};

function productDecision(board: TeamCoachBoard): ProductDecision {
  return {
    scoreByPosition: Object.fromEntries(board.positions.map((column) => [column.position, column.top[0]?.score ?? null])),
    composition: { actionable: board.currentDecision.actionablePositions, recommended: board.currentDecision.recommendedPosition },
    chooseNow: { position: board.currentDecision.recommendedPosition, hero: board.currentDecision.recommendedHeroId, basis: board.currentDecision.targetBasis },
    warn: board.freeThreats,
    steals: board.positions.flatMap((column) => column.top.flatMap((candidate) => candidate.steals)),
    reasons: board.positions.flatMap((column) => column.top.flatMap((candidate) => candidate.reasons)),
  };
}

function routes(store: ProtocolSessionStore, heroCounters: ReturnType<typeof strongOpenerCounters>, liveGate?: (sessionId: string) => { available: boolean; reason: string | null; completeness: string } | null) {
  return createProtocolSessionRoutes({
    store,
    computeSuggestions: fakeCompute(POOL, HERO_POSITIONS),
    heroPositions: HERO_POSITIONS,
    heroCounters,
    liveRecommendationGate: liveGate,
  });
}

async function boardOf(getBoard: (id: string, url: URL) => Promise<Response>, sessionId: string): Promise<TeamCoachBoard> {
  const response = await getBoard(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
  expect(response.status).toBe(200);
  return response.json() as Promise<TeamCoachBoard>;
}

type V3Response = { output: RecommendationOutputV3; recommendationSet: RecommendationSetV2 };

async function coachOf(getRecommendations: (id: string, url: URL) => Promise<Response>, sessionId: string): Promise<V3Response> {
  const response = await getRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=v3`));
  expect(response.status).toBe(200);
  const body = await response.json() as { output: RecommendationOutputV3 | null; recommendationSet: RecommendationSetV2 };
  expect(body.output).not.toBeNull();
  return { output: body.output!, recommendationSet: body.recommendationSet };
}

function commandRequest(slotIndex: number, heroId: number, assignedPosition: Position): Request {
  return new Request("http://127.0.0.1/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId }, assignedPosition }),
  });
}

function fixtureCounters(bannedHero: number, extra: ReadonlyMap<number, readonly { vs: number; level: "hard"; why: string }[]> = new Map()) {
  return strongOpenerCounters(POOL, bannedHero, extra);
}

type CuratedCounters = ReturnType<typeof strongOpenerCounters>;

function simulatorBoard(bannedHero = BANNED, extraCounters?: ReadonlyMap<number, readonly { vs: number; level: "hard"; why: string }[]>, curatedOverride?: CuratedCounters) {
  const store = new ProtocolSessionStore();
  const created = store.create({
    sessionId: "sim-parity",
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: "radiant",
    adapterKind: "simulator",
    simulatorSeed: "PARITY01",
    partyContext: { partySize: 5, side: "radiant", controlledSlots: [] },
    controlledPositions: POSITIONS,
  });
  if (!created.ok) throw new Error("simulator setup failed");
  const commands: ProtocolCommand[] = [
    { type: "RECORD_RESOLVED_BANS", heroes: [bannedHero] },
    { type: "BAN_RESOLUTION_COMPLETE" },
  ];
  const applied = store.applyAtomically("sim-parity", commands);
  if (!applied?.ok) throw new Error("simulator bans failed");
  return { store, routes: routes(store, curatedOverride ?? fixtureCounters(bannedHero, extraCounters)), sessionId: "sim-parity" };
}

function liveBoard(bannedHero = BANNED, extraCounters?: ReadonlyMap<number, readonly { vs: number; level: "hard"; why: string }[]>) {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => 1_790_000_000_000, heroPositions: HERO_POSITIONS });
  registry.ensureSession("live-parity", 7);
  registry.observe("live-parity", { type: "draft_started", patch: "7.41e" });
  registry.observe("live-parity", { type: "side", side: "radiant" });
  registry.observe("live-parity", { type: "ban", heroId: bannedHero });
  registry.observe("live-parity", { type: "bans_closed" });
  return { store, registry, routes: routes(store, fixtureCounters(bannedHero, extraCounters), (id) => registry.recommendationGate(id)), sessionId: "live-parity" };
}

/** One fully revealed Round 1 through each product's real ingestion path. */
async function resolvedSimulatorRound(enemyHeroes: readonly [number, number] = [9, 8], extraCounters?: ReadonlyMap<number, readonly { vs: number; level: "hard"; why: string }[]>, curatedOverride?: CuratedCounters) {
  const simulator = simulatorBoard(BANNED, extraCounters, curatedOverride);
  expect((await simulator.routes.postCommand(commandRequest(0, 1, 1), simulator.sessionId)).status).toBe(202);
  expect((await simulator.routes.postCommand(commandRequest(1, 2, 5), simulator.sessionId)).status).toBe(202);
  expect(simulator.store.apply(simulator.sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: enemyHeroes[0] })?.rejected).toBeUndefined();
  expect(simulator.store.apply(simulator.sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: enemyHeroes[1] })?.rejected).toBeUndefined();
  return simulator;
}

function resolvedLiveRound(secondOwnPosition: Position | null, enemyHeroes: readonly [number, number] = [9, 8], extraCounters?: ReadonlyMap<number, readonly { vs: number; level: "hard"; why: string }[]>) {
  const live = liveBoard(BANNED, extraCounters);
  const facts = [
    { type: "pick" as const, side: "radiant" as const, heroId: 1, position: 1 as Position },
    { type: "pick" as const, side: "radiant" as const, heroId: 2, position: secondOwnPosition },
    { type: "pick" as const, side: "dire" as const, heroId: enemyHeroes[0], position: null },
    { type: "pick" as const, side: "dire" as const, heroId: enemyHeroes[1], position: null },
  ];
  for (const fact of facts) expect(live.registry.observe(live.sessionId, fact).accepted).toBe(true);
  return live;
}

describe("Party 5 simulator ↔ Live Companion parity", () => {
  test("ingestion baseline: equivalent opening facts produce the same TeamCoachBoard projection", async () => {
    const simulator = simulatorBoard();
    const live = liveBoard();
    const sim = await boardOf(simulator.routes.getTeamRecommendations, simulator.sessionId);
    const observed = await boardOf(live.routes.getTeamRecommendations, live.sessionId);

    expect(productDecision(observed)).toEqual(productDecision(sim));
  });

  test("capture difference: an out-of-range live ban is classified, not forced into strategic parity", async () => {
    const invalidForLive = 1000; // Live's public capture boundary permits 1..999 only.
    const simulator = simulatorBoard(invalidForLive);
    const live = liveBoard(invalidForLive);
    const sim = productDecision(await boardOf(simulator.routes.getTeamRecommendations, simulator.sessionId));
    const observed = productDecision(await boardOf(live.routes.getTeamRecommendations, live.sessionId));

    // V6's raw scores are unchanged; only the Live capture refuses the ban, so it withholds the
    // strong "opened by ban" basis and therefore ELIGE AHORA. This is a data-validity divergence,
    // not a candidate-scoring or Dota-strategy regression.
    expect(observed.scoreByPosition).toEqual(sim.scoreByPosition);
    expect(observed.chooseNow).not.toEqual(sim.chooseNow);
    expect(observed.reasons).not.toEqual(sim.reasons);
  });

  test("causal repro: same stateIdentity is insufficient when V3's scorer and Live's curated evidence differ", async () => {
    const simulator = await resolvedSimulatorRound();
    const live = resolvedLiveRound(5);
    const simulatorCoach = await coachOf(simulator.routes.getRecommendations, simulator.sessionId);
    const liveBoard = await boardOf(live.routes.getTeamRecommendations, live.sessionId);

    // Same facts and roles arrived. The divergence is an EVIDENCE-INPUT one: V3's fake scorer emits a
    // statistical counter signal for hero 5 once enemy 9 is revealed (raw 0.8), while Live only raises
    // priority from CURATED evidence (hero-counters). Fixture direction: `heroCounters.get(9)` lists the
    // entries with `vs === 5`; the shared-counter test below builds exactly that entry and Live then agrees.
    expect(simulatorCoach.output.meta.basedOn.stateIdentity).toBe(liveBoard.stateIdentity);
    const v3Counter = simulatorCoach.recommendationSet.recommendations.find((recommendation) => recommendation.actions.some((action) => action.hero === 5))?.signalsByHero[5]?.find((signal) => signal.signal === "counter");
    expect(v3Counter).toMatchObject({ raw: 0.8, hasRevealedEnemyCounterEvidence: true });
    expect(fixtureCounters(BANNED).get(9)?.some((entry) => entry.vs === 5) ?? false).toBe(false);
    // Positive control for the same lookup: once the curated entry exists, the lookup finds it.
    const withCuratedEntry = fixtureCounters(BANNED, new Map([[9, [{ vs: 5, level: "hard" as const, why: "control" }]]]));
    expect(withCuratedEntry.get(9)?.some((entry) => entry.vs === 5)).toBe(true);

    // Actual Simulator Party 5 path: CoachOrchestrator -> RecommendationOutputV3.
    expect(simulatorCoach.output.primaryAction.strategy).toMatchObject({ kind: "REVEAL_POSITION", position: 3 });
    expect(simulatorCoach.output.shortlist).toEqual(expect.arrayContaining([
      expect.objectContaining({ heroId: 5, position: 3, evidenceStrength: "STRONG", rationale: "counter de 5" }),
    ]));
    expect(simulatorCoach.output.roleBeliefs.own).toEqual(expect.arrayContaining([
      expect.objectContaining({ heroId: 1, positions: [1] }),
      expect.objectContaining({ heroId: 2, positions: [5] }),
    ]));

    // Actual Live Companion path: LiveCaptureRegistry -> TeamCoachBoard.
    const livePos3 = liveBoard.positions.find((column) => column.position === 3)!;
    expect(livePos3.top).toEqual(expect.arrayContaining([
      expect.objectContaining({ heroId: 5, reasons: ["counter de 5"] }),
    ]));
    expect(liveBoard.currentDecision).toMatchObject({ recommendedPosition: 4, recommendedHeroId: 3, targetBasis: "PHASE_FALLBACK" });

    // This is evidence-input divergence, not Live ignoring a valid shared strong counter.
    const v3Strategy = simulatorCoach.output.primaryAction.strategy;
    expect(v3Strategy).toMatchObject({ kind: "REVEAL_POSITION", position: 3 });
    if (v3Strategy.kind !== "REVEAL_POSITION") throw new Error("fixture must produce a position reveal");
    expect(liveBoard.currentDecision.recommendedPosition).not.toBe(v3Strategy.position);
    expect(liveBoard.currentDecision.recommendedHeroId).not.toBe(simulatorCoach.output.shortlist[0]!.heroId);
  });

  test("shared strong counter and no-strong-evidence variants agree on the strategic policy", async () => {
    const sharedCounter = new Map([[9, [{ vs: 5, level: "hard" as const, why: "fixture shared hard counter" }]]]);
    const [strongSimulator, strongLive] = await Promise.all([
      resolvedSimulatorRound([9, 8], sharedCounter),
      resolvedLiveRound(5, [9, 8], sharedCounter),
    ]);
    const strongV3 = await coachOf(strongSimulator.routes.getRecommendations, strongSimulator.sessionId);
    const strongBoard = await boardOf(strongLive.routes.getTeamRecommendations, strongLive.sessionId);
    expect(strongV3.output.meta.basedOn.stateIdentity).toBe(strongBoard.stateIdentity);
    expect(strongV3.output.primaryAction.strategy).toMatchObject({ kind: "REVEAL_POSITION", position: 3 });
    expect(strongBoard.currentDecision).toMatchObject({ recommendedPosition: 3, recommendedHeroId: 5, targetBasis: "STRATEGIC" });

    // Without enemy 9 V3's fake scorer has no counter signal and both routes honestly use the
    // phase order. Roles, facts, scorer, curated evidence and state identity are identical here.
    const [plainSimulator, plainLive] = await Promise.all([
      resolvedSimulatorRound([7, 8]),
      resolvedLiveRound(5, [7, 8]),
    ]);
    const plainV3 = await coachOf(plainSimulator.routes.getRecommendations, plainSimulator.sessionId);
    const plainBoard = await boardOf(plainLive.routes.getTeamRecommendations, plainLive.sessionId);
    expect(plainV3.output.meta.basedOn.stateIdentity).toBe(plainBoard.stateIdentity);
    const plainCounter = plainV3.recommendationSet.recommendations.flatMap((recommendation) => Object.values(recommendation.signalsByHero).flat()).find((signal) => signal.signal === "counter");
    expect(plainCounter).toMatchObject({ raw: null, hasRevealedEnemyCounterEvidence: false });
    expect(plainV3.output.primaryAction.strategy).toMatchObject({ kind: "REVEAL_POSITION", position: 4 });
    expect(plainBoard.currentDecision).toMatchObject({ recommendedPosition: 4, recommendedHeroId: 3, targetBasis: "PHASE_FALLBACK" });
  });

  test("V3 never turns a statistics-only counter into a strong action (no curated evidence at all)", async () => {
    // Empty curated catalog: the ONLY counter signal is V3's statistical one (hero 5 vs revealed 9,
    // raw 0.8). Per the eligibility contract, COUNTER_STATS is a complement, never a standalone ground.
    const simulator = await resolvedSimulatorRound([9, 8], undefined, new Map());
    const v3 = await coachOf(simulator.routes.getRecommendations, simulator.sessionId);
    const counter = v3.recommendationSet.recommendations.find((recommendation) => recommendation.actions.some((action) => action.hero === 5))?.signalsByHero[5]?.find((signal) => signal.signal === "counter");
    expect(counter).toMatchObject({ raw: 0.8, hasRevealedEnemyCounterEvidence: true }); // the statistic really is present

    expect(v3.output.actionSupport).toBe("LIMITED"); // "ELIGE AHORA" is withheld
    expect(v3.output.shortlist.length).toBeGreaterThan(0);
    expect(v3.output.shortlist.filter((candidate) => candidate.evidenceStrength === "STRONG")).toEqual([]);
  });
});
