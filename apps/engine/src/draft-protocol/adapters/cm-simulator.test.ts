import { describe, expect, test } from "bun:test";
import { authoritativeStateHash } from "../identity-hash";
import { applyProtocolCommand, createProtocolState, legalActions } from "../kernel";
import { computeEligibilityContentHash } from "../eligibility";
import type { CmHeroEligibilitySnapshot } from "../types";
import { playFullCmDraft, playOneCmStep } from "./cm-simulator";
import { applyManualObservation } from "./manual-observation";

function fixtureEligibility(count: number): CmHeroEligibilitySnapshot {
  const withoutHash: Omit<CmHeroEligibilitySnapshot, "contentHash"> = {
    schema: "cm-hero-eligibility/v1",
    appId: 570,
    patch: "7.41e",
    buildId: "fixture",
    depotManifests: { "570": "fixture-manifest" },
    sourceHashes: { npc_heroes: "fixture" },
    provenance: { kind: "OFFICIAL_DEPOT", appId: 570, buildId: "fixture", depotId: "fixture-depot", manifestId: "fixture-manifest", sourcePath: "scripts/npc/npc_heroes.txt", sourceHash: "fixture" },
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

  test("parity real: observaciones manuales y cm-simulator traducen al mismo estado/hash", () => {
    const manualCreated = createProtocolState("cm-adapter-parity", "dota2/captains-mode");
    const simulatorCreated = createProtocolState("cm-adapter-parity", "dota2/captains-mode");
    if (!manualCreated.ok || !simulatorCreated.ok) throw new Error("setup failed");
    const eligibility = fixtureEligibility(30);

    let manual = applyManualObservation(manualCreated.state, { type: "CM_FIRST_PICK_SIDE_OBSERVED", side: "dire" })!.state;
    // La elegibilidad NO es una observación: entra por el lado confiable (acá, directo al kernel,
    // igual que haría ProtocolSessionStore.loadTrustedEligibility). Lo que esta prueba compara son
    // las dos traducciones de ACCIONES, que es donde la paridad significa algo.
    manual = applyProtocolCommand(manual, { type: "LOAD_CM_ELIGIBILITY", snapshot: eligibility }).state;
    let simulator = applyProtocolCommand(simulatorCreated.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "dire" }).state;
    simulator = applyProtocolCommand(simulator, { type: "LOAD_CM_ELIGIBILITY", snapshot: eligibility }).state;

    for (let guard = 0; guard < 30 && manual.status !== "COMPLETE"; guard += 1) {
      const action = legalActions(manual).find((candidate) => candidate.type === "CM_ACTION");
      if (!action || action.type !== "CM_ACTION") throw new Error("manual adapter has no legal CM action");
      const manualResult = applyManualObservation(manual, {
        type: "CM_HERO_ACTION_OBSERVED",
        side: action.absoluteSide,
        kind: action.kind,
        heroId: action.eligibleHeroIds[0]!,
      });
      const simulatorResult = playOneCmStep(simulator);
      if (!manualResult || !simulatorResult) throw new Error("adapter stopped early");
      expect(manualResult.rejected).toBeUndefined();
      expect(simulatorResult.rejected).toBeUndefined();
      manual = manualResult.state;
      simulator = simulatorResult.state;
    }

    expect(manual.status).toBe("COMPLETE");
    expect(authoritativeStateHash(manual)).toBe(authoritativeStateHash(simulator));
  });
});
