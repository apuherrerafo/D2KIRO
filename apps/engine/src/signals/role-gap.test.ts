import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { roleGapScorer } from "./role-gap";
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

describe("roleGapScorer", () => {
  test("equipo propio sin carries todavía -> un candidato carry no se penaliza", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Carry Hero", roles: ["Carry"] } });

    const result = roleGapScorer.score(state, 1, snapshot);

    expect(result.raw).toBe(0);
    expect(result.sampleSize).toBe(0);
  });

  test("equipo con 2 carries: otro carry puntúa más bajo que uno de otro rol", () => {
    const state = draftState({ picks: { radiant: [10, 11], dire: [] } });
    const snapshot = meta({
      10: { id: 10, localizedName: "Carry A", roles: ["Carry"] },
      11: { id: 11, localizedName: "Carry B", roles: ["Carry"] },
      20: { id: 20, localizedName: "Carry C", roles: ["Carry"] },
      21: { id: 21, localizedName: "Support Hero", roles: ["Support"] },
    });

    const extraCarry = roleGapScorer.score(state, 20, snapshot);
    const otherRole = roleGapScorer.score(state, 21, snapshot);

    expect(extraCarry.raw).toBeLessThan(0);
    expect(otherRole.raw).toBe(0);
    expect((extraCarry.raw as number) < (otherRole.raw as number)).toBe(true);
    expect(extraCarry.explanation).toContain("carries");
  });

  test("no duplica team_synergy: role_gap solo mira solapamiento de farm, no capacidades", () => {
    const state = draftState({ picks: { radiant: [10, 11], dire: [] } });
    const snapshot = meta({
      10: { id: 10, localizedName: "Carry+Disabler", roles: ["Carry", "Disabler"] },
      11: { id: 11, localizedName: "Carry B", roles: ["Carry"] },
      20: { id: 20, localizedName: "Puro Support", roles: ["Support"] },
    });

    // Aporta una capacidad que team_synergy premiaría (Disabler ya cubierto, así que ni eso), pero
    // role_gap no debe premiarlo por rol -- solo le importa si compite por farm de carry o no.
    const result = roleGapScorer.score(state, 20, snapshot);
    expect(result.raw).toBe(0);
  });

  test("sampleSize es 0 en todos los casos", () => {
    const noTeam = draftState({ picks: { radiant: [], dire: [] } });
    const saturated = draftState({ picks: { radiant: [10, 11], dire: [] } });
    const snapshot = meta({
      10: { id: 10, localizedName: "A", roles: ["Carry"] },
      11: { id: 11, localizedName: "B", roles: ["Carry"] },
    });

    expect(roleGapScorer.score(noTeam, 1, snapshot).sampleSize).toBe(0);
    expect(roleGapScorer.score(saturated, 10, snapshot).sampleSize).toBe(0);
  });

  test("candidato/héroes sin roles no lanza y es pura", () => {
    const state = draftState({ picks: { radiant: [999], dire: [] } });
    const snapshot = meta({});

    expect(() => roleGapScorer.score(state, 42, snapshot)).not.toThrow();
    expect(roleGapScorer.score(state, 42, snapshot)).toEqual(roleGapScorer.score(state, 42, snapshot));
  });
});
