import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import { ProtocolSessionStore } from "../server/protocol-session";
import { LiveCaptureRegistry } from "../live/live-capture-registry";
import { createCoachRecommendations, type CoachRecommendations } from "../server/routes/coach-recommendations";
import type { HeroPositions } from "../signals/hero-positions";
import type { CuratedCounter } from "../signals/hero-counters";
import type { TeamCoachBoard } from "./team-coach-board";
import type { PoolMembership, RankedCandidateCard, RecommendationOutputV4 } from "./recommendation-output-v4";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import { fakeCompute } from "./session-harness.fixtures";

// P0-03D -- Hero Pools certification (Party 5): the pool is a PREFERENCE, never a restriction, and the Simulator (V4) and
// Live (TeamCoachBoard) say the same thing about it. Same REAL kernel/store/coach path as the P0-02 parity harness; only
// V6's scorer is the shared deterministic stand-in and every curated input is inline (no real JSON, no SQLite, no network).
//
//   Pos 3 universe:  5 = the "Underlord" (outside the pool; hard counter of revealed enemy 9)
//                    6 = "Axe" and 10 = "Centaur" (the player's pool; only the generic meta behind them -> WEAK)
//   Own picks: 1 (Pos 1) and 2 (Pos 5) are already locked, so Pos 2, 3 and 4 stay open. Enemy 9 is revealed in the STRONG
//   scenarios. Every other candidate has only the generic meta behind it (WEAK).

const POSITIONS = [1, 2, 3, 4, 5] as Position[];
const OPEN_POSITIONS = [2, 3, 4] as Position[];
const OWN_PICKS: [number, Position][] = [[1, 1], [2, 5]];
const BAN = 99;
const HERO_POSITIONS: HeroPositions = {
  1: [{ position: 1, matches: 1000 }],
  2: [{ position: 5, matches: 1000 }],
  3: [{ position: 4, matches: 1000 }],
  4: [{ position: 2, matches: 1000 }],
  5: [{ position: 3, matches: 1000 }],
  6: [{ position: 3, matches: 1000 }],
  10: [{ position: 3, matches: 1000 }],
};
const UNIVERSE = [1, 2, 3, 4, 5, 6, 10];
const COUNTER_5_BEATS_9 = new Map<number, readonly CuratedCounter[]>([[9, [{ vs: 5, level: "hard", why: "fixture: 5 le gana a 9 en la linea" }]]]);
const NO_COUNTERS = new Map<number, readonly CuratedCounter[]>();

interface Facts { bans: number[]; enemies: number[]; counters: ReadonlyMap<number, readonly CuratedCounter[]>; pools?: Partial<Record<Position, number[]>> }

const OWNER = 7;
/** The owner's own account carries a personal pool: V6 would emit `hero_pool_fit` for them (and only for them). Everyone else gets the plain stand-in. */
function withOwnerPool(base: ComputeSuggestionsForRecommendation, ownerPool: readonly number[] | undefined): ComputeSuggestionsForRecommendation {
  return async (state, accountId, options) => {
    const set = await base(state, accountId, options);
    if (accountId !== OWNER || ownerPool === undefined) return set;
    return {
      ...set,
      suggestions: set.suggestions.map((suggestion) => ({
        ...suggestion,
        signals: [...suggestion.signals, ownerPool.includes(suggestion.hero)
          ? { signal: "hero_pool_fit" as const, raw: 0.6, weighted: 0, explanation: "En tu pool de héroes", sampleSize: 0, applicable: true }
          : { signal: "hero_pool_fit" as const, raw: 0.2, weighted: 0, explanation: "Fuera de tu pool de héroes", sampleSize: 0, applicable: true }],
      })),
    };
  };
}

function coachFor(store: ProtocolSessionStore, facts: Facts, ownerPool?: readonly number[]): CoachRecommendations {
  return createCoachRecommendations({
    source: store,
    computeSuggestions: withOwnerPool(fakeCompute(UNIVERSE, HERO_POSITIONS), ownerPool),
    heroPositions: HERO_POSITIONS,
    heroCounters: facts.counters,
    heroSynergies: new Map(),
    heroCapabilities: [],
    advertirApproved: new Set(),
  });
}

/** Simulator: pools travel in the session metadata exactly like a saved team does; own picks go through the real command route (sealed picks reveal together). */
async function simulator(facts: Facts): Promise<{ store: ProtocolSessionStore; sessionId: string }> {
  const store = new ProtocolSessionStore();
  const sessionId = "sim-p0-03d";
  const created = store.create({
    sessionId,
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: "radiant",
    adapterKind: "simulator",
    simulatorSeed: "P0030004",
    partyContext: { partySize: 5, side: "radiant", controlledSlots: [] },
    controlledPositions: POSITIONS,
    ...(facts.pools ? { playerPoolsByPosition: facts.pools } : {}),
  });
  if (!created.ok) throw new Error("simulator create failed");
  const banned = store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: facts.bans }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  if (!banned?.ok) throw new Error("simulator bans failed");
  const routes = createProtocolSessionRoutes({ store, computeSuggestions: fakeCompute(UNIVERSE, HERO_POSITIONS), heroPositions: HERO_POSITIONS, heroCounters: facts.counters });
  for (const [slotIndex, [heroId, position]] of OWN_PICKS.entries()) {
    const request = new Request("http://127.0.0.1/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId }, assignedPosition: position }) });
    const response = await routes.postCommand(request, sessionId);
    if (response.status !== 202) throw new Error(`own pick refused: ${response.status}`);
  }
  facts.enemies.forEach((heroId, index) => {
    const result = store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: index % 2, heroId });
    if (!result || result.rejected) throw new Error(`enemy pick rejected: ${result?.rejected}`);
  });
  return { store, sessionId };
}

/** Live: the same visible facts through the capture registry; pools arrive the way the live team preset applies them. */
function live(facts: Facts): { store: ProtocolSessionStore; sessionId: string } {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => 1_790_000_000_000, heroPositions: HERO_POSITIONS });
  const sessionId = "live-p0-03d";
  registry.ensureSession(sessionId, OWNER);
  registry.observe(sessionId, { type: "draft_started", patch: "7.41e" });
  registry.observe(sessionId, { type: "side", side: "radiant" });
  for (const heroId of facts.bans) registry.observe(sessionId, { type: "ban", heroId });
  registry.observe(sessionId, { type: "bans_closed" });
  for (const [heroId, position] of OWN_PICKS) registry.observe(sessionId, { type: "pick", side: "radiant", heroId, position });
  for (const heroId of facts.enemies) registry.observe(sessionId, { type: "pick", side: "dire", heroId, position: null });
  if (facts.pools) registry.setTeamContext(sessionId, OWNER, { teamGroupId: 1, playerPoolsByPosition: facts.pools });
  return { store, sessionId };
}

type V4Decision = Extract<RecommendationOutputV4["decision"], { kind: "ACTIONABLE" }>;
async function v4(facts: Facts, viewed: Position | null = null, personal: { position: Position; pool: readonly number[] } | null = null): Promise<V4Decision> {
  const { store, sessionId } = await simulator(facts);
  const output = (await coachFor(store, facts, personal?.pool).recommendCurrentDecision(sessionId, personal?.position ?? null, personal ? OWNER : null, viewed))!.output;
  if (output.decision.kind !== "ACTIONABLE") throw new Error("expected an actionable decision");
  return output.decision;
}
async function liveBoard(facts: Facts, personal: { position: Position; pool: readonly number[] } | null = null): Promise<TeamCoachBoard> {
  const { store, sessionId } = live(facts);
  const board = await coachFor(store, facts, personal?.pool).recommendTeamBoard(sessionId, personal?.position ?? null, personal ? OWNER : null);
  if (!board) throw new Error("board unavailable");
  return board;
}
async function simBoard(facts: Facts, personal: { position: Position; pool: readonly number[] } | null = null): Promise<TeamCoachBoard> {
  const { store, sessionId } = await simulator(facts);
  const board = await coachFor(store, facts, personal?.pool).recommendTeamBoard(sessionId, personal?.position ?? null, personal ? OWNER : null);
  if (!board) throw new Error("board unavailable");
  return board;
}

const cardOf = (decision: V4Decision, heroId: number): RankedCandidateCard | undefined => decision.candidates.cards.find((card) => card.heroId === heroId);
const columnOf = (board: TeamCoachBoard, position: Position) => board.positions.find((column) => column.position === position)!;
const membershipsOf = (cards: readonly { heroId: number; poolMembership?: PoolMembership }[]) => Object.fromEntries(cards.map((card) => [card.heroId, card.poolMembership ?? "ABSENT"]));

const POOL_AXE_CENTAUR = { 3: [6, 10] } as const;
const withPool = (pool: Partial<Record<Position, number[]>>, base: Partial<Facts> = {}): Facts => ({ bans: [BAN], enemies: [9, 8], counters: COUNTER_5_BEATS_9, pools: pool, ...base });

describe("P0-03D 1. a STRONG hero inside the pool is the recommendation and is marked IN_POOL", () => {
  const facts = withPool({ 3: [5, 6] });
  test("Simulator V4", async () => {
    const decision = await v4(facts);
    expect(decision.primaryRecommendation).toEqual({ position: 3, heroId: 5 });
    expect(cardOf(await v4(facts, 3), 5)).toMatchObject({ evidenceStrength: "STRONG", poolMembership: "IN_POOL" });
    expect(decision.poolState).toBe("ACTIVE");
  });
  test("Live board names the same hero; its card says IN_POOL too", async () => {
    const board = await liveBoard(facts);
    expect(board.currentDecision).toMatchObject({ recommendedPosition: 3, recommendedHeroId: 5 });
    expect(membershipsOf(columnOf(board, 3).top)[5]).toBe("IN_POOL");
  });
});

describe("P0-03D 2. WEAK pool heroes never beat an outside STRONG hero, and the outside hero says OFF-POOL", () => {
  const facts = withPool(POOL_AXE_CENTAUR as unknown as Partial<Record<Position, number[]>>);
  test("Simulator V4", async () => {
    const decision = await v4(facts);
    expect(decision.primaryRecommendation).toEqual({ position: 3, heroId: 5 });
    const column = await v4(facts, 3);
    expect(cardOf(column, 5)).toMatchObject({ evidenceStrength: "STRONG", poolMembership: "OUTSIDE_POOL" });
    expect(cardOf(column, 6)).toMatchObject({ evidenceStrength: "WEAK", poolMembership: "IN_POOL" });
    expect(cardOf(column, 10)).toMatchObject({ evidenceStrength: "WEAK", poolMembership: "IN_POOL" });
  });
  test("Live board names the same outside hero and identifies it as outside the pool", async () => {
    const board = await liveBoard(facts);
    expect(board.currentDecision).toMatchObject({ recommendedPosition: 3, recommendedHeroId: 5 });
    expect(columnOf(board, 3).top.find((candidate) => candidate.heroId === 5)?.evidenceStrength).toBe("STRONG");
    expect(membershipsOf(columnOf(board, 3).top)).toMatchObject({ 5: "OUTSIDE_POOL", 6: "IN_POOL", 10: "IN_POOL" });
  });
  test("the outside hero is also listed in the informational column while pool heroes exist", async () => {
    const column = await v4(facts, 3);
    expect(column.candidates.cards.map((card) => card.heroId)).toContain(5);
    expect(column.candidates.poolCards).toEqual([]); // the V4 path asks for the general list only; the board carries the pool list
    const board = await liveBoard(facts);
    expect(columnOf(board, 3).top.map((candidate) => candidate.heroId)).toEqual(expect.arrayContaining([5, 6, 10]));
    expect(columnOf(board, 3).poolTop.map((candidate) => candidate.heroId).sort()).toEqual([10, 6]);
  });
});

describe("P0-03D 3. exhausted pool (A): every pool hero is banned -> an outside STRONG hero is still recommended, state EXHAUSTED", () => {
  const facts = withPool({ 3: [6] }, { bans: [BAN, 6] });
  test("Simulator V4", async () => {
    const decision = await v4(facts);
    expect(decision.primaryRecommendation).toEqual({ position: 3, heroId: 5 });
    const column = await v4(facts, 3);
    expect(column.poolState).toBe("EXHAUSTED");
    expect(cardOf(column, 5)).toMatchObject({ evidenceStrength: "STRONG", poolMembership: "OUTSIDE_POOL" });
  });
  test("Live board", async () => {
    const board = await liveBoard(facts);
    expect(board.currentDecision).toMatchObject({ recommendedPosition: 3, recommendedHeroId: 5 });
    expect(membershipsOf(columnOf(board, 3).top)[5]).toBe("OUTSIDE_POOL");
  });
});

describe("P0-03D 4. inadequate pool (B): pool heroes are available but have no STRONG ground -> no invented hero, and it is NOT 'exhausted'", () => {
  const facts = withPool(POOL_AXE_CENTAUR as unknown as Partial<Record<Position, number[]>>, { counters: NO_COUNTERS, enemies: [7, 8] });
  test("Simulator V4: no primary, state ACTIVE (never EXHAUSTED), pool heroes shown as WEAK", async () => {
    const decision = await v4(facts);
    expect(decision.primaryRecommendation).toBeNull();
    const column = await v4(facts, 3);
    expect(column.poolState).toBe("ACTIVE");
    expect(column.candidates.cards.every((card) => card.evidenceStrength === "WEAK")).toBe(true);
    expect(column.candidates.cards.some((card) => card.poolMembership === "IN_POOL")).toBe(true);
  });
  test("Live board stays silent too", async () => {
    const board = await liveBoard(facts);
    expect(board.currentDecision.recommendedHeroId).toBeNull();
  });
});

describe("P0-03D 5. no STRONG hero anywhere (inside or outside the pool) -> no principal recommendation", () => {
  for (const [name, pools] of [["with a pool", POOL_AXE_CENTAUR], ["without a pool", undefined]] as const) {
    test(name, async () => {
      const facts = withPool((pools ?? {}) as Partial<Record<Position, number[]>>, { counters: NO_COUNTERS, enemies: [7, 8] });
      expect((await v4(facts)).primaryRecommendation).toBeNull();
      expect((await liveBoard(facts)).currentDecision.recommendedHeroId).toBeNull();
      expect((await simBoard(facts)).currentDecision.recommendedHeroId).toBeNull();
    });
  }
});

describe("P0-03D 6. viewing another position never changes the principal recommendation or the pool identification", () => {
  const facts = withPool(POOL_AXE_CENTAUR as unknown as Partial<Record<Position, number[]>>);
  test("Simulator V4: the principal stays Pos 3 / hero 5 whichever position is viewed", async () => {
    for (const viewed of OPEN_POSITIONS) {
      const decision = await v4(facts, viewed);
      expect(decision.viewedPosition).toBe(viewed);
      expect(decision.primaryRecommendation).toEqual({ position: 3, heroId: 5 });
      expect(decision.targetPosition).toBe(3);
    }
  });
  test("a position without a pool shows NO_POOL, not OFF-POOL", async () => {
    const column = await v4(facts, 2);
    expect(column.candidates.cards.length).toBeGreaterThan(0);
    expect(column.candidates.cards.every((card) => card.poolMembership === "NO_POOL")).toBe(true);
    expect(column.poolState).toBe("NONE");
  });
});

describe("P0-03D 7. Simulator <-> Live parity with equivalent pools", () => {
  const scenarios: [string, Facts][] = [
    ["pool STRONG available", withPool({ 3: [5, 6] })],
    ["pool WEAK + outside STRONG", withPool(POOL_AXE_CENTAUR as unknown as Partial<Record<Position, number[]>>)],
    ["pool exhausted", withPool({ 3: [6] }, { bans: [BAN, 6] })],
    ["pool inadequate", withPool(POOL_AXE_CENTAUR as unknown as Partial<Record<Position, number[]>>, { counters: NO_COUNTERS, enemies: [7, 8] })],
  ];
  for (const [name, facts] of scenarios) {
    test(name, async () => {
      const decision = await v4(facts);
      const board = await liveBoard(facts);
      const simulatorBoard = await simBoard(facts);
      // headline: position + hero
      expect(board.currentDecision.recommendedHeroId).toBe(decision.primaryRecommendation?.heroId ?? null);
      if (decision.primaryRecommendation !== null) expect(board.currentDecision.recommendedPosition).toBe(decision.primaryRecommendation.position);
      // columns: same heroes, same strength, same pool identification as the Simulator's board (same builder) and as V4's cards
      for (const position of OPEN_POSITIONS) {
        const live = columnOf(board, position).top.map((candidate) => ({ heroId: candidate.heroId, strength: candidate.evidenceStrength, membership: candidate.poolMembership ?? "ABSENT" }));
        const sim = columnOf(simulatorBoard, position).top.map((candidate) => ({ heroId: candidate.heroId, strength: candidate.evidenceStrength, membership: candidate.poolMembership ?? "ABSENT" }));
        expect(live).toEqual(sim);
        const v4Cards = (await v4(facts, position)).candidates.cards.map((card) => ({ heroId: card.heroId, strength: card.evidenceStrength, membership: card.poolMembership }));
        expect([...live].sort((a, b) => a.heroId - b.heroId)).toEqual([...v4Cards].sort((a, b) => a.heroId - b.heroId));
      }
    });
  }
});

describe("P0-03D 7b. the player's OWN position pool (account pool, no saved team): same identification in V4 and in both boards", () => {
  const facts: Facts = { bans: [BAN], enemies: [9, 8], counters: COUNTER_5_BEATS_9 };
  const personal = { position: 3 as Position, pool: [6, 10] };
  test("V4 names the outside STRONG hero as OUTSIDE_POOL and keeps the pool heroes IN_POOL / WEAK", async () => {
    const decision = await v4(facts, null, personal);
    expect(decision.primaryRecommendation).toEqual({ position: 3, heroId: 5 });
    expect(decision.personalPoolApplied).toBe(true);
    expect(decision.poolOwner).toBe("PLAYER");
    const column = await v4(facts, 3, personal);
    expect(cardOf(column, 5)).toMatchObject({ evidenceStrength: "STRONG", poolMembership: "OUTSIDE_POOL" });
    expect(cardOf(column, 6)).toMatchObject({ evidenceStrength: "WEAK", poolMembership: "IN_POOL" });
  });
  test("the Simulator board and the Live board agree with V4 on the personal column", async () => {
    const v4Cards = (await v4(facts, 3, personal)).candidates.cards.map((card) => ({ heroId: card.heroId, strength: card.evidenceStrength, membership: card.poolMembership }));
    for (const board of [await simBoard(facts, personal), await liveBoard(facts, personal)]) {
      expect(board.currentDecision).toMatchObject({ recommendedPosition: 3, recommendedHeroId: 5 });
      const cards = columnOf(board, 3).top.map((candidate) => ({ heroId: candidate.heroId, strength: candidate.evidenceStrength, membership: candidate.poolMembership }));
      expect([...cards].sort((a, b) => a.heroId - b.heroId)).toEqual([...v4Cards].sort((a, b) => a.heroId - b.heroId));
    }
  });
  test("a position that is not the personal one carries NO_POOL (never OFF-POOL of a pool nobody configured)", async () => {
    const column = await v4(facts, 2, personal);
    expect(column.candidates.cards.every((card) => card.poolMembership === "NO_POOL")).toBe(true);
  });
});
