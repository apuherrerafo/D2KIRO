import { loadDraftFormatTurnData, type CaptainsModeTurnTable } from "./draft-format-turns";
import { captainsModeTurnIndex, checkCaptainsModeTurn, consumeReserveTime } from "./turn-clock";

export type HeroId = number;
export type TeamSide = "radiant" | "dire";
export type DraftFormatId = "all_pick" | "captains_mode";
export type CaptureSource = "simulator" | "manual" | "overwolf" | "ocr";

export interface DraftEventEnvelope {
  schema: "draft-event/v1";
  eventId: string;
  sessionId: string;
  seq: number;
  emittedAt: string;
  source: CaptureSource;
  confidence: number;
  payload: DraftEvent;
}

export type DraftEvent =
  | { type: "session_started"; format: DraftFormatId | "unknown"; patch: string }
  | { type: "local_side_identified"; side: TeamSide }
  | { type: "hero_banned"; hero: HeroId; side: TeamSide | "unknown" }
  | { type: "hero_picked"; hero: HeroId; side: TeamSide }
  | { type: "pick_reverted"; hero: HeroId; side: TeamSide }
  | { type: "session_ended"; reason: "completed" | "aborted" | "lost_capture" }
  | { type: "capture_health"; status: "ok" | "degraded" | "lost"; detail?: string };

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
  // TSK-072 (spec §2.2, specs/draft-native-experience.md): solo se usan cuando format ===
  // "captains_mode" y hay tabla de turnos cargada -- en cualquier otro caso quedan en null, sin
  // ningún efecto en el resto del reductor. `firstPickSide` es un hecho que se aprende UNA vez
  // (bootstrap: el lado del primer ban/pick que llega con un lado real define qué lado real es
  // "first" en la tabla relativa first/second de draft-format-turns.json) -- nunca se vuelve a
  // pisar. Limitación conocida y documentada, no un bug silencioso: si esa primerísima acción se
  // corrige con pick_reverted, `firstPickSide` no se des-bootstrapea -- un caso de borde raro
  // (corregir la acción 1 de 24 de todo el draft) que no justificaba la complejidad de deshacerlo.
  firstPickSide: TeamSide | null;
  turnStartedAt: string | null;
  reserveRemainingMs: { radiant: number; dire: number } | null;
}

export type RejectionReason =
  | "duplicate_event"
  | "stale_seq"
  | "wrong_phase"
  | "unknown_hero"
  | "hero_already_taken"
  | "roster_full"
  | "wrong_turn";

// RCA post-TSK-076 (auditoría de arquitectura, 2026-08-23): constante universal de Dota,
// independiente de formato/parche -- a diferencia del conteo de bans (sí depende de formato,
// correctamente diferido a la tabla de turnos de TSK-071-074), 5 picks por lado nunca cambia.
export const MAX_PICKS_PER_SIDE = 5;

export function createIdleDraftState(sessionId: string): DraftState {
  return {
    sessionId,
    schema: "draft-state/v1",
    format: "unknown",
    patch: "",
    localSide: "unknown",
    phase: "idle",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
  };
}

// Singleton de módulo -- el archivo curado se carga una sola vez por proceso (mismo patrón que
// MODULE_HERO_POSITIONS en signals/mix.ts). Inyectable vía ApplyDraftEventOptions para que las
// pruebas usen una tabla sintética propia, nunca el archivo real (costura S10,
// testing-seams.md).
const MODULE_TURN_DATA = loadDraftFormatTurnData();

export interface ApplyDraftEventOptions {
  captainsModeTurns?: CaptainsModeTurnTable | null;
}

// Solo se toca cuando format:"captains_mode" y hay tabla disponible -- arma el patch de
// firstPickSide/turnStartedAt/reserveRemainingMs a partir del resultado de checkCaptainsModeTurn.
// Separado de los dos `case` que lo llaman porque hero_banned y hero_picked lo necesitan idéntico.
// `source: "simulator"` (guion fijo, TSK-016) nunca se valida contra la tabla de turnos real --
// su guion es artificial a propósito (existe para demostrar la UI, no para replicar un draft real
// de Captain's Mode turno por turno) y precede a esta feature. Mismo criterio ya documentado para
// TSK-074: "el simulador sigue siendo dueño de su propio guion". Una captura real (manual/
// overwolf/ocr) sí se valida siempre.
function captainsModeTurnPatch(
  working: DraftState,
  envelope: DraftEventEnvelope,
  action: "ban" | "pick",
  side: TeamSide | "unknown",
  table: CaptainsModeTurnTable | null,
): { rejected?: "wrong_turn"; patch?: Partial<DraftState> } {
  if (envelope.source === "simulator") return {};
  const check = checkCaptainsModeTurn(working, table, action, side);
  if (check.rejected) return { rejected: check.rejected };
  if (!table || working.format !== "captains_mode") return {};

  const patch: Partial<DraftState> = { turnStartedAt: envelope.emittedAt };
  if (check.bootstrapSide) patch.firstPickSide = check.bootstrapSide;

  const actingSide = check.bootstrapSide ?? (side === "unknown" ? null : side);
  if (actingSide && working.turnStartedAt && working.reserveRemainingMs) {
    const entry = table.turns[captainsModeTurnIndex(working)];
    if (entry) {
      const elapsedMs = new Date(envelope.emittedAt).getTime() - new Date(working.turnStartedAt).getTime();
      patch.reserveRemainingMs = consumeReserveTime(working.reserveRemainingMs, actingSide, elapsedMs, entry.standardTimeMs);
    }
  }
  return { patch };
}

function checkHeroAvailable(state: DraftState, hero: HeroId): RejectionReason | null {
  if (!Number.isInteger(hero) || hero <= 0) return "unknown_hero";
  const taken =
    state.banned.includes(hero) ||
    state.picks.radiant.includes(hero) ||
    state.picks.dire.includes(hero);
  return taken ? "hero_already_taken" : null;
}

function revertHero(state: DraftState, hero: HeroId, side: TeamSide): Partial<DraftState> {
  const quality = { ...state.quality, unconfirmed: state.quality.unconfirmed.filter((h) => h !== hero) };
  if (state.banned.includes(hero)) {
    return { banned: state.banned.filter((h) => h !== hero), quality };
  }
  if (state.picks[side].includes(hero)) {
    return { picks: { ...state.picks, [side]: state.picks[side].filter((h) => h !== hero) }, quality };
  }
  return { quality };
}

// Confianza por debajo de este umbral no bloquea el evento (SPEC.md línea 127: "el evento se
// aplica igual") -- solo marca el héroe como sin confirmar para que la UI lo señale y ofrezca
// corregirlo con pick_reverted, sin perder el resto del draft.
const LOW_CONFIDENCE_THRESHOLD = 0.6;

function markUnconfirmed(state: DraftState, envelope: DraftEventEnvelope, hero: HeroId): DraftState["quality"] {
  if (envelope.confidence >= LOW_CONFIDENCE_THRESHOLD || state.quality.unconfirmed.includes(hero)) {
    return state.quality;
  }
  return { ...state.quality, unconfirmed: [...state.quality.unconfirmed, hero] };
}

function accept(
  state: DraftState,
  envelope: DraftEventEnvelope,
  patch: Partial<DraftState>,
): { state: DraftState; rejected?: RejectionReason } {
  return {
    state: {
      ...state,
      ...patch,
      lastSeq: Math.max(state.lastSeq, envelope.seq),
      appliedEventIds: [...state.appliedEventIds, envelope.eventId],
      updatedAt: envelope.emittedAt,
    },
  };
}

export function applyDraftEvent(
  state: DraftState,
  envelope: DraftEventEnvelope,
  options: ApplyDraftEventOptions = {},
): { state: DraftState; rejected?: RejectionReason } {
  const event = envelope.payload;
  const turnTable = options.captainsModeTurns !== undefined ? options.captainsModeTurns : MODULE_TURN_DATA.captainsMode;

  // Una nueva sessionId en `session_started` vuelve el estado a idle antes de procesar — el resto
  // de los tipos de evento no revalidan sessionId (fuera del alcance del ticket: no hay una razón
  // de rechazo dedicada a "sesión desconocida" en el contrato).
  let working = state;
  if (event.type === "session_started" && envelope.sessionId !== state.sessionId) {
    working = createIdleDraftState(envelope.sessionId);
  }

  if (working.appliedEventIds.includes(envelope.eventId)) {
    return { state, rejected: "duplicate_event" };
  }

  if (event.type !== "pick_reverted" && envelope.seq <= working.lastSeq) {
    return { state, rejected: "stale_seq" };
  }

  if (event.type === "session_started" ? working.phase !== "idle" : working.phase !== "active") {
    return { state, rejected: "wrong_phase" };
  }

  switch (event.type) {
    case "session_started": {
      const patch: Partial<DraftState> = { phase: "active", format: event.format, patch: event.patch };
      if (event.format === "captains_mode" && turnTable) {
        patch.firstPickSide = null;
        patch.turnStartedAt = envelope.emittedAt;
        patch.reserveRemainingMs = { radiant: turnTable.reserveTimeMs, dire: turnTable.reserveTimeMs };
      } else {
        patch.firstPickSide = null;
        patch.turnStartedAt = null;
        patch.reserveRemainingMs = null;
      }
      return accept(working, envelope, patch);
    }
    case "local_side_identified":
      return accept(working, envelope, { localSide: event.side });
    case "hero_banned": {
      const rejection = checkHeroAvailable(working, event.hero);
      if (rejection) return { state, rejected: rejection };
      const turnResult = captainsModeTurnPatch(working, envelope, "ban", event.side, turnTable);
      if (turnResult.rejected) return { state, rejected: turnResult.rejected };
      return accept(working, envelope, {
        banned: [...working.banned, event.hero],
        quality: markUnconfirmed(working, envelope, event.hero),
        ...turnResult.patch,
      });
    }
    case "hero_picked": {
      const rejection = checkHeroAvailable(working, event.hero);
      if (rejection) return { state, rejected: rejection };
      if (working.picks[event.side].length >= MAX_PICKS_PER_SIDE) {
        return { state, rejected: "roster_full" };
      }
      const turnResult = captainsModeTurnPatch(working, envelope, "pick", event.side, turnTable);
      if (turnResult.rejected) return { state, rejected: turnResult.rejected };
      return accept(working, envelope, {
        picks: { ...working.picks, [event.side]: [...working.picks[event.side], event.hero] },
        quality: markUnconfirmed(working, envelope, event.hero),
        ...turnResult.patch,
      });
    }
    case "pick_reverted": {
      if (!Number.isInteger(event.hero) || event.hero <= 0) {
        return { state, rejected: "unknown_hero" };
      }
      return accept(working, envelope, revertHero(working, event.hero, event.side));
    }
    case "session_ended":
      return accept(working, envelope, { phase: event.reason === "completed" ? "complete" : "aborted" });
    case "capture_health":
      return accept(working, envelope, { quality: { ...working.quality, captureStatus: event.status } });
  }
}
