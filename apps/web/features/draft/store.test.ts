import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeSocket } from "./fake-socket";
import { deriveScreenState, useDraftStore } from "./store";
import type { DraftState, ServerMessage, SuggestionSet } from "./types";

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
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    turn: null,
    ...overrides,
  };
}

function suggestionSet(overrides: Partial<SuggestionSet> = {}): SuggestionSet {
  return {
    schema: "suggestions/v1",
    sessionId: "s1",
    basedOnSeq: 1,
    decisionContext: "blind_second_pick",
    suggestions: [],
    comparison: null,
    degraded: [],
    computedInMs: 5,
    ...overrides,
  };
}

function serverMessage(type: ServerMessage["type"], payload: ServerMessage["payload"]): ServerMessage {
  return { schema: "draft-ws/v1", type, seq: 1, sentAt: "2026-07-27T00:00:00Z", payload };
}

beforeEach(() => {
  useDraftStore.setState({
    connectionStatus: "desconectado",
    sessionId: null,
    draftState: null,
    suggestions: null,
    errorMessage: null,
    socket: null,
    inputMode: { action: "pick", side: "unknown" },
    archetypeIntent: null,
  });
});

describe("los 6 estados de pantalla (S5)", () => {
  test("desconectado: estado inicial, sin conexión todavía", () => {
    expect(deriveScreenState(useDraftStore.getState())).toBe("desconectado");
  });

  test("esperando_draft: conectado, snapshot con fase idle", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    socket.emit(serverMessage("snapshot", draftState({ phase: "idle" })));

    expect(deriveScreenState(useDraftStore.getState())).toBe("esperando_draft");
  });

  test("activo: fase active, sin degradación", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    socket.emit(serverMessage("draft_state", draftState({ phase: "active" })));
    socket.emit(serverMessage("suggestions", suggestionSet({ degraded: [] })));

    expect(deriveScreenState(useDraftStore.getState())).toBe("activo");
  });

  test("degradado: fase active, con degraded no vacío", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    socket.emit(serverMessage("draft_state", draftState({ phase: "active" })));
    socket.emit(serverMessage("suggestions", suggestionSet({ degraded: ["stale_meta"] })));

    expect(deriveScreenState(useDraftStore.getState())).toBe("degradado");
  });

  test("completo: fase complete, y también fase aborted", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    socket.emit(serverMessage("draft_state", draftState({ phase: "complete" })));
    expect(deriveScreenState(useDraftStore.getState())).toBe("completo");

    socket.emit(serverMessage("draft_state", draftState({ phase: "aborted" })));
    expect(deriveScreenState(useDraftStore.getState())).toBe("completo");
  });

  test("error: un mensaje de error del servidor prevalece sobre cualquier otro estado", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    socket.emit(serverMessage("draft_state", draftState({ phase: "active" })));
    socket.emit(serverMessage("error", { code: "boom", message: "Algo salió mal" }));

    expect(deriveScreenState(useDraftStore.getState())).toBe("error");
    expect(useDraftStore.getState().errorMessage).toBe("Algo salió mal");
  });

  test("desconectado tras un cierre real de socket: el último draftState/suggestions siguen disponibles, atenuados por la vista", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    socket.emit(serverMessage("draft_state", draftState({ phase: "active" })));
    socket.emitClose();

    const state = useDraftStore.getState();
    expect(deriveScreenState(state)).toBe("desconectado");
    expect(state.draftState?.phase).toBe("active"); // último conocido, no se limpia
  });

  test("un mensaje con forma inesperada se descarta en silencio y no corrompe el estado (hallazgo @redteam ronda 1)", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    socket.emit(serverMessage("draft_state", draftState({ phase: "active" })));
    const before = useDraftStore.getState().draftState;

    // Simula un mensaje malformado real (ej. un bug de versión de contrato en el servidor) --
    // el cast a ServerMessage aquí es exactamente lo que JSON.parse produciría en producción.
    socket.emit({ schema: "draft-ws/v1", type: "draft_state", seq: 2, sentAt: "x", payload: { picks: "no-es-un-objeto" } } as unknown as ServerMessage);

    const state = useDraftStore.getState();
    expect(state.draftState).toBe(before); // sin cambios, el mensaje inválido no se aplicó
    expect(deriveScreenState(state)).not.toBe("error"); // tampoco se cuela como un error visible
  });
});

describe("conexión (hello / snapshot)", () => {
  test("connect() manda hello con el sessionId correcto", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "session-xyz", "test-token");

    expect(socket.sentMessages).toEqual([{ schema: "draft-ws/v1", type: "hello", sessionId: "session-xyz", accountToken: "test-" + "token" }]);
  });

  test("clearError() limpia el error sin tocar el resto del estado", () => {
    useDraftStore.setState({ errorMessage: "algo", draftState: draftState({ phase: "active" }) });
    useDraftStore.getState().clearError();

    const state = useDraftStore.getState();
    expect(state.errorMessage).toBeNull();
    expect(state.draftState?.phase).toBe("active");
  });

  test("connect() guarda el sessionId en el store", () => {
    useDraftStore.getState().connect(new FakeSocket(), "session-correction", "test-token");
    expect(useDraftStore.getState().sessionId).toBe("session-correction");
  });
});

describe("inputMode (DraftInputMode, RCA post-TSK-076)", () => {
  test("por defecto empieza en pick sin lado -- ninguna sesión hereda el lado de otra", () => {
    expect(useDraftStore.getState().inputMode).toEqual({ action: "pick", side: "unknown" });
  });

  test("setInputMode actualiza solo el campo que se le pasa", () => {
    useDraftStore.getState().setInputMode({ action: "ban" });
    expect(useDraftStore.getState().inputMode).toEqual({ action: "ban", side: "unknown" });

    useDraftStore.getState().setInputMode({ side: "dire" });
    expect(useDraftStore.getState().inputMode).toEqual({ action: "ban", side: "dire" });
  });

  test("connect() reinicia inputMode a pick/unknown, aunque la sesión anterior tuviera un lado elegido", () => {
    useDraftStore.getState().setInputMode({ side: "dire" });
    useDraftStore.getState().connect(new FakeSocket(), "session-nueva", "test-token");

    expect(useDraftStore.getState().inputMode).toEqual({ action: "pick", side: "unknown" });
  });

  test("un draft_state con localSide conocido completa el lado UNA sola vez", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    socket.emit(serverMessage("draft_state", draftState({ localSide: "dire" })));

    expect(useDraftStore.getState().inputMode).toEqual({ action: "pick", side: "dire" });
  });

  test("el auto-completado nunca pisa un lado ya elegido a mano", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    socket.emit(serverMessage("draft_state", draftState({ localSide: "radiant" })));
    expect(useDraftStore.getState().inputMode.side).toBe("radiant");

    // ManualEntryPanel: el usuario apunta deliberadamente al lado contrario para registrar un
    // pick del rival -- un segundo draft_state con el mismo localSide no debe revertirlo.
    useDraftStore.getState().setInputMode({ side: "dire" });
    socket.emit(serverMessage("draft_state", draftState({ localSide: "radiant", lastSeq: 2 })));

    expect(useDraftStore.getState().inputMode.side).toBe("dire");
  });
});

describe("intención de draft (TSK-181, Fase 4.3)", () => {
  test("por defecto es null", () => {
    expect(useDraftStore.getState().archetypeIntent).toBeNull();
  });

  test("setArchetypeIntent fija el estado local y manda set_intent por el socket", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    socket.sentMessages.length = 0; // descartar el hello

    useDraftStore.getState().setArchetypeIntent("push");
    expect(useDraftStore.getState().archetypeIntent).toBe("push");
    expect(socket.sentMessages).toEqual([{ schema: "draft-ws/v1", type: "set_intent", sessionId: "s1", archetypeIntent: "push" }]);
  });

  test("setArchetypeIntent(null) limpia y manda set_intent con null", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    useDraftStore.getState().setArchetypeIntent("teamfight");
    socket.sentMessages.length = 0;

    useDraftStore.getState().setArchetypeIntent(null);
    expect(useDraftStore.getState().archetypeIntent).toBeNull();
    expect(socket.sentMessages).toEqual([{ schema: "draft-ws/v1", type: "set_intent", sessionId: "s1", archetypeIntent: null }]);
  });

  test("connect() re-envía la intención tras el hello si hay una puesta", () => {
    const first = new FakeSocket();
    useDraftStore.getState().connect(first, "s1", "test-token");
    useDraftStore.getState().setArchetypeIntent("pickoff");

    const reconnect = new FakeSocket();
    useDraftStore.getState().connect(reconnect, "s1", "test-token");
    expect(reconnect.sentMessages).toEqual([
      { schema: "draft-ws/v1", type: "hello", sessionId: "s1", accountToken: "test-" + "token" },
      { schema: "draft-ws/v1", type: "set_intent", sessionId: "s1", archetypeIntent: "pickoff" },
    ]);
  });

  test("connect() sin intención puesta manda sólo el hello (no un set_intent espurio)", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    expect(socket.sentMessages).toEqual([{ schema: "draft-ws/v1", type: "hello", sessionId: "s1", accountToken: "test-" + "token" }]);
  });
});

describe("correctHero (TSK-013)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("envía pick_reverted vía POST /api/session/manual usando el sessionId y lastSeq guardados", async () => {
    let capturedBody: Record<string, unknown> = {};
    global.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as typeof fetch;

    useDraftStore.setState({ sessionId: "session-correction", draftState: draftState({ lastSeq: 7 }) });
    await useDraftStore.getState().correctHero(1, "radiant");

    expect(capturedBody).toMatchObject({
      sessionId: "session-correction",
      seq: 8,
      source: "manual",
      payload: { type: "pick_reverted", hero: 1, side: "radiant" },
    });
  });

  test("sin sessionId (nunca conectado), no intenta enviar nada", async () => {
    let fetchCalled = false;
    global.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;

    useDraftStore.setState({ sessionId: null });
    await useDraftStore.getState().correctHero(1, "radiant");

    expect(fetchCalled).toBe(false);
  });

  test("un fallo de red no queda como una promesa rechazada sin capturar (hallazgo @redteam)", async () => {
    global.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    useDraftStore.setState({ sessionId: "session-correction", draftState: draftState({ lastSeq: 1 }) });

    await expect(useDraftStore.getState().correctHero(1, "radiant")).resolves.toBeUndefined();
  });
});
