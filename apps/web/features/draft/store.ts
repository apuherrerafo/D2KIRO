import { create } from "zustand";
import { postManualEvent } from "./manual-entry";
import type { DraftSocket, DraftState, ErrorPayload, HeroId, ScreenState, ServerMessage, SuggestionSet, TeamSide } from "./types";
import { isValidServerMessage } from "./validation";

// RCA post-TSK-076 (auditoría de arquitectura, 2026-08-23): fuente de verdad única para "qué pasa
// si toco un héroe ahora" -- antes, ManualEntryPanel tenía su propio useState de side/action y
// HeroGrid (vía handleQuickPick en DraftView.tsx) hardcodeaba "siempre pick, siempre a localSide"
// sin ningún selector visible. Dos modelos mentales distintos para la misma acción. `side:
// "unknown"` solo es válido con `action: "ban"` -- un pick siempre necesita un lado real
// (mismo contrato que ya exige DraftEvent.hero_picked en apps/engine/src/draft/reducer.ts).
export interface DraftInputMode {
  action: "pick" | "ban";
  side: TeamSide | "unknown";
}

export interface DraftStoreState {
  connectionStatus: "desconectado" | "conectando" | "conectado";
  sessionId: string | null;
  draftState: DraftState | null;
  suggestions: SuggestionSet | null;
  errorMessage: string | null;
  socket: DraftSocket | null;
  inputMode: DraftInputMode;
  connect: (socket: DraftSocket, sessionId: string, accountToken: string) => void;
  disconnect: () => void;
  clearError: () => void;
  setInputMode: (mode: Partial<DraftInputMode>) => void;
  // Corrige un pick/ban de confianza baja -- mismo POST /api/session/manual y pick_reverted del
  // contrato de TSK-004, disponible desde cualquier componente sin pasar callbacks por props.
  correctHero: (hero: HeroId, side: TeamSide) => Promise<void>;
}

const DEFAULT_INPUT_MODE: DraftInputMode = { action: "pick", side: "unknown" };

export const useDraftStore = create<DraftStoreState>((set, get) => ({
  connectionStatus: "desconectado",
  sessionId: null,
  draftState: null,
  suggestions: null,
  errorMessage: null,
  socket: null,
  inputMode: DEFAULT_INPUT_MODE,

  connect(socket, sessionId, accountToken) {
    get().socket?.close();
    socket.onMessage((message) => applyServerMessage(set, get, message));
    socket.onClose(() => set({ connectionStatus: "desconectado", socket: null }));
    // Una sesión nueva no hereda el lado de la sesión anterior -- vuelve a derivarse solo al
    // llegar el próximo draft_state/snapshot (ver applyServerMessage, "auto-fill" de abajo).
    set({ socket, sessionId, connectionStatus: "conectando", errorMessage: null, inputMode: DEFAULT_INPUT_MODE });
    socket.send({ schema: "draft-ws/v1", type: "hello", sessionId, accountToken });
  },

  setInputMode(mode) {
    set((current) => ({ inputMode: { ...current.inputMode, ...mode } }));
  },

  disconnect() {
    get().socket?.close();
    set({ socket: null, connectionStatus: "desconectado" });
  },

  clearError() {
    set({ errorMessage: null });
  },

  async correctHero(hero, side) {
    const { sessionId, draftState } = get();
    if (!sessionId) return;
    // Un fallo de red no debe quedar como una promesa rechazada sin capturar -- el botón
    // "Corregir" no tiene su propio estado de error dedicado, así que como mínimo se registra
    // en vez de arriesgar un unhandled rejection (hallazgo de @redteam durante esta revisión).
    try {
      await postManualEvent(sessionId, draftState?.lastSeq ?? 0, { type: "pick_reverted", hero, side });
    } catch (error) {
      console.error("[draft] no se pudo corregir el héroe:", error);
    }
  },
}));

// El estado anterior (draftState/suggestions) nunca se limpia al desconectar -- la regla dura del
// estado `desconectado` es mostrar el último conocido, atenuado, no una pantalla vacía.
function applyServerMessage(
  set: (partial: Partial<DraftStoreState>) => void,
  get: () => DraftStoreState,
  message: ServerMessage,
): void {
  // Input externo: un mensaje con forma inesperada se descarta en silencio -- nunca corrompe el
  // estado ya conocido (mismo principio que applyDraftEvent en el reductor de apps/engine).
  if (!isValidServerMessage(message)) return;

  switch (message.type) {
    case "snapshot":
    case "draft_state": {
      const draftState = message.payload as DraftState;
      const patch: Partial<DraftStoreState> = { draftState, connectionStatus: "conectado", errorMessage: null };
      // Auto-completa el lado del modo de entrada UNA sola vez, la primera vez que el motor
      // identifica localSide -- nunca pisa una elección manual posterior (ManualEntryPanel puede
      // apuntar deliberadamente al lado contrario). `connect()` ya reinicia inputMode a "unknown"
      // en cada sesión nueva, así que este auto-fill vuelve a correr una vez por sesión.
      const currentMode = get().inputMode;
      if (currentMode.side === "unknown" && draftState.localSide !== "unknown") {
        patch.inputMode = { ...currentMode, side: draftState.localSide };
      }
      set(patch);
      return;
    }
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
