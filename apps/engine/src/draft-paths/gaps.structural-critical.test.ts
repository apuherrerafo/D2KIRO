import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { assessCompositionNeeds, criticalPressure, unfilledCriticalGaps } from "./gaps";
import type { DraftCapabilityGap, HeroCapabilities } from "./types";

// F2-E1: `structural_damage` becomes a critical gap in the closing window. These tests are written BEFORE the change.
// Two groups: the new behavior (red on F1, green with E1) and the CONFINEMENT of the change (green on both): nothing else moves.
// Fixtures inline (S9): never the real capabilities.json.

function draftState(heroIds: number[]): DraftState {
  return {
    sessionId: "s1", schema: "draft-state/v1", format: "all_pick", patch: "7.41e", localSide: "radiant", phase: "active", banned: [],
    picks: { radiant: heroIds, dire: [] }, lastSeq: 0, appliedEventIds: [], quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-10-24T00:00:00Z", firstPickSide: null, turnStartedAt: null, reserveRemainingMs: null,
  };
}

function hero(id: number, overrides: Partial<HeroCapabilities> = {}): HeroCapabilities {
  return { hero: id, damageType: "physical", hasInitiation: true, hasCatch: true, hasWaveclear: true, structuralDamage: "low", teamfight: "medium", scaling: "medium", ...overrides };
}

const F1_CRITICAL_KINDS: readonly DraftCapabilityGap[] = ["initiation", "catch", "damage_mix"];
const withoutStructural = (gaps: DraftCapabilityGap[]): DraftCapabilityGap[] => gaps.filter((gap) => F1_CRITICAL_KINDS.includes(gap));

// A varied fixture pool: every combination of the capabilities that matter to the five gaps that can be critical.
const POOL: HeroCapabilities[] = [
  hero(1), hero(2, { damageType: "magical" }), hero(3, { structuralDamage: "high" }), hero(4, { hasInitiation: false }), hero(5, { hasCatch: false, damageType: "mixed" }),
  hero(6, { structuralDamage: "medium", hasInitiation: false, hasCatch: false }),
];

function subsets(items: number[], size: number): number[][] {
  if (size === 0) return [[]];
  return items.flatMap((item, index) => subsets(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]));
}

describe("F2-E1 -- the new behavior (structural damage is critical in the closing window)", () => {
  // Three picks, all with low structural damage: structural_damage is open; initiation, catch and damage mix are covered.
  const team = [hero(1), hero(2, { damageType: "magical" }), hero(3)];
  const state = draftState([1, 2, 3]);

  test("with 2 picks left an open structural-damage gap is critical", () => {
    const needs = assessCompositionNeeds(state, team, 2);
    expect(needs.open).toContain("structural_damage");
    expect(needs.critical).toEqual(["structural_damage"]);
  });

  test("a candidate with structural damage fills it; one without leaves it unfilled; an uncurated candidate is never blamed", () => {
    const needs = assessCompositionNeeds(state, team, 2);
    expect(unfilledCriticalGaps(hero(10, { structuralDamage: "medium" }), needs)).toEqual([]);
    expect(unfilledCriticalGaps(hero(11, { structuralDamage: "high" }), needs)).toEqual([]);
    expect(unfilledCriticalGaps(hero(12, { structuralDamage: "low" }), needs)).toEqual(["structural_damage"]);
    expect(unfilledCriticalGaps(undefined, needs)).toEqual([]);
  });

  test("it weighs like any other critical gap: 1 critical with 2 picks left -> 0.5, with 1 pick left -> 1", () => {
    expect(criticalPressure(assessCompositionNeeds(state, team, 2))).toBe(0.5);
    expect(criticalPressure(assessCompositionNeeds(state, team, 1))).toBe(1);
  });

  test("exhaustively over the fixture pool: structural_damage is critical exactly when the window is on, every pick is curated and the gap is open", () => {
    for (let size = 0; size <= 5; size += 1) {
      for (const ids of subsets(POOL.map((c) => c.hero), size)) {
        for (let remaining = 0; remaining <= 5; remaining += 1) {
          const needs = assessCompositionNeeds(draftState(ids), POOL, remaining);
          const active = remaining >= 1 && remaining <= 2;
          expect(needs.critical.includes("structural_damage")).toBe(active && needs.open.includes("structural_damage"));
        }
      }
    }
  });
});

describe("F2-E1 -- confinement: nothing else about the critical gaps moves (green on F1 and on E1)", () => {
  test("exhaustively over the fixture pool: ignoring structural_damage, the critical set is exactly F1's (open gaps of the F1 kinds, only inside the window)", () => {
    for (let size = 0; size <= 5; size += 1) {
      for (const ids of subsets(POOL.map((c) => c.hero), size)) {
        for (let remaining = 0; remaining <= 5; remaining += 1) {
          const needs = assessCompositionNeeds(draftState(ids), POOL, remaining);
          const active = remaining >= 1 && remaining <= 2;
          const expectedF1 = active ? needs.open.filter((gap) => F1_CRITICAL_KINDS.includes(gap)) : [];
          expect(withoutStructural(needs.critical)).toEqual(expectedF1);
        }
      }
    }
  });

  test("an uncurated own pick still declares nothing critical, structural included", () => {
    const needs = assessCompositionNeeds(draftState([1, 2, 999]), POOL, 2);
    expect(needs.critical).toEqual([]);
  });

  test("a closed structural gap (a structural hero already on the team) changes nothing: same critical set as the F1 kinds give", () => {
    const withStructural = [hero(1, { hasInitiation: false }), hero(2, { damageType: "magical", structuralDamage: "high" }), hero(3)];
    const needs = assessCompositionNeeds(draftState([1, 2, 3]), withStructural, 2);
    expect(needs.open).not.toContain("structural_damage");
    expect(needs.critical).toEqual(needs.open.filter((gap) => F1_CRITICAL_KINDS.includes(gap)));
  });

  test("outside the window an open structural gap is open but not critical (3 picks left)", () => {
    const needs = assessCompositionNeeds(draftState([1, 2]), POOL, 3);
    expect(needs.critical).toEqual([]);
  });

  test("the pressure of a state that already had other critical gaps rises only by the structural one (reported separately as A2)", () => {
    // initiation missing (everyone at "hasInitiation: false") AND structural low: 2 critical with E1, 1 with F1.
    const noInit = [hero(1, { hasInitiation: false }), hero(2, { hasInitiation: false, damageType: "magical" }), hero(3, { hasInitiation: false })];
    const needs = assessCompositionNeeds(draftState([1, 2, 3]), noInit, 2);
    expect(withoutStructural(needs.critical)).toEqual(["initiation"]);
  });
});
