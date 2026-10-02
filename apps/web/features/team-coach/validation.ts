import type {
  GsiLinkView,
  LiveCaptureStatus,
  LiveDetectedPick,
  LiveGsiStatus,
  TeamCoachBoardData,
  TeamCoachCandidate,
  TeamCoachColumn,
  TeamCoachDecision,
  TeamPosition,
} from "./types";

// Toda respuesta del motor es input externo: se valida en el borde antes de llegar a un componente.
// Una forma inesperada devuelve `null` -- la vista muestra "no se pudo calcular", nunca datos a medias.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHeroId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isPosition(value: unknown): value is TeamPosition {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isSide(value: unknown): value is "radiant" | "dire" {
  return value === "radiant" || value === "dire";
}

function isNullable<T>(value: unknown, guard: (candidate: unknown) => candidate is T): value is T | null {
  return value === null || guard(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isCandidate(value: unknown): value is TeamCoachCandidate {
  return (
    isRecord(value) &&
    isHeroId(value.heroId) &&
    typeof value.rank === "number" &&
    (value.score === null || (typeof value.score === "number" && Number.isFinite(value.score))) &&
    Array.isArray(value.reasons) &&
    value.reasons.every(isString) &&
    typeof value.isPrimary === "boolean"
  );
}

const COLUMN_STATES = new Set(["RANKED", "UNRANKED_POSITIONAL", "UNAVAILABLE", "FILLED", "WAITING"]);

function isColumn(value: unknown): value is TeamCoachColumn {
  return (
    isRecord(value) &&
    isPosition(value.position) &&
    typeof value.eligibleNow === "boolean" &&
    typeof value.alreadyFilled === "boolean" &&
    isNullable(value.filledHeroId, isHeroId) &&
    typeof value.state === "string" &&
    COLUMN_STATES.has(value.state) &&
    isNullable(value.primaryHeroId, isHeroId) &&
    Array.isArray(value.top) &&
    value.top.every(isCandidate) &&
    isString(value.stateIdentity) &&
    isNullable(value.note, isString)
  );
}

function isDecision(value: unknown): value is TeamCoachDecision {
  return (
    isRecord(value) &&
    isNullable(value.recommendedPosition, isPosition) &&
    isNullable(value.recommendedHeroId, isHeroId) &&
    (value.targetBasis === null || value.targetBasis === "STRATEGIC" || value.targetBasis === "DETERMINISTIC_DEFAULT") &&
    isString(value.reason) &&
    Array.isArray(value.actionablePositions) &&
    value.actionablePositions.every(isPosition) &&
    typeof value.roundCapacity === "number"
  );
}

export function parseTeamCoachBoard(value: unknown): TeamCoachBoardData | null {
  if (!isRecord(value) || value.schema !== "team-coach-board/v1") return null;
  if (!isString(value.sessionId) || !isString(value.stateIdentity) || !isDecision(value.currentDecision)) return null;
  if (!Array.isArray(value.positions) || !value.positions.every(isColumn)) return null;
  if (!Array.isArray(value.unboundOwnHeroIds) || !value.unboundOwnHeroIds.every(isHeroId)) return null;
  // One board = one snapshot: a column ranked against another state is refused, never shown.
  if (value.positions.some((column) => column.stateIdentity !== value.stateIdentity)) return null;
  return value as unknown as TeamCoachBoardData;
}

function isDetectedPick(value: unknown): value is LiveDetectedPick {
  return isRecord(value) && isSide(value.side) && isHeroId(value.heroId) && isNullable(value.position, isPosition) && (value.source === "gsi" || value.source === "overwolf" || value.source === "manual") && isString(value.at);
}

const GSI_DRAFT_KEYS = ["draftBlock", "side", "ownHero", "bans", "allyPicks", "enemyPicks"] as const;

function isGsiStatus(value: unknown): value is LiveGsiStatus {
  return (
    isRecord(value) &&
    isNullable(value.gameState, isString) &&
    (value.phase === "idle" || value.phase === "loading" || value.phase === "draft" || value.phase === "match") &&
    isRecord(value.draft) &&
    GSI_DRAFT_KEYS.every((key) => typeof (value.draft as Record<string, unknown>)[key] === "boolean") &&
    Array.isArray(value.telemetry) &&
    value.telemetry.every(isString) &&
    (value.draftProgression === undefined || typeof value.draftProgression === "boolean") &&
    (value.lastPacketAgeMs === undefined || (typeof value.lastPacketAgeMs === "number" && Number.isFinite(value.lastPacketAgeMs) && value.lastPacketAgeMs >= 0)) &&
    (value.active === undefined || typeof value.active === "boolean")
  );
}

/** GET /engine/api/live/gsi-link. `undefined` when the response is not a valid link view. */
export function parseGsiLink(value: unknown): GsiLinkView | null | undefined {
  if (!isRecord(value) || value.schema !== "live-gsi-link/v1") return undefined;
  if (value.link === null) return null;
  const link = value.link;
  if (!isRecord(link) || !isString(link.sessionId) || !isString(link.createdAt) || !isString(link.expiresAt)) return undefined;
  return { sessionId: link.sessionId, createdAt: link.createdAt, expiresAt: link.expiresAt };
}

export function parseLiveCaptureStatus(value: unknown): LiveCaptureStatus | null {
  if (!isRecord(value) || value.schema !== "live-capture-status/v1") return null;
  const valid =
    isString(value.sessionId) &&
    (value.connection === "waiting" || value.connection === "connected" || value.connection === "stale") &&
    isNullable(value.lastEventAt, isString) &&
    (value.captureHealth === "unknown" || value.captureHealth === "ok" || value.captureHealth === "degraded" || value.captureHealth === "lost") &&
    isNullable(value.captureDetail, isString) &&
    (value.draftPhase === "waiting" || value.draftPhase === "hero_selection" || value.draftPhase === "ended") &&
    isNullable(value.localSide, isSide) &&
    isNullable(value.lastDetectedPick, isDetectedPick) &&
    [value.bans, value.picks, value.deferredPicks, value.rejectedFacts].every((count) => typeof count === "number") &&
    (value.gsi === undefined || isNullable(value.gsi, isGsiStatus));
  return valid ? (value as unknown as LiveCaptureStatus) : null;
}
