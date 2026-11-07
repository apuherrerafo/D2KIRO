import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { ProtocolCommand } from "../draft-protocol/types";
import { LiveCaptureRegistry } from "../live/live-capture-registry";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import { ProtocolSessionStore } from "../server/protocol-session";
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

function routes(store: ProtocolSessionStore, opener: number, liveGate?: (sessionId: string) => { available: boolean; reason: string | null; completeness: string } | null) {
  return createProtocolSessionRoutes({
    store,
    computeSuggestions: fakeCompute(POOL, HERO_POSITIONS),
    heroPositions: HERO_POSITIONS,
    heroCounters: strongOpenerCounters(POOL, opener),
    liveRecommendationGate: liveGate,
  });
}

async function boardOf(getBoard: (id: string, url: URL) => Promise<Response>, sessionId: string): Promise<TeamCoachBoard> {
  const response = await getBoard(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
  expect(response.status).toBe(200);
  return response.json() as Promise<TeamCoachBoard>;
}

function simulatorBoard(bannedHero = BANNED) {
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
  return { routes: routes(store, bannedHero), sessionId: "sim-parity" };
}

function liveBoard(bannedHero = BANNED) {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => 1_790_000_000_000, heroPositions: HERO_POSITIONS });
  registry.ensureSession("live-parity", 7);
  registry.observe("live-parity", { type: "draft_started", patch: "7.41e" });
  registry.observe("live-parity", { type: "side", side: "radiant" });
  registry.observe("live-parity", { type: "ban", heroId: bannedHero });
  registry.observe("live-parity", { type: "bans_closed" });
  return { routes: routes(store, bannedHero, (id) => registry.recommendationGate(id)), sessionId: "live-parity" };
}

describe("Party 5 simulator ↔ Live Companion parity", () => {
  test("baseline: equivalent opening facts produce the same scoring, composition, ELIGE AHORA, ADVERTIR, Robo and reasons", async () => {
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
});
