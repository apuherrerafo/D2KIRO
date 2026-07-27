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
}

export type RejectionReason =
  | "duplicate_event"
  | "stale_seq"
  | "wrong_phase"
  | "unknown_hero"
  | "hero_already_taken";

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
  };
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
  if (state.banned.includes(hero)) {
    return { banned: state.banned.filter((h) => h !== hero) };
  }
  if (state.picks[side].includes(hero)) {
    return { picks: { ...state.picks, [side]: state.picks[side].filter((h) => h !== hero) } };
  }
  return {};
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
): { state: DraftState; rejected?: RejectionReason } {
  const event = envelope.payload;

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
    case "session_started":
      return accept(working, envelope, { phase: "active", format: event.format, patch: event.patch });
    case "local_side_identified":
      return accept(working, envelope, { localSide: event.side });
    case "hero_banned": {
      const rejection = checkHeroAvailable(working, event.hero);
      if (rejection) return { state, rejected: rejection };
      return accept(working, envelope, { banned: [...working.banned, event.hero] });
    }
    case "hero_picked": {
      const rejection = checkHeroAvailable(working, event.hero);
      if (rejection) return { state, rejected: rejection };
      return accept(working, envelope, {
        picks: { ...working.picks, [event.side]: [...working.picks[event.side], event.hero] },
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
