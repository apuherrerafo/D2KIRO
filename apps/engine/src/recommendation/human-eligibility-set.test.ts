import { describe, expect, test } from "bun:test";
import type { HeroId } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { HeroPositions } from "../signals/hero-positions";
import type { SuggestionSet } from "../signals/mix";
import { buildRecommendationSetV2 } from "./build";
import { buildRecommendationSetFromPerspective } from "./build-from-perspective";
import { buildCompoundRecommendations, buildSingleRecommendations, type ConstructContext } from "./construct";
import type { ShortlistEntry } from "./shortlist";
import type { Recommendation, RecommendationSlot } from "./types";
import { fakeCompute, harness } from "../coach/session-harness.fixtures";

// Human position eligibility is a SET (PD-001: POSITION != PICK ORDER != ROUND SLOT != CONTROLLER).
// K recommended heroes must admit an injective assignment onto K DISTINCT members of
// HumanActionability.eligiblePositions -- whether or not the whole set fits the round. It is an
// admission test only: no slot ever gains a position, and the verdict never depends on slot or hero order.

const POS1_A = 21;
const POS5_A = 22;
const POS3_A = 23;
const POS2_ONLY = 24;
const POS4_ONLY = 25;
const FLEX_1_3 = 26;
const POS1_B = 27;
const POS3_B = 28;
const FLEX_1_2 = 29;

const POSITIONS: HeroPositions = {
  [POS1_A]: [{ position: 1, matches: 1000 }],
  [POS5_A]: [{ position: 5, matches: 1000 }],
  [POS3_A]: [{ position: 3, matches: 1000 }],
  [POS2_ONLY]: [{ position: 2, matches: 1000 }],
  [POS4_ONLY]: [{ position: 4, matches: 1000 }],
  [FLEX_1_3]: [{ position: 1, matches: 500 }, { position: 3, matches: 500 }],
  [POS1_B]: [{ position: 1, matches: 1000 }],
  [POS3_B]: [{ position: 3, matches: 1000 }],
  [FLEX_1_2]: [{ position: 1, matches: 500 }, { position: 2, matches: 500 }],
};

const SET_ORDER: readonly (readonly Position[])[] = [[1, 3, 5], [5, 1, 3], [3, 5, 1]];

function entry(hero: HeroId, score: number): ShortlistEntry {
  return {
    hero,
    suggestion: {
      hero,
      rank: 1,
      score,
      confidence: "alta",
      signals: [{ signal: "counter", raw: 0.5, normalized: 0.5, weighted: score, explanation: "test", sampleSize: 100, applicable: true }],
      reason: "test",
      evidenceCoverage: 1,
      guessingIndex: 0,
    },
  } as ShortlistEntry;
}

const SUGGESTION_SET = { schema: "suggestions/v1", sessionId: "s", basedOnSeq: 0, suggestions: [], comparison: null, degraded: [], computedInMs: 1, decisionContext: "team_opening" } as unknown as SuggestionSet;

const POSITIONLESS_SLOTS: RecommendationSlot[] = [
  { side: "radiant", slotIndex: 0 },
  { side: "radiant", slotIndex: 1 },
];

function context(eligible: readonly Position[] | undefined): ConstructContext {
  return { isLegal: () => true, contextEvidence: [], ...(eligible ? { eligibleHumanPositions: eligible } : {}) };
}

/** Heroes proposed together, scored in the order given (first = highest). */
function pairs(eligible: readonly Position[] | undefined, heroes: readonly HeroId[], slots: readonly RecommendationSlot[] = POSITIONLESS_SLOTS): Recommendation[] {
  const shortlist = heroes.map((hero, index) => entry(hero, 90 - index));
  return buildCompoundRecommendations(context(eligible), shortlist, [], POSITIONS, undefined, slots, false, [], 10);
}

function singles(eligible: readonly Position[] | undefined, heroes: readonly HeroId[]): HeroId[] {
  const shortlist = heroes.map((hero, index) => entry(hero, 90 - index));
  return buildSingleRecommendations(context(eligible), shortlist, [], POSITIONS, undefined, POSITIONLESS_SLOTS[0]!, false, SUGGESTION_SET, [], 10)
    .map((recommendation) => recommendation.actions[0]!.hero);
}

function pairKey(recommendation: Recommendation): string {
  return recommendation.actions.map((action) => action.hero).sort((a, b) => a - b).join("+");
}

/** Canonical pair key: heroes sorted numerically, so expectations never depend on hero order. */
function key(...heroes: HeroId[]): string {
  return [...heroes].sort((a, b) => a - b).join("+");
}

function pairKeys(eligible: readonly Position[] | undefined, heroes: readonly HeroId[]): string[] {
  return pairs(eligible, heroes).map(pairKey);
}

describe("compound admission: injective assignment onto DISTINCT eligible positions (eligible [1,3,5], capacity 2)", () => {
  test("GREPTILE EXACT CASE: a Pos2-only + Pos4-only pair serves NO eligible position -> absent", () => {
    for (const eligible of SET_ORDER) {
      expect(pairKeys(eligible, [POS2_ONLY, POS4_ONLY])).toEqual([]);
    }
  });

  test("Pos1-only + Pos5-only -> accepted (any hero order)", () => {
    for (const eligible of SET_ORDER) {
      expect(pairKeys(eligible, [POS1_A, POS5_A])).toEqual([key(POS1_A, POS5_A)]);
      expect(pairKeys(eligible, [POS5_A, POS1_A])).toEqual([key(POS1_A, POS5_A)]);
    }
  });

  test("one hero serves an eligible position, the other serves none -> rejected", () => {
    expect(pairKeys([1, 3, 5], [POS1_A, POS2_ONLY])).toEqual([]);
    expect(pairKeys([1, 3, 5], [POS4_ONLY, POS5_A])).toEqual([]);
  });

  test("flex Pos1/3 + Pos3-only -> accepted through the distinct assignment flex->1, Pos3->3", () => {
    expect(pairKeys([1, 3, 5], [FLEX_1_3, POS3_A])).toEqual([key(FLEX_1_3, POS3_A)]);
    expect(pairKeys([1, 3, 5], [POS3_A, FLEX_1_3])).toEqual([key(FLEX_1_3, POS3_A)]);
  });

  test("Pos3-only + Pos3-only -> rejected (both would need the same position)", () => {
    expect(pairKeys([1, 3, 5], [POS3_A, POS3_B])).toEqual([]);
  });

  test("Pos1-only + Pos1-only -> rejected even though Pos1 is eligible", () => {
    expect(pairKeys([1, 3, 5], [POS1_A, POS1_B])).toEqual([]);
  });

  test("distinctness is about positions, not the hero: flex Pos1/3 + Pos1-only is accepted (flex->3), flex + flex-over-the-same-two fits too", () => {
    expect(pairKeys([1, 3, 5], [FLEX_1_3, POS1_A])).toEqual([key(POS1_A, FLEX_1_3)]);
  });

  test("a hero's only eligible position being taken by the other hero rejects the pair (Pos1-only + flex Pos1/2 with eligible [1,3,5]: flex has only Pos1 here)", () => {
    expect(pairKeys([1, 3, 5], [POS1_A, FLEX_1_2])).toEqual([]);
  });

  test("METAMORPHIC: the order of eligiblePositions never changes admission or the output", () => {
    const heroes = [POS2_ONLY, FLEX_1_3, POS4_ONLY, POS3_A, POS1_A, POS5_A];
    const baseline = pairs([1, 3, 5], heroes).map((recommendation) => ({ key: pairKey(recommendation), score: recommendation.score }));
    expect(baseline.length).toBeGreaterThan(0);
    for (const eligible of SET_ORDER) {
      expect(pairs(eligible, heroes).map((recommendation) => ({ key: pairKey(recommendation), score: recommendation.score }))).toEqual(baseline);
    }
  });

  test("METAMORPHIC: swapping the (positionless) slot order never changes positional admission, and no output slot gains a position", () => {
    const heroes = [POS2_ONLY, POS4_ONLY, FLEX_1_3, POS3_A, POS1_A, POS5_A];
    const forward = pairs([1, 3, 5], heroes, POSITIONLESS_SLOTS);
    const reversed = pairs([1, 3, 5], heroes, [POSITIONLESS_SLOTS[1]!, POSITIONLESS_SLOTS[0]!]);
    expect(forward.map(pairKey).sort()).toEqual(reversed.map(pairKey).sort());
    for (const recommendation of [...forward, ...reversed]) {
      for (const action of recommendation.actions) expect("position" in action.slot).toBe(false);
    }
  });

  test("the whole-set-fits case (eligible [2,5], capacity 2) still needs the pair to cover {2,5} in either order", () => {
    expect(pairKeys([2, 5], [POS5_A, POS2_ONLY])).toEqual([key(POS2_ONLY, POS5_A)]);
    expect(pairKeys([2, 5], [POS2_ONLY, POS5_A])).toEqual([key(POS2_ONLY, POS5_A)]);
    expect(pairKeys([2, 5], [POS2_ONLY, POS4_ONLY])).toEqual([]);
    expect(pairKeys([2, 5], [POS5_A, POS1_A])).toEqual([]);
  });
});

describe("compound admission -- Party5 (eligible [1,2,3,4,5], capacity 2): the constraint is NOT dropped", () => {
  const PARTY5: readonly Position[] = [1, 2, 3, 4, 5];

  test("Pos1-only + Pos1-only -> rejected as a pair", () => {
    expect(pairKeys(PARTY5, [POS1_A, POS1_B])).toEqual([]);
  });

  test("Pos1 + Pos4 -> accepted", () => {
    expect(pairKeys(PARTY5, [POS1_A, POS4_ONLY])).toEqual([key(POS1_A, POS4_ONLY)]);
  });

  test("flex Pos1/2 + Pos2-only -> accepted via 1 + 2", () => {
    expect(pairKeys(PARTY5, [FLEX_1_2, POS2_ONLY])).toEqual([key(FLEX_1_2, POS2_ONLY)]);
  });
});

describe("single admission: credible for ANY eligible position", () => {
  test("eligible [1,3,5]: Pos5 hero accepted, Pos3 hero accepted, Pos2-only rejected, Pos4-only rejected", () => {
    for (const eligible of SET_ORDER) {
      expect(singles(eligible, [POS2_ONLY, POS4_ONLY, POS5_A, POS3_A])).toEqual([POS5_A, POS3_A]);
    }
  });

  test("eligible [1,3,5]: a flex Pos1/3 hero and a Pos1-only hero are both accepted", () => {
    expect(singles([1, 3, 5], [FLEX_1_3, POS1_A])).toEqual([FLEX_1_3, POS1_A]);
  });

  test("Solo Pos2 (eligible [2], capacity 1): carry-only rejected, credible Pos2 accepted", () => {
    expect(singles([2], [POS1_A, POS2_ONLY])).toEqual([POS2_ONLY]);
  });

  test("Party5 single step (eligible [1..5], capacity 1) keeps the constraint: a hero credible for no position is rejected", () => {
    const NOBODY = 99; // no curated positions at all
    const shortlist = [entry(NOBODY, 95), entry(POS4_ONLY, 90)];
    const out = buildSingleRecommendations(context([1, 2, 3, 4, 5]), shortlist, [], POSITIONS, undefined, POSITIONLESS_SLOTS[0]!, false, SUGGESTION_SET, [], 10);
    expect(out.map((recommendation) => recommendation.actions[0]!.hero)).toEqual([POS4_ONLY]);
  });

  test("no human action (no eligible set supplied) -> no positional filter, as before", () => {
    expect(singles(undefined, [POS2_ONLY, POS4_ONLY])).toEqual([POS2_ONLY, POS4_ONLY]);
  });
});

describe("explicit / synthetic slot positions keep their explicit semantics", () => {
  test("a slot with an explicit position is checked against THAT position, not the eligible set", () => {
    const explicit: RecommendationSlot = { side: "radiant", slotIndex: 0, position: 2 };
    const shortlist = [entry(POS2_ONLY, 90), entry(POS1_A, 80)];
    const out = buildSingleRecommendations(context([1, 3, 5]), shortlist, [], POSITIONS, undefined, explicit, false, SUGGESTION_SET, [], 10);
    expect(out.map((recommendation) => recommendation.actions[0]!.hero)).toEqual([POS2_ONLY]);
    expect(out[0]!.actions[0]!.slot.position).toBe(2);
  });

  test("explicit compound columns (Pos5 + Pos4) are unchanged by an unrelated eligible set", () => {
    const slots: RecommendationSlot[] = [{ side: "radiant", slotIndex: 0, position: 5 }, { side: "radiant", slotIndex: 1, position: 4 }];
    expect(pairKeys([1, 3, 5], [POS4_ONLY, POS5_A]).length).toBe(0);
    expect(pairs([1, 3, 5], [POS4_ONLY, POS5_A], slots).map(pairKey)).toEqual([key(POS5_A, POS4_ONLY)]);
  });
});

// ---- End to end through the REAL builders (V3 perspective + V2 authoritative), real store ----------------

type Built = { v3: readonly Recommendation[]; v2: readonly Recommendation[] };

async function build(controlledPositions: Position[], pool: readonly number[]): Promise<Built> {
  const id = `elig-${controlledPositions.join("")}-${pool.join("-")}`;
  const h = harness({ sessionId: id, adapterKind: "simulator", controlledPositions, heroPositions: POSITIONS, pool });
  const v3 = await buildRecommendationSetFromPerspective({
    context: h.store.perspectiveRecommendationContext(id)!,
    computeSuggestions: fakeCompute(pool, POSITIONS),
    heroPositions: POSITIONS,
  });
  const v2 = await buildRecommendationSetV2({
    state: h.store.get(id)!,
    view: h.store.view(id)!,
    actor: h.side,
    patch: "7.41e",
    computeSuggestions: fakeCompute(pool, POSITIONS),
    heroPositions: POSITIONS,
    isSimulator: true,
    controlledPositions: h.store.metadata(id)!.controlledPositions ?? undefined,
    humanOpenPositions: h.store.humanOpenPositions(id) ?? undefined,
  });
  return { v3: v3.recommendations, v2: v2.recommendations };
}

function heroesOf(recommendations: readonly Recommendation[]): Set<HeroId> {
  return new Set(recommendations.flatMap((recommendation) => recommendation.actions.map((action) => action.hero)));
}

describe("V2 and V3 end to end (real session store, positionless round slots)", () => {
  test("GREPTILE: eligible [1,3,5], capacity 2 -- the top-scored Pos2+Pos4 pair is absent from V2 AND V3; the Pos1+Pos5 pair is recommended", async () => {
    // fakeCompute scores by pool order, so Pos2-only/Pos4-only would be the best pair if admitted.
    const { v2, v3 } = await build([1, 3, 5], [POS2_ONLY, POS4_ONLY, POS1_A, POS5_A]);
    for (const recommendations of [v2, v3]) {
      expect(recommendations.length).toBeGreaterThan(0);
      for (const recommendation of recommendations) {
        expect(recommendation.actions).toHaveLength(2);
        for (const action of recommendation.actions) {
          expect([POS1_A, POS5_A]).toContain(action.hero);
          expect("position" in action.slot).toBe(false);
        }
      }
      expect(heroesOf(recommendations).has(POS2_ONLY)).toBe(false);
      expect(heroesOf(recommendations).has(POS4_ONLY)).toBe(false);
    }
  });

  test("eligible [1,3,5]: the V3 compound fallback single step also keeps only eligible-position heroes", async () => {
    // No pair of {Pos2-only, Pos4-only, Pos1-only} is admissible except none: only one hero serves an eligible position.
    const { v3 } = await build([1, 3, 5], [POS2_ONLY, POS4_ONLY, POS1_A]);
    for (const recommendation of v3) for (const action of recommendation.actions) expect(action.hero).toBe(POS1_A);
  });

  test("Party5 (eligible 1..5, capacity 2): a Pos1+Pos1 pair is never recommended; positions are never on slots", async () => {
    const { v2, v3 } = await build([1, 2, 3, 4, 5], [POS1_A, POS1_B, POS4_ONLY]);
    for (const recommendations of [v2, v3]) {
      expect(recommendations.length).toBeGreaterThan(0);
      for (const recommendation of recommendations) {
        const heroes = recommendation.actions.map((action) => action.hero);
        if (heroes.length === 2) expect(heroes.includes(POS1_A) && heroes.includes(POS1_B)).toBe(false);
        for (const action of recommendation.actions) expect("position" in action.slot).toBe(false);
      }
    }
  });

  test("Solo Pos2 probe (eligible [2], capacity 1): carry-only is rejected, a credible Pos2 hero is accepted (V2 and V3)", async () => {
    const { v2, v3 } = await build([2], [POS1_A, POS2_ONLY]);
    for (const recommendations of [v2, v3]) {
      expect([...heroesOf(recommendations)]).toEqual([POS2_ONLY]);
    }
  });

  test("Party2 Pos2+Pos5 (eligible [2,5], capacity 2): the pair must fit {2,5} in either pool order", async () => {
    for (const pool of [[POS5_A, POS2_ONLY, POS4_ONLY, POS1_A], [POS1_A, POS4_ONLY, POS2_ONLY, POS5_A]]) {
      const { v2, v3 } = await build([2, 5], pool);
      for (const recommendations of [v2, v3]) {
        expect(recommendations.length).toBeGreaterThan(0);
        for (const recommendation of recommendations) {
          if (recommendation.actions.length === 2) expect(recommendation.actions.map((action) => action.hero).sort((a, b) => a - b)).toEqual([POS5_A, POS2_ONLY].sort((a, b) => a - b));
        }
      }
    }
  });
});
