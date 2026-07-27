import { describe, expect, test } from "bun:test";
import {
  applyDraftEvent,
  createIdleDraftState,
  type DraftEvent,
  type DraftEventEnvelope,
  type DraftState,
} from "./reducer";

function envelope(
  seq: number,
  payload: DraftEvent,
  overrides: Partial<DraftEventEnvelope> = {},
): DraftEventEnvelope {
  return {
    schema: "draft-event/v1",
    eventId: `evt-${seq}`,
    sessionId: "session-1",
    seq,
    emittedAt: `2026-07-27T00:00:${String(seq).padStart(2, "0")}Z`,
    source: "simulator",
    confidence: 1,
    payload,
    ...overrides,
  };
}

function idle(sessionId = "session-1"): DraftState {
  return createIdleDraftState(sessionId);
}

function active(sessionId = "session-1"): DraftState {
  const { state } = applyDraftEvent(
    idle(sessionId),
    envelope(1, { type: "session_started", format: "all_pick", patch: "7.36" }, { sessionId }),
  );
  return state;
}

describe("transiciones de fase", () => {
  test("idle -> active vía session_started", () => {
    const { state, rejected } = applyDraftEvent(
      idle(),
      envelope(1, { type: "session_started", format: "all_pick", patch: "7.36" }),
    );
    expect(rejected).toBeUndefined();
    expect(state.phase).toBe("active");
    expect(state.format).toBe("all_pick");
    expect(state.patch).toBe("7.36");
  });

  test("active -> complete vía session_ended: completed", () => {
    const { state, rejected } = applyDraftEvent(
      active(),
      envelope(2, { type: "session_ended", reason: "completed" }),
    );
    expect(rejected).toBeUndefined();
    expect(state.phase).toBe("complete");
  });

  test("active -> aborted vía session_ended: aborted|lost_capture", () => {
    const aborted = applyDraftEvent(active(), envelope(2, { type: "session_ended", reason: "aborted" }));
    expect(aborted.state.phase).toBe("aborted");

    const lost = applyDraftEvent(active(), envelope(2, { type: "session_ended", reason: "lost_capture" }));
    expect(lost.state.phase).toBe("aborted");
  });

  test("una nueva sessionId en session_started vuelve el estado a idle y arranca de nuevo", () => {
    const stale = active("session-1");
    const { state, rejected } = applyDraftEvent(
      stale,
      envelope(1, { type: "session_started", format: "unknown", patch: "7.36" }, { sessionId: "session-2" }),
    );
    expect(rejected).toBeUndefined();
    expect(state.sessionId).toBe("session-2");
    expect(state.phase).toBe("active");
    expect(state.banned).toEqual([]);
    expect(state.picks).toEqual({ radiant: [], dire: [] });
  });

  test("format: 'unknown' es un estado legítimo, no bloquea la sesión", () => {
    const { state, rejected } = applyDraftEvent(
      idle(),
      envelope(1, { type: "session_started", format: "unknown", patch: "7.36" }),
    );
    expect(rejected).toBeUndefined();
    expect(state.format).toBe("unknown");
    expect(state.phase).toBe("active");
  });

  test("eventos en fase complete se rechazan con wrong_phase", () => {
    const { state: completeState } = applyDraftEvent(
      active(),
      envelope(2, { type: "session_ended", reason: "completed" }),
    );
    const { state, rejected } = applyDraftEvent(
      completeState,
      envelope(3, { type: "hero_picked", hero: 1, side: "radiant" }),
    );
    expect(rejected).toBe("wrong_phase");
    expect(state).toBe(completeState);
  });
});

describe("cada RejectionReason", () => {
  test("duplicate_event: eventId repetido se descarta en silencio", () => {
    const applied = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }),
    ).state;
    const { state, rejected } = applyDraftEvent(
      applied,
      envelope(3, { type: "hero_banned", hero: 2, side: "dire" }, { eventId: "evt-2" }),
    );
    expect(rejected).toBe("duplicate_event");
    expect(state).toBe(applied);
    expect(state.banned).toEqual([1]);
  });

  test("stale_seq: seq <= lastSeq se rechaza, salvo pick_reverted", () => {
    const applied = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }),
    ).state;
    const { state, rejected } = applyDraftEvent(
      applied,
      envelope(2, { type: "hero_banned", hero: 3, side: "dire" }, { eventId: "evt-stale" }),
    );
    expect(rejected).toBe("stale_seq");
    expect(state).toBe(applied);
  });

  test("pick_reverted siempre se evalúa aunque su seq sea menor a lastSeq", () => {
    const banned = applyDraftEvent(
      active(),
      envelope(5, { type: "hero_banned", hero: 1, side: "radiant" }),
    ).state;
    expect(banned.lastSeq).toBe(5);

    const { state, rejected } = applyDraftEvent(
      banned,
      envelope(2, { type: "pick_reverted", hero: 1, side: "radiant" }, { eventId: "evt-revert" }),
    );
    expect(rejected).toBeUndefined();
    expect(state.banned).toEqual([]);
    expect(state.lastSeq).toBe(5);
  });

  test("wrong_phase: evento distinto de session_started rechazado en fase idle", () => {
    const before = idle();
    const { state, rejected } = applyDraftEvent(
      before,
      envelope(1, { type: "hero_picked", hero: 1, side: "radiant" }),
    );
    expect(rejected).toBe("wrong_phase");
    expect(state).toBe(before);
  });

  test("unknown_hero: heroId no es un entero positivo", () => {
    const { state, rejected } = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_picked", hero: -1, side: "radiant" }),
    );
    expect(rejected).toBe("unknown_hero");
    expect(state.picks.radiant).toEqual([]);
  });

  test("hero_already_taken: héroe ya baneado no puede ser picked", () => {
    const banned = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }),
    ).state;
    const { state, rejected } = applyDraftEvent(
      banned,
      envelope(3, { type: "hero_picked", hero: 1, side: "dire" }),
    );
    expect(rejected).toBe("hero_already_taken");
    expect(state).toBe(banned);
  });
});

describe("pureza y otros eventos", () => {
  test("misma entrada produce siempre la misma salida", () => {
    const base = active();
    const env = envelope(2, { type: "hero_picked", hero: 1, side: "radiant" });
    const first = applyDraftEvent(base, env);
    const second = applyDraftEvent(base, env);
    expect(first).toEqual(second);
    expect(base.picks.radiant).toEqual([]); // el estado original nunca se muta
  });

  test("local_side_identified actualiza localSide", () => {
    const { state } = applyDraftEvent(active(), envelope(2, { type: "local_side_identified", side: "dire" }));
    expect(state.localSide).toBe("dire");
  });

  test("capture_health actualiza quality.captureStatus", () => {
    const { state } = applyDraftEvent(
      active(),
      envelope(2, { type: "capture_health", status: "degraded", detail: "OCR confidence baja" }),
    );
    expect(state.quality.captureStatus).toBe("degraded");
  });

  test("un evento rechazado nunca corrompe el estado anterior", () => {
    const before = active();
    const { state, rejected } = applyDraftEvent(
      before,
      envelope(2, { type: "hero_picked", hero: 0, side: "radiant" }),
    );
    expect(rejected).toBe("unknown_hero");
    expect(state).toBe(before);
  });
});
