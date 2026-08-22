import { afterEach, describe, expect, test } from "bun:test";
import { bootstrapManualSession, shouldBootstrapManualSession } from "./bootstrap-session";
import type { DraftState } from "./types";

const originalFetch = global.fetch;

function draftState(overrides: Partial<DraftState> = {}): DraftState {
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
    ...overrides,
  };
}

describe("bootstrapManualSession", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("manda session_started (seq 1) y local_side_identified (seq 2), en ese orden", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    global.fetch = (async (_url: string, init: RequestInit) => {
      capturedBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as typeof fetch;

    await bootstrapManualSession("session-1");

    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ seq: 1, source: "manual", payload: { type: "session_started", format: "all_pick" } });
    expect(capturedBodies[1]).toMatchObject({ seq: 2, source: "manual", payload: { type: "local_side_identified", side: "radiant" } });
  });
});

// TSK-061: regresión exacta de TSK-053 -- antes de extraer esta función, el condicional vivía
// inline en DraftView.openManualEntry sin ninguna prueba propia.
describe("shouldBootstrapManualSession", () => {
  test("sin draftState (sesión nunca vista todavía) -> true", () => {
    expect(shouldBootstrapManualSession(null)).toBe(true);
  });

  test("phase:idle (sesión arrancada por entrada manual pura) -> true", () => {
    expect(shouldBootstrapManualSession(draftState({ phase: "idle" }))).toBe(true);
  });

  test("phase:active (sesión ya en curso) -> false, nunca reemitir session_started sobre un draft activo", () => {
    expect(shouldBootstrapManualSession(draftState({ phase: "active" }))).toBe(false);
  });

  test("phase:complete -> false", () => {
    expect(shouldBootstrapManualSession(draftState({ phase: "complete" }))).toBe(false);
  });

  test("phase:aborted -> false", () => {
    expect(shouldBootstrapManualSession(draftState({ phase: "aborted" }))).toBe(false);
  });
});
