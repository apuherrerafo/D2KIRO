import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { detectDraftGaps, filledGaps } from "./gaps";
import type { HeroCapabilities } from "./types";

function draftState(heroIds: number[]): DraftState {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.36",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: heroIds, dire: [] },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-07-30T00:00:00Z",
  };
}

function capability(hero: number, damageType: HeroCapabilities["damageType"]): HeroCapabilities {
  return {
    hero,
    damageType,
    hasInitiation: true,
    hasCatch: true,
    hasWaveclear: true,
    structuralDamage: "medium",
    teamfight: "medium",
    scaling: "medium",
  };
}

describe("detectDraftGaps damage_mix", () => {
  test("2+ héroes conocidos y mismo tipo -> gap damage_mix", () => {
    const gaps = detectDraftGaps(draftState([1, 2]), [capability(1, "physical"), capability(2, "physical")]);

    expect(gaps).toContain("damage_mix");
  });

  test("2+ héroes conocidos y tipos distintos -> no hay gap damage_mix", () => {
    const gaps = detectDraftGaps(draftState([1, 2]), [capability(1, "physical"), capability(2, "magical")]);

    expect(gaps).not.toContain("damage_mix");
  });

  test("menos de 2 héroes conocidos -> no hay gap damage_mix", () => {
    const gaps = detectDraftGaps(draftState([1, 999]), [capability(1, "physical")]);

    expect(gaps).not.toContain("damage_mix");
  });

  test("un héroe mixed presente -> no hay gap damage_mix", () => {
    const gaps = detectDraftGaps(draftState([1, 2]), [capability(1, "physical"), capability(2, "mixed")]);

    expect(gaps).not.toContain("damage_mix");
  });
});

// Hallazgo real de @redteam: filledGaps original asumía que el equipo siempre era monótono en
// "physical" -- estas pruebas cubren el caso contrario (monótono en "magical"), que la versión
// anterior manejaba al revés de lo correcto.
describe("filledGaps damage_mix -- no asume que el equipo monótono es siempre 'physical'", () => {
  test("equipo monótono en magical: un candidato physical SÍ resuelve el gap", () => {
    const fills = filledGaps(capability(3, "physical"), ["damage_mix"], ["magical", "magical"]);

    expect(fills).toContain("damage_mix");
  });

  test("equipo monótono en magical: otro candidato magical NO resuelve el gap (lo empeora)", () => {
    const fills = filledGaps(capability(3, "magical"), ["damage_mix"], ["magical", "magical"]);

    expect(fills).not.toContain("damage_mix");
  });

  test("equipo monótono en physical: un candidato magical SÍ resuelve el gap (caso ya cubierto antes, no debe romperse)", () => {
    const fills = filledGaps(capability(3, "magical"), ["damage_mix"], ["physical", "physical"]);

    expect(fills).toContain("damage_mix");
  });

  test("un candidato mixed siempre resuelve el gap, sin importar el tipo dominante del equipo", () => {
    const fills = filledGaps(capability(3, "mixed"), ["damage_mix"], ["magical", "magical"]);

    expect(fills).toContain("damage_mix");
  });
});
