import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { HeroCapabilities } from "../draft-paths/types";
import { createTeamSynergyScorer } from "./team-synergy";

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
    updatedAt: "2026-07-27T00:00:00Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

// Fixture propio, determinístico -- nunca draft-paths/capabilities.json real (mismo criterio que
// gaps.test.ts y position-fit.test.ts, costura S9/S10: ese archivo se regenera por parche, un
// test atado a su contenido se rompería en silencio al cambiar el meta, no al cambiar el código).
function capability(overrides: Partial<HeroCapabilities> & { hero: number }): HeroCapabilities {
  return {
    damageType: "physical",
    hasInitiation: false,
    hasCatch: false,
    hasWaveclear: false,
    structuralDamage: "low",
    teamfight: "low",
    scaling: "low",
    ...overrides,
  };
}

const INITIATOR = capability({ hero: 10, hasInitiation: true, damageType: "magical" });
const WAVECLEARER = capability({ hero: 20, hasWaveclear: true, damageType: "magical" });
const SCALER = capability({ hero: 21, scaling: "high", damageType: "physical" });
const REDUNDANT_INITIATOR = capability({ hero: 30, hasInitiation: true, damageType: "physical" });

describe("createTeamSynergyScorer", () => {
  test("equipo propio vacío -> raw: null (sin cobertura previa que medir, es dato insuficiente)", () => {
    const scorer = createTeamSynergyScorer([INITIATOR]);
    const state = draftState({ picks: { radiant: [], dire: [] } });

    const result = scorer.score(state, INITIATOR.hero, { heroes: {}, matchups: {} });

    expect(result.raw).toBeNull();
    expect(result.sampleSize).toBe(0);
  });

  test("localSide 'unknown' tampoco tiene equipo propio identificable -> raw: null", () => {
    const scorer = createTeamSynergyScorer([INITIATOR]);
    const state = draftState({ localSide: "unknown", picks: { radiant: [INITIATOR.hero], dire: [] } });

    expect(scorer.score(state, WAVECLEARER.hero, { heroes: {}, matchups: {} }).raw).toBeNull();
  });

  test("candidato sin entrada en capabilities.json -> raw: 0, nunca null (es un hueco de dato del candidato, no del equipo)", () => {
    const scorer = createTeamSynergyScorer([INITIATOR]);
    const state = draftState({ picks: { radiant: [INITIATOR.hero], dire: [] } });

    const result = scorer.score(state, 999, { heroes: {}, matchups: {} });

    expect(result.raw).toBe(0);
    expect(result.explanation).toContain("Sin datos de capacidades");
  });

  test("equipo sin iniciación: candidato que la aporta puntúa más que uno que repite algo ya cubierto", () => {
    // Equipo propio: WAVECLEARER (aporta waveclear, nada de iniciación). Falta iniciación, catch,
    // structural_damage, teamfight, scaling (todo salvo waveclear con un solo pick propio).
    const state = draftState({ picks: { radiant: [WAVECLEARER.hero], dire: [] } });
    const scorer = createTeamSynergyScorer([WAVECLEARER, INITIATOR, SCALER]);

    const fillsInitiation = scorer.score(state, INITIATOR.hero, { heroes: {}, matchups: {} });
    const fillsNothingNew = scorer.score(state, WAVECLEARER.hero, { heroes: {}, matchups: {} }); // ya picked, pero score() es pura, se puede volver a preguntar

    expect(fillsInitiation.raw).toBeGreaterThan(0);
    expect(fillsInitiation.explanation).toContain("initiation");
    expect(fillsNothingNew.raw).toBe(0);
  });

  test("gap de magnitud (scaling): la explicación cita el nivel real del candidato, no un genérico", () => {
    const state = draftState({ picks: { radiant: [WAVECLEARER.hero], dire: [] } }); // scaling bajo -> gap
    const scorer = createTeamSynergyScorer([WAVECLEARER, SCALER]);

    const result = scorer.score(state, SCALER.hero, { heroes: {}, matchups: {} });

    expect(result.raw).toBeGreaterThan(0);
    expect(result.explanation).toContain("muy buen scaling");
  });

  test("damage_mix: con 2 picks propios del mismo tipo, un candidato de tipo distinto llena el hueco", () => {
    const magicalOnly = draftState({ picks: { radiant: [INITIATOR.hero, WAVECLEARER.hero], dire: [] } }); // ambos "magical"
    const scorer = createTeamSynergyScorer([INITIATOR, WAVECLEARER, SCALER]); // SCALER es "physical"

    const result = scorer.score(magicalOnly, SCALER.hero, { heroes: {}, matchups: {} });

    expect(result.explanation).toContain("daño físico");
  });

  test("candidato que no llena ningún gap actual -> raw: 0, explicación honesta", () => {
    const state = draftState({ picks: { radiant: [INITIATOR.hero], dire: [] } });
    const scorer = createTeamSynergyScorer([INITIATOR, REDUNDANT_INITIATOR]);

    const result = scorer.score(state, REDUNDANT_INITIATOR.hero, { heroes: {}, matchups: {} });

    expect(result.raw).toBe(0);
    expect(result.explanation).toBe("No aporta ninguna capacidad táctica que a tu equipo le falte todavía");
  });

  test("sampleSize es 0 en todos los casos (esta señal no reporta muestra propia)", () => {
    const scorer = createTeamSynergyScorer([INITIATOR]);
    const empty = draftState({ picks: { radiant: [], dire: [] } });
    const withTeam = draftState({ picks: { radiant: [INITIATOR.hero], dire: [] } });

    expect(scorer.score(empty, INITIATOR.hero, { heroes: {}, matchups: {} }).sampleSize).toBe(0);
    expect(scorer.score(withTeam, WAVECLEARER.hero, { heroes: {}, matchups: {} }).sampleSize).toBe(0);
  });

  test("es pura: mismo state + mismo candidato -> mismo resultado, nunca lanza", () => {
    const state = draftState({ picks: { radiant: [999], dire: [] } }); // pick propio sin entrada en capabilities
    const scorer = createTeamSynergyScorer([]);

    expect(() => scorer.score(state, 42, { heroes: {}, matchups: {} })).not.toThrow();
    expect(scorer.score(state, 42, { heroes: {}, matchups: {} })).toEqual(scorer.score(state, 42, { heroes: {}, matchups: {} }));
  });

  // TSK-069: el candado de TSK-060 ("el mismo state con dos meta distintos no comparte covered
  // cacheado entre sí") no tiene equivalente acá a propósito, no por olvido -- la versión anterior
  // necesitaba ese candado porque `teamSynergyScorer` era un singleton de módulo reusado entre
  // llamadas con distinto `meta`. `createTeamSynergyScorer(capabilities)` construye una cache
  // nueva (WeakMap local al closure) por cada llamada a buildSuggestions -- dos instancias nunca
  // comparten cache entre sí porque cada una tiene la suya propia, la clase de bug queda eliminada
  // por construcción, no por un chequeo en runtime.
});
