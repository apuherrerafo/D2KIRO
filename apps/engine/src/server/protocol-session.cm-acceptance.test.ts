import { describe, expect, test } from "bun:test";
import { computeEligibilityContentHash } from "../draft-protocol";
import type { CmHeroEligibilitySnapshot, ControlledSlot, GameplayLegalAction, TeamSide } from "../draft-protocol";
import { ProtocolSessionStore } from "./protocol-session";

// R1 S3 acceptance -- full 24-step Captain's Mode flow through ProtocolSessionStore (the layer
// S1 never exercised: session creation with party size 5, and driving a complete game to
// COMPLETE through the session/kernel stack together).

function fixtureEligibility(heroIds: number[]): CmHeroEligibilitySnapshot {
  const withoutHash: Omit<CmHeroEligibilitySnapshot, "contentHash"> = {
    schema: "cm-hero-eligibility/v1",
    appId: 570,
    patch: "7.41e",
    buildId: "fixture-build",
    depotManifests: { "570": "fixture-manifest" },
    sourceHashes: { npc_heroes: "fixture" },
    provenance: { kind: "OFFICIAL_DEPOT", appId: 570, buildId: "fixture-build", depotId: "fixture-depot", manifestId: "fixture-manifest", sourcePath: "scripts/npc/npc_heroes.txt", sourceHash: "fixture" },
    heroIds: [...heroIds].sort((a, b) => a - b),
  };
  return { ...withoutHash, contentHash: computeEligibilityContentHash(withoutHash) };
}

const FULL_PARTY_SLOTS: ControlledSlot[] = [0, 1, 2, 3, 4].map((slotIndex) => ({
  side: "radiant" as const,
  slotIndex,
  controllerId: `p${slotIndex}`,
}));

function createCmSession(store: ProtocolSessionStore, sessionId: string, firstPickSide: TeamSide) {
  const created = store.create({
    sessionId,
    rulesetId: "dota2/captains-mode",
    patch: "7.41e",
    partyContext: { partySize: 5, side: "radiant", controlledSlots: FULL_PARTY_SLOTS },
  });
  expect(created.ok).toBe(true);
  store.apply(sessionId, { type: "CONFIRM_FIRST_PICK_SIDE", side: firstPickSide });
  // 30 eligible heroes: comfortably more than the 24 hero-targeting steps could ever consume.
  store.apply(sessionId, { type: "LOAD_CM_ELIGIBILITY", snapshot: fixtureEligibility(Array.from({ length: 30 }, (_, i) => i + 1)) });
}

/** Drives every remaining step by always taking the CM_ACTION option (never BAN_SKIPPED/AUTO_PICK), picking the lowest eligible heroId each time. */
function playFullCmDraft(store: ProtocolSessionStore, sessionId: string): void {
  for (let guard = 0; guard < 30; guard += 1) {
    const actions = store.legalActions(sessionId) ?? [];
    const cmAction = actions.find((action): action is Extract<GameplayLegalAction, { type: "CM_ACTION" }> => action.type === "CM_ACTION");
    if (!cmAction) return; // COMPLETE or no more hero-targeting actions
    const heroId = cmAction.eligibleHeroIds[0]!;
    const result = store.apply(sessionId, { type: "CM_ACTION", actor: cmAction.actor, kind: cmAction.kind, heroId });
    expect(result?.rejected).toBeUndefined();
  }
  throw new Error("playFullCmDraft did not reach COMPLETE within the guard limit");
}

describe("S3 acceptance -- Captain's Mode through ProtocolSessionStore", () => {
  test.each(["radiant", "dire"] as const)("FIRST = %s: 24 pasos reales completan el draft", (firstPickSide) => {
    const store = new ProtocolSessionStore();
    const sessionId = `cm-${firstPickSide}`;
    createCmSession(store, sessionId, firstPickSide);
    playFullCmDraft(store, sessionId);

    const finalState = store.get(sessionId)!;
    expect(finalState.status).toBe("COMPLETE");
    expect(finalState.captainsMode!.history).toHaveLength(24);
    expect(finalState.captainsMode!.bannedHeroes).toHaveLength(14); // 7+3+4 bans across BAN_1/2/3
    expect(finalState.captainsMode!.picks.radiant).toHaveLength(5);
    expect(finalState.captainsMode!.picks.dire).toHaveLength(5);
  });

  test("actor correcto en cada paso: FIRST=dire invierte qué lado absoluto actúa en el paso 1", () => {
    const storeRadiantFirst = new ProtocolSessionStore();
    const storeDireFirst = new ProtocolSessionStore();
    createCmSession(storeRadiantFirst, "actor-radiant", "radiant");
    createCmSession(storeDireFirst, "actor-dire", "dire");

    const step1Radiant = (storeRadiantFirst.legalActions("actor-radiant") ?? []).find((a) => a.type === "CM_ACTION")!;
    const step1Dire = (storeDireFirst.legalActions("actor-dire") ?? []).find((a) => a.type === "CM_ACTION")!;
    expect((step1Radiant as { absoluteSide: TeamSide }).absoluteSide).toBe("radiant");
    expect((step1Dire as { absoluteSide: TeamSide }).absoluteSide).toBe("dire");
  });

  test("paso 25 se rechaza -- STEP_AFTER_COMPLETION tras el draft completo", () => {
    const store = new ProtocolSessionStore();
    createCmSession(store, "step25", "radiant");
    playFullCmDraft(store, "step25");
    const result = store.apply("step25", { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 29 });
    expect(result?.rejected).toBe("STEP_AFTER_COMPLETION");
  });

  test("BAN_SKIPPED avanza el paso sin agregar ningún héroe a bannedHeroes", () => {
    const store = new ProtocolSessionStore();
    createCmSession(store, "ban-skip", "radiant");
    const before = store.get("ban-skip")!.captainsMode!;
    const actions = store.legalActions("ban-skip") ?? [];
    const banSkipped = actions.find((a) => a.type === "CM_BAN_SKIPPED") as Extract<GameplayLegalAction, { type: "CM_BAN_SKIPPED" }>;
    expect(banSkipped).toBeDefined();
    const result = store.apply("ban-skip", { type: "CM_BAN_SKIPPED", actor: banSkipped.actor });
    expect(result?.rejected).toBeUndefined();
    const after = store.get("ban-skip")!.captainsMode!;
    expect(after.currentStep).toBe(before.currentStep + 1);
    expect(after.bannedHeroes).toHaveLength(0);
    expect(after.history[after.history.length - 1]).toEqual({ step: before.currentStep, outcome: { kind: "BAN_SKIPPED" } });
  });

  test("AUTO_PICK confirma un héroe elegible y avanza el paso, sin exigir un CM_ACTION explícito", () => {
    const store = new ProtocolSessionStore();
    createCmSession(store, "auto-pick", "radiant");
    // Fast-forward past BAN_1 (7 bans) to reach the first PICK step.
    for (let i = 0; i < 7; i += 1) {
      const action = (store.legalActions("auto-pick") ?? []).find((a) => a.type === "CM_ACTION") as Extract<GameplayLegalAction, { type: "CM_ACTION" }>;
      store.apply("auto-pick", { type: "CM_ACTION", actor: action.actor, kind: action.kind, heroId: action.eligibleHeroIds[0]! });
    }
    const pickActions = store.legalActions("auto-pick") ?? [];
    const autoPick = pickActions.find((a) => a.type === "CM_AUTO_PICK") as Extract<GameplayLegalAction, { type: "CM_AUTO_PICK" }>;
    expect(autoPick).toBeDefined();
    const heroId = autoPick.eligibleHeroIds[0]!;
    const before = store.get("auto-pick")!.captainsMode!.currentStep;
    const result = store.apply("auto-pick", { type: "CM_AUTO_PICK", actor: autoPick.actor, heroId });
    expect(result?.rejected).toBeUndefined();
    const after = store.get("auto-pick")!.captainsMode!;
    expect(after.currentStep).toBe(before + 1);
    expect(after.picks.radiant.includes(heroId) || after.picks.dire.includes(heroId)).toBe(true);
  });

  test("eligibility fail-closed: sin snapshot cargado, ningún CM_ACTION/CM_AUTO_PICK es legal ni aceptado", () => {
    const store = new ProtocolSessionStore();
    store.create({
      sessionId: "no-eligibility",
      rulesetId: "dota2/captains-mode",
      patch: "7.41e",
      partyContext: { partySize: 5, side: "radiant", controlledSlots: FULL_PARTY_SLOTS },
    });
    store.apply("no-eligibility", { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" });
    // No LOAD_CM_ELIGIBILITY at all.
    const actions = store.legalActions("no-eligibility") ?? [];
    expect(actions.some((a) => a.type === "CM_ACTION")).toBe(false);
    expect(actions.some((a) => a.type === "CM_BAN_SKIPPED")).toBe(true); // the one action that never needs eligibility
    const result = store.apply("no-eligibility", { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 1 });
    expect(result?.rejected).toBe("ELIGIBILITY_UNVERIFIED");
  });

  test("CM nunca tiene información oculta en la perspectiva autorizada", () => {
    const store = new ProtocolSessionStore();
    createCmSession(store, "cm-visibility", "radiant");
    const action = (store.legalActions("cm-visibility") ?? []).find((a) => a.type === "CM_ACTION") as Extract<GameplayLegalAction, { type: "CM_ACTION" }>;
    store.apply("cm-visibility", { type: "CM_ACTION", actor: action.actor, kind: action.kind, heroId: action.eligibleHeroIds[0]! });

    const radiantView = store.view("cm-visibility");
    // No HIDDEN slot ever appears in a CM view (frozen contract: CM has no sealed phase).
    expect([...(radiantView?.ownPicks ?? []), ...(radiantView?.enemyPicks ?? [])].some((s) => s.visibility === "HIDDEN")).toBe(false);
  });
});
