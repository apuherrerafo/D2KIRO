import { describe, expect, test } from "bun:test";
import {
  isValidBotSelectionBody,
  isValidCreateProtocolSessionBody,
  isValidPartyContextInput,
  isValidProtocolCommand,
  isValidRulesetId,
  isValidSimulatorAuthorityBody,
  isValidSubmitProtocolCommandBody,
} from "./validation";

describe("isValidRulesetId", () => {
  test("acepta los dos rulesets conocidos, rechaza cualquier otro string", () => {
    expect(isValidRulesetId("dota2/ranked-all-pick")).toBe(true);
    expect(isValidRulesetId("dota2/captains-mode")).toBe(true);
    expect(isValidRulesetId("dota2/unknown")).toBe(false);
    expect(isValidRulesetId(123)).toBe(false);
    expect(isValidRulesetId(null)).toBe(false);
  });
});

describe("isValidProtocolCommand -- input externo, cada variante de la unión", () => {
  test("SUBMIT_SEALED_SELECTION válido", () => {
    expect(isValidProtocolCommand({ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 })).toBe(true);
  });
  test("HeroId usa la semántica canónica: entero, finito y mayor que cero", () => {
    for (const heroId of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isValidProtocolCommand({ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId })).toBe(false);
    }
  });
  test("SUBMIT_SEALED_SELECTION con slotIndex negativo se rechaza", () => {
    expect(isValidProtocolCommand({ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: -1, heroId: 1 })).toBe(false);
  });
  test("SUBMIT_SEALED_SELECTION con side inválido se rechaza", () => {
    expect(isValidProtocolCommand({ type: "SUBMIT_SEALED_SELECTION", side: "north", slotIndex: 0, heroId: 1 })).toBe(false);
  });
  test("RECORD_RESOLVED_BANS exige array de números", () => {
    expect(isValidProtocolCommand({ type: "RECORD_RESOLVED_BANS", heroes: [1, 2, 3] })).toBe(true);
    expect(isValidProtocolCommand({ type: "RECORD_RESOLVED_BANS", heroes: [1, "2"] })).toBe(false);
    expect(isValidProtocolCommand({ type: "RECORD_RESOLVED_BANS", heroes: "not-array" })).toBe(false);
  });
  test("BAN_RESOLUTION_COMPLETE no exige campos adicionales", () => {
    expect(isValidProtocolCommand({ type: "BAN_RESOLUTION_COMPLETE" })).toBe(true);
  });
  test("APPLY_AUTHORITATIVE_COLLISION_RESOLUTION válido y con round fuera de {1,2,3} rechazado", () => {
    const winner = { side: "dire" as const, slotIndex: 1 };
    expect(isValidProtocolCommand({ type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION", round: 2, heroId: 5, winner })).toBe(true);
    expect(isValidProtocolCommand({ type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION", round: 4, heroId: 5, winner })).toBe(false);
    expect(isValidProtocolCommand({ type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION", round: 2, heroId: 5, winner: { side: "dire" } })).toBe(false);
  });
  test("CONFIRM_FIRST_PICK_SIDE exige side válido", () => {
    expect(isValidProtocolCommand({ type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" })).toBe(true);
    expect(isValidProtocolCommand({ type: "CONFIRM_FIRST_PICK_SIDE" })).toBe(false);
  });
  test("LOAD_CM_ELIGIBILITY delega en parseCmHeroEligibilitySnapshot -- rechaza forma inválida", () => {
    expect(isValidProtocolCommand({ type: "LOAD_CM_ELIGIBILITY", snapshot: {} })).toBe(false);
    expect(isValidProtocolCommand({ type: "LOAD_CM_ELIGIBILITY", snapshot: null })).toBe(false);
  });
  test("CM_ACTION exige actor relativo, kind BAN|PICK, heroId numérico", () => {
    expect(isValidProtocolCommand({ type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 9 })).toBe(true);
    expect(isValidProtocolCommand({ type: "CM_ACTION", actor: "third", kind: "BAN", heroId: 9 })).toBe(false);
    expect(isValidProtocolCommand({ type: "CM_ACTION", actor: "first", kind: "STEAL", heroId: 9 })).toBe(false);
  });
  test("CM_BAN_SKIPPED / CM_AUTO_PICK", () => {
    expect(isValidProtocolCommand({ type: "CM_BAN_SKIPPED", actor: "second" })).toBe(true);
    expect(isValidProtocolCommand({ type: "CM_AUTO_PICK", actor: "second", heroId: 3 })).toBe(true);
    expect(isValidProtocolCommand({ type: "CM_AUTO_PICK", actor: "second" })).toBe(false);
  });
  test("tipo desconocido, no-objeto, o sin `type` se rechazan sin lanzar", () => {
    expect(isValidProtocolCommand({ type: "TELEPORT" })).toBe(false);
    expect(isValidProtocolCommand("string")).toBe(false);
    expect(isValidProtocolCommand(null)).toBe(false);
    expect(isValidProtocolCommand(undefined)).toBe(false);
    expect(isValidProtocolCommand(42)).toBe(false);
    expect(isValidProtocolCommand({})).toBe(false);
  });
});

describe("isValidPartyContextInput", () => {
  test("acepta forma estructural válida", () => {
    expect(
      isValidPartyContextInput({
        partySize: 3,
        side: "radiant",
        controlledSlots: [{ side: "radiant", slotIndex: 0, controllerId: "me" }],
      }),
    ).toBe(true);
  });
  test("rechaza partySize 4 (aun antes de llegar a createPartyContext)", () => {
    expect(isValidPartyContextInput({ partySize: 4, side: "radiant", controlledSlots: [] })).toBe(false);
  });
  test("rechaza controlledSlots malformado", () => {
    expect(isValidPartyContextInput({ partySize: 2, side: "radiant", controlledSlots: [{ side: "radiant" }] })).toBe(false);
    expect(isValidPartyContextInput({ partySize: 2, side: "radiant", controlledSlots: "not-array" })).toBe(false);
  });
});

describe("isValidCreateProtocolSessionBody", () => {
  const validBody = {
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: "radiant",
    adapterKind: "simulator",
    partyContext: { partySize: 5, side: "radiant", controlledSlots: [] },
  } as const;

  test("exige perspectiva, adapter y PartyContext canónicos", () => {
    expect(isValidCreateProtocolSessionBody(validBody)).toBe(true);
    expect(isValidCreateProtocolSessionBody({ rulesetId: "dota2/ranked-all-pick", patch: "7.41e" })).toBe(false);
    expect(isValidCreateProtocolSessionBody({ ...validBody, localSide: "dire" })).toBe(false);
  });
  test("rechaza patch vacío o ausente", () => {
    expect(isValidCreateProtocolSessionBody({ ...validBody, patch: "" })).toBe(false);
    expect(isValidCreateProtocolSessionBody({ ...validBody, patch: undefined })).toBe(false);
  });
  test("rechaza rulesetId desconocido", () => {
    expect(isValidCreateProtocolSessionBody({ ...validBody, rulesetId: "dota2/single-draft" })).toBe(false);
  });
  test("rechaza partyContext malformado cuando está presente", () => {
    expect(isValidCreateProtocolSessionBody({ ...validBody, partyContext: { partySize: 4, side: "radiant", controlledSlots: [] } })).toBe(false);
  });
});

describe("isValidSubmitProtocolCommandBody", () => {
  test("acepta command válido con y sin viewerSide", () => {
    expect(isValidSubmitProtocolCommandBody({ command: { type: "BAN_RESOLUTION_COMPLETE" } })).toBe(true);
    expect(isValidSubmitProtocolCommandBody({ command: { type: "BAN_RESOLUTION_COMPLETE" }, viewerSide: "radiant" })).toBe(true);
    expect(isValidSubmitProtocolCommandBody({ command: { type: "BAN_RESOLUTION_COMPLETE" }, viewerSide: null })).toBe(true);
  });
  test("rechaza viewerSide inválido y command inválido", () => {
    expect(isValidSubmitProtocolCommandBody({ command: { type: "BAN_RESOLUTION_COMPLETE" }, viewerSide: "north" })).toBe(false);
    expect(isValidSubmitProtocolCommandBody({ command: { type: "NOPE" } })).toBe(false);
  });
});

describe("isValidSimulatorAuthorityBody / isValidBotSelectionBody", () => {
  test("seed no vacío, máximo 64 chars", () => {
    expect(isValidSimulatorAuthorityBody({ seed: "ABCDEFGH" })).toBe(true);
    expect(isValidSimulatorAuthorityBody({ seed: "" })).toBe(false);
    expect(isValidSimulatorAuthorityBody({ seed: "x".repeat(65) })).toBe(false);
  });
  test("bot-selection no acepta side controlado por el cliente", () => {
    expect(isValidBotSelectionBody({})).toBe(true);
    expect(isValidBotSelectionBody({ side: "dire" })).toBe(false);
  });
});
