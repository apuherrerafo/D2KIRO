// Espejo del contrato de wire real de apps/engine (draft/reducer.ts, signals/{types,mix}.ts,
// server/session.ts). apps/web y apps/engine son dos procesos independientes que se comunican
// por WebSocket, no un paquete compartido — estos tipos se mantienen sincronizados a mano.

export type HeroId = number;
export type TeamSide = "radiant" | "dire";
export type DraftFormatId = "all_pick" | "captains_mode";

// Payloads que apps/web puede EMITIR hacia el motor (entrada manual, TSK-013). session_ended y
// capture_health siguen siendo exclusivos de un capturador real (Overwolf/OCR, todavía no
// construidos). session_started/local_side_identified SÍ los emite la entrada manual (TSK-053) --
// sin ningún capturador automático corriendo todavía, una sesión que arranca por entrada manual
// pura necesita poder bootstrapear su propia fase activa, igual que ya hace el simulador de guion
// fijo (SPEC.md D1: "simulador y entrada manual son capturadores de primera clase").
export type DraftEvent =
  | { type: "session_started"; format: DraftFormatId | "unknown"; patch: string }
  | { type: "local_side_identified"; side: TeamSide }
  | { type: "hero_banned"; hero: HeroId; side: TeamSide | "unknown" }
  | { type: "hero_picked"; hero: HeroId; side: TeamSide }
  | { type: "pick_reverted"; hero: HeroId; side: TeamSide };

// TSK-073 (spec §2.3, specs/draft-native-experience.md): turno actual de Captain's Mode, ya
// resuelto del lado del motor (turn-clock.ts) -- este proceso nunca recalcula la tabla de
// turnos, solo consume el resultado. `null` cuando no hay tabla aplicable (formato distinto de
// captains_mode, o `firstPickSide` sin bootstrapear todavía del lado del motor).
export interface DraftTurn {
  side: TeamSide;
  action: "ban" | "pick";
  standardTimeMs: number;
}

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
  // TSK-072/073: espejo a mano de los mismos 3 campos que el motor agregó a su DraftState --
  // solo tienen valor real con format:"captains_mode". `turn` es la proyección calculada del
  // lado del motor (nunca se recalcula acá); los otros 3 viajan tal cual desde el reductor.
  firstPickSide: TeamSide | null;
  turnStartedAt: string | null;
  reserveRemainingMs: { radiant: number; dire: number } | null;
  turn: DraftTurn | null;
}

// TSK-046 (Fase 3, SPEC.md §10.7): las dos señales de rol de fase 1/1b se fusionan en
// `position_fit` en el motor (apps/engine/src/signals/types.ts) -- el espejo se mueve en el mismo
// bloque de trabajo.
// TSK-180 (Fase 4.2, SPEC.md §11.13.6): el motor gana la 6ª señal `archetype_fit` -- el espejo se
// mueve en el mismo PR o `tsc` de apps/web rompe.
export type SignalId = "counter" | "patch_meta" | "team_synergy" | "hero_pool_fit" | "position_fit" | "archetype_fit";

export interface SignalContribution {
  signal: SignalId;
  raw: number | null;
  weighted: number;
  explanation: string;
  sampleSize: number;
  // TSK-026 (fase 1b): ausente = true, las 4 señales de fase 1 no lo tocan. "Esta señal no aplica
  // a este usuario ahora mismo" (pool nunca configurado) es distinto de `raw: null` ("hay hueco de
  // datos") -- mismo campo, mismo significado, que el motor ya define en signals/types.ts.
  applicable?: boolean;
}

export type SuggestionConfidence = "alta" | "media" | "baja";
export type DraftDecisionContext = "team_opening" | "blind_second_pick" | "response_pick" | "closing_pick";

export interface Suggestion {
  hero: HeroId;
  rank: 1 | 2 | 3 | 4 | 5 | 6;
  score: number;
  signals: SignalContribution[];
  reason: string;
  confidence: SuggestionConfidence;
  evidence?: { kind: "opening" | "counter" | "synergy" | "flex" | "risk"; text: string }[];
}

// TSK-032: comparación explícita entre el pick #1 y el #2 -- `signal` es la señal con mayor
// ventaja del #1 sobre `vsHero`, entre las comparables en ambos lados (mismo criterio que el
// motor: ni `raw: null` ni `applicable: false` de cualquiera de los dos cuenta como comparable).
export interface SuggestionComparison {
  vsHero: HeroId;
  signal: SignalId;
  delta: number;
}

export type DegradationFlag = "stale_meta" | "partial_signals" | "unconfirmed_state" | "unknown_format";

export interface SuggestionSet {
  schema: "suggestions/v1";
  sessionId: string;
  basedOnSeq: number;
  decisionContext?: DraftDecisionContext;
  suggestions: Suggestion[];
  comparison: SuggestionComparison | null;
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

// TSK-181 (Fase 4.3): espejo a mano de DraftPathArchetype (apps/engine/src/draft-paths/types.ts)
// -- los dos procesos son independientes, sin import directo, mismo criterio que `SignalId`.
export type DraftArchetype = "push" | "teamfight" | "pickoff" | "scaling";

export interface ClientMessage {
  schema: "draft-ws/v1";
  type: "hello" | "ping" | "set_intent";
  sessionId?: string;
  accountToken?: string;
  // Sólo en set_intent. `null` limpia la intención elegida.
  archetypeIntent?: DraftArchetype | null;
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

export interface DraftConnection {
  socket: DraftSocket;
  accountToken: string;
}

export type DraftSocketFactory = (url: string) => DraftConnection | Promise<DraftConnection>;
