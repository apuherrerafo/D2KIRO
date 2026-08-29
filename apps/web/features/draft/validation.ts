import type { CaptureStatus, DraftState, ErrorPayload, ServerMessage, SuggestionSet } from "./types";

// Los mensajes de WebSocket son input externo igual que un envelope HTTP -- JSON.parse produce
// `any`, un cast `as` no protege nada en runtime (hallazgo de @redteam ronda 1, TSK-012, mismo
// patrón que edge.ts en apps/engine). Se valida aquí, en el punto donde el store confía el dato.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isHeroId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isHeroIdArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isHeroId);
}

function isTeamSide(value: unknown): value is "radiant" | "dire" {
  return value === "radiant" || value === "dire";
}

function isSignalId(value: unknown): boolean {
  return (
    value === "counter" ||
    value === "patch_meta" ||
    value === "team_synergy" ||
    value === "hero_pool_fit" ||
    value === "position_fit" ||
    value === "archetype_fit"
  );
}

function isDegradationFlag(value: unknown): boolean {
  return value === "stale_meta" || value === "partial_signals" || value === "unconfirmed_state" || value === "unknown_format";
}

function isDecisionContext(value: unknown): boolean {
  return value === "team_opening" || value === "blind_second_pick" || value === "response_pick" || value === "closing_pick";
}

function isDraftTurn(value: unknown): boolean {
  return isRecord(value) && isTeamSide(value.side) && (value.action === "ban" || value.action === "pick") && isFiniteNumber(value.standardTimeMs) && value.standardTimeMs >= 0;
}

function isDraftState(value: unknown): value is DraftState {
  if (!isRecord(value) || value.schema !== "draft-state/v1") return false;
  if (typeof value.sessionId !== "string" || typeof value.patch !== "string") return false;
  if (value.format !== "all_pick" && value.format !== "captains_mode" && value.format !== "unknown") return false;
  if (!isTeamSide(value.localSide) && value.localSide !== "unknown") return false;
  if (value.phase !== "idle" && value.phase !== "active" && value.phase !== "complete" && value.phase !== "aborted") return false;
  if (!isHeroIdArray(value.banned) || !isNonnegativeInteger(value.lastSeq)) return false;
  if (!isRecord(value.picks) || !isHeroIdArray(value.picks.radiant) || !isHeroIdArray(value.picks.dire)) return false;
  if (!Array.isArray(value.appliedEventIds) || !value.appliedEventIds.every((id) => typeof id === "string")) return false;
  if (!isRecord(value.quality) || !isHeroIdArray(value.quality.unconfirmed)) return false;
  const { captureStatus } = value.quality;
  if (captureStatus !== "ok" && captureStatus !== "degraded" && captureStatus !== "lost") return false;
  if (typeof value.updatedAt !== "string") return false;
  if (value.firstPickSide !== null && !isTeamSide(value.firstPickSide)) return false;
  if (value.turnStartedAt !== null && typeof value.turnStartedAt !== "string") return false;
  if (value.reserveRemainingMs !== null) {
    if (!isRecord(value.reserveRemainingMs) || !isFiniteNumber(value.reserveRemainingMs.radiant) || !isFiniteNumber(value.reserveRemainingMs.dire)) return false;
  }
  return value.turn === null || isDraftTurn(value.turn);
}

function isSignalContribution(value: unknown): boolean {
  if (!isRecord(value) || !isSignalId(value.signal) || !(value.raw === null || isFiniteNumber(value.raw))) return false;
  if (!isFiniteNumber(value.weighted) || typeof value.explanation !== "string" || !isFiniteNumber(value.sampleSize)) return false;
  if (value.applicable !== undefined && typeof value.applicable !== "boolean") return false;
  // TSK-210 (Fase 9.1, SPEC.md §16.9): campos opcionales del motor. Si vienen, `normalized` es
  // number|null y `evidenceConfidence` un number finito (el motor lo entrega en [0,1]).
  if (value.normalized !== undefined && !(value.normalized === null || isFiniteNumber(value.normalized))) return false;
  if (value.evidenceConfidence !== undefined && !isFiniteNumber(value.evidenceConfidence)) return false;
  return true;
}

function isUnitInterval(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isSuggestion(value: unknown): boolean {
  if (!isRecord(value) || !isHeroId(value.hero) || ![1, 2, 3, 4, 5, 6].includes(value.rank as number)) return false; // TSK-192: 6 recomendaciones
  if (!isFiniteNumber(value.score) || typeof value.reason !== "string" || !Array.isArray(value.signals) || !value.signals.every(isSignalContribution)) return false;
  if (value.confidence !== "alta" && value.confidence !== "media" && value.confidence !== "baja") return false;
  // TSK-210 (Fase 9.1, SPEC.md §16.9): requeridos, ambos en [0, 1].
  if (!isUnitInterval(value.evidenceCoverage) || !isUnitInterval(value.guessingIndex)) return false;
  return value.evidence === undefined || (Array.isArray(value.evidence) && value.evidence.every((item) => isRecord(item) && (item.kind === "opening" || item.kind === "counter" || item.kind === "synergy" || item.kind === "flex" || item.kind === "risk") && typeof item.text === "string"));
}

export function isValidSuggestionSet(value: unknown): value is SuggestionSet {
  if (!isRecord(value) || value.schema !== "suggestions/v1") return false;
  if (typeof value.sessionId !== "string" || !isNonnegativeInteger(value.basedOnSeq) || !isDecisionContext(value.decisionContext)) return false;
  if (!Array.isArray(value.suggestions) || !value.suggestions.every(isSuggestion) || !Array.isArray(value.degraded) || !value.degraded.every(isDegradationFlag)) return false;
  if (value.comparison !== null && (!isRecord(value.comparison) || !isHeroId(value.comparison.vsHero) || !isSignalId(value.comparison.signal) || !isFiniteNumber(value.comparison.delta))) return false;
  return isFiniteNumber(value.computedInMs) && value.computedInMs >= 0;
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

function isCaptureStatus(value: unknown): value is CaptureStatus {
  return isRecord(value) && (value.status === "ok" || value.status === "degraded" || value.status === "lost") && (value.detail === undefined || typeof value.detail === "string");
}

export function isValidServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value) || value.schema !== "draft-ws/v1") return false;
  if (!isNonnegativeInteger(value.seq) || typeof value.sentAt !== "string") return false;
  switch (value.type) {
    case "snapshot":
    case "draft_state":
      return isDraftState(value.payload);
    case "suggestions":
      return isValidSuggestionSet(value.payload);
    case "capture_status":
      return isCaptureStatus(value.payload);
    case "error":
      return isErrorPayload(value.payload);
    default:
      return false;
  }
}
