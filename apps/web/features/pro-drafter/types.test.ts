import { describe, expect, test } from "bun:test";
import type { DraftState } from "@/features/draft/types";
import { buildProDrafterRequest, toProDrafterView } from "./types";
import type { LegacySuggestionSetResponse, ProDrafterResponse } from "./types";

function draftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.41e",
    localSide: "radiant",
    phase: "active",
    banned: [1, 2],
    picks: { radiant: [3], dire: [4, 5] },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: new Date(0).toISOString(),
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    turn: null,
    ...overrides,
  };
}

describe("buildProDrafterRequest", () => {
  test("extrae solo los campos del contrato de entrada del motor", () => {
    const state = draftState();
    expect(buildProDrafterRequest(state)).toEqual({
      format: "all_pick",
      patch: "7.41e",
      localSide: "radiant",
      banned: [1, 2],
      picks: { radiant: [3], dire: [4, 5] },
    });
  });

  test("format y localSide \"unknown\" viajan tal cual, mismo contrato que acepta el motor", () => {
    const state = draftState({ format: "unknown", localSide: "unknown" });
    const request = buildProDrafterRequest(state);
    expect(request.format).toBe("unknown");
    expect(request.localSide).toBe("unknown");
  });
});

// Fase 3 (sesión Gobernanza 2.0): retrocompatibilidad real, no hipotética -- con
// ENABLE_PRO_DRAFTER apagado del lado del motor, POST /api/v1/draft/pro-recommendations responde
// con el shape v5 legacy en la MISMA url (server/app.ts:258-260), nunca ProDrafterResponse.
describe("toProDrafterView -- retrocompatibilidad con el flag del motor apagado/encendido", () => {
  test("con el shape de Pro-Drafter real, usa engine_version/fallback_applied/cache_hit tal cual", () => {
    const response: ProDrafterResponse = {
      schema: "pro-drafter-suggestions/v1",
      suggestions: [{ hero: 101, rank: 1, score: 0.8, signals: [{ signal: "knn_similarity", raw: 0.5 }] }],
      fallback_applied: false,
      cache_hit: true,
      engine_version: "pro-drafter",
    };

    const view = toProDrafterView(response);

    expect(view.engineVersion).toBe("pro-drafter");
    expect(view.cacheHit).toBe(true);
    expect(view.fallbackApplied).toBe(false);
    expect(view.suggestions).toEqual(response.suggestions);
  });

  test("con el shape legacy v5 (flag apagado del lado del motor), normaliza a engine_version:\"v5\" sin lanzar", () => {
    const legacy: LegacySuggestionSetResponse = {
      schema: "suggestions/v1",
      suggestions: [{ hero: 202, rank: 1, score: 0.42 }],
    };

    const view = toProDrafterView(legacy);

    expect(view.engineVersion).toBe("v5");
    expect(view.fallbackApplied).toBe(true);
    expect(view.cacheHit).toBe(false);
    expect(view.suggestions).toEqual([{ hero: 202, rank: 1, score: 0.42, signals: [] }]);
  });

  test("el shape legacy nunca fabrica señales de Pro-Drafter que v5 no calculó", () => {
    const legacy: LegacySuggestionSetResponse = { schema: "suggestions/v1", suggestions: [{ hero: 303, rank: 2, score: 0.1 }] };

    const view = toProDrafterView(legacy);

    expect(view.suggestions[0]?.signals).toEqual([]);
  });
});
