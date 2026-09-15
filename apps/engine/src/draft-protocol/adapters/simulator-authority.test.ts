import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, createProtocolState } from "../kernel";
import type { DraftProtocolState } from "../types";
import { SIMULATOR_COLLISION_POLICY_VERSION, resolveSimulatorCollisionAuthority } from "./simulator-authority";

let uniqueHeroCounter = 1000;

/**
 * Submits every currently-open slot of round 1: `collidingHeroId` on both sides' slot 0 (forcing
 * a collision this pass), fresh unique heroes elsewhere. Each PASS needs its own colliding hero --
 * a hero banned by collision #1/#2 can never be resealed (HERO_ALREADY_TAKEN), only the
 * round-scoped collision COUNTER carries across passes, not the hero itself.
 */
function driveOneRoundPass(state: DraftProtocolState, collidingHeroId: number): DraftProtocolState {
  const openSlots = state.rankedAp?.round?.openSlots ?? [];
  let next = state;
  for (const slot of openSlots) {
    const heroId = slot.slotIndex === 0 ? collidingHeroId : (uniqueHeroCounter += 1);
    next = applyProtocolCommand(next, {
      type: "SUBMIT_SEALED_SELECTION",
      side: slot.side,
      slotIndex: slot.slotIndex,
      heroId,
    }).state;
  }
  return next;
}

function driveToThirdCollision(sessionId: string, collidingHeroIds: [number, number, number]): DraftProtocolState {
  const created = createProtocolState(sessionId, "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("setup failed");
  let state = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
  for (const heroId of collidingHeroIds) {
    state = driveOneRoundPass(state, heroId);
    if (state.status === "WAITING_FOR_COLLISION_AUTHORITY") break;
  }
  return state;
}

describe("resolveSimulatorCollisionAuthority -- S2.4 SIMULATOR_POLICY", () => {
  test("null cuando no hay colisión pendiente", () => {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup failed");
    expect(resolveSimulatorCollisionAuthority(created.state, "SEEDSEED")).toBeNull();
  });

  test("produce un comando que el kernel acepta y saca al draft de WAITING_FOR_COLLISION_AUTHORITY", () => {
    const state = driveToThirdCollision("sim-1", [201, 202, 203]);
    expect(state.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");

    const resolution = resolveSimulatorCollisionAuthority(state, "SEEDSEED");
    expect(resolution).not.toBeNull();
    expect(resolution!.policy).toBe(SIMULATOR_COLLISION_POLICY_VERSION);
    expect(resolution!.command).toEqual({
      type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION",
      round: 1,
      heroId: 203,
      winner: resolution!.command.winner,
    });

    const result = applyProtocolCommand(state, resolution!.command);
    expect(result.rejected).toBeUndefined();
    expect(result.state.status).not.toBe("WAITING_FOR_COLLISION_AUTHORITY");
    // Winner confirmed, loser's slot reopened, hero NOT banned (frozen collision-3+ contract).
    expect(result.state.rankedAp?.bannedHeroes).not.toContain(203);
  });

  test("nunca decide sin un pendingCollision real -- nunca muta el estado directamente", () => {
    const created = createProtocolState("sim-3", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup failed");
    const before = created.state;
    const resolution = resolveSimulatorCollisionAuthority(before, "SEEDSEED");
    expect(resolution).toBeNull();
    // Same reference -- nothing about calling this function touched authoritative state.
    expect(before).toBe(created.state);
  });

  test("determinismo: mismo seed + mismo estado -> mismo ganador siempre", () => {
    const state = driveToThirdCollision("sim-2", [301, 302, 303]);
    expect(state.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");

    const first = resolveSimulatorCollisionAuthority(state, "FIXEDSD");
    const second = resolveSimulatorCollisionAuthority(state, "FIXEDSD");
    expect(first).toEqual(second);
  });
});
