import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { HeroPositions } from "./hero-positions";
import { buildSuggestions } from "./mix";
import type { MetaHeroInfo, MetaSnapshot } from "./types";

// Step 1B-B -- the V6 seam of hard Party5 pools. Fixtures inline (S10): never the curated file.
//
// `candidateUniverseIsAdmission` says "`candidateHeroIds` is a configured pool and IS the admission": V6 then skips its own
// positional-credibility filter for `targetPosition`. It changes nothing else -- no weight, no signal, no identity.

function draftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.41e",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 7,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-10-15T00:00:00Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

const HEROES: Record<number, MetaHeroInfo> = {
  1: { id: 1, localizedName: "Carry real" },
  2: { id: 2, localizedName: "Otro carry" },
  3: { id: 3, localizedName: "Rubick del pool (solo Pos 4 en los datos)" },
  4: { id: 4, localizedName: "Héroe sin ninguna presencia curada" },
  5: { id: 5, localizedName: "Héroe fuera del pool" },
};
const META: MetaSnapshot = { heroes: HEROES, matchups: {} };
const POSITIONS: HeroPositions = {
  1: [{ position: 1, matches: 900 }],
  2: [{ position: 1, matches: 800 }],
  3: [{ position: 4, matches: 900 }],
  5: [{ position: 1, matches: 700 }],
};
const heroesOf = (state: DraftState, options: Parameters<typeof buildSuggestions>[2]) => buildSuggestions(state, META, options).suggestions.map((suggestion) => suggestion.hero).sort((a, b) => a - b);

describe("candidateUniverseIsAdmission", () => {
  const base = { teamOpening: false, targetPosition: 1 as const, heroPositions: POSITIONS };

  test("con la admisión del pool, un héroe del pool sin presencia curada en esa posición SÍ es candidato", () => {
    expect(heroesOf(draftState(), { ...base, candidateHeroIds: [1, 3, 4], candidateUniverseIsAdmission: true })).toEqual([1, 3, 4]);
  });

  test("candado en rojo: SIN la bandera, V6 sigue expulsando al héroe del pool por credibilidad posicional (comportamiento actual intacto)", () => {
    expect(heroesOf(draftState(), { ...base, candidateHeroIds: [1, 3, 4] })).toEqual([1]);
  });

  test("la admisión es el universo exacto: un héroe creíble en la posición pero fuera del pool no entra", () => {
    const heroes = heroesOf(draftState(), { ...base, candidateHeroIds: [1, 3], candidateUniverseIsAdmission: true });
    expect(heroes).toEqual([1, 3]);
    expect(heroes).not.toContain(2);
    expect(heroes).not.toContain(5);
  });

  test("un héroe baneado o ya elegido del pool sigue no disponible", () => {
    const state = draftState({ banned: [3], picks: { radiant: [], dire: [1] } });
    expect(heroesOf(state, { ...base, candidateHeroIds: [1, 3, 4], candidateUniverseIsAdmission: true })).toEqual([4]);
  });

  test("pool agotado: ningún candidato, y V6 no rellena con héroes de fuera del pool", () => {
    const state = draftState({ banned: [3], picks: { radiant: [], dire: [1, 4] } });
    expect(heroesOf(state, { ...base, candidateHeroIds: [1, 3, 4], candidateUniverseIsAdmission: true })).toEqual([]);
  });

  test("sin candidateHeroIds la bandera no hace nada: el filtro posicional sigue activo", () => {
    expect(heroesOf(draftState(), { ...base, candidateUniverseIsAdmission: true })).toEqual([1, 2, 5]);
  });

  test("regresión cero: la bandera no mueve ningún score ni peso de los héroes que ya eran candidatos", () => {
    const withFlag = buildSuggestions(draftState(), META, { ...base, candidateHeroIds: [1, 2], candidateUniverseIsAdmission: true });
    const withoutFlag = buildSuggestions(draftState(), META, { ...base, candidateHeroIds: [1, 2] });
    expect(withFlag.suggestions.map((suggestion) => ({ hero: suggestion.hero, score: suggestion.score, signals: suggestion.signals }))).toEqual(
      withoutFlag.suggestions.map((suggestion) => ({ hero: suggestion.hero, score: suggestion.score, signals: suggestion.signals })),
    );
  });
});
