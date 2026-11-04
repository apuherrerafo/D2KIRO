import { describe, expect, test } from "bun:test";
import type { HeroPositions } from "../signals/hero-positions";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import { deriveCandidateResult } from "./current-human-decision";
import { fakeCompute, harness } from "./session-harness.fixtures";

// Reporte del usuario en ranked: al avanzar picks y bans, el Team Coach se quedaba con 3, 2 o 1 tarjeta por columna; lo esperado es
// SIEMPRE 5 "subiendo a los de atrás". V6 entrega 6 candidatos y el Coach filtra después (aquí: los de "solo rol", sin sinergia).
// Este stand-in de V6 imita ese tope: devuelve solo `limit ?? 6` candidatos, en el mismo orden. Fixtures inline, sin datos curados reales.

const HEROES = Array.from({ length: 14 }, (_, index) => index + 1);
const POSITIONS: HeroPositions = Object.fromEntries(HEROES.map((id) => [id, [{ position: 1 as const, matches: 3000 }]]));

/** Los 6 mejores de V6 son "solo rol" (sin sinergia); del 7.º en adelante, todos traen un motivo del draft. */
function cappedCompute(): ComputeSuggestionsForRecommendation {
  const base = fakeCompute(HEROES, POSITIONS);
  const roleOnly = new Set(HEROES.slice(0, 6));
  const keepMotive = <T extends { signal: string }>(hero: number, signals: readonly T[]): T[] =>
    roleOnly.has(hero) ? signals.filter((s) => s.signal !== "patch_meta" && s.signal !== "team_synergy") : [...signals];
  return async (state, accountId, options) => {
    const set = await base(state, accountId, options);
    const cap = options?.limit ?? 6; // el tope de V6: 6 salvo que se pida más
    return {
      ...set,
      suggestions: set.suggestions.slice(0, cap).map((s) => ({ ...s, signals: keepMotive(s.hero, s.signals) })),
      functionalEvidence: set.functionalEvidence
        ? { ...set.functionalEvidence, signalEvidence: set.functionalEvidence.signalEvidence.slice(0, cap).map((e) => ({ ...e, signals: keepMotive(e.hero, e.signals) })) }
        : set.functionalEvidence,
    };
  };
}

async function cardsFor(candidateLimit: number | undefined, bans: number[] = []) {
  const h = harness({ adapterKind: "simulator", controlledPositions: [1, 2, 3, 4, 5], pool: HEROES, heroPositions: POSITIONS, bans });
  h.seal(h.side, 0, 14); // un pick propio a la vista: desde aquí el draft "dice algo" y se filtra a los de solo rol
  const context = h.store.perspectiveRecommendationContext(h.id)!;
  const ranking = await buildRecommendationSetFromPerspective({
    context,
    computeSuggestions: cappedCompute(),
    heroPositions: POSITIONS,
    targetPosition: 1,
    teamOpening: false,
    singleSlotEvaluation: true,
    outputLimit: candidateLimit ?? 6,
    ...(candidateLimit !== undefined ? { candidateLimit } : {}),
  });
  return deriveCandidateResult({ targetPosition: 1, targetRanking: ranking, view: context.view, heroPositions: POSITIONS, personalPoolApplied: false });
}

describe("siempre 5 tarjetas por columna mientras haya candidatos (se suben los de atrás)", () => {
  test("ANTES: con 6 candidatos y los 6 mejores sin fundamento, la columna queda vacía (sin relleno ni mensaje)", async () => {
    const result = await cardsFor(undefined);
    expect(result.cards).toEqual([]);
  });

  test("AHORA: pidiendo todo el universo, suben los de atrás y la columna llega a 5 tarjetas, en el orden de V6", async () => {
    const result = await cardsFor(HEROES.length);
    if (result.state !== "RANKED") throw new Error(`esperaba RANKED, salió ${result.state}`);
    expect(result.cards).toHaveLength(5);
    expect(result.cards.map((card) => card.rank)).toEqual([1, 2, 3, 4, 5]);
    const heroIds = result.cards.map((card) => card.heroId);
    expect(heroIds.every((hero) => hero > 6)).toBe(true); // ninguno de los 6 "solo rol"
    expect([...heroIds].sort((a, b) => a - b)).toEqual(heroIds.slice().sort((a, b) => a - b));
  });
});

describe("la fila avanza cuando un héroe sale del juego (mecanismo del shortlist; la ruta pide el universo en protocol-sessions.team-board.test.ts)", () => {
  test("si un héroe sale del juego (baneado), la fila corre: los de atrás suben y siguen siendo 5, en el mismo orden de V6", async () => {
    const before = await cardsFor(HEROES.length);
    const after = await cardsFor(HEROES.length, [9]);
    if (before.state !== "RANKED" || after.state !== "RANKED") throw new Error("esperaba RANKED");
    expect(before.cards.map((card) => card.heroId)).toEqual([7, 8, 9, 10, 11]);
    expect(after.cards.map((card) => card.heroId)).toEqual([7, 8, 10, 11, 12]); // el 9 salió; el 12 subió al quinto lugar
    expect(after.cards.map((card) => card.rank)).toEqual([1, 2, 3, 4, 5]);
  });

});
