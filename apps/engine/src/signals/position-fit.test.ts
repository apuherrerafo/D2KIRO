import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { createPositionFitScorer } from "./position-fit";
import type { HeroPositions } from "./hero-positions";
import type { MetaSnapshot } from "./types";

// Fixture propio, determinístico -- nunca el hero-positions.json real (costura S10,
// testing-seams.md). Los números de `matches` son los reales, recolectados en /pre-flight
// (Dota2ProTracker, bracket 7000+ MMR, parche 7.41e), congelados acá para que el test no se
// rompa si el archivo real se regenera tras un parche.
const SPECTRE = 67;
const WRAITH_KING = 42;
const ANTI_MAGE = 1;
const CRYSTAL_MAIDEN = 5;
const PUDGE = 14;
const INVOKER = 74;
const LICH = 31;
const DAZZLE = 50;
const ORACLE = 111;
const CHEN = 66; // sin entrada -- representa el único hueco real de datos (SPEC.md §10.6)

const FIXTURE_POSITIONS: HeroPositions = {
  [SPECTRE]: [{ position: 1, matches: 4476 }],
  [WRAITH_KING]: [
    { position: 3, matches: 593 },
    { position: 1, matches: 415 },
  ],
  [ANTI_MAGE]: [{ position: 1, matches: 1409 }],
  [CRYSTAL_MAIDEN]: [
    { position: 5, matches: 2507 },
    { position: 4, matches: 520 },
  ],
  [PUDGE]: [
    { position: 4, matches: 4123 },
    { position: 5, matches: 2795 },
    { position: 3, matches: 2387 },
    { position: 2, matches: 540 },
  ],
  [INVOKER]: [
    { position: 2, matches: 6632 },
    { position: 4, matches: 735 },
  ],
  [LICH]: [
    { position: 5, matches: 2966 },
    { position: 4, matches: 617 },
  ],
  [DAZZLE]: [{ position: 5, matches: 1386 }],
  [ORACLE]: [
    { position: 5, matches: 1946 },
    { position: 4, matches: 233 },
  ],
};

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
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-08-21T00:00:00Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

const EMPTY_META: MetaSnapshot = { heroes: {}, matchups: {} };

describe("positionFitScorer", () => {
  const scorer = createPositionFitScorer(FIXTURE_POSITIONS);

  // Escenario A (SPEC.md §10.5, TSK-044 criterio 1): Spectre propio pickeado, n=1, t=0.30.
  describe("Escenario A -- no repite rol (Spectre ya pickeado)", () => {
    const state = draftState({ picks: { radiant: [SPECTRE], dire: [] } });

    test("Anti-Mage (otro carry puro): raw = 0", () => {
      const result = scorer.score(state, ANTI_MAGE, EMPTY_META);
      expect(result.raw).toBeCloseTo(0, 3);
    });

    test("Wraith King (offlane/carry mixto): raw ≈ 0.412", () => {
      const result = scorer.score(state, WRAITH_KING, EMPTY_META);
      expect(result.raw).toBeCloseTo(0.412, 3);
    });

    test("Pudge (flex, mucho support): raw ≈ 0.911", () => {
      const result = scorer.score(state, PUDGE, EMPTY_META);
      expect(result.raw).toBeCloseTo(0.911, 3);
    });

    test("Crystal Maiden (support puro): raw = 1", () => {
      const result = scorer.score(state, CRYSTAL_MAIDEN, EMPTY_META);
      expect(result.raw).toBeCloseTo(1, 3);
    });

    test("orden final: Anti-Mage < Wraith King < Pudge < Crystal Maiden", () => {
      const values = [ANTI_MAGE, WRAITH_KING, PUDGE, CRYSTAL_MAIDEN].map(
        (hero) => scorer.score(state, hero, EMPTY_META).raw as number,
      );
      expect(values).toEqual([...values].sort((a, b) => a - b));
    });
  });

  // Escenario B (SPEC.md §10.5, TSK-044 criterio 2): draft vacío, n=0, t=0.50.
  describe("Escenario B -- primero lo seguro (draft vacío)", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });

    test("Anti-Mage: raw = 0.5", () => {
      const result = scorer.score(state, ANTI_MAGE, EMPTY_META);
      expect(result.raw).toBeCloseTo(0.5, 3);
    });

    test("Invoker: raw ≈ 0.550", () => {
      const result = scorer.score(state, INVOKER, EMPTY_META);
      expect(result.raw).toBeCloseTo(0.55, 3);
    });

    test("Pudge: raw ≈ 0.851", () => {
      const result = scorer.score(state, PUDGE, EMPTY_META);
      expect(result.raw).toBeCloseTo(0.851, 3);
    });

    test("Crystal Maiden: raw = 1 (el más seguro para el primer pick)", () => {
      const result = scorer.score(state, CRYSTAL_MAIDEN, EMPTY_META);
      expect(result.raw).toBeCloseTo(1, 3);
    });

    test("un support puntúa estrictamente más que un carry puro", () => {
      const support = scorer.score(state, CRYSTAL_MAIDEN, EMPTY_META).raw as number;
      const carry = scorer.score(state, ANTI_MAGE, EMPTY_META).raw as number;
      expect(support).toBeGreaterThan(carry);
    });
  });

  // Simetría (SPEC.md §10.5, TSK-044 criterio 3) -- prueba dedicada, no se infiere de A/B: sin
  // ella, una implementación que solo premiara supports pasaría los dos escenarios de arriba y
  // seguiría estando rota (mismo tipo de hallazgo real de @redteam en TSK-036).
  describe("Simetría -- con 4 supports propios, se invierte y favorece al carry", () => {
    const state = draftState({
      picks: { radiant: [CRYSTAL_MAIDEN, LICH, DAZZLE, ORACLE], dire: [] },
    });

    test("Anti-Mage: raw = 1 (ahora es lo que falta)", () => {
      const result = scorer.score(state, ANTI_MAGE, EMPTY_META);
      expect(result.raw).toBeCloseTo(1, 3);
    });

    test("Crystal Maiden: raw ≈ 0.094 (rol ya saturado)", () => {
      const result = scorer.score(state, CRYSTAL_MAIDEN, EMPTY_META);
      expect(result.raw).toBeCloseTo(0.094, 3);
    });

    test("la señal se invirtió respecto al draft vacío", () => {
      const amNow = scorer.score(state, ANTI_MAGE, EMPTY_META).raw as number;
      const cmNow = scorer.score(state, CRYSTAL_MAIDEN, EMPTY_META).raw as number;
      expect(amNow).toBeGreaterThan(cmNow);
    });
  });

  test("candidato sin dato de posición (Chen): raw: null, sampleSize: 0, sin lanzar", () => {
    const state = draftState({ picks: { radiant: [SPECTRE], dire: [] } });

    expect(() => scorer.score(state, CHEN, EMPTY_META)).not.toThrow();
    const result = scorer.score(state, CHEN, EMPTY_META);
    expect(result.raw).toBeNull();
    expect(result.sampleSize).toBe(0);
    expect(result.applicable).not.toBe(false); // hueco de datos, nunca "función no configurada"
  });

  test("localSide 'unknown': raw: null, sin lanzar", () => {
    const state = draftState({ localSide: "unknown", picks: { radiant: [], dire: [] } });

    const result = scorer.score(state, ANTI_MAGE, EMPTY_META);
    expect(result.raw).toBeNull();
    expect(result.applicable).not.toBe(false);
  });

  test("un héroe propio sin dato de posición no rompe el cálculo del resto", () => {
    const state = draftState({ picks: { radiant: [CHEN], dire: [] } });

    expect(() => scorer.score(state, ANTI_MAGE, EMPTY_META)).not.toThrow();
    const result = scorer.score(state, ANTI_MAGE, EMPTY_META);
    // Chen no aporta NADA de cobertura (need sigue en 1 para todas las posiciones, igual que un
    // draft vacío) -- pero SÍ cuenta como pick propio hecho para el timing (n = own.length = 1,
    // no 0): `t` pasa a TIMING_BLEND[1] = 0.30, distinto del draft realmente vacío (t = 0.50).
    // fill=1, safety=0 -> raw = 0.70·1 + 0.30·0 = 0.7, no 0.5.
    expect(result.raw).toBeCloseTo(0.7, 3);
  });

  test("sampleSize del candidato es la suma de sus partidas totales", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const result = scorer.score(state, CRYSTAL_MAIDEN, EMPTY_META);
    expect(result.sampleSize).toBe(2507 + 520);
  });

  test("id de la señal es position_fit", () => {
    expect(createPositionFitScorer(FIXTURE_POSITIONS).id).toBe("position_fit");
  });
});
