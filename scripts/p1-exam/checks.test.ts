import { describe, expect, test } from "bun:test";
import type { HeroCapabilities } from "../../apps/engine/src/draft-paths/types";
import type { CuratedCounter } from "../../apps/engine/src/signals/hero-counters";
import type { HeroPositions } from "../../apps/engine/src/signals/hero-positions";
import { availableHardCounters, criticalGapOnCards, criticalWithheldByUncuratedPick, i11Basis, examNeeds, fieldStats, fillsCritical, i6bInitiation, needsChange, pairedChange, revealedCounterProfile, tiedAtCut, topThree, hardCounteredBy, i1Illegal, i2Roles, i3Order, i6Gap, i7Damage, i9Counters, inMorePlayedHalf, jaccard, meanPairwiseJaccard, notCredibleShown, varianceShare, type ExamState, type ExamV4Card, type ExamWorld, type FieldCandidate } from "./checks";

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
  return { draftKey: "k", index: 0, round: 1, ownPicksRemaining: 2, banned: [], ownPicks: [], revealedEnemy: [], v3: [], v3PrimaryRationale: "", board: null, v4: null, lpp: null, positionFitShare: null, positionFitLevelShare: null, positionFitSaturated: null, positionFitField: null, positionFitPaired: null, teamNeedsPaired: null, candidateCount: 0, ...over };
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
  test("v4 cards belong to the VIEWED position, not the suggested target (the Player opens on their own position)", () => {
    const v4 = (heroId: number) => ({ kind: "own", targetPosition: 5 as const, viewedPosition: 1 as const, targetBasis: null, state: "RANKED", cards: [{ heroId, rationale: "", basis: null, risks: [] }] });
    expect(i2Roles(state({ v4: v4(1) }), world)).toEqual([]);
    expect(i2Roles(state({ v4: v4(2) }), world)).toHaveLength(1);
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
  test("an own pick without curated capabilities means the gap is not established (unknown is not lacking)", () => {
    expect(i6Gap(state({ ownPicksRemaining: 1, ownPicks: [1, 2, 777, 5] }), world).applies).toBe(false);
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

describe("fieldStats (I5 over the whole credible field)", () => {
  // 8 credible heroes; hero n has n*1000 matches at the position. Matches decide the "more played half" = heroes 5..8.
  const candidate = (heroId: number, score: number, positionFit: number): FieldCandidate => ({ heroId, score, positionFit, matches: heroId * 1000 });

  test("a column thinner than the cut of 6 says nothing", () => {
    expect(fieldStats([candidate(1, 50, 10), candidate(2, 40, 10)])).toBeNull();
  });

  test("popularity-driven field: position_fit IS the order, so removing it reshuffles the top and the top is all more-played", () => {
    // score = position_fit + 30 for everyone ("the rest" is flat), position_fit grows with matches
    const field = [1, 2, 3, 4, 5, 6, 7, 8].map((hero) => candidate(hero, 30 + hero * 5, hero * 5));
    const stats = fieldStats(field)!;
    expect(stats.fieldSize).toBe(8);
    expect(stats.top3MorePlayed).toBe(1); // 8,7,6 are all in the more-played half
    expect(stats.top6MorePlayed).toBeCloseTo(4 / 6, 10); // 8,7,6,5 yes; 4,3 no
    expect(stats.orderShareField).toBeCloseTo(1, 10);
    // the rest is flat -> ties break by hero id ascending: top3 of "rest" = {1,2,3}, disjoint from {8,7,6}
    expect(stats.top3WithoutPositionFit).toBe(0);
  });

  test("draft-driven field: position_fit is a constant, so it decides nothing", () => {
    // everyone has position_fit 20; the rest varies and is UNcorrelated with popularity (hero 1 best)
    const rest: Record<number, number> = { 1: 50, 2: 45, 3: 40, 4: 35, 5: 30, 6: 25, 7: 20, 8: 15 };
    const field = [1, 2, 3, 4, 5, 6, 7, 8].map((hero) => candidate(hero, 20 + rest[hero]!, 20));
    const stats = fieldStats(field)!;
    expect(stats.orderShareField).toBeCloseTo(0, 10);
    expect(stats.top3WithoutPositionFit).toBe(1);
    expect(stats.top6WithoutPositionFit).toBe(1);
    expect(stats.top3MorePlayed).toBeCloseTo(0, 10); // top = heroes 1,2,3, all in the LESS played half
  });
});

describe("pairedChange (same state, old rule vs new rule)", () => {
  const candidate = (heroId: number, score: number): FieldCandidate => ({ heroId, score, positionFit: 0, matches: heroId * 1000 });
  const ids = [1, 2, 3, 4, 5, 6, 7];

  test("identical rankings: nothing changed", () => {
    const field = ids.map((id) => candidate(id, id * 10));
    const change = pairedChange(field, field)!;
    expect(change.top3Same).toBe(true);
    expect(change.jaccard3).toBe(1);
    expect(change.entered3).toEqual([]);
  });

  test("a less played hero overtakes the most played one: it enters the top-3 and the mean volume of the top-3 drops", () => {
    const oldField = ids.map((id) => candidate(id, id * 10)); // top-3 = 7,6,5
    const newField = ids.map((id) => candidate(id, id === 2 ? 100 : id * 10)); // hero 2 jumps to #1
    const change = pairedChange(oldField, newField)!;
    expect(change.top3Same).toBe(false);
    expect(change.entered3).toEqual([2]);
    expect(change.left3).toEqual([5]);
    expect(change.jaccard3).toBe(0.5); // {7,6,5} vs {2,7,6}: 2 shared / 4
    expect(change.meanMatchesTop3Old).toBe(6000);
    expect(change.meanMatchesTop3New).toBeCloseTo(5000, 10); // (2000 + 7000 + 6000) / 3
  });

  test("a column too thin to have a cut at 6 is not compared", () => {
    expect(pairedChange(ids.slice(0, 4).map((id) => candidate(id, id)), ids.map((id) => candidate(id, id)))).toBeNull();
  });
});

describe("fieldStats -- inside the more-played half", () => {
  const candidate = (heroId: number, score: number, positionFit: number): FieldCandidate => ({ heroId, score, positionFit, matches: heroId * 1000 });

  test("popular half tied on position_fit: volume explains nothing there even if it explains the whole field", () => {
    // heroes 5..8 are the more-played half: all at position_fit 20; heroes 1..4 are below it with growing position_fit
    const low = [1, 2, 3, 4].map((id) => candidate(id, 10 + id * 5, id * 5));
    const high = [5, 6, 7, 8].map((id) => candidate(id, 20 + (id % 3) * 7, 20));
    const stats = fieldStats([...low, ...high])!;
    expect(stats.orderShareMorePlayedHalf).toBeCloseTo(0, 10);
    expect(stats.orderShareField!).toBeGreaterThan(0.5);
  });
});

describe("revealedCounterProfile", () => {
  // curated layer is keyed by the VICTIM: 90 is hard-countered by 1; 91 is hard-countered by 2 (medium by 3); hero 4 is hard-countered by enemy 91
  const curated = new Map<number, readonly CuratedCounter[]>([
    [90, [{ vs: 1, level: "hard", why: "x" }]],
    [91, [{ vs: 2, level: "hard", why: "x" }, { vs: 3, level: "medium", why: "x" }]],
    [4, [{ vs: 91, level: "hard", why: "x" }]],
  ]);

  test("counts the heroes that hard-counter a revealed enemy, and those a revealed enemy hard-counters; medium never counts", () => {
    expect(revealedCounterProfile([1, 3, 5], [90, 91], curated)).toEqual({ counters: 1, exposed: 0 }); // 1 counters 90; 3 is only a medium counter of 91
    expect(revealedCounterProfile([2, 4, 5], [90, 91], curated)).toEqual({ counters: 1, exposed: 1 }); // 2 counters 91; 4 is countered BY 91
  });

  test("no revealed enemy: nothing to counter and nothing to be exposed to", () => {
    expect(revealedCounterProfile([1, 2, 4], [], curated)).toEqual({ counters: 0, exposed: 0 });
  });
});

describe("topThree", () => {
  test("highest score first, ties by hero id", () => {
    const field: FieldCandidate[] = [5, 3, 9, 1].map((heroId) => ({ heroId, score: heroId === 9 ? 50 : 40, positionFit: 0, matches: 0 }));
    expect(topThree(field)).toEqual([9, 1, 3]);
  });
});

describe("tiedAtCut", () => {
  const field = (scores: number[]): FieldCandidate[] => scores.map((score, i) => ({ heroId: i + 1, score, positionFit: 0, matches: 0 }));

  test("the 3rd and the 4th share a score: the cut is a tie", () => {
    expect(tiedAtCut(field([90, 80, 70, 70, 60]), 3)).toBe(true);
  });
  test("a gap at the cut is not a tie, even if heroes above it tie among themselves", () => {
    expect(tiedAtCut(field([80, 80, 80, 70, 60]), 3)).toBe(false);
  });
  test("nothing beyond the cut: not applicable", () => {
    expect(tiedAtCut(field([90, 80, 70]), 3)).toBeNull();
  });
});

// ---- T4 (TSK-253) ---------------------------------------------------------------------------------------------------------------
// World: hero 3 initiates; 1, 2, 5 do not; 4 is the only magical. Own team [2, 4, 6]: no initiator, a catcher (6), damage already mixed (hero 4): initiation is the only critical gap.
describe("T4 -- critical gaps in the exam", () => {
  const team = { ownPicks: [2, 4, 6], ownPicksRemaining: 2 };

  test("examNeeds reads the gap from the state: no initiator among the picks, 2 left -> initiation is critical", () => {
    expect(examNeeds(state(team), world).critical).toContain("initiation");
  });

  test("with 3 picks left it is open but not critical", () => {
    const needs = examNeeds(state({ ownPicks: [1, 2], ownPicksRemaining: 3 }), world);
    expect(needs.open).toContain("initiation");
    expect(needs.critical).toEqual([]);
  });

  test("fillsCritical: the initiator does, the rest do not, an uncurated hero fills nothing (and is not counted as lacking)", () => {
    const needs = examNeeds(state(team), world);
    expect(fillsCritical(3, needs, world)).toBe(true);
    expect(fillsCritical(5, needs, world)).toBe(false);
    expect(fillsCritical(777, needs, world)).toBe(false);
  });

  test("an uncurated own pick withholds the critical gap, and the exam says so", () => {
    expect(criticalWithheldByUncuratedPick(state({ ownPicks: [1, 2, 777], ownPicksRemaining: 2 }), world)).toBe(true);
    expect(criticalWithheldByUncuratedPick(state(team), world)).toBe(false);
  });

  const candidate = (heroId: number, score: number): FieldCandidate => ({ heroId, score, positionFit: 0, matches: heroId * 1000 });
  const ids = [1, 2, 3, 4, 5, 6, 8];

  test("needsChange: the initiator climbs into the top-3 and the swap's cost under the legacy score is reported", () => {
    const needs = examNeeds(state(team), world);
    const flat = ids.map((id) => candidate(id, id === 3 ? 10 : id * 10)); // top-3 under legacy: 8, 6, 5 -- no initiator
    const closing = ids.map((id) => candidate(id, id === 3 ? 90 : id * 10)); // hero 3 jumps to #1
    const change = needsChange(flat, closing, needs, world)!;
    expect(change.top3Same).toBe(false);
    expect(change.entered3).toEqual([3]);
    expect(change.left3).toEqual([5]);
    expect(change.top3FillersFlat).toBe(0);
    expect(change.top3FillersClosing).toBe(1);
    expect(change.fillerInField).toBe(true);
    expect(change.meanFlatScoreOfFlatTop3).toBeCloseTo((80 + 60 + 50) / 3, 10);
    expect(change.meanFlatScoreOfClosingTop3).toBeCloseTo((80 + 60 + 10) / 3, 10); // the cost: hero 3 is only worth 10 to the legacy score
  });

  test("needsChange: too thin a column (<6) says nothing", () => {
    const needs = examNeeds(state(team), world);
    expect(needsChange(ids.slice(0, 4).map((id) => candidate(id, id)), ids.map((id) => candidate(id, id)), needs, world)).toBeNull();
  });

  test("I6b: initiation alone is measured (the original I6 union with catch hides it)", () => {
    // Hero 6 has catch, nobody on the team initiates: I6 (initiation OR catch) does not apply when 6 is on the team; I6b does.
    const withCatcher = state({ ownPicks: [1, 2, 6], ownPicksRemaining: 2 });
    expect(i6Gap(withCatcher, world).applies).toBe(false);
    expect(i6bInitiation(withCatcher, world).applies).toBe(true);
  });

  test("I6b: top-3 fill is read from the recommended column; does not apply with an initiator, with 3+ left, or with an uncurated pick", () => {
    const column = (heroIds: number[]) => ({ recommendedPosition: 3 as const, targetBasis: null, columns: [{ position: 3 as const, state: "RANKED", eligibleNow: true, top: heroIds.map((heroId) => ({ heroId, reason: "x" })) }] });
    expect(i6bInitiation(state({ ...team, board: column([1, 2, 5]) }), world)).toMatchObject({ applies: true, top3Fills: false });
    expect(i6bInitiation(state({ ...team, board: column([3, 2, 5]) }), world)).toMatchObject({ applies: true, top3Fills: true });
    expect(i6bInitiation(state({ ownPicks: [1, 3, 5], ownPicksRemaining: 2 }), world).applies).toBe(false);
    expect(i6bInitiation(state({ ownPicks: [1, 2], ownPicksRemaining: 3 }), world).applies).toBe(false);
    expect(i6bInitiation(state({ ownPicks: [1, 2, 777], ownPicksRemaining: 2 }), world).applies).toBe(false);
  });
});

// ---- T5 (TSK-254): CRITICAL_GAP on the cards and I11 ---------------------------------------------------------------------------------
// World: hero 3 initiates; 1, 2, 5 do not; 4 is the only magical; 6 has catch. Own team [2, 4, 6]: initiation is the only critical gap.
describe("T5 -- CRITICAL_GAP on the V4 cards", () => {
  const team = { ownPicks: [2, 4, 6], ownPicksRemaining: 2 };
  const gapRisk = { kind: "CRITICAL_GAP", detail: "A tu equipo le falta iniciación", heroIds: [] as number[] };
  const v4With = (cards: { heroId: number; risks: typeof gapRisk[] }[]) => ({ kind: "own", targetPosition: 1 as const, viewedPosition: 1 as const, targetBasis: null, state: "RANKED", cards: cards.map((c) => ({ heroId: c.heroId, rationale: "", basis: null, risks: c.risks })) });

  test("demonstrable and shown: a curated non-initiator carries it, the initiator does not -> clean", () => {
    const result = criticalGapOnCards(state({ ...team, v4: v4With([{ heroId: 1, risks: [gapRisk] }, { heroId: 3, risks: [] }]) }), world);
    expect(result).toMatchObject({ shown: 1, shownWithoutProof: [], missingOnCard: [], cardsInCriticalStates: 2 });
  });

  test("HARD: demonstrable but missing on the card of a curated non-initiator", () => {
    const result = criticalGapOnCards(state({ ...team, v4: v4With([{ heroId: 1, risks: [] }]) }), world);
    expect(result.missingOnCard).toHaveLength(1);
  });

  test("HARD: shown on an initiator (it fills the gap)", () => {
    const result = criticalGapOnCards(state({ ...team, v4: v4With([{ heroId: 3, risks: [gapRisk] }]) }), world);
    expect(result.shownWithoutProof).toHaveLength(1);
  });

  test("HARD: shown on a hero with unknown capabilities (never presented as certainty)", () => {
    const result = criticalGapOnCards(state({ ...team, v4: v4With([{ heroId: 777, risks: [gapRisk] }]) }), world);
    expect(result.shownWithoutProof).toHaveLength(1);
    expect(criticalGapOnCards(state({ ...team, v4: v4With([{ heroId: 777, risks: [] }]) }), world)).toMatchObject({ shown: 0, shownWithoutProof: [], missingOnCard: [] });
  });

  test("HARD: shown when an own pick is uncurated (the gap may be false) or outside the closing window", () => {
    expect(criticalGapOnCards(state({ ownPicks: [2, 4, 777], ownPicksRemaining: 2, v4: v4With([{ heroId: 1, risks: [gapRisk] }]) }), world).shownWithoutProof).toHaveLength(1);
    expect(criticalGapOnCards(state({ ownPicks: [2, 4], ownPicksRemaining: 3, v4: v4With([{ heroId: 1, risks: [gapRisk] }]) }), world).shownWithoutProof).toHaveLength(1);
  });

  test("I6-visible reads the V4 risk text too: a late open initiation/catch gap is no longer invisible once a card says it", () => {
    const late = { ownPicksRemaining: 1, ownPicks: [1, 2, 4, 5] };
    const hidden = i6Gap(state({ ...late, v4: v4With([{ heroId: 1, risks: [] }]) }), world);
    const visible = i6Gap(state({ ...late, v4: v4With([{ heroId: 1, risks: [{ ...gapRisk, detail: "A tu equipo le falta iniciación y te queda 1 pick" }] }]) }), world);
    expect(hidden.gapNotVisible).toBe(true);
    expect(visible.gapNotVisible).toBe(false);
  });
});

describe("T5 -- I11 honest basis", () => {
  const card = (rationale: string, basis: ExamV4Card["basis"]) =>
    ({ kind: "own", targetPosition: 1 as const, viewedPosition: 1 as const, targetBasis: null, state: "RANKED", cards: [{ heroId: 1, rationale, basis, risks: [] }] });
  const statistical = { kind: "statistical", sources: [{ kind: "statistical", sampleSize: 4200 }] };
  const curated = { kind: "curated", sources: [{ kind: "curated", sampleSize: null }] };

  test("coherent bases are clean and counted by kind", () => {
    expect(i11Basis(state({ v4: card("Evidencia sólida de que funciona como carry", statistical) }))).toMatchObject({ cards: 1, violations: [], kinds: { statistical: 1 } });
    expect(i11Basis(state({ v4: card("Aporta initiation que a tu equipo le falta", curated) })).violations).toEqual([]);
  });

  test("HARD: a card with no basis", () => {
    expect(i11Basis(state({ v4: card("x", null) })).violations).toHaveLength(1);
  });

  test("HARD: a capability claim labelled statistical-only (a curated claim must not look like a measurement)", () => {
    expect(i11Basis(state({ v4: card("Aporta initiation que a tu equipo le falta", statistical) })).violations).toHaveLength(1);
  });

  test("HARD: a quoted statistic whose basis is not statistical", () => {
    expect(i11Basis(state({ v4: card("Gana 61% en 4200 partidas", curated) })).violations).toHaveLength(1);
  });

  test("HARD: a curated source that claims a sample, a repeated kind, or a kind that does not follow its sources", () => {
    expect(i11Basis(state({ v4: card("x", { kind: "curated", sources: [{ kind: "curated", sampleSize: 50 }] }) })).violations).toHaveLength(1);
    expect(i11Basis(state({ v4: card("x", { kind: "mixed", sources: [{ kind: "curated", sampleSize: null }, { kind: "curated", sampleSize: null }] }) })).violations.length).toBeGreaterThan(0);
    expect(i11Basis(state({ v4: card("x", { kind: "statistical", sources: [{ kind: "curated", sampleSize: null }] }) })).violations).toHaveLength(1);
  });

  test("OBSERVATION: a statistical source with an unknown sample is counted, not a violation", () => {
    const unknownN = { kind: "statistical", sources: [{ kind: "statistical", sampleSize: null }] };
    expect(i11Basis(state({ v4: card("Evidencia sólida de que funciona como carry", unknownN) }))).toMatchObject({ violations: [], statisticalWithoutSample: 1 });
  });
});
