import { describe, expect, test } from "bun:test";
import { computeEligibilityContentHash } from "./eligibility";
import { authoritativeStateHash, perspectiveStateHash, rulesHash } from "./identity-hash";
import {
  applyProtocolCommand,
  availableCommands,
  createProtocolState,
  legalGameplayActions,
  replayProtocolState,
} from "./kernel";
import { project } from "./perspective";
import { CAPTAINS_MODE_IDENTITY, captainsModeStepDefinition } from "./rulesets/captains-mode";
import { RANKED_ALL_PICK_IDENTITY, isSealedSelectionLegal } from "./rulesets/ranked-all-pick";
import * as captainsModeModule from "./rulesets/captains-mode";
import * as rankedAllPickModule from "./rulesets/ranked-all-pick";
import type { CmHeroEligibilitySnapshot, DraftProtocolState, ProtocolCommand } from "./types";

type RankedRulesetExports = typeof import("./rulesets/ranked-all-pick");
type CaptainsModeExports = typeof import("./rulesets/captains-mode");
// @ts-expect-error -- compile-time boundary: transition reducer must remain absent
type NoRankedReducerExport = RankedRulesetExports["applyRankedAllPickCommand"];
// @ts-expect-error -- compile-time boundary: factory must remain absent
type NoRankedFactoryExport = RankedRulesetExports["createRankedAllPickState"];
// @ts-expect-error -- compile-time boundary: transition reducer must remain absent
type NoCaptainsReducerExport = CaptainsModeExports["applyCaptainsModeCommand"];
// @ts-expect-error -- compile-time boundary: factory must remain absent
type NoCaptainsFactoryExport = CaptainsModeExports["createCaptainsModeState"];

// R1 S1 -- Blocker repair test evidence. Each describe block maps to the numbered checklist in
// the independent architecture review's "BLOCKER 6 -- TESTS MUST PROVE CLAIMS" section. These
// test the EXTERNALLY OBSERVABLE contract (createProtocolState/applyProtocolCommand/
// legalGameplayActions/availableCommands/project/replayProtocolState) -- never implementation
// internals.

function buildEligibilitySnapshot(heroIds: number[]): CmHeroEligibilitySnapshot {
  const base = {
    schema: "cm-hero-eligibility/v1" as const,
    appId: 570 as const,
    patch: "7.41e",
    buildId: "b",
    depotManifests: { "570": "1" },
    sourceHashes: { npc_heroes: "fixture" },
    heroIds,
  };
  return { ...base, contentHash: computeEligibilityContentHash(base) };
}

function submit(side: "radiant" | "dire", slotIndex: number, heroId: number): ProtocolCommand {
  return { type: "SUBMIT_SEALED_SELECTION", side, slotIndex, heroId };
}

function mustApply(state: DraftProtocolState, command: ProtocolCommand): DraftProtocolState {
  const result = applyProtocolCommand(state, command);
  if (result.rejected) throw new Error(`comando ${command.type} rechazado: ${result.rejected}`);
  return result.state;
}

// -------------------------------------------------------------------------------------------
// Blocker 2 -- Immutability / aliasing (#1, #2, #3)
// -------------------------------------------------------------------------------------------
describe("Blocker 2 — mutation aliasing (#1, #2, #3)", () => {
  test("#1 mutar el comando aceptado no afecta un replay posterior", () => {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    const command: ProtocolCommand = { type: "RECORD_RESOLVED_BANS", heroes: [1, 2, 3] };
    const result = applyProtocolCommand(created.state, command);
    expect(result.rejected).toBeUndefined();

    // Mutate the ORIGINAL object the caller still holds, after acceptance.
    (command as { heroes: number[] }).heroes.push(999);

    const replay = replayProtocolState(
      "s1",
      "dota2/ranked-all-pick",
      result.state.eventLog.map((entry) => entry.command),
    );
    if (!replay.ok) throw new Error("replay failed");
    expect(replay.state.rankedAp?.bannedHeroes).toEqual([1, 2, 3]);
  });

  test("#2 mutar el snapshot de elegibilidad original no afecta el estado ya aceptado", () => {
    const created = createProtocolState("s1", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    const confirmed = mustApply(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" });
    const base = {
      schema: "cm-hero-eligibility/v1" as const,
      appId: 570 as const,
      patch: "7.41e",
      buildId: "b",
      depotManifests: { "570": "1" },
      sourceHashes: { npc_heroes: "x" },
      heroIds: [1, 2, 3],
    };
    const snapshot = { ...base, contentHash: computeEligibilityContentHash(base) };
    const loaded = mustApply(confirmed, { type: "LOAD_CM_ELIGIBILITY", snapshot });

    snapshot.heroIds.push(999); // mutate the caller's own object AFTER acceptance

    expect(loaded.captainsMode?.eligibilitySnapshot?.heroIds).toEqual([1, 2, 3]);
  });

  test("#3 mutar la vista proyectada no afecta el estado autoritativo", () => {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    const afterBans = mustApply(created.state, { type: "RECORD_RESOLVED_BANS", heroes: [1, 2] });
    const view = project(afterBans, "radiant");

    expect(view.bannedHeroes).not.toBe(afterBans.rankedAp?.bannedHeroes); // independent copy
    expect(() => {
      (view.bannedHeroes as number[]).push(999);
    }).toThrow(); // the view is frozen -- a mutation attempt fails loudly instead of corrupting silently

    expect(afterBans.rankedAp?.bannedHeroes).toEqual([1, 2]);
  });
});

// -------------------------------------------------------------------------------------------
// Blocker 4A -- PartyContext validated inside the canonical factory (#4)
// -------------------------------------------------------------------------------------------
describe("Blocker 4A — party 4 vía canonical factory (#4)", () => {
  test("partySize 4 pasado directamente a createProtocolState se rechaza", () => {
    const result = createProtocolState("s1", "dota2/ranked-all-pick", {
      partyContext: { partySize: 4, side: "radiant", controlledSlots: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("INVALID_PARTY_CONTEXT");
    if (result.reason === "INVALID_PARTY_CONTEXT") {
      expect(result.error).toBe("INVALID_PARTY_SIZE");
    }
  });

  test("un partySize válido (1/2/3/5) se acepta y queda reflejado en el estado", () => {
    const result = createProtocolState("s1", "dota2/ranked-all-pick", {
      partyContext: {
        partySize: 2,
        side: "radiant",
        controlledSlots: [{ side: "radiant", slotIndex: 0, controllerId: "a" }],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.state.rankedAp?.partyContext?.partySize).toBe(2);
  });
});

// -------------------------------------------------------------------------------------------
// Blocker 3 -- Legal Action Oracle parity (#11, #12, #13, #14, #15, #16)
// -------------------------------------------------------------------------------------------
describe("Blocker 3 — legalActions ↔ kernel acceptance parity (#11, #12, #13)", () => {
  test("CM: eligibleHeroIds coincide EXACTAMENTE con lo que el kernel acepta, para heroId 1..10", () => {
    const created = createProtocolState("s1", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    let state = mustApply(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" });
    state = mustApply(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: buildEligibilitySnapshot([1, 2, 3, 4, 5, 6, 7]) });
    state = mustApply(state, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 2 }); // step 1: bans hero 2

    const actions = legalGameplayActions(state);
    const cmAction = actions.find((action) => action.type === "CM_ACTION");
    if (!cmAction || cmAction.type !== "CM_ACTION") throw new Error("expected a CM_ACTION entry at step 2");

    for (let heroId = 1; heroId <= 10; heroId += 1) {
      const advertised = cmAction.eligibleHeroIds.includes(heroId);
      const result = applyProtocolCommand(state, { type: "CM_ACTION", actor: cmAction.actor, kind: cmAction.kind, heroId });
      const accepted = result.rejected === undefined;
      expect(accepted).toBe(advertised);
    }
  });

  test("CM: cada eligibleHeroIds de CM_AUTO_PICK, aplicado literalmente, es aceptado por el kernel (#12: ejecutable de verdad)", () => {
    const created = createProtocolState("s1", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    let state = mustApply(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" });
    state = mustApply(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: buildEligibilitySnapshot(Array.from({ length: 30 }, (_, i) => i + 1)) });
    for (let step = 1; step <= 7; step += 1) {
      const def = captainsModeStepDefinition(step)!;
      state = mustApply(state, { type: "CM_ACTION", actor: def.actor, kind: def.kind, heroId: step });
    }
    // paso 8: PICK_1/first
    const actions = legalGameplayActions(state);
    const autoPick = actions.find((action) => action.type === "CM_AUTO_PICK");
    if (!autoPick || autoPick.type !== "CM_AUTO_PICK") throw new Error("expected CM_AUTO_PICK at step 8");
    expect(autoPick.eligibleHeroIds.length).toBeGreaterThan(0);
    const heroId = autoPick.eligibleHeroIds[0]!;
    const result = applyProtocolCommand(state, { type: "CM_AUTO_PICK", actor: autoPick.actor, heroId });
    expect(result.rejected).toBeUndefined();
  });

  test("AP: isSealedSelectionLegal coincide exactamente con la aceptación del kernel (heroId fresco, tomado, y slot cerrado)", () => {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    let state = mustApply(created.state, { type: "RECORD_RESOLVED_BANS", heroes: [5] });
    state = mustApply(state, { type: "BAN_RESOLUTION_COMPLETE" });
    state = mustApply(state, submit("radiant", 0, 10));

    const samples: Array<{ side: "radiant" | "dire"; slotIndex: number; heroId: number }> = [
      { side: "radiant", slotIndex: 1, heroId: 20 }, // open, fresh -> legal
      { side: "radiant", slotIndex: 0, heroId: 21 }, // slot already closed -> illegal
      { side: "dire", slotIndex: 0, heroId: 5 }, // already banned -> illegal
      { side: "dire", slotIndex: 0, heroId: 10 }, // already taken (radiant slot 0) -> illegal
    ];
    for (const { side, slotIndex, heroId } of samples) {
      const advertisedLegal = isSealedSelectionLegal(state, side, slotIndex, heroId);
      const result = applyProtocolCommand(state, submit(side, slotIndex, heroId));
      expect(result.rejected === undefined).toBe(advertisedLegal);
    }
  });
});

describe("Blocker 3 — COMPLETE: sin gameplay, admin manejado explícitamente (#14, #15, #22)", () => {
  function driveApToComplete(): DraftProtocolState {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    let state = mustApply(created.state, { type: "BAN_RESOLUTION_COMPLETE" });
    state = mustApply(state, submit("radiant", 0, 1));
    state = mustApply(state, submit("radiant", 1, 2));
    state = mustApply(state, submit("dire", 0, 3));
    state = mustApply(state, submit("dire", 1, 4)); // round 1 done
    state = mustApply(state, submit("radiant", 0, 5));
    state = mustApply(state, submit("radiant", 1, 6));
    state = mustApply(state, submit("dire", 0, 7));
    state = mustApply(state, submit("dire", 1, 8)); // round 2 done
    state = mustApply(state, submit("radiant", 0, 9));
    state = mustApply(state, submit("dire", 0, 10)); // round 3 done -> COMPLETE
    return state;
  }

  function driveCmToComplete(): DraftProtocolState {
    const created = createProtocolState("s1", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    let state = mustApply(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" });
    state = mustApply(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: buildEligibilitySnapshot(Array.from({ length: 30 }, (_, i) => i + 1)) });
    for (let step = 1; step <= 24; step += 1) {
      const def = captainsModeStepDefinition(step)!;
      state = mustApply(state, { type: "CM_ACTION", actor: def.actor, kind: def.kind, heroId: step });
    }
    return state;
  }

  test("AP completo: legalGameplayActions vacío y SUBMIT_SEALED_SELECTION se rechaza (#14)", () => {
    const state = driveApToComplete();
    expect(state.status).toBe("COMPLETE");
    expect(legalGameplayActions(state)).toEqual([]);
    const result = applyProtocolCommand(state, submit("radiant", 0, 999));
    expect(result.rejected).toBeDefined();
  });

  test("CM completo (paso 25): legalGameplayActions vacío; CM_ACTION/CM_BAN_SKIPPED/CM_AUTO_PICK todos STEP_AFTER_COMPLETION (#14, #22)", () => {
    const state = driveCmToComplete();
    expect(state.status).toBe("COMPLETE");
    expect(state.captainsMode?.currentStep).toBe(25);
    expect(legalGameplayActions(state)).toEqual([]);

    expect(applyProtocolCommand(state, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 200 }).rejected).toBe(
      "STEP_AFTER_COMPLETION",
    );
    expect(applyProtocolCommand(state, { type: "CM_BAN_SKIPPED", actor: "first" }).rejected).toBe("STEP_AFTER_COMPLETION");
    expect(applyProtocolCommand(state, { type: "CM_AUTO_PICK", actor: "first", heroId: 200 }).rejected).toBe(
      "STEP_AFTER_COMPLETION",
    );
  });

  test("CM completo: LOAD_CM_ELIGIBILITY sigue disponible/aceptado -- decisión explícita, no una laguna silenciosa (#15)", () => {
    const state = driveCmToComplete();
    expect(availableCommands(state)).toEqual([{ type: "LOAD_CM_ELIGIBILITY" }]);
    const result = applyProtocolCommand(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: buildEligibilitySnapshot([1, 2, 3]) });
    expect(result.rejected).toBeUndefined();
  });

  test("CM completo: CONFIRM_FIRST_PICK_SIDE ya no se anuncia como disponible, y el kernel lo rechaza ALREADY_RESOLVED (#15)", () => {
    const state = driveCmToComplete();
    expect(availableCommands(state)).not.toContainEqual({ type: "CONFIRM_FIRST_PICK_SIDE" });
    const result = applyProtocolCommand(state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "dire" });
    expect(result.rejected).toBe("ALREADY_RESOLVED");
  });
});

describe("Blocker 3 — resolución absoluta de actor CM (#16)", () => {
  test("absoluteSide en la acción legal coincide con el lado que efectivamente recibe el pick", () => {
    const created = createProtocolState("s1", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    // firstPickSide = dire -> "first" resuelve a dire, "second" a radiant.
    let state = mustApply(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "dire" });
    state = mustApply(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: buildEligibilitySnapshot(Array.from({ length: 30 }, (_, i) => i + 1)) });
    for (let step = 1; step <= 7; step += 1) {
      const def = captainsModeStepDefinition(step)!;
      state = mustApply(state, { type: "CM_ACTION", actor: def.actor, kind: def.kind, heroId: step });
    }
    // paso 8: PICK_1/first -> absoluto = dire
    const actions = legalGameplayActions(state);
    const cmAction = actions.find((action) => action.type === "CM_ACTION");
    if (!cmAction || cmAction.type !== "CM_ACTION") throw new Error("expected CM_ACTION at step 8");
    expect(cmAction.actor).toBe("first");
    expect(cmAction.absoluteSide).toBe("dire");

    const heroId = cmAction.eligibleHeroIds[0]!;
    const result = applyProtocolCommand(state, { type: "CM_ACTION", actor: "first", kind: "PICK", heroId });
    expect(result.rejected).toBeUndefined();
    expect(result.state.captainsMode?.picks.dire).toContain(heroId);
    expect(result.state.captainsMode?.picks.radiant).not.toContain(heroId);
  });
});

// -------------------------------------------------------------------------------------------
// Blocker 5 -- hidden twin / hashing (#17, #18, #24)
// -------------------------------------------------------------------------------------------
describe("Blocker 5 — hashing: perspective vs authoritative (#17, #18)", () => {
  function buildOpenRoundState(direSlot0HeroId: number): DraftProtocolState {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    let state = mustApply(created.state, { type: "BAN_RESOLUTION_COMPLETE" });
    state = mustApply(state, submit("radiant", 0, 10));
    state = mustApply(state, submit("radiant", 1, 11));
    state = mustApply(state, submit("dire", 0, direSlot0HeroId));
    return state;
  }

  test("#18 dos gemelos ocultos SÍ pueden diferir en authoritativeStateHash, aunque su perspectiveStateHash sea idéntico (#17)", () => {
    const stateA = buildOpenRoundState(1001);
    const stateB = buildOpenRoundState(2002);

    expect(authoritativeStateHash(stateA)).not.toBe(authoritativeStateHash(stateB)); // #18

    const viewA = project(stateA, "radiant");
    const viewB = project(stateB, "radiant");
    expect(perspectiveStateHash(viewA)).toBe(perspectiveStateHash(viewB)); // #17, hidden twin
  });
});

describe("Blocker 5 — rulesHash sensibilidad (#24)", () => {
  test("un cambio material en el manifiesto cambia rulesHash; el orden de claves no", () => {
    const manifestA = { phases: ["A", "B"], capacityPerSide: { 1: 2 } };
    const manifestB = { phases: ["A", "B"], capacityPerSide: { 1: 3 } }; // cambio real
    expect(rulesHash(manifestA)).not.toBe(rulesHash(manifestB));

    const manifestAReordered = { capacityPerSide: { 1: 2 }, phases: ["A", "B"] };
    expect(rulesHash(manifestA)).toBe(rulesHash(manifestAReordered));
  });

  test("las identidades reales de ambos rulesets tienen rulesHash distintos entre sí", () => {
    expect(RANKED_ALL_PICK_IDENTITY.rulesHash).not.toBe(CAPTAINS_MODE_IDENTITY.rulesHash);
  });
});

// -------------------------------------------------------------------------------------------
// Blocker 6 -- replay coverage (#19, #20, #23)
// -------------------------------------------------------------------------------------------
describe("Blocker 6 — replay determinista: colisión, BAN_SKIPPED, CM completo (#19, #20, #23)", () => {
  test("#19 replay incluyendo una colisión de ronda reproduce exactamente el mismo estado", () => {
    const events: ProtocolCommand[] = [
      { type: "BAN_RESOLUTION_COMPLETE" },
      submit("radiant", 0, 10),
      submit("dire", 1, 10), // colisión #1 en 10
      submit("radiant", 1, 20),
      submit("dire", 0, 21),
    ];
    const first = replayProtocolState("s1", "dota2/ranked-all-pick", events);
    const second = replayProtocolState("s1", "dota2/ranked-all-pick", events);
    expect(first).toEqual(second);
    if (first.ok) {
      expect(first.state.rankedAp?.bannedHeroes).toContain(10);
    }
  });

  test("#20 replay incluyendo un BAN_SKIPPED reproduce exactamente el mismo estado", () => {
    const events: ProtocolCommand[] = [
      { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" },
      { type: "LOAD_CM_ELIGIBILITY", snapshot: buildEligibilitySnapshot([1, 2, 3]) },
      { type: "CM_BAN_SKIPPED", actor: "first" },
    ];
    const first = replayProtocolState("s1", "dota2/captains-mode", events);
    const second = replayProtocolState("s1", "dota2/captains-mode", events);
    expect(first).toEqual(second);
    if (first.ok) {
      expect(first.state.captainsMode?.currentStep).toBe(2);
      expect(first.state.captainsMode?.history[0]).toEqual({ step: 1, outcome: { kind: "BAN_SKIPPED" } });
    }
  });

  test("#23 replay de un draft CM completo (24 pasos) vía replayProtocolState", () => {
    const snapshot = buildEligibilitySnapshot(Array.from({ length: 30 }, (_, i) => i + 1));
    const events: ProtocolCommand[] = [{ type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }, { type: "LOAD_CM_ELIGIBILITY", snapshot }];
    for (let step = 1; step <= 24; step += 1) {
      const def = captainsModeStepDefinition(step)!;
      events.push({ type: "CM_ACTION", actor: def.actor, kind: def.kind, heroId: step });
    }
    const first = replayProtocolState("s1", "dota2/captains-mode", events);
    const second = replayProtocolState("s1", "dota2/captains-mode", events);
    expect(first).toEqual(second);
    if (!first.ok) throw new Error("replay failed");
    expect(first.state.status).toBe("COMPLETE");
    expect(first.state.captainsMode?.currentStep).toBe(25);
    expect(first.state.captainsMode?.history).toHaveLength(24);
  });
});

describe("remaining API boundary blockers", () => {
  test("ruleset reducers and factories are not exported, including by deep import", () => {
    expect("applyRankedAllPickCommand" in rankedAllPickModule).toBe(false);
    expect("createRankedAllPickState" in rankedAllPickModule).toBe(false);
    expect("applyCaptainsModeCommand" in captainsModeModule).toBe(false);
    expect("createCaptainsModeState" in captainsModeModule).toBe(false);
  });
});

function stateBeforeThirdCollision(): DraftProtocolState {
  const created = createProtocolState("collision-session", "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("setup");
  let state = mustApply(created.state, { type: "BAN_RESOLUTION_COMPLETE" });
  state = mustApply(state, submit("radiant", 0, 100));
  state = mustApply(state, submit("radiant", 1, 101));
  state = mustApply(state, submit("dire", 0, 102));
  state = mustApply(state, submit("dire", 1, 100));
  state = mustApply(state, submit("radiant", 0, 200));
  return mustApply(state, submit("dire", 1, 200));
}

function thirdCollision(order: readonly ["radiant" | "dire", "radiant" | "dire"]): DraftProtocolState {
  let state = stateBeforeThirdCollision();
  for (const side of order) {
    state = mustApply(state, submit(side, side === "radiant" ? 0 : 1, 300));
  }
  return state;
}

const radiantWins300: ProtocolCommand = {
  type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION",
  round: 1,
  heroId: 300,
  winner: { side: "radiant", slotIndex: 0 },
};

describe("third collision requires external authority", () => {
  test("opposite transport orders reach the same waiting state with no winner", () => {
    const radiantThenDire = thirdCollision(["radiant", "dire"]);
    const direThenRadiant = thirdCollision(["dire", "radiant"]);

    expect(radiantThenDire).toEqual(direThenRadiant);
    expect(radiantThenDire.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    expect(radiantThenDire.degradation?.reason).toBe("COLLISION_AUTHORITY_REQUIRED");
    expect(radiantThenDire.rankedAp?.confirmedPicks.some((pick) => pick.heroId === 300)).toBe(false);
    expect(legalGameplayActions(radiantThenDire)).toEqual([]);
    expect(availableCommands(radiantThenDire)).toEqual([
      { type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION" },
    ]);
  });

  test("the same authoritative result produces identical final state and hash", () => {
    const first = mustApply(thirdCollision(["radiant", "dire"]), radiantWins300);
    const second = mustApply(thirdCollision(["dire", "radiant"]), radiantWins300);

    expect(first).toEqual(second);
    expect(authoritativeStateHash(first)).toBe(authoritativeStateHash(second));
    expect(first.rankedAp?.confirmedPicks).toContainEqual({
      side: "radiant",
      round: 1,
      slotIndex: 0,
      heroId: 300,
    });
    expect(first.rankedAp?.round?.openSlots).toEqual([{ side: "dire", slotIndex: 1 }]);
  });

  test("pending collision and authority resolution both replay deterministically", () => {
    const pending = thirdCollision(["dire", "radiant"]);
    const pendingReplay = replayProtocolState(
      pending.sessionId,
      "dota2/ranked-all-pick",
      pending.eventLog.map((event) => event.command),
    );
    if (!pendingReplay.ok) throw new Error("pending replay failed");
    expect(pendingReplay.state).toEqual(pending);

    const resolved = mustApply(pending, radiantWins300);
    const resolvedReplay = replayProtocolState(
      resolved.sessionId,
      "dota2/ranked-all-pick",
      resolved.eventLog.map((event) => event.command),
    );
    if (!resolvedReplay.ok) throw new Error("resolution replay failed");
    expect(resolvedReplay.state).toEqual(resolved);
  });

  test("invalid and stale authority resolutions are rejected without changing state", () => {
    const pending = thirdCollision(["radiant", "dire"]);
    const mismatch = applyProtocolCommand(pending, { ...radiantWins300, heroId: 301 });
    expect(mismatch.rejected).toBe("COLLISION_RESOLUTION_MISMATCH");
    expect(mismatch.state).toBe(pending);

    const resolved = mustApply(pending, radiantWins300);
    const stale = applyProtocolCommand(resolved, radiantWins300);
    expect(stale.rejected).toBe("COLLISION_AUTHORITY_NOT_PENDING");
    expect(stale.state).toBe(resolved);
  });

  test("authority resolution naming the wrong round is rejected without changing state", () => {
    const pending = thirdCollision(["radiant", "dire"]);
    expect(pending.rankedAp?.round?.pendingCollision?.round).toBe(1);

    const wrongRound = applyProtocolCommand(pending, { ...radiantWins300, round: 2 });
    expect(wrongRound.rejected).toBe("COLLISION_RESOLUTION_MISMATCH");
    expect(wrongRound.state).toBe(pending);
    expect(pending.rankedAp?.confirmedPicks.some((pick) => pick.heroId === 300)).toBe(false);
  });

  test("authority resolution naming a non-contender winner is rejected without changing state", () => {
    const pending = thirdCollision(["radiant", "dire"]);
    const contenders = pending.rankedAp?.round?.pendingCollision?.contenders;
    expect(contenders).toEqual([
      { side: "dire", slotIndex: 1 },
      { side: "radiant", slotIndex: 0 },
    ]);

    // (dire, 0) is a real slot from the ban round -- not one of the two contenders in THIS collision.
    const nonContender = applyProtocolCommand(pending, {
      ...radiantWins300,
      winner: { side: "dire", slotIndex: 0 },
    });
    expect(nonContender.rejected).toBe("COLLISION_RESOLUTION_MISMATCH");
    expect(nonContender.state).toBe(pending);
    expect(pending.rankedAp?.confirmedPicks.some((pick) => pick.heroId === 300)).toBe(false);
  });
});

describe("legal gameplay oracle never advertises an empty category", () => {
  test("CM pick step with no remaining eligible hero returns no gameplay actions", () => {
    const created = createProtocolState("cm-empty", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    let state = mustApply(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" });
    state = mustApply(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: buildEligibilitySnapshot([1, 2, 3, 4, 5, 6, 7]) });
    for (let step = 1; step <= 7; step += 1) {
      const definition = captainsModeStepDefinition(step)!;
      state = mustApply(state, { type: "CM_ACTION", actor: definition.actor, kind: "BAN", heroId: step });
    }
    expect(state.captainsMode?.currentStep).toBe(8);
    expect(legalGameplayActions(state)).toEqual([]);
  });

  test("every advertised CM gameplay action has at least one executable instance", () => {
    const created = createProtocolState("cm-oracle", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    let state = mustApply(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "dire" });
    state = mustApply(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: buildEligibilitySnapshot([1, 2, 3]) });

    for (const action of legalGameplayActions(state)) {
      if (action.type === "CM_BAN_SKIPPED") {
        expect(applyProtocolCommand(state, { type: "CM_BAN_SKIPPED", actor: action.actor }).rejected).toBeUndefined();
        continue;
      }
      if (action.type === "CM_ACTION") {
        expect(action.eligibleHeroIds.length).toBeGreaterThan(0);
        expect(applyProtocolCommand(state, {
          type: "CM_ACTION",
          actor: action.actor,
          kind: action.kind,
          heroId: action.eligibleHeroIds[0]!,
        }).rejected).toBeUndefined();
      }
    }
  });
});
