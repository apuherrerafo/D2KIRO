import { describe, expect, test } from "bun:test";
import type { DraftEventEnvelope } from "../draft/reducer";
import { SessionStore } from "./session";

function envelope(sessionId: string, overrides: Partial<DraftEventEnvelope> = {}): DraftEventEnvelope {
  return {
    schema: "draft-event/v1",
    eventId: `evt-${sessionId}-${Math.random()}`,
    sessionId,
    seq: 1,
    emittedAt: "2026-08-21T00:00:00Z",
    source: "simulator",
    confidence: 1,
    payload: { type: "session_started", format: "all_pick", patch: "7.36" },
    ...overrides,
  };
}

describe("SessionStore (TSK-055)", () => {
  test("get() sin sesión previa devuelve estado idle, sin crear una entrada", () => {
    const store = new SessionStore();
    const state = store.get("nunca-existio");
    expect(state.phase).toBe("idle");
    expect(store.size).toBe(0);
  });

  test("apply() persiste el estado resultante, recuperable con get()", () => {
    const store = new SessionStore();
    store.apply(envelope("session-a"));
    expect(store.get("session-a").phase).toBe("active");
    expect(store.size).toBe(1);
  });

  test("evictStale() borra una sesión sin actividad por más del TTL", () => {
    const store = new SessionStore();
    const t0 = 1_000_000;
    store.apply(envelope("session-abandonada"), t0);

    store.evictStale(t0 + 46 * 60 * 1000, 45 * 60 * 1000);

    expect(store.size).toBe(0);
    // get() tras la expiración vuelve a devolver idle -- la sesión ya no existe.
    expect(store.get("session-abandonada").phase).toBe("idle");
  });

  test("evictStale() nunca borra una sesión accedida dentro del TTL", () => {
    const store = new SessionStore();
    const t0 = 1_000_000;
    store.apply(envelope("session-activa"), t0);

    // Un get() a mitad de camino cuenta como actividad -- refresca lastAccessedAt.
    store.get("session-activa", t0 + 40 * 60 * 1000);
    store.evictStale(t0 + 50 * 60 * 1000, 45 * 60 * 1000);

    expect(store.size).toBe(1);
    expect(store.get("session-activa").phase).toBe("active");
  });

  test("evictStale() con varias sesiones solo borra las que corresponde", () => {
    const store = new SessionStore();
    const t0 = 1_000_000;
    store.apply(envelope("vieja"), t0);
    store.apply(envelope("nueva"), t0 + 44 * 60 * 1000);

    store.evictStale(t0 + 45 * 60 * 1000 + 1, 45 * 60 * 1000);

    expect(store.size).toBe(1);
    expect(store.get("nueva").phase).toBe("active");
  });
});
