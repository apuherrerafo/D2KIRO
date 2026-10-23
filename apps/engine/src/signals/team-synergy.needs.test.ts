import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { HeroCapabilities } from "../draft-paths/types";
import { createTeamSynergyScorer } from "./team-synergy";
import type { MetaSnapshot } from "./types";

// TSK-253: `team_synergy` pesa lo crítico en la ventana de cierre. Fixtures inline (S9); el scorer se prueba solo (S3).

const META = {} as MetaSnapshot; // team_synergy no lee la meta

function draftState(heroIds: number[]): DraftState {
  return {
    sessionId: "s1", schema: "draft-state/v1", format: "all_pick", patch: "7.41e", localSide: "radiant", phase: "active", banned: [],
    picks: { radiant: heroIds, dire: [] }, lastSeq: 0, appliedEventIds: [], quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-10-23T00:00:00Z", firstPickSide: null, turnStartedAt: null, reserveRemainingMs: null,
  };
}

function hero(id: number, overrides: Partial<HeroCapabilities> = {}): HeroCapabilities {
  return { hero: id, damageType: "physical", hasInitiation: false, hasCatch: true, hasWaveclear: true, structuralDamage: "medium", teamfight: "medium", scaling: "medium", ...overrides };
}

// El equipo propio (3 picks) lo tiene todo MENOS iniciación, y tiene bajos el daño a estructuras y el scaling. Dos candidatos:
//   - INITIATOR: llena el hueco crítico y nada más (iniciación).
//   - RICH: no inicia, pero llena dos huecos blandos (daño a estructuras y scaling).
const OWN = [
  hero(1, { structuralDamage: "low", scaling: "low", teamfight: "medium" }),
  hero(2, { damageType: "magical", structuralDamage: "low", scaling: "low", teamfight: "medium" }),
  hero(3, { structuralDamage: "low", scaling: "low", teamfight: "medium" }),
];
const INITIATOR = hero(10, { hasInitiation: true, structuralDamage: "low", scaling: "low" });
const RICH = hero(11, { hasInitiation: false, structuralDamage: "high", scaling: "high" });
const CAPS = [...OWN, INITIATOR, RICH];

const raw = (scorer: ReturnType<typeof createTeamSynergyScorer>, state: DraftState, id: number): number | null => scorer.score(state, id, META).raw;

describe("team_synergy -- importancia por etapa (TSK-253)", () => {
  const state = draftState([1, 2, 3]);

  test("candado de regresión cero: sin el parámetro, la fórmula de siempre (filled/7) y el mismo orden", () => {
    const legacy = createTeamSynergyScorer(CAPS);
    expect(raw(legacy, state, 10)).toBeCloseTo(1 / 7, 10); // sólo iniciación
    expect(raw(legacy, state, 11)).toBeCloseTo(2 / 7, 10); // estructuras + scaling
    // En la fórmula vieja el héroe "rico" le gana al iniciador aunque al equipo le falte iniciar:
    expect(raw(legacy, state, 11)!).toBeGreaterThan(raw(legacy, state, 10)!);
  });

  test("antes de la ventana (3 picks que quedan) el parámetro no cambia nada", () => {
    const early = draftState([1, 2]);
    const legacy = createTeamSynergyScorer(CAPS);
    const aware = createTeamSynergyScorer(CAPS, 3);
    for (const id of [10, 11]) expect(raw(aware, early, id)).toBe(raw(legacy, early, id));
  });

  test("con 2 picks que quedan y un hueco crítico: el iniciador pasa por delante del héroe 'rico' (la necesidad pesa)", () => {
    const aware = createTeamSynergyScorer(CAPS, 2);
    // p = 1 crítico / 2 picks = 0.5.  INITIATOR: 0.5*(1/7) + 0.5*1 ; RICH: 0.5*(2/7) + 0.5*0
    expect(raw(aware, state, 10)).toBeCloseTo(0.5 * (1 / 7) + 0.5, 10);
    expect(raw(aware, state, 11)).toBeCloseTo(0.5 * (2 / 7), 10);
    expect(raw(aware, state, 10)!).toBeGreaterThan(raw(aware, state, 11)!);
  });

  test("con 1 pick que queda, p = 1: la señal es sólo cuánto de lo crítico llena", () => {
    const aware = createTeamSynergyScorer(CAPS, 1);
    expect(raw(aware, state, 10)).toBe(1);
    expect(raw(aware, state, 11)).toBe(0);
  });

  test("candado de sensibilidad inverso: si el equipo YA tiene iniciador no hay nada crítico y la fórmula vuelve a la de siempre", () => {
    const withInitiator = draftState([1, 2, 10]);
    const legacy = createTeamSynergyScorer(CAPS);
    const aware = createTeamSynergyScorer(CAPS, 1);
    expect(raw(aware, withInitiator, 11)).toBe(raw(legacy, withInitiator, 11));
  });

  test("un pick propio sin capacidades curadas desactiva el énfasis: no se castiga por un hueco que quizá no existe", () => {
    const uncertain = draftState([1, 2, 999]);
    const legacy = createTeamSynergyScorer(CAPS);
    const aware = createTeamSynergyScorer(CAPS, 1);
    for (const id of [10, 11]) expect(raw(aware, uncertain, id)).toBe(raw(legacy, uncertain, id));
  });

  test("raw sigue en [0, 1] y `null` sigue siendo null: sin picks propios, o candidato sin capacidades, no se inventa un número", () => {
    const aware = createTeamSynergyScorer(CAPS, 1);
    expect(raw(aware, draftState([]), 10)).toBeNull();
    expect(raw(aware, state, 4242)).toBeNull();
    for (const id of [10, 11]) {
      const value = raw(aware, state, id)!;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
