import { describe, expect, test } from "bun:test";
import type { CurrentDecisionRecomputation } from "../../coach";
import type { HeroCard } from "../../coach/hero-card";
import type { FunctionalRecommendationEvidence } from "../../recommendation/evidence";
import type { HeroPositions } from "../../signals/hero-positions";
import type { SuggestionSet } from "../../signals/mix";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes } from "./protocol-sessions";

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function mockSuggestionsWithPool(
  heroIds: number[],
  pool: readonly number[] = [],
): SuggestionSet {
  const functionalEvidence: FunctionalRecommendationEvidence = {
    metaIsStale: false,
    signalEvidence: heroIds.map((hero) => ({ hero, signals: [] })),
    heroPositions: [],
    teamOpening: null,
    partyPreferredPositions: [],
  };
  const scored = heroIds.map((hero, index) => {
    const inPool = pool.includes(hero);
    const score = hero === 60 ? 200 : inPool ? 150 - index : 100 - index;
    return { hero, inPool, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return {
    schema: "suggestions/v1",
    sessionId: "party5-qa-test",
    basedOnSeq: 0,
    decisionContext: "team_opening",
    suggestions: scored.map((item, index) => ({
      hero: item.hero,
      rank: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6,
      score: item.score,
      signals: [
        {
          signal: "hero_pool_fit" as const,
          raw: item.inPool ? 0.5 : 0.2,
          normalized: item.inPool ? 80 : 30,
          evidenceConfidence: 1,
          weighted: item.inPool ? 40 : 10,
          explanation: item.inPool ? "En tu pool de héroes" : "Fuera de tu pool de héroes",
          sampleSize: 1,
          applicable: pool.length > 0,
        },
        {
          signal: "position_fit" as const,
          raw: 0.5,
          normalized: 50,
          evidenceConfidence: 1,
          weighted: 50,
          explanation: "fixture",
          sampleSize: 50,
        },
        ...(item.hero === 60 ? [{
          signal: "counter" as const,
          raw: 0.8,
          normalized: 85,
          evidenceConfidence: 1,
          weighted: 100,
          explanation: "Fuerte contra el draft rival",
          sampleSize: 100,
          applicable: true,
        }] : []),
      ],
      reason: item.inPool ? "in pool" : "out of pool",
      confidence: "alta" as const,
      evidenceCoverage: 1,
      guessingIndex: 0,
    })),
    comparison: null,
    degraded: [],
    computedInMs: 0,
    functionalEvidence,
  };
}

describe("Party 5 QA Readiness Integration Tests", () => {
  const POS1_POOL = [1, 2, 3, 4, 5];
  const POS2_POOL = [11, 12, 13, 14, 15];
  const POS3_POOL = [21, 22, 23, 24, 25];
  const POS4_POOL = [31, 32, 33, 34, 35];
  const POS5_POOL = [41, 42, 43, 44, 45];

  const HERO_POSITIONS: HeroPositions = {
    1: [{ position: 1, matches: 1000 }],
    2: [{ position: 1, matches: 1000 }],
    3: [{ position: 1, matches: 1000 }],
    4: [{ position: 1, matches: 1000 }],
    5: [{ position: 1, matches: 1000 }],
    60: [{ position: 1, matches: 1000 }], // out of pool carry

    11: [{ position: 2, matches: 1000 }],
    12: [{ position: 2, matches: 1000 }],
    13: [{ position: 2, matches: 1000 }],
    14: [{ position: 2, matches: 1000 }],
    15: [{ position: 2, matches: 1000 }],

    21: [{ position: 3, matches: 1000 }],
    22: [{ position: 3, matches: 1000 }],
    23: [{ position: 3, matches: 1000 }],
    24: [{ position: 3, matches: 1000 }],
    25: [{ position: 3, matches: 1000 }],

    31: [{ position: 4, matches: 1000 }],
    32: [{ position: 4, matches: 1000 }],
    33: [{ position: 4, matches: 1000 }],
    34: [{ position: 4, matches: 1000 }],
    35: [{ position: 4, matches: 1000 }],

    41: [{ position: 5, matches: 1000 }],
    42: [{ position: 5, matches: 1000 }],
    43: [{ position: 5, matches: 1000 }],
    44: [{ position: 5, matches: 1000 }],
    45: [{ position: 5, matches: 1000 }],

    // Heroes for enemy bot
    51: [{ position: 1, matches: 1000 }],
    52: [{ position: 2, matches: 1000 }],
    53: [{ position: 3, matches: 1000 }],
    54: [{ position: 4, matches: 1000 }],
    55: [{ position: 5, matches: 1000 }],
  };

  const MOCK_TEAM_GROUP = {
    id: 42,
    partySize: 5,
    members: [
      { slot: 1, heroPool: POS1_POOL },
      { slot: 2, heroPool: POS2_POOL },
      { slot: 3, heroPool: POS3_POOL },
      { slot: 4, heroPool: POS4_POOL },
      { slot: 5, heroPool: POS5_POOL },
    ],
  };

  async function createParty5Harness() {
    const store = new ProtocolSessionStore();
    const computeSuggestions = async (
      _state: unknown,
      _acc: unknown,
      options?: { candidateHeroIds?: readonly number[]; overrideHeroPool?: readonly number[] },
    ) => {
      const candidates = options?.candidateHeroIds && options.candidateHeroIds.length > 0
        ? [...options.candidateHeroIds]
        : [1, 11, 21, 31, 41, 51, 52, 53, 54, 55];
      return mockSuggestionsWithPool(candidates, options?.overrideHeroPool ?? []);
    };

    const routes = createProtocolSessionRoutes({
      store,
      computeSuggestions,
      heroPositions: HERO_POSITIONS,
      loadTeamGroup: async (id) => (id === 42 ? MOCK_TEAM_GROUP : null),
      heroUniverse: async () => ({
        allHeroIds: Array.from({ length: 120 }, (_, i) => i + 1),
        metaOrder: Array.from({ length: 50 }, (_, i) => i + 70),
      }),
    });

    const createResp = await routes.post(
      jsonRequest({
        rulesetId: "dota2/ranked-all-pick",
        patch: "7.41e",
        localSide: "radiant",
        adapterKind: "simulator",
        humanPosition: 1,
        simulatorSeed: "QA_SEED_42",
        partyContext: { partySize: 5, side: "radiant", controlledSlots: [] },
        controlledPositions: [1, 2, 3, 4, 5],
        teamGroupId: 42,
      }),
    );
    expect(createResp.status).toBe(201);
    const { sessionId } = (await createResp.json()) as { sessionId: string };

    return { store, routes, sessionId };
  }

  test("1. Ban phase resolves to exactly 16 bans in Party 5 session", async () => {
    const { routes, sessionId } = await createParty5Harness();
    const resolveResp = await routes.postResolveBans(
      jsonRequest({ playerBanPreferences: [1, 2] }),
      sessionId,
    );
    expect(resolveResp.status).toBe(200);
    const body = (await resolveResp.json()) as { resolvedBans: number[] };
    expect(body.resolvedBans.length).toBe(16);
    expect(new Set(body.resolvedBans).size).toBe(16);
  });

  test("2. Party preset is loaded into playerPoolsByPosition for all 5 positions", async () => {
    const { store, sessionId } = await createParty5Harness();
    const ctx = store.perspectiveRecommendationContext(sessionId);
    expect(ctx?.playerPoolsByPosition).toBeDefined();
    expect(ctx?.playerPoolsByPosition?.[1]).toEqual(POS1_POOL);
    expect(ctx?.playerPoolsByPosition?.[2]).toEqual(POS2_POOL);
    expect(ctx?.playerPoolsByPosition?.[3]).toEqual(POS3_POOL);
    expect(ctx?.playerPoolsByPosition?.[4]).toEqual(POS4_POOL);
    expect(ctx?.playerPoolsByPosition?.[5]).toEqual(POS5_POOL);
  });

  test("3. All five positions remain controlled by the party (no Ally Bot capacity, canYield is false)", async () => {
    const { store, routes, sessionId } = await createParty5Harness();
    await routes.postResolveBans(jsonRequest({ playerBanPreferences: [] }), sessionId);

    expect(store.canYield(sessionId)).toBe(false);
    expect(store.allyBotPositions(sessionId)).toEqual([]);
    expect(store.humanOpenPositions(sessionId)?.sort()).toEqual([1, 2, 3, 4, 5]);

    // Auto-drive stops for human input, never picks for own team
    const autoDriveResp = await routes.postAutoDrive(sessionId);
    const autoDriveBody = (await autoDriveResp.json()) as { stopReason: string };
    expect(autoDriveBody.stopReason).toBe("human_input");
  });

  test("4. Viewing Pos 2 uses Mid player's pool; viewing Pos 5 uses Hard Support player's pool", async () => {
    const { routes, sessionId } = await createParty5Harness();
    await routes.postResolveBans(jsonRequest({ playerBanPreferences: [] }), sessionId);

    // Request V4 decision for Pos 2
    const urlPos2 = new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=v4&target=2`);
    const respPos2 = await routes.getRecommendations(sessionId, urlPos2);
    expect(respPos2.status).toBe(200);
    const bodyPos2 = (await respPos2.json()) as CurrentDecisionRecomputation;
    expect(bodyPos2.output.decision.kind).toBe("ACTIONABLE");
    if (bodyPos2.output.decision.kind !== "ACTIONABLE") throw new Error("Expected ACTIONABLE");
    if (bodyPos2.output.decision.candidates?.state !== "RANKED") throw new Error("Expected RANKED candidates");
    expect(bodyPos2.output.decision.candidates.targetPosition).toBe(2);
    expect(bodyPos2.output.decision.personalPoolApplied).toBe(true);

    const cardsPos2: HeroCard[] = bodyPos2.output.decision.candidates.cards;
    for (const card of cardsPos2) {
      if (POS2_POOL.includes(card.heroId)) {
        expect(card.isFromPool).toBe(true);
      } else {
        expect(card.isFromPool).toBe(false);
      }
    }

    // Request V4 decision for Pos 5
    const urlPos5 = new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=v4&target=5`);
    const respPos5 = await routes.getRecommendations(sessionId, urlPos5);
    expect(respPos5.status).toBe(200);
    const bodyPos5 = (await respPos5.json()) as CurrentDecisionRecomputation;
    expect(bodyPos5.output.decision.kind).toBe("ACTIONABLE");
    if (bodyPos5.output.decision.kind !== "ACTIONABLE") throw new Error("Expected ACTIONABLE");
    if (bodyPos5.output.decision.candidates?.state !== "RANKED") throw new Error("Expected RANKED candidates");
    expect(bodyPos5.output.decision.candidates.targetPosition).toBe(5);
    expect(bodyPos5.output.decision.personalPoolApplied).toBe(true);

    const cardsPos5: HeroCard[] = bodyPos5.output.decision.candidates.cards;
    for (const card of cardsPos5) {
      if (POS5_POOL.includes(card.heroId)) {
        expect(card.isFromPool).toBe(true);
      } else {
        expect(card.isFromPool).toBe(false);
      }
    }
  });

  test("5. A banned pool hero cannot appear as an active candidate", async () => {
    const { routes, sessionId } = await createParty5Harness();
    // Ban hero 11 (which is in Pos 2 pool)
    const store = (routes as unknown as { deps: { store: ProtocolSessionStore } }).deps?.store;
    // Apply ban preferences ensuring hero 11 is banned (all 4 slots filled guarantees top preference)
    const resolveResp = await routes.postResolveBans(jsonRequest({ playerBanPreferences: [11, 12, 13, 14] }), sessionId);
    expect(resolveResp.status).toBe(200);
    const resolveBody = (await resolveResp.json()) as { resolvedBans: number[] };
    expect(resolveBody.resolvedBans.includes(11)).toBe(true);

    const urlPos2 = new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=v4&target=2`);
    const resp = await routes.getRecommendations(sessionId, urlPos2);
    const body = (await resp.json()) as CurrentDecisionRecomputation;
    expect(body.output.decision.kind).toBe("ACTIONABLE");
    if (body.output.decision.kind !== "ACTIONABLE") throw new Error("Expected ACTIONABLE");
    if (body.output.decision.candidates?.state !== "RANKED") throw new Error("Expected RANKED candidates");
    const cards: HeroCard[] = body.output.decision.candidates.cards;
    expect(cards.some((c: HeroCard) => c.heroId === 11)).toBe(false);
  });

  test("6. An out-of-pool hero can still rank if credible, with isFromPool=false and personalPoolApplied=true", async () => {
    const { routes, sessionId } = await createParty5Harness();
    await routes.postResolveBans(jsonRequest({ playerBanPreferences: [] }), sessionId);

    // Hero 60 is credible at Pos 1, but NOT in POS1_POOL [1, 2, 3, 4, 5]
    const urlPos1 = new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=v4&target=1`);
    const resp = await routes.getRecommendations(sessionId, urlPos1);
    const body = (await resp.json()) as CurrentDecisionRecomputation;
    expect(body.output.decision.kind).toBe("ACTIONABLE");
    if (body.output.decision.kind !== "ACTIONABLE") throw new Error("Expected ACTIONABLE");
    if (body.output.decision.candidates?.state !== "RANKED") throw new Error("Expected RANKED candidates");
    const cards: HeroCard[] = body.output.decision.candidates.cards;

    const card60 = cards.find((c: HeroCard) => c.heroId === 60);
    expect(card60).toBeDefined();
    expect(card60?.isFromPool).toBe(false);
    expect(body.output.decision.personalPoolApplied).toBe(true);
  });
});
