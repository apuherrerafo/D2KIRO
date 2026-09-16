import { describe, expect, test } from "bun:test";
import type { Suggestion, SuggestionSet } from "../signals/mix";
import { buildCompoundCandidates, buildShortlist, SHORTLIST_SIZE } from "./shortlist";

function suggestion(hero: number, score: number, confidence: "alta" | "media" | "baja" = "alta"): Suggestion {
  return { hero, rank: 1, score, signals: [], reason: "fixture", confidence, evidenceCoverage: 1, guessingIndex: 0 };
}

function suggestionSet(heroes: number[]): SuggestionSet {
  return {
    schema: "suggestions/v1",
    sessionId: "s",
    basedOnSeq: 0,
    decisionContext: "team_opening",
    suggestions: heroes.map((hero, index) => suggestion(hero, 100 - index)),
    comparison: null,
    degraded: [],
    computedInMs: 0,
  };
}

describe("buildShortlist -- LEGAL ACTION FIRST intersection, never a re-sort", () => {
  test("sin universo restringido (Ranked All Pick), respeta el orden ya rankeado por V6", () => {
    const shortlist = buildShortlist(suggestionSet([10, 20, 30]), null, new Set());
    expect(shortlist.map((entry) => entry.hero)).toEqual([10, 20, 30]);
  });

  test("intersecta contra eligibleHeroIds -- un héroe fuera del universo certificado nunca aparece", () => {
    const shortlist = buildShortlist(suggestionSet([10, 20, 30]), [20, 30], new Set());
    expect(shortlist.map((entry) => entry.hero)).toEqual([20, 30]);
  });

  test("excluidos (banned/picked, defensa en profundidad) se filtran incluso si V6 los hubiera dejado pasar", () => {
    const shortlist = buildShortlist(suggestionSet([10, 20, 30]), null, new Set([20]));
    expect(shortlist.map((entry) => entry.hero)).toEqual([10, 30]);
  });

  test("se acota a SHORTLIST_SIZE sin alterar el orden", () => {
    const heroes = Array.from({ length: SHORTLIST_SIZE + 10 }, (_, i) => i + 1);
    const shortlist = buildShortlist(suggestionSet(heroes), null, new Set());
    expect(shortlist).toHaveLength(SHORTLIST_SIZE);
    expect(shortlist[0]!.hero).toBe(1);
  });
});

describe("buildCompoundCandidates -- unicidad estructural, sin invención de bonus de sinergia", () => {
  test("cada par es distinto por construcción -- nunca un héroe consigo mismo", () => {
    const shortlist = buildShortlist(suggestionSet([1, 2, 3]), null, new Set());
    const combos = buildCompoundCandidates(shortlist);
    expect(combos).toHaveLength(3); // 3 choose 2
    for (const combo of combos) expect(combo.entries[0].hero).not.toBe(combo.entries[1].hero);
  });

  test("score del par es la suma pura de los dos scores independientes -- nada más", () => {
    const shortlist = buildShortlist(suggestionSet([1, 2]), null, new Set());
    const [combo] = buildCompoundCandidates(shortlist);
    expect(combo!.score).toBe(100 + 99);
  });

  test("determinista: mismo shortlist -> mismo orden de combinaciones, siempre", () => {
    const shortlist = buildShortlist(suggestionSet([1, 2, 3, 4]), null, new Set());
    const first = buildCompoundCandidates(shortlist).map((c) => c.entries.map((e) => e.hero));
    const second = buildCompoundCandidates(shortlist).map((c) => c.entries.map((e) => e.hero));
    expect(first).toEqual(second);
  });

  test("confianza del par es la MENOR de las dos -- nunca se inventa una confianza más alta que la evidencia real", () => {
    const set = suggestionSet([1, 2]);
    set.suggestions[0]!.confidence = "alta";
    set.suggestions[1]!.confidence = "baja";
    const shortlist = buildShortlist(set, null, new Set());
    const [combo] = buildCompoundCandidates(shortlist);
    expect(combo!.confidence).toBe("baja");
  });
});
