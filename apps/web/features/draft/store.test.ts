import { beforeEach, describe, expect, test } from "bun:test";
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
    ...overrides,
  };
}

function suggestionSet(overrides: Partial<SuggestionSet> = {}): SuggestionSet {
  return {
    schema: "suggestions/v1",
    sessionId: "s1",
    basedOnSeq: 1,
    suggestions: [],
    degraded: [],
    computedInMs: 5,
    ...overrides,
  };
}

function serverMessage(type: ServerMessage["type"], payload: ServerMessage["payload"]): ServerMessage {
  return { schema: "draft-ws/v1", type, seq: 1, sentAt: "2026-07-27T00:00:00Z", payload };
}

beforeEach(() => {
  useDraftStore.setState({ connectionStatus: "desconectado", draftState: null, suggestions: null, errorMessage: null, socket: null });
});

describe("los 6 estados de pantalla (S5)", () => {
  test("desconectado: estado inicial, sin conexión todavía", () => {
    expect(deriveScreenState(useDraftStore.getState())).toBe("desconectado");
  });

  test("esperando_draft: conectado, snapshot con fase idle", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1");
    socket.emit(serverMessage("snapshot", draftState({ phase: "idle" })));

    expect(deriveScreenState(useDraftStore.getState())).toBe("esperando_draft");
  });

  test("activo: fase active, sin degradación", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1");
    socket.emit(serverMessage("draft_state", draftState({ phase: "active" })));
    socket.emit(serverMessage("suggestions", suggestionSet({ degraded: [] })));

    expect(deriveScreenState(useDraftStore.getState())).toBe("activo");
  });

  test("degradado: fase active, con degraded no vacío", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1");
    socket.emit(serverMessage("draft_state", draftState({ phase: "active" })));
    socket.emit(serverMessage("suggestions", suggestionSet({ degraded: ["stale_meta"] })));

    expect(deriveScreenState(useDraftStore.getState())).toBe("degradado");
  });

  test("completo: fase complete, y también fase aborted", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1");
    socket.emit(serverMessage("draft_state", draftState({ phase: "complete" })));
    expect(deriveScreenState(useDraftStore.getState())).toBe("completo");

    socket.emit(serverMessage("draft_state", draftState({ phase: "aborted" })));
    expect(deriveScreenState(useDraftStore.getState())).toBe("completo");
  });

  test("error: un mensaje de error del servidor prevalece sobre cualquier otro estado", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1");
    socket.emit(serverMessage("draft_state", draftState({ phase: "active" })));
    socket.emit(serverMessage("error", { code: "boom", message: "Algo salió mal" }));

    expect(deriveScreenState(useDraftStore.getState())).toBe("error");
    expect(useDraftStore.getState().errorMessage).toBe("Algo salió mal");
  });

  test("desconectado tras un cierre real de socket: el último draftState/suggestions siguen disponibles, atenuados por la vista", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1");
    socket.emit(serverMessage("draft_state", draftState({ phase: "active" })));
    socket.emitClose();

    const state = useDraftStore.getState();
    expect(deriveScreenState(state)).toBe("desconectado");
    expect(state.draftState?.phase).toBe("active"); // último conocido, no se limpia
  });

  test("un mensaje con forma inesperada se descarta en silencio y no corrompe el estado (hallazgo @redteam ronda 1)", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1");
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
    useDraftStore.getState().connect(socket, "session-xyz");

    expect(socket.sentMessages).toEqual([{ schema: "draft-ws/v1", type: "hello", sessionId: "session-xyz" }]);
  });

  test("clearError() limpia el error sin tocar el resto del estado", () => {
    useDraftStore.setState({ errorMessage: "algo", draftState: draftState({ phase: "active" }) });
    useDraftStore.getState().clearError();

    const state = useDraftStore.getState();
    expect(state.errorMessage).toBeNull();
    expect(state.draftState?.phase).toBe("active");
  });
});
