import { describe, expect, test } from "bun:test";
import type { TeamCoachBoard } from "../coach";
import { fakeCompute, strongOpenerCounters } from "../coach/session-harness.fixtures";
import type { RecommendationOutputV4 } from "../coach/recommendation-output-v4";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { DraftEventEnvelope } from "../draft/reducer";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { LiveCaptureRegistry } from "./live-capture-registry";

// P0-03C -- V4 respects the Team Coach board's explicit decision NOT to recommend (nothingStrongForWhatIsMissing, no STRONG hero), on a LIVE
// session, without hiding the informative columns. Fixtures mirror live-composition.test.ts ("composition-6" / "composition-7"); positions,
// counters and the V6 stand-in are inline (never the curated files).

const share = (position: Position, matches: number) => ({ position, matches });
const LION = 41;
const CRYSTAL = 42;
const ZEUS = 46;
const CARRIES = [11, 12, 13];
const MIDS = [21, 22];
const OFFLANERS = [31, 32, 33];
const POSITIONS: HeroPositions = {
  ...Object.fromEntries(CARRIES.map((hero) => [hero, [share(1, 9000)]])),
  ...Object.fromEntries(MIDS.map((hero) => [hero, [share(2, 9000)]])),
  ...Object.fromEntries(OFFLANERS.map((hero) => [hero, [share(3, 9000)]])),
  [LION]: [share(4, 5000), share(5, 3500), share(2, 1000)],
  [CRYSTAL]: [share(5, 6000), share(4, 2500), share(2, 700)],
  [ZEUS]: [share(2, 2500), share(4, 6000), share(5, 1500)],
};
const ALL_HEROES = Object.keys(POSITIONS).map(Number);
const PERMISSIVE: HeroPositions = Object.fromEntries(ALL_HEROES.map((hero) => [hero, ([1, 2, 3, 4, 5] as Position[]).map((position) => share(position, 1000))]));
const IRRELEVANT_BAN = 99;
const NO_COUNTERS = new Map<number, CuratedCounter[]>();
const ALL_POSITIONS: Position[] = [1, 2, 3, 4, 5];
let seq = 0;

function universeHonouringCompute(): ComputeSuggestionsForRecommendation {
  const base = fakeCompute(ALL_HEROES, PERMISSIVE);
  return async (state, accountId, options) => {
    const set = await base(state, accountId, options);
    if (!options?.candidateHeroIds) return set;
    const allowed = new Set(options.candidateHeroIds);
    const suggestions = set.suggestions
      .filter((suggestion) => allowed.has(suggestion.hero))
      .map((suggestion, index) => ({ ...suggestion, rank: Math.min(index + 1, 6) as typeof suggestion.rank }));
    const signalEvidence = set.functionalEvidence?.signalEvidence.filter((entry) => allowed.has(entry.hero));
    return { ...set, suggestions, functionalEvidence: set.functionalEvidence && signalEvidence ? { ...set.functionalEvidence, signalEvidence } : set.functionalEvidence };
  };
}

type V4Decision = Extract<RecommendationOutputV4["decision"], { kind: "ACTIONABLE" }>;

function setup(sessionId: string, withoutEvidence: readonly number[]) {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41f", now: () => 1_790_000_000_000, heroPositions: POSITIONS });
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions: universeHonouringCompute(),
    heroPositions: POSITIONS,
    heroCounters: strongOpenerCounters(ALL_HEROES.filter((hero) => !withoutEvidence.includes(hero)), IRRELEVANT_BAN + 1, NO_COUNTERS),
    liveRecommendationGate: (id) => registry.recommendationGate(id),
  });
  registry.ensureSession(sessionId, 4242);
  registry.observe(sessionId, { type: "draft_started", patch: "7.41f" });
  registry.observe(sessionId, { type: "side", side: "radiant" });
  registry.observe(sessionId, { type: "ban", heroId: IRRELEVANT_BAN + 1 });
  registry.setTeamContext(sessionId, 4242, { teamGroupId: 7, playerPoolsByPosition: {} });
  const send = (payload: DraftEventEnvelope["payload"], source: DraftEventEnvelope["source"] = "ocr") => {
    seq += 1;
    return registry.ingestEnvelope({ schema: "draft-event/v1", eventId: `silence-${seq}`, sessionId, seq, emittedAt: "2026-10-15T12:00:00.000Z", source, confidence: 0.95, payload });
  };
  send({ type: "capture_health", status: "ok", detail: "VISUAL_OK" });
  const url = (suffix: string) => new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/${suffix}`);
  return {
    // A position is only known when a source that knows who is who (Overwolf/GSI) states it.
    ally: (hero: number, position?: Position) => (position === undefined ? send({ type: "hero_picked", hero, side: "radiant" }) : send({ type: "hero_picked", hero, side: "radiant", position } as DraftEventEnvelope["payload"], "overwolf")),
    enemy: (hero: number) => send({ type: "hero_picked", hero, side: "dire" }),
    async board(): Promise<TeamCoachBoard> {
      const response = await routes.getTeamRecommendations(sessionId, url("team-recommendations"));
      if (response.status !== 200) throw new Error(`board HTTP ${response.status}`);
      return (await response.json()) as TeamCoachBoard;
    },
    async v4(viewed: Position | null = null): Promise<V4Decision> {
      const response = await routes.getRecommendations(sessionId, url(`recommendations?format=v4${viewed === null ? "" : `&target=${viewed}`}`));
      if (response.status !== 200) throw new Error(`v4 HTTP ${response.status}`);
      const decision = ((await response.json()) as { output: RecommendationOutputV4 }).output.decision;
      if (decision.kind !== "ACTIONABLE") throw new Error("expected an actionable decision");
      return decision;
    },
  };
}

/** composition-6: the missing mid has no STRONG hero, so the board stays silent. */
async function silentLiveSession(sessionId: string) {
  const t = setup(sessionId, [...MIDS, ZEUS]);
  t.ally(LION);
  t.ally(CRYSTAL);
  t.enemy(91);
  t.enemy(92);
  t.ally(CARRIES[0]!);
  t.ally(OFFLANERS[0]!);
  t.enemy(93);
  t.enemy(94);
  return t;
}

describe("P0-03C: V4 respects the board's explicit silence", () => {
  test("composition-6 through V4: the board is silent, so primaryRecommendation is null -- at the default view AND at every viewed position", async () => {
    const t = await silentLiveSession("silence-1");
    const board = await t.board();
    expect(board.currentDecision.recommendedPosition).toBeNull(); // the precondition: the engine decided NOT to recommend
    expect(board.currentDecision.recommendedHeroId).toBeNull();

    expect((await t.v4()).primaryRecommendation).toBeNull();
    for (const position of ALL_POSITIONS) {
      const decision = await t.v4(position);
      expect(decision.viewedPosition).toBe(position); // navigation still works for all five positions
      expect(decision.primaryRecommendation).toBeNull(); // ...and never resurrects a recommendation
    }
  });

  test("the silence hides nothing informative: the columns keep their eligible cards (WEAK or STRONG) in V4 and in the board", async () => {
    const t = await silentLiveSession("silence-2");
    const board = await t.board();
    for (const position of [1, 3] as Position[]) expect(board.positions.find((column) => column.position === position)!.top.length).toBeGreaterThan(0);
    const pos1 = await t.v4(1);
    expect(pos1.candidates.cards.length).toBeGreaterThan(0); // the Pos 1 cards are still there, with their evidence mark
    expect(pos1.candidates.cards.some((card) => card.evidenceStrength === "STRONG")).toBe(true); // a STRONG card is shown, but NOT claimed as the recommendation
    expect(pos1.primaryRecommendation).toBeNull();
  });

  test("a legitimate STRONG recommendation on a live session: V4 and the board name the same position and hero, whatever position is viewed", async () => {
    const t = setup("silence-3", [ZEUS]); // composition-7: the missing mid DOES have a STRONG hero
    t.ally(LION);
    t.ally(CRYSTAL);
    t.enemy(91);
    t.enemy(92);
    t.ally(CARRIES[0]!);
    t.ally(OFFLANERS[0]!);
    t.enemy(93);
    t.enemy(94);
    const board = await t.board();
    expect(board.currentDecision.recommendedPosition).toBe(2);
    expect(MIDS).toContain(board.currentDecision.recommendedHeroId!);
    for (const viewed of [null, ...ALL_POSITIONS]) {
      const decision = await t.v4(viewed);
      expect(decision.primaryRecommendation).toEqual({ position: board.currentDecision.recommendedPosition!, heroId: board.currentDecision.recommendedHeroId! });
      expect(decision.targetPosition).toBe(board.currentDecision.recommendedPosition!);
    }
  });

  /** Four own picks with CONFIRMED positions leave exactly one human position (Pos 5) pending. */
  async function onePendingPosition(sessionId: string, withoutEvidence: readonly number[]) {
    const t = setup(sessionId, withoutEvidence);
    t.ally(CARRIES[0]!, 1);
    t.ally(MIDS[0]!, 2);
    t.enemy(91);
    t.enemy(92);
    t.ally(OFFLANERS[0]!, 3);
    t.ally(LION, 4);
    t.enemy(93);
    t.enemy(94);
    return t;
  }

  test("ONE pending position on a live session WITH a STRONG hero: V4 evaluates the board and names the board's hero", async () => {
    const t = await onePendingPosition("silence-4", []);
    const board = await t.board();
    expect(board.currentDecision.actionablePositions).toEqual([5]);
    expect(board.currentDecision.recommendedPosition).toBe(5);
    const decision = await t.v4();
    expect(decision.actionablePositions).toEqual([5]);
    expect(decision.primaryRecommendation).toEqual({ position: 5, heroId: board.currentDecision.recommendedHeroId! });
  });

  test("ONE pending position on a live session WITHOUT any STRONG hero: the board is silent and V4 invents nothing", async () => {
    const t = await onePendingPosition("silence-5", [CRYSTAL, ZEUS]);
    const board = await t.board();
    expect(board.currentDecision.actionablePositions).toEqual([5]);
    expect(board.currentDecision.recommendedPosition).toBeNull();
    const decision = await t.v4();
    expect(decision.primaryRecommendation).toBeNull();
    expect(decision.candidates.cards.every((card) => card.evidenceStrength === "WEAK")).toBe(true);
  });
});
