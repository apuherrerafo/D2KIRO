import { describe, expect, test } from "bun:test";
import type { TeamCoachBoard } from "../coach";
import { fakeCompute } from "../coach/session-harness.fixtures";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { DraftEventEnvelope } from "../draft/reducer";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { LiveCaptureRegistry } from "./live-capture-registry";

// Party5 live engine P0 -- REAL registry -> REAL kernel -> REAL store -> REAL Team Coach Board route.
// Only V6's scorer is a deterministic fixture; positions, counters and pools are inline (S9/S10).
// Picks arrive the way the visual capturer sends them: source "ocr", never a position.

const share = (position: Position, matches: number) => ({ position, matches });
const POSITIONS: HeroPositions = {
  ...Object.fromEntries(([1, 2, 3, 4, 5] as Position[]).flatMap((position) => [0, 1, 2, 3].map((k) => [position * 10 + k, [share(position, 1000)]]))),
  34: [share(3, 600), share(4, 500)], // offlane / soft support flex
  134: [share(3, 600), share(4, 500)],
  45: [share(4, 600), share(5, 500)], // soft / hard support flex
};
const POOL = Object.keys(POSITIONS).map(Number);
const POOLS: Partial<Record<Position, readonly number[]>> = { 1: [10, 11], 2: [20, 21, 22], 3: [30, 31, 34, 134], 4: [34, 134, 40, 41], 5: [50, 51, 45] };
/** Keyed by the VICTIM: hero 41 (Pos 4 pool + shortlist) hard-counters the enemy 91. */
const ENEMY_COUNTERED = 91;
const COUNTERS = new Map<number, CuratedCounter[]>([[ENEMY_COUNTERED, [{ vs: 41, level: "hard", why: "fixture" }]]]);
const ACCOUNT = 4242;
const BANNED = 99;

let seq = 0;

/** A V6 stand-in that honours the position pool it is handed (hero_pool_fit) and records which pool each target got. */
function poolAwareCompute(record: Map<Position, readonly number[] | undefined>): ComputeSuggestionsForRecommendation {
  const base = fakeCompute(POOL, POSITIONS);
  return async (state, accountId, options) => {
    const set = await base(state, accountId, options);
    if (options?.targetPosition !== undefined) record.set(options.targetPosition, options.overrideHeroPool);
    const pool = new Set(options?.overrideHeroPool ?? []);
    const suggestions = set.suggestions
      .map((suggestion) => {
        const inPool = pool.has(suggestion.hero);
        const fit = { signal: "hero_pool_fit" as const, raw: inPool ? 1 : 0, normalized: inPool ? 100 : 0, evidenceConfidence: 1, weighted: inPool ? 100 : 0, explanation: inPool ? "En el pool de la posición" : "Fuera del pool", sampleSize: 0, applicable: pool.size > 0 };
        const signals = [...suggestion.signals, fit];
        return { ...suggestion, signals, score: signals.reduce((sum, signal) => sum + signal.weighted, 0) };
      })
      .sort((a, b) => b.score - a.score || a.hero - b.hero)
      .map((suggestion, index) => ({ ...suggestion, rank: Math.min(index + 1, 6) as typeof suggestion.rank }));
    const signalEvidence = suggestions.map((suggestion) => ({
      hero: suggestion.hero,
      signals: suggestion.signals.map((entry) => ({ signal: entry.signal, raw: entry.raw, normalized: entry.normalized ?? null, evidenceConfidence: entry.evidenceConfidence ?? null, explanation: entry.explanation, sampleSize: entry.sampleSize, applicable: null })),
    }));
    return { ...set, suggestions, functionalEvidence: set.functionalEvidence ? { ...set.functionalEvidence, signalEvidence } : set.functionalEvidence };
  };
}

function setup(sessionId: string, pools: Partial<Record<Position, readonly number[]>> | null = POOLS) {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => 1_790_000_000_000, heroPositions: POSITIONS });
  const poolsByTarget = new Map<Position, readonly number[] | undefined>();
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions: poolAwareCompute(poolsByTarget),
    heroPositions: POSITIONS,
    heroCounters: COUNTERS,
    liveRecommendationGate: (id) => registry.recommendationGate(id),
  });
  registry.ensureSession(sessionId, ACCOUNT);
  registry.observe(sessionId, { type: "draft_started", patch: "7.41e" });
  registry.observe(sessionId, { type: "side", side: "radiant" });
  registry.observe(sessionId, { type: "ban", heroId: BANNED });
  if (pools) registry.setTeamContext(sessionId, ACCOUNT, { teamGroupId: 7, playerPoolsByPosition: pools });
  const send = (payload: DraftEventEnvelope["payload"]) => {
    seq += 1;
    return registry.ingestEnvelope({ schema: "draft-event/v1", eventId: `p5-${seq}`, sessionId, seq, emittedAt: "2026-10-14T12:00:00.000Z", source: "ocr", confidence: 0.95, payload });
  };
  send({ type: "capture_health", status: "ok", detail: "VISUAL_OK" });
  const ally = (hero: number) => send({ type: "hero_picked", hero, side: "radiant" });
  const enemy = (hero: number) => send({ type: "hero_picked", hero, side: "dire" });
  async function boardResponse() {
    poolsByTarget.clear();
    return routes.getTeamRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
  }
  async function board(): Promise<TeamCoachBoard> {
    const response = await boardResponse();
    expect(response.status).toBe(200);
    return (await response.json()) as TeamCoachBoard;
  }
  return { store, registry, ally, enemy, board, boardResponse, poolsByTarget, setPools: (next: Partial<Record<Position, readonly number[]>>) => registry.setTeamContext(sessionId, ACCOUNT, { teamGroupId: 7, playerPoolsByPosition: next }) };
}

const column = (board: TeamCoachBoard, position: Position) => board.positions.find((candidate) => candidate.position === position)!;

describe("LIVE_POSITION_RESOLUTION -- own live picks fill their positions without a manual step", () => {
  test("a hero only the Pos 5 pool lists fills Pos 5: FILLED, correct hero, out of the actionable positions", async () => {
    const t = setup("p5-resolve-0001");
    t.ally(50);
    const body = await t.board();
    expect(column(body, 5)).toMatchObject({ state: "FILLED", alreadyFilled: true, filledHeroId: 50, eligibleNow: false, top: [] });
    expect(body.currentDecision.actionablePositions).not.toContain(5);
    expect(body.currentDecision.recommendedPosition).not.toBe(5);
    expect(body.unboundOwnHeroIds).toEqual([]);
  });

  test("a flex Pos 3/4 hero is not guessed: both columns stay open, it is the one unbound hero, and neither is recommended over a certain one", async () => {
    const t = setup("p5-resolve-0002");
    t.ally(34);
    const body = await t.board();
    expect(column(body, 3).alreadyFilled).toBe(false);
    expect(column(body, 4).alreadyFilled).toBe(false);
    expect(body.unboundOwnHeroIds).toEqual([34]);
    expect([3, 4]).not.toContain(body.currentDecision.recommendedPosition!);
    expect(body.currentDecision.targetBasis).not.toBe("STRATEGIC");
  });

  test("the next own pick disambiguates: the flex hero and the new one both bind", async () => {
    const t = setup("p5-resolve-0003");
    t.ally(34);
    t.enemy(92);
    t.ally(30); // only in the Pos 3 pool -> 34 is the Pos 4
    const body = await t.board();
    expect(column(body, 3)).toMatchObject({ state: "FILLED", filledHeroId: 30 });
    expect(column(body, 4)).toMatchObject({ state: "FILLED", filledHeroId: 34 });
    expect(body.unboundOwnHeroIds).toEqual([]);
  });

  test("two flex heroes covering Pos 3 / Pos 4 between them close BOTH columns, without pretending which is which", async () => {
    const t = setup("p5-resolve-0004");
    t.ally(34);
    t.ally(134);
    const body = await t.board();
    for (const position of [3, 4] as Position[]) expect(column(body, position)).toMatchObject({ state: "FILLED", alreadyFilled: true, filledHeroId: null, eligibleNow: false });
    expect([...body.unboundOwnHeroIds].sort((a, b) => a - b)).toEqual([34, 134]);
  });

  test("the preset applied AFTER the picks re-resolves them (no manual user action)", async () => {
    const t = setup("p5-resolve-0005", null);
    t.ally(45); // credible at Pos 4 and Pos 5, no pool yet
    expect((await t.board()).unboundOwnHeroIds).toEqual([45]);
    t.setPools(POOLS); // 45 is only in the Pos 5 pool
    const body = await t.board();
    expect(column(body, 5)).toMatchObject({ state: "FILLED", filledHeroId: 45 });
    expect(body.unboundOwnHeroIds).toEqual([]);
  });
});

describe("POSITION_PRIORITY -- the recommended position has a truthful basis", () => {
  test("EMPTY DRAFT: not Pos 1 because 1 is the smallest number; a named PHASE_FALLBACK", async () => {
    const body = await setup("p5-priority-0001").board();
    expect(body.currentDecision.recommendedPosition).toBe(5);
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
    expect(body.currentDecision.actionablePositions).toEqual([1, 2, 3, 4, 5]);
  });

  test("COUNTER WINDOW: an enemy that Pos 4's shortlist hard-counters makes Pos 4 the STRATEGIC pick, with that counter as its hero", async () => {
    const t = setup("p5-priority-0002");
    t.enemy(ENEMY_COUNTERED);
    const body = await t.board();
    expect(body.currentDecision).toMatchObject({ recommendedPosition: 4, targetBasis: "STRATEGIC", recommendedHeroId: 41 });
    expect(column(body, 4).primaryHeroId).toBe(41);
    expect(body.currentDecision.reason).toContain("Ventana de counter");
  });
});

describe("PARTY5_POOLS -- playerPoolsByPosition[P] -> overrideHeroPool -> that position's ranking only", () => {
  test("changing ONLY the Pos 4 pool changes the Pos 4 ranking and leaves every other position's pool context untouched", async () => {
    const t = setup("p5-pools-0001");
    const before = await t.board();
    const poolsBefore = new Map(t.poolsByTarget);
    t.setPools({ ...POOLS, 4: [42, 43] });
    const after = await t.board();
    const poolsAfter = new Map(t.poolsByTarget);

    expect(poolsAfter.get(4)).toEqual([42, 43]);
    for (const position of [1, 2, 3, 5] as Position[]) {
      expect(poolsBefore.get(position)).toEqual(POOLS[position]);
      expect(poolsAfter.get(position)).toEqual(POOLS[position]);
      expect(column(after, position).top.map((card) => card.heroId)).toEqual(column(before, position).top.map((card) => card.heroId));
    }
    const ranking = (body: TeamCoachBoard) => [...column(body, 4).top].sort((a, b) => a.rank - b.rank).map((card) => card.heroId);
    expect(ranking(after)).not.toEqual(ranking(before));
    expect(ranking(after).slice(0, 2).sort()).toEqual([42, 43]);
    // A preference, not a whitelist: heroes outside the new pool still rank at Pos 4.
    expect(ranking(after).some((heroId) => ![42, 43].includes(heroId))).toBe(true);
  });
});

describe("REALISTIC_AP_SEQUENCE -- one Ranked All Pick draft, asserted at every state", () => {
  test("0 picks -> enemy lock -> ally lock -> enemy lock -> ally lock -> round 2 rapid locks -> round 3 -> 10/10", async () => {
    const t = setup("p5-sequence-0001");
    const steps: [string, () => unknown][] = [
      ["0 picks", () => undefined],
      ["enemy lock", () => t.enemy(ENEMY_COUNTERED)],
      ["ally lock (the counter)", () => t.ally(41)],
      ["enemy lock", () => t.enemy(11)], // eats the Pos 1 pool down to one hero
      ["ally lock", () => t.ally(50)], // round 1 closes 2/2
      ["round 2: ally lock", () => t.ally(30)],
      ["round 2: ally lock (our round full first)", () => t.ally(10)],
      ["round 2: enemy lock", () => t.enemy(31)],
      ["round 2: enemy lock", () => t.enemy(92)],
      ["round 3: enemy lock", () => t.enemy(93)],
      ["round 3: ally lock", () => t.ally(20)],
    ];
    const ownBound = new Map<number, Position>([[41, 4], [50, 5], [30, 3], [10, 1], [20, 2]]);
    for (const [label, step] of steps) {
      step();
      const status = t.registry.status("p5-sequence-0001")!;
      expect({ label, recommendation: status.recommendation }).toEqual({ label, recommendation: { available: true, reason: null } });
      expect(status.deferredPicks).toBe(0);
      const body = await t.board();
      const view = t.store.view("p5-sequence-0001")!;
      const gone = new Set([...view.bannedHeroes, ...[...view.ownPicks, ...view.enemyPicks].flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]))]);

      // No picked / banned hero suggested anywhere.
      for (const candidate of body.positions.flatMap((entry) => entry.top)) expect({ label, hero: candidate.heroId, gone: gone.has(candidate.heroId) }).toEqual({ label, hero: candidate.heroId, gone: false });
      // Every own pick is bound to its position; nothing is left unbound.
      const ownHeroes = view.ownPicks.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
      for (const heroId of ownHeroes) expect({ label, heroId, column: column(body, ownBound.get(heroId)!).filledHeroId }).toEqual({ label, heroId, column: heroId });
      expect(body.unboundOwnHeroIds).toEqual([]);
      // Each ranked position was ranked with ITS pool.
      for (const [position, pool] of t.poolsByTarget) expect({ label, position, pool }).toEqual({ label, position, pool: POOLS[position] });

      const decision = body.currentDecision;
      if (decision.recommendedPosition === null) {
        expect(decision.actionablePositions).toEqual([]);
        continue;
      }
      // Never a FILLED position; always an actionable one.
      expect({ label, state: column(body, decision.recommendedPosition).state }).not.toEqual({ label, state: "FILLED" });
      expect(decision.actionablePositions).toContain(decision.recommendedPosition);
      // A truthful basis.
      if (decision.targetBasis === "STRATEGIC") {
        const pool = POOLS[decision.recommendedPosition] ?? [];
        const counters = (COUNTERS.get(ENEMY_COUNTERED) ?? []).map((entry) => entry.vs);
        const counterWindow = gone.has(ENEMY_COUNTERED) && counters.includes(decision.recommendedHeroId!);
        const lastPoolHero = pool.filter((heroId) => !gone.has(heroId)).length === 1 && pool.includes(decision.recommendedHeroId!);
        expect({ label, truthful: counterWindow || lastPoolHero }).toEqual({ label, truthful: true });
      } else if (decision.targetBasis === "PHASE_FALLBACK") {
        expect(decision.reason).toContain("no una ventaja");
      } else {
        expect(decision.actionablePositions).toHaveLength(1);
      }
    }
    const final = t.registry.status("p5-sequence-0001")!;
    expect(final.completeness).toBe("PICKS_COMPLETE");
    expect(final.picks).toBe(10);
  });

  test("the sequence's tactical moments are the ones expected", async () => {
    const t = setup("p5-sequence-0002");
    expect((await t.board()).currentDecision).toMatchObject({ recommendedPosition: 5, targetBasis: "PHASE_FALLBACK" });
    t.enemy(ENEMY_COUNTERED);
    expect((await t.board()).currentDecision).toMatchObject({ recommendedPosition: 4, targetBasis: "STRATEGIC", recommendedHeroId: 41 });
    t.ally(41);
    t.enemy(11); // Pos 1 pool: only 10 left
    expect((await t.board()).currentDecision).toMatchObject({ recommendedPosition: 1, targetBasis: "STRATEGIC", recommendedHeroId: 10 });
  });
});
