// Espejo del contrato de wire real de apps/engine (draft/reducer.ts, signals/{types,mix}.ts,
// server/session.ts). apps/web y apps/engine son dos procesos independientes que se comunican
// por WebSocket, no un paquete compartido — estos tipos se mantienen sincronizados a mano.

export type HeroId = number;
export type TeamSide = "radiant" | "dire";
export type DraftFormatId = "all_pick" | "captains_mode";

export interface DraftState {
  sessionId: string;
  schema: "draft-state/v1";
  format: DraftFormatId | "unknown";
  patch: string;
  localSide: TeamSide | "unknown";
  phase: "idle" | "active" | "complete" | "aborted";
  banned: HeroId[];
  picks: { radiant: HeroId[]; dire: HeroId[] };
  lastSeq: number;
  appliedEventIds: string[];
  quality: { unconfirmed: HeroId[]; captureStatus: "ok" | "degraded" | "lost" };
  updatedAt: string;
}

export type SignalId = "counter" | "patch_meta" | "team_synergy" | "role_gap";

export interface SignalContribution {
  signal: SignalId;
  raw: number | null;
  weighted: number;
  explanation: string;
  sampleSize: number;
}

export type SuggestionConfidence = "alta" | "media" | "baja";

export interface Suggestion {
  hero: HeroId;
  rank: 1 | 2 | 3;
  score: number;
  signals: SignalContribution[];
  reason: string;
  confidence: SuggestionConfidence;
}

export type DegradationFlag = "stale_meta" | "partial_signals" | "unconfirmed_state" | "unknown_format";

export interface SuggestionSet {
  schema: "suggestions/v1";
  sessionId: string;
  basedOnSeq: number;
  suggestions: Suggestion[];
  degraded: DegradationFlag[];
  computedInMs: number;
}

export interface CaptureStatus {
  status: "ok" | "degraded" | "lost";
  detail?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface ServerMessage {
  schema: "draft-ws/v1";
  type: "snapshot" | "draft_state" | "suggestions" | "capture_status" | "error";
  seq: number;
  sentAt: string;
  payload: DraftState | SuggestionSet | CaptureStatus | ErrorPayload;
}

export interface ClientMessage {
  schema: "draft-ws/v1";
  type: "hello" | "ping";
  sessionId?: string;
}

// Los 6 estados de pantalla (S5) — derivados, no un valor guardado directo del store.
export type ScreenState = "desconectado" | "esperando_draft" | "activo" | "degradado" | "completo" | "error";

// Contrato mínimo del socket que la vista consume — el mismo shape lo cumplen el WebSocket real
// (socket.ts) y el FakeSocket de pruebas (fake-socket.ts), costura S5 de testing-seams.md.
export interface DraftSocket {
  send(message: ClientMessage): void;
  close(): void;
  onMessage(handler: (message: ServerMessage) => void): void;
  onClose(handler: () => void): void;
}
