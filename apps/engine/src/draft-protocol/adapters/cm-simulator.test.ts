import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, createProtocolState } from "../kernel";
import { computeEligibilityContentHash } from "../eligibility";
import type { CmHeroEligibilitySnapshot } from "../types";
import { playFullCmDraft, playOneCmStep } from "./cm-simulator";

function fixtureEligibility(count: number): CmHeroEligibilitySnapshot {
  const withoutHash: Omit<CmHeroEligibilitySnapshot, "contentHash"> = {
    schema: "cm-hero-eligibility/v1",
    appId: 570,
    patch: "7.41e",
    buildId: "fixture",
    depotManifests: { "570": "fixture" },
    sourceHashes: { npc_heroes: "fixture" },
    heroIds: Array.from({ length: count }, (_, i) => i + 1),
  };
  return { ...withoutHash, contentHash: computeEligibilityContentHash(withoutHash) };
}

describe("cm-simulator -- S3.5 (controls both sides through the real kernel)", () => {
  test("playFullCmDraft completa un draft real de 24 pasos", () => {
    const created = createProtocolState("cm-sim-1", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup failed");
    let state = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
    state = applyProtocolCommand(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: fixtureEligibility(30) }).state;

    const result = playFullCmDraft(state);
    expect(result.stoppedNaturally).toBe(true);
    expect(result.state.status).toBe("COMPLETE");
    expect(result.state.captainsMode!.history).toHaveLength(24);
    expect(result.stepsPlayed).toBe(24);
  });

  test("funciona igual con FIRST = dire", () => {
    const created = createProtocolState("cm-sim-2", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup failed");
    let state = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "dire" }).state;
    state = applyProtocolCommand(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: fixtureEligibility(30) }).state;

    const result = playFullCmDraft(state);
    expect(result.state.status).toBe("COMPLETE");
  });

  test("sin eligibilidad cargada, se detiene naturalmente en el primer paso sin lanzar", () => {
    const created = createProtocolState("cm-sim-3", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup failed");
    const state = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;

    const result = playFullCmDraft(state);
    expect(result.stoppedNaturally).toBe(true);
    expect(result.state.status).not.toBe("COMPLETE");
    expect(result.state.captainsMode!.history).toHaveLength(0);
  });

  test("playOneCmStep null cuando no hay CM_ACTION legal (UNCONFIRMED_STATE)", () => {
    const created = createProtocolState("cm-sim-4", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup failed");
    expect(playOneCmStep(created.state)).toBeNull();
  });

  test("estrategia personalizada: elige el héroe MAYOR disponible en vez del menor", () => {
    const created = createProtocolState("cm-sim-5", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup failed");
    let state = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
    state = applyProtocolCommand(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: fixtureEligibility(30) }).state;

    const highestStrategy = { chooseHeroId: (ids: readonly number[]) => ids[ids.length - 1]! };
    const result = playOneCmStep(state, highestStrategy);
    expect(result?.rejected).toBeUndefined();
    expect(result?.state.captainsMode!.bannedHeroes).toEqual([30]);
  });

  test("determinismo: la estrategia por defecto produce exactamente el mismo draft dos veces", () => {
    const build = () => {
      const created = createProtocolState("cm-sim-det", "dota2/captains-mode");
      if (!created.ok) throw new Error("setup failed");
      let state = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
      state = applyProtocolCommand(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: fixtureEligibility(30) }).state;
      return playFullCmDraft(state).state;
    };
    const a = build();
    const b = build();
    expect(a.captainsMode).toEqual(b.captainsMode);
  });
});
