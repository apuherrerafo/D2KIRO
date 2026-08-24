import { afterEach, describe, expect, test } from "bun:test";
import type { DraftState, SuggestionSet } from "@/features/draft/types";
import { postDraftFeedback } from "./post-feedback";

const originalFetch = global.fetch;

function draftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "session-1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.41e",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [67], dire: [] },
    lastSeq: 3,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-08-21T00:00:00Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    turn: null,
    ...overrides,
  };
}

describe("postDraftFeedback", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("envía comment + draftState + suggestions al endpoint del sessionId correcto", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    global.fetch = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as typeof fetch;

    const state = draftState();
    const suggestions: SuggestionSet = {
      schema: "suggestions/v1",
      sessionId: "session-1",
      basedOnSeq: 3,
      suggestions: [],
      comparison: null,
      degraded: [],
      computedInMs: 5,
    };

    const result = await postDraftFeedback("session-1", "esta sugerencia no tiene sentido", state, suggestions);

    expect(capturedUrl).toContain("/api/session/session-1/feedback");
    expect(capturedBody).toEqual({ comment: "esta sugerencia no tiene sentido", draftState: state, suggestions });
    expect(result).toEqual({ accepted: true });
  });

  test("suggestions null (reporte antes de que llegara ninguna sugerencia) se manda tal cual", async () => {
    let capturedBody: Record<string, unknown> = {};
    global.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as typeof fetch;

    await postDraftFeedback("session-1", "todavía no cargó nada", draftState(), null);

    expect(capturedBody.suggestions).toBeNull();
  });
});
