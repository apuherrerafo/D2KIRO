import { describe, expect, test } from "bun:test";
import type { HeroCapabilities } from "../../apps/engine/src/draft-paths/types";
import type { CuratedCounter } from "../../apps/engine/src/signals/hero-counters";
import type { HeroPositions } from "../../apps/engine/src/signals/hero-positions";
import { availableHardCounters, hardCounteredBy, i1Illegal, i2Roles, i3Order, i6Gap, i7Damage, i9Counters, inMorePlayedHalf, jaccard, meanPairwiseJaccard, notCredibleShown, varianceShare, type ExamState, type ExamWorld } from "./checks";

// Inline fixtures only: no curated file, no SQLite (invariantes.md).
const positions: HeroPositions = {
  1: [{ position: 1, matches: 5000 }],
  2: [{ position: 2, matches: 4000 }],
  3: [{ position: 3, matches: 3000 }],
  4: [{ position: 4, matches: 2000 }, { position: 5, matches: 1000 }],
  5: [{ position: 5, matches: 500 }],
  6: [{ position: 1, matches: 100 }, { position: 4, matches: 2000 }], // listed at pos1 but not credible there (dominant is pos4, share ~5%)
};
const cap = (hero: number, over: Partial<HeroCapabilities> = {}): HeroCapabilities => ({ hero, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "low", ...over });
const counters = new Map<number, readonly CuratedCounter[]>([
  [1, [{ vs: 9, level: "hard", why: "x" }, { vs: 8, level: "medium", why: "y" }]],
]);
const world: ExamWorld = {
  legalHeroIds: new Set([1, 2, 3, 4, 5, 6, 8, 9]),
  positions,
  counters,
  capabilities: new Map([[1, cap(1)], [2, cap(2)], [3, cap(3, { hasInitiation: true })], [4, cap(4, { damageType: "magical" })], [5, cap(5)], [6, cap(6, { hasCatch: true })]]),
};

function state(over: Partial<ExamState> = {}): ExamState {
  return { draftKey: "k", index: 0, round: 1, ownPicksRemaining: 2, banned: [], ownPicks: [], revealedEnemy: [], v3: [], v3PrimaryRationale: "", board: null, v4: null, lpp: null, positionFitShare: null, positionFitLevelShare: null, candidateCount: 0, ...over };
}

describe("I1 illegal", () => {
  test("a banned, own or revealed hero in any surface is a violation; a clean state is not", () => {
    expect(i1Illegal(state({ v3: [{ heroId: 2, rationale: "" }] }), world)).toEqual([]);
    expect(i1Illegal(state({ banned: [2], v3: [{ heroId: 2, rationale: "" }] }), world)).toHaveLength(1);
    const board = { recommendedPosition: 1 as const, targetBasis: null, columns: [{ position: 1 as const, state: "RANKED", eligibleNow: true, top: [{ heroId: 9, reason: "" }] }] };
    expect(i1Illegal(state({ revealedEnemy: [9], board }), world)).toHaveLength(1);
  });
  test("a hero outside the universe and a duplicate inside one list are violations", () => {
    expect(i1Illegal(state({ v3: [{ heroId: 77, rationale: "" }] }), world)).toHaveLength(1);
    expect(i1Illegal(state({ v3: [{ heroId: 2, rationale: "" }, { heroId: 2, rationale: "" }] }), world)).toHaveLength(1);
  });
});

describe("I2 roles", () => {
  const col = (position: 1 | 2 | 3 | 4 | 5, ids: number[]) => ({ position, state: "RANKED", eligibleNow: true, top: ids.map((heroId) => ({ heroId, reason: "" })) });
  test("a candidate with no evidence at its column is a violation", () => {
    expect(i2Roles(state({ board: { recommendedPosition: 1, targetBasis: null, columns: [col(1, [1]), col(2, [2])] } }), world)).toEqual([]);
    expect(i2Roles(state({ board: { recommendedPosition: 1, targetBasis: null, columns: [col(1, [2])] } }), world)).toHaveLength(1);
  });
  test("one hero as the primary of two positions is a violation (an unranked column is ignored)", () => {
    expect(i2Roles(state({ board: { recommendedPosition: 4, targetBasis: null, columns: [col(4, [4]), col(5, [4])] } }), world)).toHaveLength(1);
    expect(i2Roles(state({ board: { recommendedPosition: 1, targetBasis: null, columns: [{ ...col(1, [2]), state: "UNRANKED_POSITIONAL" }] } }), world)).toEqual([]);
  });
  test("admitted is not credible: pos1 evidence under 25% share and not dominant is only an observation", () => {
    const s = state({ board: { recommendedPosition: 1, targetBasis: null, columns: [col(1, [6])] } });
    expect(i2Roles(s, world)).toEqual([]);
    expect(notCredibleShown(s, world)).toHaveLength(1);
  });
});

describe("I3 position order", () => {
  const board = (recommendedPosition: 1 | 2 | 3 | 4 | 5, targetBasis: string, open: [number, string][] = []) => ({ recommendedPosition, targetBasis, columns: open.map(([p, st]) => ({ position: p as 1, state: st, eligibleNow: true, top: [] })) });
  test("target diverging from the declared precedence is a divergence; equal is not", () => {
    expect(i3Order(state({ board: board(1, "DETERMINISTIC_DEFAULT"), lpp: { position: 5, basis: "PHASE_FALLBACK", signal: "PHASE" } })).divergences).toHaveLength(1);
    expect(i3Order(state({ board: board(5, "DETERMINISTIC_DEFAULT"), lpp: { position: 5, basis: "PHASE_FALLBACK", signal: "PHASE" } })).divergences).toEqual([]);
  });
  test("round-1 opening on Pos 1/2 is flagged unless a COUNTER_WINDOW or POOL_SCARCITY backs it", () => {
    const base = { board: board(1, "DETERMINISTIC_DEFAULT") };
    expect(i3Order(state({ ...base, lpp: { position: 5, basis: "PHASE_FALLBACK", signal: "PHASE" } })).coreFirstWithoutWindow).toBe(true);
    expect(i3Order(state({ ...base, lpp: { position: 1, basis: "STRATEGIC", signal: "POOL_SCARCITY" } })).coreFirstWithoutWindow).toBe(false);
    expect(i3Order(state({ board: board(5, "DETERMINISTIC_DEFAULT") })).coreFirstWithoutWindow).toBe(false);
    expect(i3Order(state({ round: 2, ownPicks: [1, 2], board: board(1, "DETERMINISTIC_DEFAULT") })).coreFirstWithoutWindow).toBeNull();
  });
  test("an open column that is not ranked is reported; PHASE shown as STRATEGIC is flagged", () => {
    expect(i3Order(state({ board: board(5, "DETERMINISTIC_DEFAULT", [[5, "RANKED"], [4, "UNAVAILABLE"]]) })).unrankedOpenColumns).toHaveLength(1);
    expect(i3Order(state({ board: board(5, "STRATEGIC"), lpp: { position: 5, basis: "PHASE_FALLBACK", signal: "PHASE" } })).phasePresentedAsStrategic).toBe(true);
  });
});

describe("I6 gap / I7 damage", () => {
  const late = { ownPicksRemaining: 1, ownPicks: [1, 2, 4, 5] };
  test("gap applies only with >=3 own picks, <=2 left and no initiator/catcher among them", () => {
    expect(i6Gap(state({ ...late, ownPicks: [1, 2, 3, 5] }), world).applies).toBe(false); // hero 3 initiates
    expect(i6Gap(state({ ...late, round: 3, ownPicksRemaining: 3 }), world).applies).toBe(false);
    expect(i6Gap(state(late), world).applies).toBe(true);
  });
  test("top-3 fills vs a filler existing elsewhere vs the gap being visible on a card", () => {
    const hidden = i6Gap(state({ ...late, v3: [{ heroId: 5, rationale: "x" }], board: { recommendedPosition: 1, targetBasis: null, columns: [{ position: 3, state: "RANKED", eligibleNow: true, top: [{ heroId: 3, reason: "x" }] }] } }), world);
    expect(hidden).toMatchObject({ top3Fills: false, credibleFillerExists: true, gapNotVisible: true });
    const visible = i6Gap(state({ ...late, v3: [{ heroId: 3, rationale: "Aporta initiation que a tu equipo le falta" }] }), world);
    expect(visible).toMatchObject({ top3Fills: true, gapNotVisible: false });
  });
  test("damage: 4 physical picks need another damage type in the top-3", () => {
    const picks = { ownPicks: [1, 2, 3, 5], ownPicksRemaining: 1 };
    expect(i7Damage(state({ ...picks, v3: [{ heroId: 1, rationale: "" }] }), world)).toEqual({ applies: true, top3Diversifies: false });
    expect(i7Damage(state({ ...picks, v3: [{ heroId: 4, rationale: "" }] }), world)).toEqual({ applies: true, top3Diversifies: true });
    expect(i7Damage(state({ ownPicks: [1, 2, 3, 4], ownPicksRemaining: 1 }), world).applies).toBe(false); // hero 4 is magical
  });
});

describe("I9 hard counters, I8 exposure, I10 popularity", () => {
  test("a hard counter of a revealed enemy inside a top-3 is reported with whether the risk is stated; medium is ignored", () => {
    expect(hardCounteredBy(1, [9], counters)).toEqual([9]);
    expect(hardCounteredBy(1, [8], counters)).toEqual([]);
    const silent = i9Counters(state({ revealedEnemy: [9], v3: [{ heroId: 1, rationale: "Buen encaje" }] }), world);
    expect(silent.shown).toEqual([{ where: "k#0 v3", heroId: 1, by: [9], riskVisible: false }]);
    const stated = i9Counters(state({ revealedEnemy: [9], v3: [{ heroId: 1, rationale: "Riesgo: lo countera un rival revelado" }] }), world);
    expect(stated.shown[0]!.riskVisible).toBe(true);
    expect(i9Counters(state({ revealedEnemy: [8], v3: [{ heroId: 1, rationale: "" }] }), world).shown).toEqual([]);
  });
  test("exposure counts only hard counters still available", () => {
    expect(availableHardCounters(1, state(), world)).toBe(1);
    expect(availableHardCounters(1, state({ banned: [9] }), world)).toBe(0);
  });
  test("more-played half is computed per position from the evidence rows", () => {
    // pos1 rows: hero1=5000, hero6=100 -> the more-played half is 1 hero
    expect(inMorePlayedHalf(1, 1, positions)).toBe(true);
    expect(inMorePlayedHalf(6, 1, positions)).toBe(false);
    expect(inMorePlayedHalf(2, 1, positions)).toBeNull();
  });
});

describe("I4 / I5 statistics", () => {
  test("jaccard by hand: {1,2,3} vs {2,3,4} = 2/4", () => {
    expect(jaccard([1, 2, 3], [2, 3, 4])).toBe(0.5);
    expect(jaccard([], [])).toBe(1);
  });
  test("mean pairwise jaccard of three lists, computed by hand", () => {
    // pairs: (A,B) = 0.5, (A,C) = 0, (B,C) = 0 -> mean = 0.5 / 3
    expect(meanPairwiseJaccard([[1, 2, 3], [2, 3, 4], [7, 8, 9]])).toBeCloseTo(0.5 / 3, 10);
    expect(meanPairwiseJaccard([[1]])).toBeNull();
  });
  test("variance share: a part that IS the total explains 1; a constant part explains 0; shares of a decomposition add up to 1", () => {
    const a = [1, 2, 3, 4];
    const b = [4, 1, 3, 2];
    const total = a.map((x, i) => x + b[i]!);
    expect(varianceShare(total, total)).toBeCloseTo(1, 10);
    expect(varianceShare([5, 5, 5, 5], total)).toBeCloseTo(0, 10);
    expect(varianceShare(a, total)! + varianceShare(b, total)!).toBeCloseTo(1, 10);
    expect(varianceShare([1, 2], [3, 3])).toBeNull();
  });
});
