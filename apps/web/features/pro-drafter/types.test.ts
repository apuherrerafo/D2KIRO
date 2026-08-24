import { describe, expect, test } from "bun:test";
import type { DraftState } from "@/features/draft/types";
import { buildProDrafterRequest } from "./types";

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
