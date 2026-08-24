import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { HeroCapabilities } from "../draft-paths/types";
import { createArchetypeFitScorer } from "./archetype-fit";
import type { MetaSnapshot } from "./types";

// Fixture propio, determinístico -- nunca capabilities.json real (costura S9, testing-seams.md:
// ese archivo se regenera por curación de dominio, un test atado a su contenido exacto se
// rompería en silencio con cada corrección). Los valores SÍ son los reales de hoy (SPEC.md §11.5,
// verificados ejecutando archetypeFitBonus contra el archivo real), congelados acá para que el
// test no dependa de que el archivo no cambie.
const ANTI_MAGE = 1;
const AXE = 2;
const CRYSTAL_MAIDEN = 5;
const JUGGERNAUT = 8;
const PUDGE = 14;
const LION = 26;
const NATURES_PROPHET = 53;
const LYCAN = 77;
const NO_CAPABILITIES_ENTRY = 999; // representa el hueco real (hoy: héroes 131/145/155)

const FIXTURE_CAPABILITIES: HeroCapabilities[] = [
  { hero: ANTI_MAGE, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "high" },
  { hero: AXE, damageType: "physical", hasInitiation: true, hasCatch: false, hasWaveclear: true, structuralDamage: "low", teamfight: "medium", scaling: "medium" },
  { hero: CRYSTAL_MAIDEN, damageType: "magical", hasInitiation: false, hasCatch: true, hasWaveclear: true, structuralDamage: "low", teamfight: "medium", scaling: "low" },
  { hero: JUGGERNAUT, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: true, structuralDamage: "medium", teamfight: "medium", scaling: "high" },
  { hero: PUDGE, damageType: "magical", hasInitiation: true, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "medium", scaling: "medium" },
  { hero: LION, damageType: "magical", hasInitiation: true, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "medium", scaling: "low" },
  { hero: NATURES_PROPHET, damageType: "magical", hasInitiation: false, hasCatch: false, hasWaveclear: true, structuralDamage: "high", teamfight: "low", scaling: "medium" },
  { hero: LYCAN, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: true, structuralDamage: "high", teamfight: "low", scaling: "medium" },
];

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
    updatedAt: "2026-08-23T00:00:00Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

const EMPTY_META: MetaSnapshot = { heroes: {}, matchups: {} };
const STATE = draftState(); // raw no depende de state/meta (SPEC.md §11.4) -- un solo state alcanza

describe("archetypeFitScorer", () => {
  // Criterio 2 (SPEC.md §11.9): sin intención -- raw: null Y applicable: false, nunca un número.
  describe("sin intención elegida", () => {
    const scorer = createArchetypeFitScorer(FIXTURE_CAPABILITIES, undefined);

    test("Nature's Prophet: applicable: false, raw: null", () => {
      const result = scorer.score(STATE, NATURES_PROPHET, EMPTY_META);
      expect(result.raw).toBeNull();
      expect(result.applicable).toBe(false);
    });

    test("Anti-Mage (perfil totalmente distinto): mismo resultado, applicable: false", () => {
      const result = scorer.score(STATE, ANTI_MAGE, EMPTY_META);
      expect(result.raw).toBeNull();
      expect(result.applicable).toBe(false);
    });
  });

  // Escenario A (SPEC.md §11.5, criterio 3): intención "push", MAX = 2.
  describe('Escenario A -- intención "push"', () => {
    const scorer = createArchetypeFitScorer(FIXTURE_CAPABILITIES, "push");

    test("Nature's Prophet (structuralDamage: high): raw = 1.000", () => {
      expect(scorer.score(STATE, NATURES_PROPHET, EMPTY_META).raw).toBeCloseTo(1.0, 3);
    });

    test("Juggernaut (structuralDamage: medium): raw = 0.500", () => {
      expect(scorer.score(STATE, JUGGERNAUT, EMPTY_META).raw).toBeCloseTo(0.5, 3);
    });

    test("Anti-Mage (structuralDamage: low): raw = 0.000", () => {
      expect(scorer.score(STATE, ANTI_MAGE, EMPTY_META).raw).toBeCloseTo(0.0, 3);
    });

    test("orden: Anti-Mage < Juggernaut < Nature's Prophet", () => {
      const values = [ANTI_MAGE, JUGGERNAUT, NATURES_PROPHET].map(
        (hero) => scorer.score(STATE, hero, EMPTY_META).raw as number,
      );
      expect(values).toEqual([...values].sort((a, b) => a - b));
    });
  });

  // Escenario B (SPEC.md §11.5, criterio 4): mismos héroes, intención "scaling" -- el orden se
  // invierte. Prueba dedicada: sin ella, un ranking fijo que ignore `intent` pasaría el Escenario A
  // y seguiría roto (mismo tipo de hallazgo que @redteam encontró en TSK-036).
  describe('Escenario B -- intención "scaling" (mismos héroes, orden invertido)', () => {
    const scorer = createArchetypeFitScorer(FIXTURE_CAPABILITIES, "scaling");

    test("Anti-Mage (scaling: high): raw = 1.000 (era 0.000 en push)", () => {
      expect(scorer.score(STATE, ANTI_MAGE, EMPTY_META).raw).toBeCloseTo(1.0, 3);
    });

    test("Juggernaut (scaling: high): raw = 1.000", () => {
      expect(scorer.score(STATE, JUGGERNAUT, EMPTY_META).raw).toBeCloseTo(1.0, 3);
    });

    test("Nature's Prophet (scaling: medium): raw = 0.500 (era 1.000 en push)", () => {
      expect(scorer.score(STATE, NATURES_PROPHET, EMPTY_META).raw).toBeCloseTo(0.5, 3);
    });

    test("Crystal Maiden (scaling: low): raw = 0.000", () => {
      expect(scorer.score(STATE, CRYSTAL_MAIDEN, EMPTY_META).raw).toBeCloseTo(0.0, 3);
    });
  });

  // Escenario C (SPEC.md §11.5, criterio 5): intención "pickoff", MAX = 3 -- única escala de 4
  // niveles. Detecta un ARCHETYPE_MAX_BONUS mal puesto (con MAX=2, Crystal Maiden y Pudge
  // empatarían en 1.000 en vez de distinguirse en 0.667/1.000).
  describe('Escenario C -- intención "pickoff" (escala de 4 niveles)', () => {
    const scorer = createArchetypeFitScorer(FIXTURE_CAPABILITIES, "pickoff");

    test("Pudge (catch + initiation): raw = 1.000", () => {
      expect(scorer.score(STATE, PUDGE, EMPTY_META).raw).toBeCloseTo(1.0, 3);
    });

    test("Lion (catch + initiation): raw = 1.000", () => {
      expect(scorer.score(STATE, LION, EMPTY_META).raw).toBeCloseTo(1.0, 3);
    });

    test("Crystal Maiden (solo catch): raw = 0.667", () => {
      expect(scorer.score(STATE, CRYSTAL_MAIDEN, EMPTY_META).raw).toBeCloseTo(0.667, 3);
    });

    test("Axe (solo initiation): raw = 0.333", () => {
      expect(scorer.score(STATE, AXE, EMPTY_META).raw).toBeCloseTo(0.333, 3);
    });

    test("Anti-Mage (ninguno): raw = 0.000", () => {
      expect(scorer.score(STATE, ANTI_MAGE, EMPTY_META).raw).toBeCloseTo(0.0, 3);
    });
  });

  // Criterio 6 (SPEC.md §11.9): candidato sin entrada en las capacidades inyectadas.
  describe("candidato sin entrada en capabilities", () => {
    const scorer = createArchetypeFitScorer(FIXTURE_CAPABILITIES, "push");

    test("raw: null, applicable ausente (nunca false), nunca lanza", () => {
      const result = scorer.score(STATE, NO_CAPABILITIES_ENTRY, EMPTY_META);
      expect(result.raw).toBeNull();
      expect(result.applicable).not.toBe(false);
      expect(result.explanation.length).toBeGreaterThan(0);
    });
  });

  // Invariante de independencia del estado (SPEC.md §11.4): raw no depende de DraftState/MetaSnapshot.
  test("raw es constante por (intent, hero) sin importar el estado del draft", () => {
    const scorer = createArchetypeFitScorer(FIXTURE_CAPABILITIES, "push");
    const emptyDraft = draftState();
    const midDraft = draftState({ picks: { radiant: [ANTI_MAGE, AXE], dire: [PUDGE] } });

    expect(scorer.score(emptyDraft, NATURES_PROPHET, EMPTY_META).raw).toBe(
      scorer.score(midDraft, NATURES_PROPHET, EMPTY_META).raw,
    );
  });
});
