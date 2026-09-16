import { describe, expect, test } from "bun:test";
import {
  applyProtocolCommand,
  authoritativeStateHash,
  computeEligibilityContentHash,
  createProtocolState,
  legalActions,
} from "../draft-protocol";
import { applyManualObservation, type ManualProtocolObservation } from "../draft-protocol/adapters/manual-observation";
import { resolveSimulatorCollisionAuthority } from "../draft-protocol/adapters/simulator-authority";
import type { CmHeroEligibilitySnapshot, ControlledSlot, DraftProtocolState } from "../draft-protocol";
import type { SuggestionSet } from "../signals/mix";
import { ProtocolSessionStore } from "./protocol-session";
import { createProtocolSessionRoutes } from "./routes/protocol-sessions";

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function suggestions(heroId: number): SuggestionSet {
  return {
    schema: "suggestions/v1",
    sessionId: "adapter-parity",
    basedOnSeq: 0,
    decisionContext: "blind_second_pick",
    suggestions: [{ hero: heroId, rank: 1, score: 1, signals: [], reason: "parity", confidence: "alta", evidenceCoverage: 1, guessingIndex: 0 }],
    comparison: null,
    degraded: [],
    computedInMs: 0,
  };
}

function observe(state: DraftProtocolState, observation: ManualProtocolObservation): DraftProtocolState {
  const result = applyManualObservation(state, observation);
  expect(result).not.toBeNull();
  expect(result?.rejected).toBeUndefined();
  return result!.state;
}

// R1-FIX-PAR-04 -- fixture eligibility snapshot, same shape as
// draft-protocol/adapters/cm-simulator.test.ts and server/protocol-session.cm-acceptance.test.ts.
// Not read from disk: CM eligibility is a TRUSTED_SERVER_ONLY artifact, never a real request body,
// so every test that needs one builds it inline (see manual-observation.ts's header comment).
function fixtureCmEligibility(count: number): CmHeroEligibilitySnapshot {
  const withoutHash: Omit<CmHeroEligibilitySnapshot, "contentHash"> = {
    schema: "cm-hero-eligibility/v1",
    appId: 570,
    patch: "7.41e",
    buildId: "fixture",
    depotManifests: { "570": "fixture-manifest" },
    sourceHashes: { npc_heroes: "fixture" },
    provenance: {
      kind: "OFFICIAL_DEPOT",
      appId: 570,
      buildId: "fixture",
      depotId: "fixture-depot",
      manifestId: "fixture-manifest",
      sourcePath: "scripts/npc/npc_heroes.txt",
      sourceHash: "fixture",
    },
    heroIds: Array.from({ length: count }, (_, i) => i + 1),
  };
  return { ...withoutHash, contentHash: computeEligibilityContentHash(withoutHash) };
}

const CM_FULL_PARTY_SLOTS: ControlledSlot[] = [0, 1, 2, 3, 4].map((slotIndex) => ({
  side: "radiant" as const,
  slotIndex,
  controllerId: `p${slotIndex}`,
}));

describe("adapter parity real -- manual observations vs simulator HTTP routes", () => {
  test("AP sealed/reveal/collision produce el mismo estado y hash canónicos", async () => {
    const created = createProtocolState("adapter-parity", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("manual setup failed");
    let manualState = observe(created.state, { type: "AP_BAN_RESOLUTION_OBSERVED" });

    const botQueue = [401, 902, 402, 403];
    const simulatorStore = new ProtocolSessionStore();
    simulatorStore.create({
      sessionId: "adapter-parity",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "simulator",
    });
    const routes = createProtocolSessionRoutes({
      store: simulatorStore,
      computeSuggestions: async () => suggestions(botQueue.shift()!),
    });
    await routes.postCommand(jsonRequest({ command: { type: "BAN_RESOLUTION_COMPLETE" } }), "adapter-parity");

    const local = async (slotIndex: number, heroId: number) => {
      manualState = observe(manualState, { type: "AP_SEALED_SELECTION_OBSERVED", side: "radiant", slotIndex, heroId });
      const response = await routes.postCommand(
        jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId } }),
        "adapter-parity",
      );
      expect(response.status).toBe(202);
    };
    const bot = async (slotIndex: number, heroId: number) => {
      manualState = observe(manualState, { type: "AP_SEALED_SELECTION_OBSERVED", side: "dire", slotIndex, heroId });
      const response = await routes.postBotSelection(jsonRequest({}), "adapter-parity");
      expect(response.status).toBe(200);
    };

    await local(0, 401);
    await local(1, 901);
    await bot(0, 401);
    await bot(1, 902);
    await local(0, 402);
    await bot(0, 402);
    await local(0, 403);
    await bot(0, 403);

    expect(manualState.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    expect(simulatorStore.get("adapter-parity")!.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    const resolution = resolveSimulatorCollisionAuthority(manualState, "ABCDEFGH");
    if (!resolution) throw new Error("missing parity resolution");
    manualState = observe(manualState, {
      type: "AP_COLLISION_RESOLUTION_OBSERVED",
      round: resolution.command.round,
      heroId: resolution.command.heroId,
      winner: resolution.command.winner,
    });
    const response = await routes.postSimulatorAuthority(jsonRequest({ seed: "ABCDEFGH" }), "adapter-parity");
    expect(response.status).toBe(200);

    const simulatorState = simulatorStore.get("adapter-parity")!;
    expect(authoritativeStateHash(manualState)).toBe(authoritativeStateHash(simulatorState));
    expect(manualState.rankedAp!.confirmedPicks.some((pick) => pick.heroId === 901)).toBe(true);
    expect(manualState.rankedAp!.bannedHeroes).toEqual(expect.arrayContaining([401, 402]));
  });

  // R1-FIX-PAR-04 -- the missing parity direction the manifest flags: adapter-parity.integration.test.ts
  // above only ever drove Ranked All Pick through the real HTTP session routes; Captain's Mode had
  // no equivalent here (draft-protocol/adapters/cm-simulator.test.ts's "parity real" test compares
  // manual observations against playOneCmStep directly, bypassing ProtocolSessionStore/the HTTP
  // routes entirely). This closes that gap for the FIRST=dire direction specifically, through the
  // exact same production surface (postCommand/postBotSelection) the AP test above exercises --
  // no second CM path, no new adapter.
  test("R1-FIX-PAR-04: CM manual vs simulador (rutas HTTP reales) produce el mismo estado y hash canónicos con FIRST=dire", async () => {
    const eligibility = fixtureCmEligibility(30);

    // Manual side: createProtocolState -> applyManualObservation, same adapter the AP case above
    // uses. Eligibility is never an "observation" (manual-observation.ts's header comment) -- it
    // enters the same way ProtocolSessionStore.loadTrustedEligibility does on the simulator side
    // below: a direct, trusted-side kernel command, never through applyManualObservation.
    const manualCreated = createProtocolState("cm-parity-dire-manual", "dota2/captains-mode");
    if (!manualCreated.ok) throw new Error("manual setup failed");
    let manualState = observe(manualCreated.state, { type: "CM_FIRST_PICK_SIDE_OBSERVED", side: "dire" });
    manualState = applyProtocolCommand(manualState, { type: "LOAD_CM_ELIGIBILITY", snapshot: eligibility }).state;

    // Simulator side: the real ProtocolSessionStore + the real HTTP routes -- postCommand for the
    // local side's own CM_ACTIONs, postBotSelection for the opposite side's, exactly like a live
    // adapter and a simulator adapter would each be driven in production.
    const sessionId = "cm-parity-dire-simulator";
    const simulatorStore = new ProtocolSessionStore();
    const created = simulatorStore.create({
      sessionId,
      rulesetId: "dota2/captains-mode",
      patch: "7.41e",
      partyContext: { partySize: 5, side: "radiant", controlledSlots: CM_FULL_PARTY_SLOTS },
      localSide: "radiant",
      adapterKind: "simulator",
    });
    expect(created.ok).toBe(true);
    const routes = createProtocolSessionRoutes({
      store: simulatorStore,
      computeSuggestions: async () => suggestions(1),
    });

    const confirmResponse = await routes.postCommand(
      jsonRequest({ command: { type: "CONFIRM_FIRST_PICK_SIDE", side: "dire" } }),
      sessionId,
    );
    expect(confirmResponse.status).toBe(202);
    const eligibilityLoad = simulatorStore.loadTrustedEligibility(sessionId, eligibility);
    expect(eligibilityLoad.ok).toBe(true);

    let stepsPlayed = 0;
    for (; stepsPlayed < 30 && manualState.status !== "COMPLETE"; stepsPlayed += 1) {
      const action = legalActions(manualState).find((candidate) => candidate.type === "CM_ACTION");
      if (!action || action.type !== "CM_ACTION") throw new Error("manual adapter has no legal CM action");
      const heroId = action.eligibleHeroIds[0]!;

      manualState = observe(manualState, {
        type: "CM_HERO_ACTION_OBSERVED",
        side: action.absoluteSide,
        kind: action.kind,
        heroId,
      });

      if (action.absoluteSide === "radiant") {
        const response = await routes.postCommand(
          jsonRequest({ command: { type: "CM_ACTION", actor: action.actor, kind: action.kind, heroId } }),
          sessionId,
        );
        expect(response.status).toBe(202);
      } else {
        const response = await routes.postBotSelection(jsonRequest({}), sessionId);
        expect(response.status).toBe(200);
      }
    }

    expect(stepsPlayed).toBe(24);
    expect(manualState.status).toBe("COMPLETE");
    const simulatorState = simulatorStore.get(sessionId)!;
    expect(simulatorState.status).toBe("COMPLETE");
    expect(authoritativeStateHash(manualState)).toBe(authoritativeStateHash(simulatorState));
    expect(manualState.captainsMode!.picks.radiant).toEqual(simulatorState.captainsMode!.picks.radiant);
    expect(manualState.captainsMode!.picks.dire).toEqual(simulatorState.captainsMode!.picks.dire);
  });
});
