import { create } from "zustand";
import type { DraftSocket, DraftState, ErrorPayload, ScreenState, ServerMessage, SuggestionSet } from "./types";
import { isValidServerMessage } from "./validation";

export interface DraftStoreState {
  connectionStatus: "desconectado" | "conectando" | "conectado";
  draftState: DraftState | null;
  suggestions: SuggestionSet | null;
  errorMessage: string | null;
  socket: DraftSocket | null;
  connect: (socket: DraftSocket, sessionId: string) => void;
  disconnect: () => void;
  clearError: () => void;
}

export const useDraftStore = create<DraftStoreState>((set, get) => ({
  connectionStatus: "desconectado",
  draftState: null,
  suggestions: null,
  errorMessage: null,
  socket: null,

  connect(socket, sessionId) {
    get().socket?.close();
    socket.onMessage((message) => applyServerMessage(set, message));
    socket.onClose(() => set({ connectionStatus: "desconectado", socket: null }));
    set({ socket, connectionStatus: "conectando", errorMessage: null });
    socket.send({ schema: "draft-ws/v1", type: "hello", sessionId });
  },

  disconnect() {
    get().socket?.close();
    set({ socket: null, connectionStatus: "desconectado" });
  },

  clearError() {
    set({ errorMessage: null });
  },
}));

// El estado anterior (draftState/suggestions) nunca se limpia al desconectar -- la regla dura del
// estado `desconectado` es mostrar el último conocido, atenuado, no una pantalla vacía.
function applyServerMessage(set: (partial: Partial<DraftStoreState>) => void, message: ServerMessage): void {
  // Input externo: un mensaje con forma inesperada se descarta en silencio -- nunca corrompe el
  // estado ya conocido (mismo principio que applyDraftEvent en el reductor de apps/engine).
  if (!isValidServerMessage(message)) return;

  switch (message.type) {
    case "snapshot":
    case "draft_state":
      set({ draftState: message.payload as DraftState, connectionStatus: "conectado", errorMessage: null });
      return;
    case "suggestions":
      set({ suggestions: message.payload as SuggestionSet });
      return;
    case "capture_status":
      return; // Definido en el contrato (TSK-010), sin emisión activa todavía -- nada que aplicar.
    case "error":
      set({ errorMessage: (message.payload as ErrorPayload).message });
      return;
  }
}

// Selector puro, exportado aparte para poder probarlo sin renderizar nada (los 6 estados de S5
// son derivados, no un campo guardado directo del store).
export function deriveScreenState(
  state: Pick<DraftStoreState, "connectionStatus" | "draftState" | "suggestions" | "errorMessage">,
): ScreenState {
  if (state.errorMessage) return "error";
  if (state.connectionStatus !== "conectado") return "desconectado";
  if (!state.draftState || state.draftState.phase === "idle") return "esperando_draft";
  if (state.draftState.phase === "complete" || state.draftState.phase === "aborted") return "completo";
  if ((state.suggestions?.degraded.length ?? 0) > 0) return "degradado";
  return "activo";
}
