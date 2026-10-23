import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { assessCompositionNeeds, criticalPressure, detectDraftGaps, ownPicksRemainingOf, unfilledCriticalGaps } from "./gaps";
import type { HeroCapabilities } from "./types";

// TSK-253: qué le falta al equipo y cuánto pesa ya. Fixtures inline (costura S9): nunca capabilities.json real.

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

// Equipo de 3 sin iniciador: catch/waveclear/niveles cubiertos, daño de tipos distintos.
const NO_INITIATOR_TEAM = [hero(1), hero(2, { damageType: "magical" }), hero(3)];

describe("assessCompositionNeeds -- importancia por etapa", () => {
  test("`open` es exactamente detectDraftGaps (no se reinterpreta qué falta)", () => {
    const state = draftState([1, 2, 3]);
    expect(assessCompositionNeeds(state, NO_INITIATOR_TEAM, 2).open).toEqual(detectDraftGaps(state, NO_INITIATOR_TEAM));
  });

  test("fuera de la ventana de cierre el hueco está abierto pero NO es crítico (con 3 picks por delante todavía se puede llenar)", () => {
    const needs = assessCompositionNeeds(draftState([1, 2]), NO_INITIATOR_TEAM, 3);
    expect(needs.open).toContain("initiation");
    expect(needs.critical).toEqual([]);
  });

  test("dentro de la ventana (2 picks que quedan) un hueco de iniciación sí es crítico", () => {
    const needs = assessCompositionNeeds(draftState([1, 2, 3]), NO_INITIATOR_TEAM, 2);
    expect(needs.critical).toEqual(["initiation"]);
  });

  test("con 1 pick que queda sigue siendo crítico", () => {
    expect(assessCompositionNeeds(draftState([1, 2, 3]), NO_INITIATOR_TEAM, 1).critical).toEqual(["initiation"]);
  });

  test("sin picks que quedar (draft completo) no hay nada crítico que llenar", () => {
    expect(assessCompositionNeeds(draftState([1, 2, 3]), NO_INITIATOR_TEAM, 0).critical).toEqual([]);
  });

  test("un hueco que NO es crítico por plan (waveclear) nunca se vuelve crítico, ni en el último pick", () => {
    const team = [hero(1, { hasWaveclear: false, hasInitiation: true }), hero(2, { hasWaveclear: false, hasInitiation: true, damageType: "magical" })];
    const needs = assessCompositionNeeds(draftState([1, 2]), team, 1);
    expect(needs.open).toContain("waveclear");
    expect(needs.critical).toEqual([]);
  });

  test("monodaño es crítico: tres físicos y ninguno mixto, con 2 picks que quedan", () => {
    const team = [hero(1, { hasInitiation: true }), hero(2, { hasInitiation: true }), hero(3, { hasInitiation: true })];
    expect(assessCompositionNeeds(draftState([1, 2, 3]), team, 2).critical).toEqual(["damage_mix"]);
  });

  test("un pick propio sin capacidades curadas es dato desconocido, no carencia: el hueco no se declara crítico", () => {
    // El 999 podría ser un iniciador: con el dato que hay no se le puede decir al jugador que "le falta iniciación".
    const needs = assessCompositionNeeds(draftState([1, 2, 999]), [hero(1), hero(2, { damageType: "magical" })], 2);
    expect(needs.open).toContain("initiation");
    expect(needs.critical).toEqual([]);
  });
});

describe("unfilledCriticalGaps -- qué crítico NO llena este candidato", () => {
  const needs = assessCompositionNeeds(draftState([1, 2, 3]), NO_INITIATOR_TEAM, 2);

  test("un iniciador llena el hueco: no queda nada sin llenar", () => {
    expect(unfilledCriticalGaps(hero(10, { hasInitiation: true }), needs)).toEqual([]);
  });

  test("un héroe sin iniciación lo deja sin llenar", () => {
    expect(unfilledCriticalGaps(hero(11), needs)).toEqual(["initiation"]);
  });

  test("candidato sin capacidades curadas: no se le atribuye el hueco (devuelve [], nunca 'no llena')", () => {
    expect(unfilledCriticalGaps(undefined, needs)).toEqual([]);
  });

  test("fuera de la ventana no hay críticos que dejar sin llenar", () => {
    const early = assessCompositionNeeds(draftState([1, 2]), NO_INITIATOR_TEAM, 3);
    expect(unfilledCriticalGaps(hero(11), early)).toEqual([]);
  });

  test("monodaño: un candidato del mismo tipo no lo llena; uno de otro tipo o mixto sí", () => {
    const mono = assessCompositionNeeds(draftState([1, 2, 3]), [hero(1, { hasInitiation: true }), hero(2, { hasInitiation: true }), hero(3, { hasInitiation: true })], 2);
    expect(unfilledCriticalGaps(hero(20, { hasInitiation: true }), mono)).toEqual(["damage_mix"]);
    expect(unfilledCriticalGaps(hero(21, { damageType: "magical" }), mono)).toEqual([]);
    expect(unfilledCriticalGaps(hero(22, { damageType: "mixed" }), mono)).toEqual([]);
  });
});

describe("criticalPressure -- qué parte de los picks que quedan se iría en lo crítico", () => {
  test("sin críticos, 0", () => {
    expect(criticalPressure(assessCompositionNeeds(draftState([1, 2]), NO_INITIATOR_TEAM, 3))).toBe(0);
  });

  test("1 crítico con 2 picks que quedan -> 0.5; con 1 -> 1 (ya no alcanzan los picks)", () => {
    expect(criticalPressure(assessCompositionNeeds(draftState([1, 2, 3]), NO_INITIATOR_TEAM, 2))).toBe(0.5);
    expect(criticalPressure(assessCompositionNeeds(draftState([1, 2, 3]), NO_INITIATOR_TEAM, 1))).toBe(1);
  });

  test("nunca pasa de 1", () => {
    const team = [hero(1, { hasCatch: false }), hero(2, { hasCatch: false })];
    const needs = assessCompositionNeeds(draftState([1, 2]), team, 1);
    expect(needs.critical.length).toBeGreaterThan(1);
    expect(criticalPressure(needs)).toBe(1);
  });
});

describe("ownPicksRemainingOf", () => {
  test("5 menos los picks propios, sin bajar de 0", () => {
    expect(ownPicksRemainingOf(draftState([]))).toBe(5);
    expect(ownPicksRemainingOf(draftState([1, 2, 3]))).toBe(2);
    expect(ownPicksRemainingOf(draftState([1, 2, 3, 4, 5]))).toBe(0);
  });
});
