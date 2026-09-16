import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, computeEligibilityContentHash, createProtocolState } from "../draft-protocol";
import type { CmHeroEligibilitySnapshot, DraftProtocolState } from "../draft-protocol/types";
import { applyOwnCandidateAction, locateOpponentObservationPoint, opponentSideOf } from "./observation-point";

function eligibilitySnapshot(heroIds: number[]): CmHeroEligibilitySnapshot {
  const base = {
    schema: "cm-hero-eligibility/v1" as const,
    appId: 570 as const,
    patch: "7.41e",
    buildId: "b",
    depotManifests: { "570": "fixture-manifest" },
    sourceHashes: { npc_heroes: "fixture" },
    provenance: {
      kind: "OFFICIAL_DEPOT" as const,
      appId: 570 as const,
      buildId: "b",
      depotId: "fixture-depot",
      manifestId: "fixture-manifest",
      sourcePath: "scripts/npc/npc_heroes.txt",
      sourceHash: "fixture",
    },
    heroIds,
  };
  return { ...base, contentHash: computeEligibilityContentHash(base) };
}

function apRound1State(sessionId: string): DraftProtocolState {
  const created = createProtocolState(sessionId, "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("fixture setup failed");
  return applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
}

function cmReadyState(sessionId: string, heroIds: number[]): DraftProtocolState {
  const created = createProtocolState(sessionId, "dota2/captains-mode");
  if (!created.ok) throw new Error("fixture setup failed");
  const confirmed = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
  return applyProtocolCommand(confirmed, { type: "LOAD_CM_ELIGIBILITY", snapshot: eligibilitySnapshot(heroIds) }).state;
}

describe("opponentSideOf", () => {
  test("radiant <-> dire", () => {
    expect(opponentSideOf("radiant")).toBe("dire");
    expect(opponentSideOf("dire")).toBe("radiant");
  });
});

describe("applyOwnCandidateAction -- Ranked All Pick", () => {
  test("compound (2 acciones) aplica ambos slots en una copia -- el estado original queda intacto", () => {
    const state = apRound1State("ap-apply-compound");
    const result = applyOwnCandidateAction(state, "radiant", [
      { slot: { side: "radiant", slotIndex: 0 }, hero: 1 },
      { slot: { side: "radiant", slotIndex: 1 }, hero: 2 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.state.rankedAp!.round!.sealed.map((s) => s.heroId).sort()).toEqual([1, 2]);
    expect(state.rankedAp!.round!.sealed).toHaveLength(0); // original never mutated
  });

  test("acción ilegal (slot inexistente) se rechaza explícitamente, nunca lanza", () => {
    const opened = apRound1State("ap-apply-illegal");
    const result = applyOwnCandidateAction(opened, "radiant", [{ slot: { side: "radiant", slotIndex: 9 }, hero: 1 }]);
    expect(result.ok).toBe(false);
  });
});

describe("applyOwnCandidateAction -- Captain's Mode", () => {
  test("resuelve actor/kind desde el propio oráculo del kernel (legalGameplayActions), nunca una copia manual de resolveAbsoluteSide", () => {
    const state = cmReadyState("cm-apply", [1, 2, 3]);
    const result = applyOwnCandidateAction(state, "radiant", [{ slot: { side: "radiant", slotIndex: 1 }, hero: 1 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.state.captainsMode!.bannedHeroes).toEqual([1]);
    expect(result.state.captainsMode!.currentStep).toBe(2);
  });

  test("compound nunca es válido para CM (S5 nunca produce >1 acción para CM) -- se rechaza fail-closed", () => {
    const state = cmReadyState("cm-apply-compound", [1, 2, 3]);
    const result = applyOwnCandidateAction(state, "radiant", [
      { slot: { side: "radiant", slotIndex: 1 }, hero: 1 },
      { slot: { side: "radiant", slotIndex: 1 }, hero: 2 },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("locateOpponentObservationPoint -- Ranked All Pick", () => {
  test("ronda 1: tras sellar ambos slots propios, el rival AÚN tiene sus 2 slots abiertos -> READY", () => {
    const state = apRound1State("ap-observe-ready");
    const applied = applyOwnCandidateAction(state, "radiant", [
      { slot: { side: "radiant", slotIndex: 0 }, hero: 1 },
      { slot: { side: "radiant", slotIndex: 1 }, hero: 2 },
    ]);
    if (!applied.ok) throw new Error("fixture rejected");
    const observation = locateOpponentObservationPoint(applied.state, "dire");
    expect(observation.status).toBe("READY");
  });

  test("BAN_RESOLUTION (sin ronda abierta) -> NO_LEGAL_RESPONSE, nunca inventado", () => {
    const created = createProtocolState("ap-observe-no-round", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    const observation = locateOpponentObservationPoint(created.state, "dire");
    expect(observation.status).toBe("NO_LEGAL_RESPONSE");
    expect(observation.state).toBeNull();
  });

  test("draft completo (ronda 3 resuelta) -> DRAFT_COMPLETE", () => {
    const created = createProtocolState("ap-observe-complete", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    let state = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    const commands = [
      { side: "radiant" as const, slotIndex: 0, heroId: 1 },
      { side: "radiant" as const, slotIndex: 1, heroId: 2 },
      { side: "dire" as const, slotIndex: 0, heroId: 3 },
      { side: "dire" as const, slotIndex: 1, heroId: 4 },
      { side: "radiant" as const, slotIndex: 0, heroId: 5 },
      { side: "radiant" as const, slotIndex: 1, heroId: 6 },
      { side: "dire" as const, slotIndex: 0, heroId: 7 },
      { side: "dire" as const, slotIndex: 1, heroId: 8 },
    ];
    for (const command of commands) {
      state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", ...command }).state;
    }
    expect(state.rankedAp!.phase).toBe("PICK_ROUND_3");
    const applied = applyOwnCandidateAction(state, "radiant", [{ slot: { side: "radiant", slotIndex: 0 }, hero: 9 }]);
    if (!applied.ok) throw new Error("fixture rejected");
    const readyForDire = locateOpponentObservationPoint(applied.state, "dire");
    expect(readyForDire.status).toBe("READY"); // dire's own round-3 slot still open
    const appliedDire = applyOwnCandidateAction(applied.state, "dire", [{ slot: { side: "dire", slotIndex: 0 }, hero: 10 }]);
    if (!appliedDire.ok) throw new Error("fixture rejected");
    expect(appliedDire.state.status).toBe("COMPLETE");
    const observation = locateOpponentObservationPoint(appliedDire.state, "radiant");
    expect(observation.status).toBe("DRAFT_COMPLETE");
  });

  test("nuestra propia acción hipotética dispara la 3ra colisión -> WAITING_FOR_COLLISION_AUTHORITY -> COLLISION_PENDING, nunca una respuesta inventada", () => {
    const created = createProtocolState("ap-observe-collision", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    // dire seals first on both slots each round so RADIANT's own remaining slot is always the one
    // that completes (and, on the 3rd repeat, collides) the round -- this is what makes the
    // collision a consequence of OUR OWN hypothetical action, not an already-authoritative fact.
    const commands = [
      { type: "BAN_RESOLUTION_COMPLETE" as const },
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "dire" as const, slotIndex: 0, heroId: 100 },
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "dire" as const, slotIndex: 1, heroId: 101 },
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "radiant" as const, slotIndex: 0, heroId: 102 },
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "radiant" as const, slotIndex: 1, heroId: 100 }, // collision 1 (vs dire slot 0)
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "dire" as const, slotIndex: 0, heroId: 200 },
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "radiant" as const, slotIndex: 1, heroId: 200 }, // collision 2
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "dire" as const, slotIndex: 0, heroId: 300 },
    ];
    let state = created.state;
    for (const command of commands) {
      const result = applyProtocolCommand(state, command);
      if (result.rejected) throw new Error(`fixture rejected: ${result.rejected}`);
      state = result.state;
    }
    expect(state.rankedAp!.round!.openSlots).toEqual([{ side: "radiant", slotIndex: 1 }]);
    // Our own hypothetical action completes the round AND collides a 3rd time (vs dire's re-sealed 300).
    const applied = applyOwnCandidateAction(state, "radiant", [{ slot: { side: "radiant", slotIndex: 1 }, hero: 300 }]);
    if (!applied.ok) throw new Error("fixture rejected");
    expect(applied.state.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    const observation = locateOpponentObservationPoint(applied.state, "dire");
    expect(observation.status).toBe("COLLISION_PENDING");
    expect(observation.state).toBeNull();
  });
});

describe("locateOpponentObservationPoint -- Captain's Mode", () => {
  test("mismo actor relativo en dos steps seguidos (ej. steps 1-2 = 'first') -> NO_LEGAL_RESPONSE, nunca se salta a un tercero", () => {
    const state = cmReadyState("cm-observe-same-actor", [1, 2, 3]);
    const applied = applyOwnCandidateAction(state, "radiant", [{ slot: { side: "radiant", slotIndex: 1 }, hero: 1 }]);
    if (!applied.ok) throw new Error("fixture rejected");
    expect(applied.state.captainsMode!.currentStep).toBe(2); // step 2 is STILL actor "first" = radiant
    const observation = locateOpponentObservationPoint(applied.state, "dire");
    expect(observation.status).toBe("NO_LEGAL_RESPONSE");
  });

  test("actor relativo cambia (ej. step 3 tras 1-2) -> READY para el rival", () => {
    const state = cmReadyState("cm-observe-next-actor", [1, 2, 3, 4]);
    const step1 = applyOwnCandidateAction(state, "radiant", [{ slot: { side: "radiant", slotIndex: 1 }, hero: 1 }]);
    if (!step1.ok) throw new Error("fixture rejected");
    const step2 = applyOwnCandidateAction(step1.state, "radiant", [{ slot: { side: "radiant", slotIndex: 1 }, hero: 2 }]);
    if (!step2.ok) throw new Error("fixture rejected");
    expect(step2.state.captainsMode!.currentStep).toBe(3); // step 3 = actor "second" = dire
    const observation = locateOpponentObservationPoint(step2.state, "dire");
    expect(observation.status).toBe("READY");
  });

  test("único legal restante para el rival es CM_BAN_SKIPPED (sin héroe elegible) -> NO_LEGAL_RESPONSE, nunca una respuesta sin héroe", () => {
    // Eligibility with only 2 heroes -- both consumed by radiant's own bans in steps 1-2, leaving
    // NOTHING for dire's step-3 ban but CM_BAN_SKIPPED (no eligible heroes remain).
    const state = cmReadyState("cm-observe-ban-skipped", [1, 2]);
    const step1 = applyOwnCandidateAction(state, "radiant", [{ slot: { side: "radiant", slotIndex: 1 }, hero: 1 }]);
    if (!step1.ok) throw new Error("fixture rejected");
    const step2 = applyOwnCandidateAction(step1.state, "radiant", [{ slot: { side: "radiant", slotIndex: 1 }, hero: 2 }]);
    if (!step2.ok) throw new Error("fixture rejected");
    const observation = locateOpponentObservationPoint(step2.state, "dire");
    expect(observation.status).toBe("NO_LEGAL_RESPONSE");
  });
});
