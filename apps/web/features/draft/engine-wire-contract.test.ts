import { beforeEach, expect, test } from "bun:test";
import { createIdleDraftState } from "../../../engine/src/draft/reducer";
import { buildServerMessage } from "../../../engine/src/server/session";
import { buildSuggestions } from "../../../engine/src/signals/mix";
import { bindPreviewSuggestions } from "../random-draft-simulator/use-random-draft-session";
import { useRandomDraftStore } from "../random-draft-simulator/store";
import { FakeSocket } from "./fake-socket";
import { useDraftStore } from "./store";
import type { ServerMessage as WebServerMessage } from "./types";
import { isValidServerMessage, isValidSuggestionSet } from "./validation";

const engineDraftState = {
  ...createIdleDraftState("wire-contract"),
  phase: "active" as const,
  format: "all_pick" as const,
  localSide: "radiant" as const,
  turn: null,
};

const engineSuggestions = buildSuggestions(engineDraftState, {
  heroes: { 1: { id: 1, localizedName: "Uno" } },
  matchups: {},
}, { heroPositions: {}, heroCapabilities: [], teamOpening: true });

beforeEach(() => {
  useDraftStore.setState({
    connectionStatus: "desconectado",
    sessionId: null,
    draftState: null,
    suggestions: null,
    errorMessage: null,
    socket: null,
    inputMode: { action: "pick", side: "unknown" },
  });
});

test("gate: payloads reales de engine viajan por WS y preview HTTP hasta las tiendas Zustand", () => {
  const engineSnapshot = buildServerMessage("snapshot", engineDraftState.lastSeq, engineDraftState);
  const engineSuggestionMessage = buildServerMessage("suggestions", engineDraftState.lastSeq, engineSuggestions);

  // Candado estático: un cambio de contrato en apps/engine debe dejar de compilar aquí.
  const webSnapshot: WebServerMessage = engineSnapshot;
  const webSuggestionMessage: WebServerMessage = engineSuggestionMessage;
  const snapshotWire: unknown = JSON.parse(JSON.stringify(webSnapshot));
  const suggestionsWire: unknown = JSON.parse(JSON.stringify(webSuggestionMessage));

  expect(isValidServerMessage(snapshotWire)).toBe(true);
  expect(isValidServerMessage(suggestionsWire)).toBe(true);

  const socket = new FakeSocket();
  useDraftStore.getState().connect(socket, engineDraftState.sessionId, "test-token");
  socket.emit(snapshotWire as WebServerMessage);
  socket.emit(suggestionsWire as WebServerMessage);

  expect(useDraftStore.getState().draftState?.sessionId).toBe(engineDraftState.sessionId);
  expect(useDraftStore.getState().suggestions?.decisionContext).toBe("team_opening");

  const previewPayload: unknown = JSON.parse(JSON.stringify(engineSuggestions));
  expect(isValidSuggestionSet(previewPayload)).toBe(true);
  const preview = bindPreviewSuggestions(previewPayload, engineDraftState);
  expect(preview?.sessionId).toBe(engineDraftState.sessionId);
  expect(preview?.basedOnSeq).toBe(engineDraftState.lastSeq);

  useRandomDraftStore.getState().setDraftState(engineDraftState, preview);
  expect(useRandomDraftStore.getState().suggestions?.decisionContext).toBe("team_opening");
});

test("gate: un preview HTTP con forma alterada nunca se vincula a Zustand", () => {
  const malformed = { ...engineSuggestions, computedInMs: "instantáneo" };

  expect(isValidSuggestionSet(malformed)).toBe(false);
  expect(bindPreviewSuggestions(malformed, engineDraftState)).toBeNull();
});
