import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { teamSynergyScorer } from "./team-synergy";
import type { MetaHeroInfo, MetaSnapshot } from "./types";

function draftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.36",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-07-27T00:00:00Z",
    ...overrides,
  };
}

function meta(heroes: Record<number, MetaHeroInfo>): MetaSnapshot {
  return { heroes, matchups: {} };
}

describe("teamSynergyScorer", () => {
  test("equipo propio vacío -> raw: null (sin cobertura previa que medir, es dato insuficiente)", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Anti-Mage", roles: ["Carry"] } });

    const result = teamSynergyScorer.score(state, 1, snapshot);

    expect(result.raw).toBeNull();
    expect(result.sampleSize).toBe(0);
  });

  test("localSide 'unknown' tampoco tiene equipo propio identificable -> raw: null", () => {
    const state = draftState({ localSide: "unknown", picks: { radiant: [1], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Anti-Mage", roles: ["Carry"] } });

    expect(teamSynergyScorer.score(state, 2, snapshot).raw).toBeNull();
  });

  test("equipo que ya cubre control/iniciación: candidato repetido puntúa más bajo que uno que llena un hueco", () => {
    const state = draftState({ picks: { radiant: [10, 11], dire: [] } });
    const snapshot = meta({
      10: { id: 10, localizedName: "Disabler Hero", roles: ["Disabler"] },
      11: { id: 11, localizedName: "Initiator Hero", roles: ["Initiator"] },
      20: { id: 20, localizedName: "Redundante", roles: ["Disabler", "Initiator"] },
      21: { id: 21, localizedName: "Aguante Hero", roles: ["Durable"] },
    });

    const redundant = teamSynergyScorer.score(state, 20, snapshot);
    const gapFiller = teamSynergyScorer.score(state, 21, snapshot);

    expect(redundant.raw).toBe(0);
    expect(gapFiller.raw).toBeGreaterThan(redundant.raw as number);
    expect(gapFiller.explanation).toContain("aguante");
  });

  test("sampleSize es 0 en todos los casos", () => {
    const emptyTeam = draftState({ picks: { radiant: [], dire: [] } });
    const withTeam = draftState({ picks: { radiant: [10], dire: [] } });
    const snapshot = meta({ 10: { id: 10, localizedName: "H", roles: ["Support"] } });

    expect(teamSynergyScorer.score(emptyTeam, 1, snapshot).sampleSize).toBe(0);
    expect(teamSynergyScorer.score(withTeam, 1, snapshot).sampleSize).toBe(0);
  });

  test("candidato/héroes sin roles no lanza y es pura", () => {
    const state = draftState({ picks: { radiant: [999], dire: [] } });
    const snapshot = meta({});

    expect(() => teamSynergyScorer.score(state, 42, snapshot)).not.toThrow();
    expect(teamSynergyScorer.score(state, 42, snapshot)).toEqual(teamSynergyScorer.score(state, 42, snapshot));
  });

  // TSK-060: `covered` se cachea por (state, meta) juntos, no solo por `state` -- `teamSynergyScorer`
  // es un singleton de módulo, así que el mismo objeto DraftState podría en teoría verse pasado con
  // un `meta` distinto entre dos llamadas (dos snapshots de meta sobre el mismo estado). Sin la
  // cache anidada por meta, la segunda llamada serviría el `covered` calculado contra el primer
  // `meta`, ignorando que los roles del héroe 10 cambiaron.
  test("el mismo state con dos meta distintos no comparte covered cacheado entre sí", () => {
    const state = draftState({ picks: { radiant: [10], dire: [] } });
    const metaA = meta({ 10: { id: 10, localizedName: "H", roles: ["Disabler"] } });
    const metaB = meta({ 10: { id: 10, localizedName: "H", roles: ["Initiator"] } });

    // candidato 20 solo aporta "iniciacion" -- con metaA (10 = Disabler) el equipo no lo cubre
    // todavía, así que 20 debería sumar cobertura nueva; con metaB (10 = Initiator) esa misma
    // capacidad ya está cubierta por el pick propio, así que 20 no debería aportar nada nuevo.
    const snapshotWithCandidate = { heroes: { ...metaA.heroes, 20: { id: 20, localizedName: "C", roles: ["Initiator"] } }, matchups: {} };
    const resultA = teamSynergyScorer.score(state, 20, snapshotWithCandidate);

    const snapshotBWithCandidate = { heroes: { ...metaB.heroes, 20: { id: 20, localizedName: "C", roles: ["Initiator"] } }, matchups: {} };
    const resultB = teamSynergyScorer.score(state, 20, snapshotBWithCandidate);

    expect(resultA.raw).toBeGreaterThan(0);
    expect(resultB.raw).toBe(0);
  });
});
