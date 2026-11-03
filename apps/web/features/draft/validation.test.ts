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

function validSignalContribution() {
  return { signal: "counter", raw: 0.05, weighted: 12, explanation: "x", sampleSize: 40 };
}

function validSuggestion() {
  return {
    hero: 7,
    rank: 1,
    score: 72,
    signals: [validSignalContribution()],
    reason: "Resumen.",
    confidence: "media",
    // TSK-210 (Fase 9.1, §16.9): requeridos, en [0, 1].
    evidenceCoverage: 0.62,
    guessingIndex: 0.38,
  };
}

function withSuggestion(over: Record<string, unknown>) {
  return envelope("suggestions", { ...validSuggestionSet(), suggestions: [{ ...validSuggestion(), ...over }] });
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

  test("accepts exact no_signal_available literals and rejects unknown ones", () => {
    expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), decisionContext: "no_signal_available", degraded: ["no_signal_available"] }))).toBe(true);
    expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), decisionContext: "unknown_context" }))).toBe(false);
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

  // TSK-211 (Fase 9.1, SPEC.md §16.9): espejo de SignalContribution v2 + Suggestion.
  test("acepta un Suggestion completo con los campos nuevos de 9.1", () => {
    expect(isValidServerMessage(withSuggestion({}))).toBe(true);
  });

  test("SignalContribution: normalized/evidenceConfidence son opcionales (el motor los dejó opcionales)", () => {
    const bare = { signal: "counter", raw: null, weighted: 0, explanation: "", sampleSize: 0 };
    expect(isValidServerMessage(withSuggestion({ signals: [bare] }))).toBe(true);
    // presentes y bien formados
    expect(isValidServerMessage(withSuggestion({ signals: [{ ...bare, normalized: null, evidenceConfidence: 0 }] }))).toBe(true);
    expect(isValidServerMessage(withSuggestion({ signals: [{ ...bare, raw: 0.1, normalized: 55, evidenceConfidence: 0.7 }] }))).toBe(true);
  });

  test("SignalContribution: normalized no numérico o evidenceConfidence NaN -> inválido", () => {
    const base = validSignalContribution();
    expect(isValidServerMessage(withSuggestion({ signals: [{ ...base, normalized: "x" }] }))).toBe(false);
    expect(isValidServerMessage(withSuggestion({ signals: [{ ...base, evidenceConfidence: Number.NaN }] }))).toBe(false);
  });

  test("Suggestion: evidenceCoverage/guessingIndex fuera de [0,1] o ausentes -> inválido", () => {
    expect(isValidServerMessage(withSuggestion({ evidenceCoverage: 1.5 }))).toBe(false);
    expect(isValidServerMessage(withSuggestion({ guessingIndex: -0.1 }))).toBe(false);
    expect(isValidServerMessage(withSuggestion({ evidenceCoverage: undefined }))).toBe(false);
  });

  test("rechaza schema/type inválidos o valores no-objeto", () => {
    expect(isValidServerMessage(null)).toBe(false);
    expect(isValidServerMessage("texto")).toBe(false);
    expect(isValidServerMessage(envelope("otro-tipo", validDraftState()))).toBe(false);
    expect(isValidServerMessage({ ...envelope("draft_state", validDraftState()), schema: "otro" })).toBe(false);
  });

  describe("PB-R4 rollout compatibility -- forward-compatible degradation flags", () => {
    test("accepts known degradation flags", () => {
      for (const flag of ["stale_meta", "partial_signals", "unconfirmed_state", "unknown_format", "no_signal_available", "patch_meta_data_not_ready"]) {
        expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), degraded: [flag] }))).toBe(true);
      }
    });

    test("forward-compatible: accepts unknown future degradation flags without dropping suggestions", () => {
      expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), degraded: ["future_experimental_flag", "stale_meta"] }))).toBe(true);
    });

    test("rejects malformed degradation flag values (non-string, empty string, null)", () => {
      expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), degraded: [123] }))).toBe(false);
      expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), degraded: [""] }))).toBe(false);
      expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), degraded: [null] }))).toBe(false);
      expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), degraded: [{ flag: "stale_meta" }] }))).toBe(false);
    });

    test("does not weaken validation of core recommendation fields", () => {
      // Missing or invalid hero ID
      expect(isValidServerMessage(withSuggestion({ hero: "not-a-number" }))).toBe(false);
      expect(isValidServerMessage(withSuggestion({ hero: -1 }))).toBe(false);
      expect(isValidServerMessage(withSuggestion({ hero: 0 }))).toBe(false);

      // Invalid rank
      expect(isValidServerMessage(withSuggestion({ rank: 7 }))).toBe(false);
      expect(isValidServerMessage(withSuggestion({ rank: 0 }))).toBe(false);

      // Invalid score
      expect(isValidServerMessage(withSuggestion({ score: "high" }))).toBe(false);
      expect(isValidServerMessage(withSuggestion({ score: Number.NaN }))).toBe(false);

      // Invalid confidence
      expect(isValidServerMessage(withSuggestion({ confidence: "very_high" }))).toBe(false);

      // Invalid decision context
      expect(isValidServerMessage(envelope("suggestions", { ...validSuggestionSet(), decisionContext: "unknown_context" }))).toBe(false);
    });
  });
});
