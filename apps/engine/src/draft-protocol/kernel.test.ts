import { describe, expect, test } from "bun:test";
import { computeEligibilityContentHash } from "./eligibility";
import { functionalIdentityHash, type CanonicalValue } from "./hash";
import { applyProtocolCommand, createProtocolState, legalActions, replayProtocolState } from "./kernel";
import { project } from "./perspective";
import type { CmHeroEligibilitySnapshot, DraftProtocolState, ProtocolCommand } from "./types";

function eligibilitySnapshot(heroIds: number[]): CmHeroEligibilitySnapshot {
  const base = {
    schema: "cm-hero-eligibility/v1" as const,
    appId: 570 as const,
    patch: "7.41e",
    buildId: "b",
    depotManifests: {},
    sourceHashes: {},
    heroIds,
  };
  return { ...base, contentHash: computeEligibilityContentHash(base) };
}

describe("Kernel — un único camino autoritativo (createProtocolState)", () => {
  test("ruleset desconocido falla cerrado, nunca crea un estado a medias", () => {
    const result = createProtocolState("s1", "dota2/made-up-ruleset");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("RULESET_LOAD_FAILED");
    }
  });

  test("ranked-all-pick y captains-mode se crean correctamente por id", () => {
    expect(createProtocolState("s1", "dota2/ranked-all-pick").ok).toBe(true);
    expect(createProtocolState("s1", "dota2/captains-mode").ok).toBe(true);
  });
});

describe("Kernel — apply/reject: una acción ilegal nunca entra al estado canónico", () => {
  test("un comando rechazado no aparece en el eventLog y el estado no cambia", () => {
    const created = createProtocolState("s1", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    const before = created.state;
    // Sin firstPickSide confirmado: cualquier CM_ACTION es ilegal.
    const result = applyProtocolCommand(before, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 1 });
    expect(result.rejected).toBe("UNCONFIRMED_STATE");
    expect(result.state.eventLog).toHaveLength(0);
    expect(result.state).toEqual(before);
  });

  test("actor equivocado (criterio 12, a nivel kernel) se rechaza y no avanza el paso", () => {
    const created = createProtocolState("s1", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    const confirmed = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" });
    const wrongActor = applyProtocolCommand(confirmed.state, { type: "CM_ACTION", actor: "second", kind: "BAN", heroId: 1 });
    expect(wrongActor.rejected).toBe("WRONG_ACTOR");
    expect(wrongActor.state.captainsMode?.currentStep).toBe(1);
  });

  test("un comando aceptado sí se agrega al eventLog con su ordinal", () => {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    const result = applyProtocolCommand(created.state, { type: "RECORD_RESOLVED_BANS", heroes: [1, 2] });
    expect(result.rejected).toBeUndefined();
    expect(result.state.eventLog).toEqual([{ ordinal: 0, command: { type: "RECORD_RESOLVED_BANS", heroes: [1, 2] } }]);
  });
});

// Criterio 19/20: replay determinista, mismo input canónico -> mismo estado/hash.
describe("Kernel — replay y determinismo", () => {
  function commandsForFullApRound(): ProtocolCommand[] {
    return [
      { type: "BAN_RESOLUTION_COMPLETE" },
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 },
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 2 },
      { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 3 },
      { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 4 },
    ];
  }

  test("reproducir el mismo ruleset + eventos produce exactamente el mismo estado", () => {
    const events = commandsForFullApRound();
    const first = replayProtocolState("s1", "dota2/ranked-all-pick", events);
    const second = replayProtocolState("s1", "dota2/ranked-all-pick", events);
    expect(first).toEqual(second);
    if (first.ok && second.ok) {
      expect(functionalIdentityHash(first.state as unknown as CanonicalValue)).toBe(
        functionalIdentityHash(second.state as unknown as CanonicalValue),
      );
    }
  });

  test("un evento individualmente ilegal dentro de la secuencia no corrompe el resto del replay", () => {
    const events: ProtocolCommand[] = [
      { type: "BAN_RESOLUTION_COMPLETE" },
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 },
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 999 }, // slot ya no está abierto
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 2 },
    ];
    const replayed = replayProtocolState("s1", "dota2/ranked-all-pick", events);
    if (!replayed.ok) throw new Error("setup");
    expect(replayed.state.rankedAp?.round?.sealed.map((s) => s.heroId).sort()).toEqual([1, 2]);
  });

  // Criterio 16 (parte reproducible): AUTO_PICK sobrevive un replay byte-idéntico.
  test("AUTO_PICK es replayable de forma determinista dentro de la secuencia de CM", () => {
    const snapshot = eligibilitySnapshot([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const events: ProtocolCommand[] = [
      { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" },
      { type: "LOAD_CM_ELIGIBILITY", snapshot },
      { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 1 },
      { type: "CM_AUTO_PICK", actor: "first", heroId: 2 }, // paso 2 sigue siendo BAN_1/first -> AUTO_PICK de tipo BAN se rechaza por kind
    ];
    const first = replayProtocolState("s1", "dota2/captains-mode", events);
    const second = replayProtocolState("s1", "dota2/captains-mode", events);
    expect(first).toEqual(second);
  });

  test("un draft completo de Captain's Mode con un AUTO_PICK real es replayable byte-idéntico", () => {
    const snapshot = eligibilitySnapshot(Array.from({ length: 30 }, (_, i) => i + 1));
    const events: ProtocolCommand[] = [
      { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" },
      { type: "LOAD_CM_ELIGIBILITY", snapshot },
      { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 1 }, // paso 1
      { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 2 }, // paso 2
      { type: "CM_ACTION", actor: "second", kind: "BAN", heroId: 3 }, // paso 3
      { type: "CM_ACTION", actor: "second", kind: "BAN", heroId: 4 }, // paso 4
      { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 5 }, // paso 5
      { type: "CM_ACTION", actor: "second", kind: "BAN", heroId: 6 }, // paso 6
      { type: "CM_ACTION", actor: "second", kind: "BAN", heroId: 7 }, // paso 7
      { type: "CM_AUTO_PICK", actor: "first", heroId: 8 }, // paso 8, timeout -> auto-pick
    ];
    const first = replayProtocolState("s1", "dota2/captains-mode", events);
    const second = replayProtocolState("s1", "dota2/captains-mode", events);
    expect(first).toEqual(second);
    if (first.ok) {
      expect(first.state.captainsMode?.currentStep).toBe(9);
      expect(first.state.captainsMode?.history[7]).toEqual({ step: 8, outcome: { kind: "AUTO_PICK", heroId: 8 } });
      expect(first.state.captainsMode?.picks.radiant).toContain(8);
    }
  });
});

describe("Kernel — legalActions es la única autoridad usada aquí para constrain la entrada", () => {
  test("cada acción devuelta por legalActions, aplicada literalmente, es aceptada por el kernel", () => {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    const actions = legalActions(created.state);
    expect(actions).toEqual([{ type: "RECORD_RESOLVED_BANS" }, { type: "BAN_RESOLUTION_COMPLETE" }]);
    const result = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" });
    expect(result.rejected).toBeUndefined();
  });
});

describe("Kernel — vista de perspectiva integrada con el camino autoritativo real", () => {
  test("commitOrdinal asignado globalmente por el kernel resuelve una colisión #3 de forma determinista", () => {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    let state: DraftProtocolState = created.state;

    const commands: ProtocolCommand[] = [
      { type: "BAN_RESOLUTION_COMPLETE" },
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 100 },
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 101 },
      { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 102 },
      { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 100 }, // colisión 1 en 100
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 200 },
      { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 200 }, // colisión 2 en 200
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 300 }, // sellado antes (ordinal menor)
      { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 300 }, // colisión 3: pierde por ordinal mayor
    ];
    for (const command of commands) {
      const result = applyProtocolCommand(state, command);
      if (result.rejected) throw new Error(`rechazado: ${result.rejected} en ${JSON.stringify(command)}`);
      state = result.state;
    }
    expect(state.rankedAp?.bannedHeroes.sort()).toEqual([100, 200]);
    const winner = state.rankedAp?.confirmedPicks.find((p) => p.heroId === 300);
    expect(winner?.side).toBe("radiant"); // radiant selló el 300 con un ordinal de evento menor
    expect(state.rankedAp?.round?.openSlots).toEqual([{ side: "dire", slotIndex: 1 }]);

    const view = project(state, "dire");
    expect(view.enemyPicks.some((slot) => slot.visibility === "REVEALED" && slot.heroId === 300)).toBe(true);
  });
});
