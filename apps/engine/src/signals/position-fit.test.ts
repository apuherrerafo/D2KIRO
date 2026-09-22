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

// AP Solo Mid data/signal repair, blocker 1 (2026-09, docs/diagnostics/ap-solo-mid-dota-judge.md
// §2/§3.3): `targetPosition === 2` switches position_fit from "what does my team still need,
// anywhere" to "how strong is the evidence this hero works AS Mid". Synthetic fixtures only --
// per instruction, no hero-name-based business assertions here (the real-hero sanity check is a
// separate manual inspection, not a test).
describe("positionFitScorer -- target-aware (targetPosition=2)", () => {
  const HERO_STRONG_MID_WEAK_SUPPORT = 9001;
  const HERO_MARGINAL_MID_STRONG_SUPPORT = 9002;
  const HERO_FIXED_MID_SMALL_OTHER = 9003;
  const HERO_FIXED_MID_LARGE_OTHER = 9004;
  const HERO_NO_MID_ENTRY = 9005; // dato en otras posiciones, ninguno en Mid

  const state = draftState({ picks: { radiant: [], dire: [] } });

  // Escenario A -- criterio del prompt: Mid fuerte / Support débil debe vencer a Mid marginal /
  // Support muy fuerte, cuando la pregunta es explícitamente "¿qué tan buena es la evidencia de
  // Mid?", no "¿qué tan flexible es?".
  describe("Escenario A -- evidencia de Mid vence a flexibilidad de Support", () => {
    const positions: HeroPositions = {
      [HERO_STRONG_MID_WEAK_SUPPORT]: [
        { position: 2, matches: 3000 }, // Mid fuerte -- satura la evidencia
        { position: 5, matches: 200 }, // Support débil, apenas sobre el piso de registro
      ],
      [HERO_MARGINAL_MID_STRONG_SUPPORT]: [
        { position: 2, matches: 250 }, // Mid marginal -- apenas admitido
        { position: 5, matches: 5000 }, // Support muy fuerte
      ],
    };
    const scorer = createPositionFitScorer(positions, 2);

    test("Mid fuerte/Support débil vence a Mid marginal/Support fuerte por position_fit", () => {
      const strong = scorer.score(state, HERO_STRONG_MID_WEAK_SUPPORT, EMPTY_META).raw as number;
      const marginal = scorer.score(state, HERO_MARGINAL_MID_STRONG_SUPPORT, EMPTY_META).raw as number;
      expect(strong).toBeGreaterThan(marginal);
    });

    test("el candidato de Mid fuerte satura cerca de 1", () => {
      const result = scorer.score(state, HERO_STRONG_MID_WEAK_SUPPORT, EMPTY_META);
      expect(result.raw).toBeCloseTo(1, 3);
    });
  });

  // Escenario B -- cambiar los shares de Position 4/5 sin tocar la evidencia de Mid no debe
  // alterar materialmente (acá: nada, por diseño) el position_fit de Mid. Contraste directo con
  // el mecanismo legado, que SÍ es sensible a esto (renormaliza sobre el total de posiciones
  // registradas) -- es exactamente el artefacto que el Dota Judge trazó como causa raíz.
  describe("Escenario B -- invariante a shares de otras posiciones", () => {
    const sameMidMatches = 1000;
    const positionsSmallOther: HeroPositions = {
      [HERO_FIXED_MID_SMALL_OTHER]: [
        { position: 2, matches: sameMidMatches },
        { position: 4, matches: 200 },
        { position: 5, matches: 200 },
      ],
    };
    const positionsLargeOther: HeroPositions = {
      [HERO_FIXED_MID_LARGE_OTHER]: [
        { position: 2, matches: sameMidMatches },
        { position: 4, matches: 6000 },
        { position: 5, matches: 6000 },
      ],
    };

    test("position_fit de Mid es idéntico con shares chicos o gigantes en 4/5", () => {
      const small = createPositionFitScorer(positionsSmallOther, 2)
        .score(state, HERO_FIXED_MID_SMALL_OTHER, EMPTY_META).raw as number;
      const large = createPositionFitScorer(positionsLargeOther, 2)
        .score(state, HERO_FIXED_MID_LARGE_OTHER, EMPTY_META).raw as number;
      expect(large).toBeCloseTo(small, 6);
    });

    test("contraste: el mecanismo legado (sin targetPosition) SÍ es sensible a ese mismo cambio", () => {
      const smallLegacy = createPositionFitScorer(positionsSmallOther)
        .score(state, HERO_FIXED_MID_SMALL_OTHER, EMPTY_META).raw as number;
      const largeLegacy = createPositionFitScorer(positionsLargeOther)
        .score(state, HERO_FIXED_MID_LARGE_OTHER, EMPTY_META).raw as number;
      expect(smallLegacy).not.toBeCloseTo(largeLegacy, 2);
    });
  });

  // Wave 5 Personal View repair: targetPosition is target-aware across all roles (1..5),
  // while targetPosition === undefined preserves the legacy fill/safety formula.
  describe("Pos2 locks -- proving Pos2 does not regress", () => {
    test("Invoker (6632 matches en Pos2): satura en 3000 -> raw 1.0", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 2).score(state, INVOKER, EMPTY_META);
      expect(result.raw).toBe(1.0);
      expect(result.sampleSize).toBe(6632);
      expect(result.explanation).toBe("Evidencia sólida de que funciona como midlane");
    });

    test("Pudge (540 matches en Pos2): raw 540/3000 = 0.18", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 2).score(state, PUDGE, EMPTY_META);
      expect(result.raw).toBeCloseTo(540 / 3000, 6);
      expect(result.sampleSize).toBe(540);
      expect(result.explanation).toBe("Evidencia limitada de que funciona como midlane");
    });

    test("candidato sin entrada en Mid (targetPosition=2): raw null, no admisión mezclada con scoring", () => {
      const positions: HeroPositions = {
        [HERO_NO_MID_ENTRY]: [{ position: 4, matches: 5000 }],
      };
      const result = createPositionFitScorer(positions, 2).score(state, HERO_NO_MID_ENTRY, EMPTY_META);
      expect(result.raw).toBeNull();
      expect(result.sampleSize).toBe(0);
      expect(result.explanation).toBe("Sin evidencia suficiente de midlane para este héroe");
    });
  });

  describe("Pos1 adversarial regression -- Carry ranking evaluates carry evidence, not support mass", () => {
    test("Spectre (4476 matches en Pos1): satura en 3000 -> raw 1.0", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 1).score(state, SPECTRE, EMPTY_META);
      expect(result.raw).toBe(1.0);
      expect(result.sampleSize).toBe(4476);
      expect(result.explanation).toBe("Evidencia sólida de que funciona como carry");
    });

    test("Anti-Mage (1409 matches en Pos1): raw 1409/3000", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 1).score(state, ANTI_MAGE, EMPTY_META);
      expect(result.raw).toBeCloseTo(1409 / 3000, 6);
      expect(result.sampleSize).toBe(1409);
      expect(result.explanation).toBe("Evidencia moderada de que funciona como carry");
    });

    test("adversarial: héroe con presencia secundaria en Pos1 no recibe bono de soporte", () => {
      // Wraith King tiene 415 en Pos1 y 593 en Pos3. Con targetPosition=1, su raw es 415/3000,
      // NO se infla por timing/safety de soporte ni por las necesidades de otros asientos del equipo.
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 1).score(state, WRAITH_KING, EMPTY_META);
      expect(result.raw).toBeCloseTo(415 / 3000, 6);
      expect(result.sampleSize).toBe(415);
      expect(result.explanation).toBe("Evidencia limitada de que funciona como carry");
    });

    test("candidato sin entrada en Pos1: raw null", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 1).score(state, CRYSTAL_MAIDEN, EMPTY_META);
      expect(result.raw).toBeNull();
      expect(result.sampleSize).toBe(0);
      expect(result.explanation).toBe("Sin evidencia suficiente de carry para este héroe");
    });
  });

  describe("Pos3 adversarial regression -- Offlane ranking evaluates offlane evidence, not support mass", () => {
    test("Pudge (2387 matches en Pos3): raw 2387/3000", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 3).score(state, PUDGE, EMPTY_META);
      expect(result.raw).toBeCloseTo(2387 / 3000, 6);
      expect(result.sampleSize).toBe(2387);
      expect(result.explanation).toBe("Evidencia sólida de que funciona como offlane");
    });

    test("Wraith King (593 matches en Pos3): raw 593/3000", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 3).score(state, WRAITH_KING, EMPTY_META);
      expect(result.raw).toBeCloseTo(593 / 3000, 6);
      expect(result.sampleSize).toBe(593);
      expect(result.explanation).toBe("Evidencia limitada de que funciona como offlane");
    });

    test("candidato sin entrada en Pos3: raw null", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 3).score(state, SPECTRE, EMPTY_META);
      expect(result.raw).toBeNull();
      expect(result.sampleSize).toBe(0);
      expect(result.explanation).toBe("Sin evidencia suficiente de offlane para este héroe");
    });
  });

  describe("Pos4 adversarial regression -- Support ranking evaluates Pos4, not mid need", () => {
    test("Pudge (4123 matches en Pos4): satura en 3000 -> raw 1.0", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 4).score(state, PUDGE, EMPTY_META);
      expect(result.raw).toBe(1.0);
      expect(result.sampleSize).toBe(4123);
      expect(result.explanation).toBe("Evidencia sólida de que funciona como support");
    });

    test("adversarial (KotL S13 pattern): Invoker (6632 en Pos2, 735 en Pos4) con targetPosition=4 evalúa sólo Pos4", () => {
      // Aunque al equipo le falte Mid, en ranking personal Pos4 evalúa sólo los 735 de Pos4
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 4).score(state, INVOKER, EMPTY_META);
      expect(result.raw).toBeCloseTo(735 / 3000, 6);
      expect(result.sampleSize).toBe(735);
      expect(result.explanation).toBe("Evidencia limitada de que funciona como support");
    });

    test("candidato sin entrada en Pos4: raw null", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 4).score(state, SPECTRE, EMPTY_META);
      expect(result.raw).toBeNull();
      expect(result.sampleSize).toBe(0);
      expect(result.explanation).toBe("Sin evidencia suficiente de support para este héroe");
    });
  });

  describe("Pos5 adversarial regression -- Hard support ranking does not penalize multi-role volume", () => {
    test("Lich (2966 matches en Pos5): raw 2966/3000", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 5).score(state, LICH, EMPTY_META);
      expect(result.raw).toBeCloseTo(2966 / 3000, 6);
      expect(result.sampleSize).toBe(2966);
      expect(result.explanation).toBe("Evidencia sólida de que funciona como hard support");
    });

    test("adversarial (Rubick S05 pattern): Crystal Maiden (2507 en Pos5, 520 en Pos4) no se diluye por jugar Pos4", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 5).score(state, CRYSTAL_MAIDEN, EMPTY_META);
      expect(result.raw).toBeCloseTo(2507 / 3000, 6);
      expect(result.sampleSize).toBe(2507);
      expect(result.explanation).toBe("Evidencia sólida de que funciona como hard support");
    });

    test("candidato sin entrada en Pos5: raw null", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, 5).score(state, SPECTRE, EMPTY_META);
      expect(result.raw).toBeNull();
      expect(result.sampleSize).toBe(0);
      expect(result.explanation).toBe("Sin evidencia suficiente de hard support para este héroe");
    });
  });

  describe("targetPosition undefined preserva la fórmula legada", () => {
    test("sin targetPosition, fill y safety operan como siempre", () => {
      const result = createPositionFitScorer(FIXTURE_POSITIONS, undefined).score(state, WRAITH_KING, EMPTY_META);
      expect(result.raw).toBeGreaterThan(0);
      expect(result.sampleSize).toBe(593 + 415);
    });
  });
});
