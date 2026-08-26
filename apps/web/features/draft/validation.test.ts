import { describe, expect, test } from "bun:test";
import { isValidServerMessage } from "./validation";

function validDraftState() {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.36",
    localSide: "radiant",
    phase: "idle",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-07-27T00:00:00Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    turn: null,
  };
}

function validSuggestionSet() {
  return {
    schema: "suggestions/v1",
    sessionId: "s1",
    basedOnSeq: 1,
    decisionContext: "blind_second_pick",
    suggestions: [],
    comparison: null,
    degraded: [],
    computedInMs: 1,
  };
}

function envelope(type: string, payload: unknown) {
  return { schema: "draft-ws/v1", type, seq: 1, sentAt: "2026-07-27T00:00:00Z", payload };
}

describe("isValidServerMessage", () => {
  test("acepta snapshot/draft_state con un DraftState válido", () => {
    expect(isValidServerMessage(envelope("snapshot", validDraftState()))).toBe(true);
    expect(isValidServerMessage(envelope("draft_state", validDraftState()))).toBe(true);
  });

  test("acepta suggestions/error válidos", () => {
    expect(isValidServerMessage(envelope("suggestions", validSuggestionSet()))).toBe(true);
    expect(isValidServerMessage(envelope("error", { code: "boom", message: "algo" }))).toBe(true);
  });

  test("rechaza suggestions incompletas antes de que lleguen a Zustand", () => {
    expect(isValidServerMessage(envelope("suggestions", { schema: "suggestions/v1", suggestions: [], degraded: [] }))).toBe(false);
  });

  test("rechaza payload con forma inesperada sin lanzar (hallazgo @redteam ronda 1, TSK-012)", () => {
    expect(isValidServerMessage(envelope("draft_state", { picks: "no-es-un-objeto" }))).toBe(false);
    expect(isValidServerMessage(envelope("draft_state", { ...validDraftState(), picks: undefined }))).toBe(false);
    expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), suggestions: "no-es-array" }))).toBe(false);
    expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), decisionContext: "inventado" }))).toBe(false);
    expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), computedInMs: "rápido" }))).toBe(false);
    expect(isValidServerMessage(envelope("error", { code: 123 }))).toBe(false);
  });

  test("rechaza schema/type inválidos o valores no-objeto", () => {
    expect(isValidServerMessage(null)).toBe(false);
    expect(isValidServerMessage("texto")).toBe(false);
    expect(isValidServerMessage(envelope("otro-tipo", validDraftState()))).toBe(false);
    expect(isValidServerMessage({ ...envelope("draft_state", validDraftState()), schema: "otro" })).toBe(false);
  });
});
