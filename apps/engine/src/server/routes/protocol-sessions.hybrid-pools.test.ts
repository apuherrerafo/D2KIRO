import { describe, expect, test } from "bun:test";
import type { DraftState } from "../../draft/reducer";
import type { RecommendationOutputV4 } from "../../coach";
import type { ComputeSuggestionsForRecommendation } from "../../recommendation/perspective-context";
import type { HeroPositions } from "../../signals/hero-positions";
import { buildSuggestions } from "../../signals/mix";
import type { MetaHeroInfo, MetaSnapshot } from "../../signals/types";
import { withHeroPoolOverride } from "../hero-pool-override";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes } from "./protocol-sessions";

// Hero Pools V2 / F1 -- a pool is a PREFERENCE, never an admission. REAL kernel, REAL store, REAL Coach path and REAL
// V6 (`buildSuggestions` + `hero_pool_fit`); only the meta snapshot and the curated positions are inline (S2/S10).
//   Pos 5: 12 / 13 / 14 identical on paper, 15 plays Pos 5 only 60% of the time (a weaker fit).
//   Hero 1 and 2 are carries: a carry saved in a Pos 5 pool must never become a Pos 5 recommendation.

const POSITIONS: HeroPositions = {
  1: [{ position: 1, matches: 1000 }],
  2: [{ position: 1, matches: 1000 }],
  12: [{ position: 5, matches: 1000 }],
  13: [{ position: 5, matches: 1000 }],
  14: [{ position: 5, matches: 1000 }],
  15: [{ position: 5, matches: 600 }, { position: 4, matches: 400 }],
  20: [{ position: 4, matches: 1000 }],
  21: [{ position: 4, matches: 1000 }],
  30: [{ position: 2, matches: 1000 }],
  31: [{ position: 2, matches: 1000 }],
  40: [{ position: 3, matches: 1000 }],
  41: [{ position: 3, matches: 1000 }],
};
const HEROES: Record<number, MetaHeroInfo> = Object.fromEntries(Object.keys(POSITIONS).map((id) => [Number(id), { id: Number(id), localizedName: `Hero ${id}` }]));
const META: MetaSnapshot = { heroes: HEROES, matchups: {} };
const OWNER_ACCOUNT = 777;
const OWNER_POOL = [14];

// The same compute the app builds: the real V6 over the snapshot, with the call's pool override applied. The owner's
// account carries its personal pool in the snapshot (what the cached account overlay does in production).
const compute: ComputeSuggestionsForRecommendation = async (state: DraftState, accountId, options) => {
  const snapshot: MetaSnapshot = accountId === OWNER_ACCOUNT
    ? { ...META, heroPool: OWNER_POOL.map((hero) => ({ hero, source: "manual" as const, personalWinrate: null, personalGames: 0, updatedAt: "2026-10-19" })) }
    : META;
  return buildSuggestions(state, withHeroPoolOverride(snapshot, options?.overrideHeroPool), { ...options, heroPositions: POSITIONS });
};

type Pools = Partial<Record<1 | 2 | 3 | 4 | 5, number[]>>;
interface SavedMember { id: number; position: number | null; heroPool: number[] }

async function setup(options: { humanPosition: 1 | 2 | 3 | 4 | 5; pools?: Pools; bans?: number[]; team?: SavedMember[]; assignment?: Record<string, number> }) {
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions: compute,
    heroPositions: POSITIONS,
    heroCounters: new Map(),
    loadTeamGroup: async () => (options.team ? { id: 1, partySize: 5, members: options.team.map((member, index) => ({ ...member, slot: index + 1 })) } : null),
  });
  const created = await routes.post(new Request("http://127.0.0.1/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "simulator",
      humanPosition: options.humanPosition,
      simulatorSeed: "HYBRIDPOOLS",
      partyContext: { partySize: 5, side: "radiant", controlledSlots: [] },
      controlledPositions: [1, 2, 3, 4, 5],
      ...(options.pools ? { playerPoolsByPosition: options.pools } : {}),
      ...(options.team ? { teamGroupId: 1 } : {}),
      ...(options.assignment ? { teamAssignment: options.assignment } : {}),
    }),
  }), OWNER_ACCOUNT);
  expect(created.status).toBe(201);
  const { sessionId } = (await created.json()) as { sessionId: string };
  store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: options.bans ?? [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  async function decide(target: 1 | 2 | 3 | 4 | 5 | null, accountId: number | null = null) {
    const query = target === null ? "format=v4" : `format=v4&target=${target}`;
    const response = await routes.getRecommendations(sessionId, new URL(`http://127.0.0.1/x?${query}`), accountId);
    expect(response.status).toBe(200);
    const { output } = (await response.json()) as { output: RecommendationOutputV4 };
    if (output.decision.kind !== "ACTIONABLE") throw new Error("expected ACTIONABLE");
    const candidates = output.decision.candidates;
    return { decision: output.decision, cards: candidates.state === "RANKED" ? candidates.cards : [] };
  }
  return { decide };
}

const heroesOf = (cards: readonly { heroId: number }[]) => cards.map((card) => card.heroId);
const scoreOf = (cards: readonly { heroId: number; score: number }[], hero: number) => cards.find((card) => card.heroId === hero)?.score ?? Number.NaN;

describe("F1 -- the pool is a preference, measured", () => {
  test("a pool hero gets a measurable edge over an identical candidate, and leads", async () => {
    const without = await (await setup({ humanPosition: 1 })).decide(5);
    expect(heroesOf(without.cards)).toEqual([12, 13, 14, 15]); // control: a tie, resolved by id
    const withPool = await (await setup({ humanPosition: 1, pools: { 5: [13] } })).decide(5);
    expect(heroesOf(withPool.cards)[0]).toBe(13);
    expect(scoreOf(withPool.cards, 13)).toBeGreaterThan(scoreOf(withPool.cards, 12) + 5);
    expect(scoreOf(withPool.cards, 13)).toBeGreaterThan(scoreOf(without.cards, 13));
  });

  test("an outside hero with a clearly better fit still beats a weaker pool hero, and says it is outside the pool", async () => {
    const { decide } = await setup({ humanPosition: 1, pools: { 5: [15] } });
    const { cards } = await decide(5);
    expect(heroesOf(cards)).toContain(15);
    expect(heroesOf(cards)[0]).not.toBe(15);
    expect(cards[0]!.poolMembership).toBe("OUTSIDE_POOL");
    expect(cards.find((card) => card.heroId === 15)!.poolMembership).toBe("IN_POOL");
  });

  test("a carry saved in a Pos 5 pool is never a Pos 5 recommendation", async () => {
    const { decide } = await setup({ humanPosition: 3, pools: { 5: [1, 2, 13] } });
    const { cards } = await decide(5);
    expect(heroesOf(cards)).not.toContain(1);
    expect(heroesOf(cards)).not.toContain(2);
    expect(heroesOf(cards)[0]).toBe(13);
  });

  test("an exhausted pool does not remove the recommendations: credible heroes come back, labelled outside", async () => {
    const { decide } = await setup({ humanPosition: 1, pools: { 5: [13] }, bans: [13] });
    const { decision, cards } = await decide(5);
    expect(decision.candidates.state).toBe("RANKED");
    expect(heroesOf(cards)).toEqual([12, 14, 15]);
    expect(cards.every((card) => card.poolMembership === "OUTSIDE_POOL")).toBe(true);
    expect(decision.poolState).toBe("EXHAUSTED");
  });

  test("an exhausted pool never closes the position as a target", async () => {
    const { decide } = await setup({ humanPosition: 5, pools: { 4: [20] }, bans: [20] });
    const { decision, cards } = await decide(4);
    expect(decision.candidates.state).toBe("RANKED");
    expect(heroesOf(cards)).toEqual([21]);
  });
});

describe("F1 -- isolation and labels", () => {
  test("two teammates keep their own preferences: each seat sees only its own pool", async () => {
    const { decide } = await setup({ humanPosition: 1, pools: { 4: [21], 5: [13] } });
    const five = await decide(5);
    const four = await decide(4);
    expect(heroesOf(five.cards)[0]).toBe(13);
    expect(five.cards.every((card) => card.heroId !== 21)).toBe(true);
    expect(heroesOf(four.cards)[0]).toBe(21);
    const fiveAlone = await (await setup({ humanPosition: 1, pools: { 5: [13] } })).decide(5);
    expect(five.cards.map((card) => [card.heroId, card.score])).toEqual(fiveAlone.cards.map((card) => [card.heroId, card.score]));
  });

  test("a teammate's pool is labelled as the teammate's, never 'Tu pool' (the owner's)", async () => {
    const { decide } = await setup({ humanPosition: 1, pools: { 5: [13] } });
    const { decision } = await decide(5);
    expect(decision.poolState).toBe("ACTIVE");
    expect(decision.poolOwner).toBe("TEAMMATE");
    expect(decision.personalPoolApplied).toBe(false);
  });

  test("the owner keeps today's behaviour: their personal pool leads, labelled as theirs", async () => {
    const { decide } = await setup({ humanPosition: 5 });
    const { decision, cards } = await decide(5, OWNER_ACCOUNT);
    expect(heroesOf(cards)[0]).toBe(14);
    expect(decision.personalPoolApplied).toBe(true);
    expect(decision.poolOwner).toBe("PLAYER");
    expect(cards[0]!.isFromPool).toBe(true);
  });

  test("no pools at all: the same ranking and scores V6 gives on its own, no labels", async () => {
    const { decide } = await setup({ humanPosition: 1 });
    const { decision, cards } = await decide(5);
    expect(decision.poolState).toBe("NONE");
    expect(decision.poolOwner).toBeNull();
    expect(cards.every((card) => card.poolMembership === "NO_POOL" && card.isFromPool === false)).toBe(true);
    const direct = buildSuggestions({ sessionId: "s", schema: "draft-state/v1", format: "all_pick", patch: "7.41e", localSide: "radiant", phase: "active", banned: [], picks: { radiant: [], dire: [] }, lastSeq: 0, appliedEventIds: [], quality: { unconfirmed: [], captureStatus: "ok" }, updatedAt: "2026-10-19T00:00:00Z", firstPickSide: null, turnStartedAt: null, reserveRemainingMs: null }, META, { teamOpening: false, targetPosition: 5, heroPositions: POSITIONS, candidateHeroIds: [12, 13, 14, 15] });
    for (const suggestion of direct.suggestions) expect(scoreOf(cards, suggestion.hero)).toBeCloseTo(suggestion.score, 5);
  });
});

describe("F1 -- the F0 guard still decides which saved pool applies", () => {
  const carryMember: SavedMember = { id: 10, position: 1, heroPool: [1, 2] };
  const supportMember: SavedMember = { id: 50, position: 5, heroPool: [13] };

  test("usual seats: the Pos 5 player's pool is a preference at Pos 5", async () => {
    const { decide } = await setup({ humanPosition: 3, team: [carryMember, supportMember] });
    const { decision, cards } = await decide(5);
    expect(decision.poolState).toBe("ACTIVE");
    expect(heroesOf(cards)[0]).toBe(13);
  });

  test("the carry swapped to Pos 5: the carry pool applies nowhere (not as a filter, not as a preference)", async () => {
    const { decide } = await setup({ humanPosition: 3, team: [carryMember, supportMember], assignment: { 10: 5, 50: 1 } });
    const { decision, cards } = await decide(5);
    expect(decision.poolState).toBe("NONE");
    expect(heroesOf(cards)).toEqual([12, 13, 14, 15]);
    expect(heroesOf(cards)).not.toContain(1);
  });
});

// TSK-251 -- product check. A Party 5 opening now recommends Pos 5 first (the habitual commitment order). That is an
// ORDER to look in, not a claim that Pos 5 is the best decision, and it must not get in the way of a Player who wants to
// consult their own position first: one request for it, whatever their position.
describe("Party 5 opening -- the habitual Pos 5 first never blocks consulting your own position", () => {
  const OWN_POSITIONS = [1, 2, 3, 4, 5] as const;
  for (const own of OWN_POSITIONS) {
    test(`personal Pos ${own}: recommended Pos 5 is labelled as a habit, the first view is Pos ${own}, ranked, and the recommendation stays Pos 5`, async () => {
      const { decide } = await setup({ humanPosition: own });
      const opening = await decide(null, OWNER_ACCOUNT);
      expect(opening.decision.targetPosition).toBe(5);
      expect(opening.decision.targetBasis).toBe("DETERMINISTIC_DEFAULT"); // "no clear strategic priority", never STRATEGIC
      expect(opening.decision.actionablePositions).toEqual([1, 2, 3, 4, 5]); // nothing is hidden or narrowed
      // The suggestion is not the view: the Player opens on their OWN position, ranked, with no request needed.
      expect(opening.decision.viewedPosition).toBe(own);
      expect(opening.decision.candidates.state).toBe("RANKED");
      for (const card of opening.cards) expect(card.position).toBe(own);

      const mine = await decide(own, OWNER_ACCOUNT);
      expect(mine.decision.viewedPosition).toBe(own);
      expect(mine.decision.targetPosition).toBe(5); // consulting does not move the recommendation
      expect(mine.decision.candidates.state).toBe("RANKED");
      expect(mine.cards.length).toBeGreaterThan(0);
      for (const card of mine.cards) expect(card.position).toBe(own);
    });
  }
});
