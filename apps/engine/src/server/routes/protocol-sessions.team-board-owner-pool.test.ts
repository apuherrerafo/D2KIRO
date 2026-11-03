import { describe, expect, test } from "bun:test";
import type { TeamCoachBoard } from "../../coach";
import { fakeCompute } from "../../coach/session-harness.fixtures";
import type { ComputeSuggestionsForRecommendation } from "../../recommendation/perspective-context";
import type { HeroPositions } from "../../signals/hero-positions";
import type { SignalContribution } from "../../signals/types";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes } from "./protocol-sessions";

// The owner always gets recommendations shaped by THEIR personal hero pool -- on the Team Coach Board too. The board used
// to erase the account for every column (team-level by construction), and a saved team never carries the owner's seat
// (withoutOwnerSeat), so the owner's own column ended up with no pool at all. Positions and pools are inline (S9/S10).

const POSITIONS: HeroPositions = {
  1: [{ position: 1, matches: 1000 }],
  2: [{ position: 1, matches: 1000 }],
  4: [{ position: 2, matches: 1000 }],
  5: [{ position: 2, matches: 1000 }],
  6: [{ position: 3, matches: 1000 }],
  7: [{ position: 3, matches: 1000 }],
  9: [{ position: 4, matches: 1000 }],
  11: [{ position: 4, matches: 1000 }],
  12: [{ position: 5, matches: 1000 }],
  13: [{ position: 5, matches: 1000 }],
};
const POOL = [1, 2, 4, 5, 6, 7, 9, 11, 12, 13];
const OWNER_ACCOUNT = 777;
// The owner's personal pool holds hero 11, which V6 would otherwise rank BELOW hero 9 at Pos 4.
const PERSONAL_HERO = 11;

interface ComputeCall { targetPosition: number | undefined; accountId: number | null }

function recordingCompute(calls: ComputeCall[]): ComputeSuggestionsForRecommendation {
  const base = fakeCompute(POOL, POSITIONS);
  return async (state, accountId, options) => {
    calls.push({ targetPosition: options?.targetPosition, accountId });
    const set = await base(state, accountId, options);
    if (accountId !== OWNER_ACCOUNT) return set;
    const pooled: SignalContribution = { signal: "hero_pool_fit", raw: 1, normalized: 100, evidenceConfidence: 1, weighted: 100, explanation: "En tu pool de héroes", sampleSize: 1 };
    const suggestions = set.suggestions
      .map((suggestion) => (suggestion.hero === PERSONAL_HERO ? { ...suggestion, score: suggestion.score + 100, signals: [...suggestion.signals, pooled] } : suggestion))
      .sort((a, b) => b.score - a.score);
    return { ...set, suggestions };
  };
}

async function setup(humanPosition: 1 | 2 | 3 | 4 | 5) {
  const calls: ComputeCall[] = [];
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({ store, computeSuggestions: recordingCompute(calls), heroPositions: POSITIONS, heroCounters: new Map() });
  const created = await routes.post(new Request("http://127.0.0.1/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "simulator",
      humanPosition,
      simulatorSeed: "OWNERPOOL",
      partyContext: { partySize: 5, side: "radiant", controlledSlots: [] },
      controlledPositions: [1, 2, 3, 4, 5],
    }),
  }));
  expect(created.status).toBe(201);
  const { sessionId } = (await created.json()) as { sessionId: string };
  store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  async function board(accountId?: number): Promise<TeamCoachBoard> {
    calls.length = 0;
    const response = await routes.getTeamRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`), accountId);
    expect(response.status).toBe(200);
    return (await response.json()) as TeamCoachBoard;
  }
  return { calls, board };
}

describe("Team Coach Board -- the owner's column uses the owner's personal pool", () => {
  test("the owner's own column is ranked with the owner's account; every other column stays team-level", async () => {
    const { calls, board } = await setup(4);
    await board(OWNER_ACCOUNT);
    const byPosition = (position: number) => calls.filter((call) => call.targetPosition === position);
    expect(byPosition(4).length).toBeGreaterThan(0);
    expect(byPosition(4).every((call) => call.accountId === OWNER_ACCOUNT)).toBe(true);
    for (const position of [1, 2, 3, 5]) {
      expect(byPosition(position).length).toBeGreaterThan(0);
      expect(byPosition(position).every((call) => call.accountId === null)).toBe(true);
    }
  });

  test("the pool moves the owner's column (hero in the pool leads); teammates' columns do not move", async () => {
    const { board } = await setup(4);
    const withPool = await board(OWNER_ACCOUNT);
    const withoutAccount = await board();
    const column = (b: TeamCoachBoard, position: number) => b.positions.find((c) => c.position === position)!;
    expect(column(withoutAccount, 4).top[0]!.heroId).toBe(9);
    expect(column(withPool, 4).top[0]!.heroId).toBe(PERSONAL_HERO);
    for (const position of [1, 2, 3, 5]) {
      expect(column(withPool, position).top.map((card) => card.heroId)).toEqual(column(withoutAccount, position).top.map((card) => card.heroId));
    }
  });

  test("a different owner seat moves the personal pool with it", async () => {
    const { calls, board } = await setup(2);
    await board(OWNER_ACCOUNT);
    expect(calls.filter((call) => call.targetPosition === 2).every((call) => call.accountId === OWNER_ACCOUNT)).toBe(true);
    expect(calls.filter((call) => call.targetPosition === 4).every((call) => call.accountId === null)).toBe(true);
  });
});
