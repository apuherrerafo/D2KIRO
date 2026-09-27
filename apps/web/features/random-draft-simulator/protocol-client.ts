import type { DraftDecisionContext, DraftState, HeroId, SignalContribution, SuggestionConfidence, TeamSide } from "@/features/draft/types";
import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";

export type ProtocolStatus = "ACTIVE" | "UNCONFIRMED_STATE" | "WAITING_FOR_COLLISION_AUTHORITY" | "COMPLETE" | "DEGRADED";
export type RankedApPhase = "BAN_RESOLUTION" | "PICK_ROUND_1" | "PICK_ROUND_2" | "PICK_ROUND_3" | "COMPLETE";
// R1 S7 (Blocker 2) -- mirrors engine's RulesetId/PartySize (draft-protocol/types.ts) by hand,
// same discipline as the rest of this file: apps/web never imports apps/engine types directly.
export type RulesetId = "dota2/ranked-all-pick" | "dota2/captains-mode";
export type PartySize = 1 | 2 | 3 | 5;
export type CmActionKind = "BAN" | "PICK";
export type RelativeSide = "first" | "second";

export type PerspectiveHeroSlot =
  | { visibility: "KNOWN"; heroId: HeroId }
  | { visibility: "REVEALED"; heroId: HeroId }
  | { visibility: "HIDDEN" };

export interface ProtocolPerspectiveView {
  schema: "draft-protocol-perspective/v1";
  sessionId: string;
  status: ProtocolStatus;
  viewerSide: TeamSide;
  bannedHeroes: HeroId[];
  ownPicks: PerspectiveHeroSlot[];
  enemyPicks: PerspectiveHeroSlot[];
  // Exactly one of the two is non-null -- mirrors engine's PerspectiveDraftView (perspective.ts).
  rankedAp: { phase: RankedApPhase; banResolutionComplete: boolean } | null;
  captainsMode: { firstPickSide: TeamSide | null; currentStep: number } | null;
}

export type ProtocolLegalAction =
  | { type: "RECORD_RESOLVED_BANS" }
  | { type: "BAN_RESOLUTION_COMPLETE" }
  | { type: "SUBMIT_SEALED_SELECTION"; side: TeamSide; slotIndex: number }
  | { type: "CONFIRM_FIRST_PICK_SIDE" }
  | { type: "CM_ACTION"; step: number; actor: RelativeSide; absoluteSide: TeamSide; kind: CmActionKind; eligibleHeroIds: HeroId[] }
  | { type: "CM_BAN_SKIPPED"; step: number; actor: RelativeSide; absoluteSide: TeamSide }
  | { type: "CM_AUTO_PICK"; step: number; actor: RelativeSide; absoluteSide: TeamSide; eligibleHeroIds: HeroId[] };

// AP Ranked Roles V1 -- Simulator-layer timer/gold-penalty projection (engine simulator/timer.ts).
// Espejo a mano: sólo lo que la UI lee. Todo relativo al momento de la respuesta -- el cliente
// nunca recibe un timestamp absoluto en el que deba confiar.
export interface SimulatorTimerView {
  round: 1 | 2 | 3;
  durationMs: number;
  remainingMs: number;
  penaltyActive: boolean;
  /** Roster seats (0..4) del Player que siguen sin elegir. */
  pendingSeats: number[];
  /** Oro perdido por asiento (0..4). */
  goldPenaltyBySlot: number[];
  penaltyRatePerSecond: number;
}

/** PD-026/PD-027 SNAPSHOT / OWN POSITION PROJECTION -- Own Team binding, own side only. Espejo a mano de OwnPickPositionBinding (engine, server/protocol-session.ts). */
export interface OwnAssignedPositionBinding {
  round: 1 | 2 | 3;
  slotIndex: number;
  assignedPosition: 1 | 2 | 3 | 4 | 5;
}

export interface ProtocolSnapshot {
  view: ProtocolPerspectiveView;
  legalActions: ProtocolLegalAction[];
  /** null fuera de una sesión AP Simulator o antes de que la primera ronda se entregue al Player. */
  simulator: SimulatorTimerView | null;
  /** PD-026/PD-027: binding sesión-capa de Own Team, `[]` si la sesión no tiene ninguno todavía. */
  ownAssignedPositions: OwnAssignedPositionBinding[];
  /** Sólo en la respuesta de un comando: el kernel lo aceptó o lo rechazó (motivo). */
  accepted?: boolean;
  rejected?: string;
}

type ProtocolCommand =
  | { type: "RECORD_RESOLVED_BANS"; heroes: HeroId[] }
  | { type: "BAN_RESOLUTION_COMPLETE" }
  | { type: "SUBMIT_SEALED_SELECTION"; side: TeamSide; slotIndex: number; heroId: HeroId }
  | { type: "CONFIRM_FIRST_PICK_SIDE"; side: TeamSide }
  | { type: "CM_ACTION"; actor: RelativeSide; kind: CmActionKind; heroId: HeroId }
  | { type: "CM_BAN_SKIPPED"; actor: RelativeSide }
  | { type: "CM_AUTO_PICK"; actor: RelativeSide; heroId: HeroId };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHeroId(value: unknown): value is HeroId {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSlot(value: unknown): value is PerspectiveHeroSlot {
  if (!isRecord(value)) return false;
  if (value.visibility === "HIDDEN") return value.heroId === undefined;
  return (value.visibility === "KNOWN" || value.visibility === "REVEALED") && isHeroId(value.heroId);
}

function isValidRankedApView(value: unknown): boolean {
  return isRecord(value) && typeof value.phase === "string" && typeof value.banResolutionComplete === "boolean";
}

function isValidCaptainsModeView(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const sideOk = value.firstPickSide === null || value.firstPickSide === "radiant" || value.firstPickSide === "dire";
  return sideOk && typeof value.currentStep === "number";
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function parseSimulatorTimer(value: unknown): SimulatorTimerView | null {
  if (!isRecord(value)) return null;
  const round = value.round;
  if (round !== 1 && round !== 2 && round !== 3) return null;
  if (typeof value.durationMs !== "number" || typeof value.remainingMs !== "number") return null;
  if (typeof value.penaltyActive !== "boolean" || typeof value.penaltyRatePerSecond !== "number") return null;
  if (!isNumberArray(value.pendingSeats) || !isNumberArray(value.goldPenaltyBySlot)) return null;
  return {
    round,
    durationMs: value.durationMs,
    remainingMs: value.remainingMs,
    penaltyActive: value.penaltyActive,
    pendingSeats: value.pendingSeats,
    goldPenaltyBySlot: value.goldPenaltyBySlot,
    penaltyRatePerSecond: value.penaltyRatePerSecond,
  };
}

function isDotaPosition(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isOwnAssignedPositionBinding(value: unknown): value is OwnAssignedPositionBinding {
  if (!isRecord(value)) return false;
  return (value.round === 1 || value.round === 2 || value.round === 3) && typeof value.slotIndex === "number" && isDotaPosition(value.assignedPosition);
}

function parseSnapshot(value: unknown): ProtocolSnapshot | null {
  if (!isRecord(value) || !isRecord(value.view) || !Array.isArray(value.legalActions)) return null;
  const view = value.view;
  if (view.schema !== "draft-protocol-perspective/v1") return null;
  if (typeof view.sessionId !== "string") return null;
  if (view.viewerSide !== "radiant" && view.viewerSide !== "dire") return null;
  if (!Array.isArray(view.bannedHeroes) || !view.bannedHeroes.every(isHeroId)) return null;
  if (!Array.isArray(view.ownPicks) || !view.ownPicks.every(isSlot)) return null;
  if (!Array.isArray(view.enemyPicks) || !view.enemyPicks.every(isSlot)) return null;
  // Exactly one of rankedAp/captainsMode is non-null (mirrors engine's project(), perspective.ts).
  const rankedApOk = view.rankedAp === null || isValidRankedApView(view.rankedAp);
  const captainsModeOk = view.captainsMode === undefined || view.captainsMode === null || isValidCaptainsModeView(view.captainsMode);
  if (!rankedApOk || !captainsModeOk) return null;
  if (view.rankedAp === null && (view.captainsMode === undefined || view.captainsMode === null)) return null;
  const ownAssignedPositions = Array.isArray(value.ownAssignedPositions) && value.ownAssignedPositions.every(isOwnAssignedPositionBinding)
    ? value.ownAssignedPositions
    : [];
  const snapshot = value as unknown as ProtocolSnapshot;
  const accepted = typeof value.accepted === "boolean" ? { accepted: value.accepted } : {};
  const rejected = typeof value.rejected === "string" ? { rejected: value.rejected } : {};
  return { ...snapshot, simulator: parseSimulatorTimer(value.simulator), ownAssignedPositions, ...accepted, ...rejected };
}

async function readSnapshot(response: Response): Promise<ProtocolSnapshot> {
  if (!response.ok) throw new Error(`protocol request failed (${response.status})`);
  const parsed = parseSnapshot(await response.json());
  if (!parsed) throw new Error("invalid protocol response");
  return parsed;
}

export interface CreateSimulatorSessionOptions {
  rulesetId?: RulesetId;
  /** AP Ranked Roles V1 controla los 5 asientos propios: partySize 5 (default). */
  partySize?: PartySize;
  /** Posición personal declarada del Player (1..5). Identifica su rol; nunca decide cuándo se pica. */
  humanPosition?: 1 | 2 | 3 | 4 | 5;
  /** Posiciones que controla la party del jugador. */
  partyPositions?: readonly (1 | 2 | 3 | 4 | 5)[];
  simulatorSeed?: string;
  /**
   * MVP P0.1 -- default "simulator" (byte-identical to every call site before this field existed).
   * "manual" is Live Companion: no Enemy Bot, no seeded ban policy -- the Player reports both
   * sides' sealed selections and the observed bans by hand (see protocol-session.ts, engine side).
   */
  adapterKind?: "manual" | "simulator";
}

/**
 * PD-026/PD-027 -- computes `controlledPositions` (Own Team's human-controlled positions), the
 * session's real control truth. `partyContext.controlledSlots` is sent EMPTY: chronological roster
 * seats are structural/inert for AP, never position/control truth.
 */
/** Exported so roster.ts's `controlledPositionsForConfig` derives the SAME set from a DraftConfig -- two independent copies of this fallback previously risked drifting apart (see PD-026/PD-027 redteam finding). */
export function resolveControlledPositions(partySize: PartySize, options: CreateSimulatorSessionOptions): (1 | 2 | 3 | 4 | 5)[] {
  if (options.partyPositions && options.partyPositions.length === partySize) return [...options.partyPositions];
  if (partySize === 5) return [1, 2, 3, 4, 5];
  if (partySize === 1 && options.humanPosition) return [options.humanPosition];
  return [1, 2, 3, 4, 5].slice(0, partySize) as (1 | 2 | 3 | 4 | 5)[];
}

export async function createSimulatorProtocolSession(
  patch: string,
  localSide: TeamSide,
  fetchImpl: typeof fetch = fetch,
  options: CreateSimulatorSessionOptions = {},
): Promise<string> {
  const partySize = options.partySize ?? 5;
  const controlledPositions = resolveControlledPositions(partySize, options);
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rulesetId: options.rulesetId ?? "dota2/ranked-all-pick",
      patch,
      localSide,
      adapterKind: options.adapterKind ?? "simulator",
      partyContext: { partySize, side: localSide, controlledSlots: [] },
      controlledPositions,
      humanPosition: options.humanPosition,
      simulatorSeed: options.simulatorSeed,
    }),
  });
  if (!response.ok) throw new Error(`protocol session creation failed (${response.status})`);
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.sessionId !== "string" || body.sessionId.length === 0) throw new Error("invalid protocol session response");
  return body.sessionId;
}

/**
 * MVP P0.1 (Live Companion) -- reads the current snapshot without submitting any command. Used
 * once, right after creating a "manual" adapterKind session, to seed the board before the Player
 * has reported anything: the ban-resolution simulator route (which returns a snapshot as a side
 * effect) is never called in this mode, so nothing else primes `draftState` otherwise.
 */
export async function getProtocolSession(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<ProtocolSnapshot> {
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}`);
  return readSnapshot(response);
}

/**
 * PD-026/PD-027 -- `assignedPosition` travels as a SIBLING field to `command`, never inside it (the
 * kernel command shape never changes). Only meaningful for an Own Team `SUBMIT_SEALED_SELECTION` on
 * an AP Simulator session with `controlledPositions`; omitted for every other command.
 */
export function submitProtocolCommand(
  sessionId: string,
  command: ProtocolCommand,
  fetchImpl: typeof fetch = fetch,
  assignedPosition?: 1 | 2 | 3 | 4 | 5,
): Promise<ProtocolSnapshot> {
  return fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(assignedPosition === undefined ? { command } : { command, assignedPosition }),
  }).then(readSnapshot);
}

/** PD-026 ALLY BOT SCHEDULING -- yields the round's remaining Own Team capacity to the Ally Bot. */
export function requestYield(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<ProtocolSnapshot> {
  return fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/yield`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }).then(readSnapshot);
}

export function requestBotSelection(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<ProtocolSnapshot> {
  return fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/bot-selection`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }).then(readSnapshot);
}

export type AutoDriveStopReason = "round_revealed" | "human_input" | "complete";

export interface AutoDriveResult extends ProtocolSnapshot {
  stopReason: AutoDriveStopReason;
  completedRound: 1 | 2 | 3 | null;
}

export async function requestEnemyAutoDrive(
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AutoDriveResult> {
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/auto-drive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error(`auto-drive request failed (${response.status})`);
  const body: unknown = await response.json();
  const snapshot = parseSnapshot(body);
  if (!snapshot || !isRecord(body)) throw new Error("invalid auto-drive response");
  if (body.stopReason !== "round_revealed" && body.stopReason !== "human_input" && body.stopReason !== "complete") {
    throw new Error("invalid auto-drive stop reason");
  }
  const completedRound = body.completedRound;
  if (completedRound !== null && completedRound !== 1 && completedRound !== 2 && completedRound !== 3) {
    throw new Error("invalid completed round");
  }
  return { ...snapshot, stopReason: body.stopReason, completedRound };
}

export type BanResolutionOutcome =
  | { ok: true; resolvedBans: HeroId[]; snapshot: ProtocolSnapshot }
  | { ok: false; retryable: boolean; error: string };

/**
 * AP Ranked Roles V1 -- ban resolution happens in the engine (BanResolutionPolicy, deterministic by
 * seed). FAIL CLOSED: any failure returns `ok: false`; the caller must NOT start Round 1 and must
 * offer a retry -- never fabricate or reduce the ban set client-side.
 */
export async function resolveSimulatorBans(
  sessionId: string,
  playerBanPreferences: (HeroId | null)[],
  fetchImpl: typeof fetch = fetch,
): Promise<BanResolutionOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/resolve-bans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerBanPreferences }),
    });
  } catch {
    return { ok: false, retryable: true, error: "engine_unreachable" };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && typeof body.error === "string" ? body.error : `http_${response.status}`;
    const retryable = isRecord(body) && body.retryable === true;
    return { ok: false, retryable, error };
  }
  const snapshot = parseSnapshot(body);
  if (!snapshot || !isRecord(body) || !Array.isArray(body.resolvedBans) || !body.resolvedBans.every(isHeroId)) {
    return { ok: false, retryable: true, error: "invalid_ban_resolution_response" };
  }
  return { ok: true, resolvedBans: body.resolvedBans, snapshot };
}

export function resolveSimulatorAuthority(sessionId: string, seed: string, fetchImpl: typeof fetch = fetch): Promise<ProtocolSnapshot> {
  return fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/simulator-authority`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed }),
  }).then(readSnapshot);
}

function visibleHeroIds(slots: readonly PerspectiveHeroSlot[]): HeroId[] {
  return slots.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
}

// R1 S5 (blocker 1, independent architecture review) -- RecommendationSet/v2 client. Espejo a mano
// del contrato del motor (apps/engine/src/recommendation/types.ts) -- sólo los campos que este
// cliente/UI realmente consume, mismo criterio que el resto de este archivo (nunca un import
// cruzado apps/engine -> apps/web). El cliente pide recomendaciones SOLO con el sessionId del
// ProtocolSession ya existente + el lado de la sesión (server-derived) -- nunca reconstruye ni
// envía DraftState, candidatos legales, señales, roles, evidencia ni picks ocultos.
export type RecommendationPosition = 1 | 2 | 3 | 4 | 5;

export interface RecommendationSlotV2 {
  side: TeamSide;
  slotIndex: number;
  position?: RecommendationPosition | null;
}

export interface RecommendationActionV2 {
  slot: RecommendationSlotV2;
  hero: HeroId;
}

export interface RecommendationRoleImpactV2 {
  status: "CONFIRMED_FORCED" | "LIKELY" | "UNRESOLVED";
  position: RecommendationPosition | null;
  marginals: Record<RecommendationPosition, number>;
  entropy: number;
}

export interface RecommendationLegacyProjectionV2 {
  hero: HeroId;
  signals: SignalContribution[];
  evidenceCoverage: number;
  guessingIndex: number;
  reason: string;
}

export interface RecommendationV2 {
  actions: RecommendationActionV2[];
  score: number;
  confidence: SuggestionConfidence;
  roleImpact: Record<number, RecommendationRoleImpactV2>;
  risks: { kind: string; detail: string }[];
  legacy: RecommendationLegacyProjectionV2 | null;
}

export interface RecommendationDegradationV2 {
  reason: string;
  detail: string;
}

export interface RecommendationDecisionV2 {
  actor: TeamSide;
  actionKind: "BAN" | "PICK" | null;
  controlledSlots: RecommendationSlotV2[];
  actionCount: number;
}

// R1 S7 -- espejo a mano de RecommendationDeferredFields (apps/engine/src/recommendation/types.ts),
// ampliado sólo con los campos que la UI del Copilot realmente lee. `deferred` sólo trae datos
// reales para `recommendations[0]` (el motor nunca calcula S6 para el resto) -- el consumidor de
// este tipo nunca debe asumir que aplica a cualquier otra recomendación del set. "Plausible", nunca
// "probable": ningún campo de acá es una probabilidad calibrada, son puntajes V6 reutilizados tal
// cual desde la perspectiva del rival.
export const NOT_COMPUTED = "NOT_COMPUTED" as const;
export type NotComputed = typeof NOT_COMPUTED;

export type OnePlyStatus =
  | "PLAUSIBLE_RESPONSE"
  | "NO_LEGAL_RESPONSE"
  | "COLLISION_PENDING"
  | "DRAFT_COMPLETE"
  | "OWN_ACTION_UNAVAILABLE"
  | "SIMULATION_UNAVAILABLE";

export type StealStatus = OnePlyStatus | "MATERIALIZED" | "STILL_CONTESTABLE" | "NOT_APPLICABLE";

export interface OpponentResponseV2 {
  status: OnePlyStatus;
  action: RecommendationActionV2 | null;
  confidence: SuggestionConfidence | null;
}

export interface StealEvaluationV2 {
  status: StealStatus;
  heroId: HeroId | null;
}

export interface OnePlyLookaheadV2 {
  status: OnePlyStatus;
  resultingEvaluation: { ourActionScore: number; opponentResponseScore: number | null; scoreDelta: number | null } | null;
}

export interface RecommendationDeferredFieldsV2 {
  opponentResponse: OpponentResponseV2 | NotComputed;
  steal: StealEvaluationV2 | NotComputed;
  lookahead: OnePlyLookaheadV2 | NotComputed;
}

export interface RecommendationSetV2 {
  schema: "recommendation-set/v2";
  sessionId: string;
  decision: RecommendationDecisionV2;
  recommendations: RecommendationV2[];
  degradations: RecommendationDegradationV2[];
  deferred: RecommendationDeferredFieldsV2;
  decisionContext: DraftDecisionContext | "no_action";
}

function isRecommendationPosition(value: unknown): value is RecommendationPosition {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isSignalContribution(value: unknown): value is SignalContribution {
  if (!isRecord(value)) return false;
  return typeof value.signal === "string" && (value.raw === null || typeof value.raw === "number") && typeof value.weighted === "number"
    && typeof value.explanation === "string" && typeof value.sampleSize === "number";
}

function isRecommendationSlot(value: unknown): value is RecommendationSlotV2 {
  return isRecord(value) && (value.side === "radiant" || value.side === "dire") && typeof value.slotIndex === "number"
    && (value.position === undefined || value.position === null || isRecommendationPosition(value.position));
}

function isRoleImpact(value: unknown): value is RecommendationRoleImpactV2 {
  if (!isRecord(value)) return false;
  if (value.status !== "CONFIRMED_FORCED" && value.status !== "LIKELY" && value.status !== "UNRESOLVED") return false;
  if (value.position !== null && !isRecommendationPosition(value.position)) return false;
  return isRecord(value.marginals) && typeof value.entropy === "number";
}

function isLegacyProjection(value: unknown): value is RecommendationLegacyProjectionV2 {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return isHeroId(value.hero) && Array.isArray(value.signals) && value.signals.every(isSignalContribution)
    && typeof value.evidenceCoverage === "number" && typeof value.guessingIndex === "number" && typeof value.reason === "string";
}

function isConfidence(value: unknown): value is SuggestionConfidence {
  return value === "alta" || value === "media" || value === "baja";
}

function isRisk(value: unknown): value is { kind: string; detail: string } {
  return isRecord(value) && typeof value.kind === "string" && typeof value.detail === "string";
}

function isRecommendation(value: unknown): value is RecommendationV2 {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.actions) || value.actions.length === 0) return false;
  if (!value.actions.every((action) => isRecord(action) && isRecommendationSlot(action.slot) && isHeroId(action.hero))) return false;
  if (typeof value.score !== "number" || !isConfidence(value.confidence)) return false;
  if (!isRecord(value.roleImpact) || !Object.values(value.roleImpact).every(isRoleImpact)) return false;
  if (!Array.isArray(value.risks) || !value.risks.every(isRisk)) return false;
  return isLegacyProjection(value.legacy ?? null);
}

function isDegradation(value: unknown): value is RecommendationDegradationV2 {
  return isRecord(value) && typeof value.reason === "string" && typeof value.detail === "string";
}

function isRecommendationDecision(value: unknown): value is RecommendationDecisionV2 {
  if (!isRecord(value)) return false;
  if (value.actor !== "radiant" && value.actor !== "dire") return false;
  if (value.actionKind !== null && value.actionKind !== "BAN" && value.actionKind !== "PICK") return false;
  return Array.isArray(value.controlledSlots) && value.controlledSlots.every(isRecommendationSlot) && typeof value.actionCount === "number";
}

function isOnePlyStatus(value: unknown): value is OnePlyStatus {
  return value === "PLAUSIBLE_RESPONSE" || value === "NO_LEGAL_RESPONSE" || value === "COLLISION_PENDING"
    || value === "DRAFT_COMPLETE" || value === "OWN_ACTION_UNAVAILABLE" || value === "SIMULATION_UNAVAILABLE";
}

function isStealStatus(value: unknown): value is StealStatus {
  return isOnePlyStatus(value) || value === "MATERIALIZED" || value === "STILL_CONTESTABLE" || value === "NOT_APPLICABLE";
}

function isRecommendationAction(value: unknown): value is RecommendationActionV2 {
  return isRecord(value) && isRecommendationSlot(value.slot) && isHeroId(value.hero);
}

function isOpponentResponse(value: unknown): value is OpponentResponseV2 {
  if (!isRecord(value)) return false;
  if (!isOnePlyStatus(value.status)) return false;
  if (value.action !== null && !isRecommendationAction(value.action)) return false;
  return value.confidence === null || isConfidence(value.confidence);
}

function isStealEvaluation(value: unknown): value is StealEvaluationV2 {
  if (!isRecord(value)) return false;
  if (!isStealStatus(value.status)) return false;
  return value.heroId === null || isHeroId(value.heroId);
}

function isResultingEvaluation(value: unknown): value is OnePlyLookaheadV2["resultingEvaluation"] {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return typeof value.ourActionScore === "number"
    && (value.opponentResponseScore === null || typeof value.opponentResponseScore === "number")
    && (value.scoreDelta === null || typeof value.scoreDelta === "number");
}

function isLookahead(value: unknown): value is OnePlyLookaheadV2 {
  if (!isRecord(value)) return false;
  if (!isOnePlyStatus(value.status)) return false;
  return isResultingEvaluation(value.resultingEvaluation);
}

function isDeferredFields(value: unknown): value is RecommendationDeferredFieldsV2 {
  if (!isRecord(value)) return false;
  const okOpponent = value.opponentResponse === NOT_COMPUTED || isOpponentResponse(value.opponentResponse);
  const okSteal = value.steal === NOT_COMPUTED || isStealEvaluation(value.steal);
  const okLookahead = value.lookahead === NOT_COMPUTED || isLookahead(value.lookahead);
  return okOpponent && okSteal && okLookahead;
}

export function parseRecommendationSet(value: unknown): RecommendationSetV2 | null {
  if (!isRecord(value)) return null;
  if (value.schema !== "recommendation-set/v2") return null;
  if (typeof value.sessionId !== "string") return null;
  if (!isRecommendationDecision(value.decision)) return null;
  if (!Array.isArray(value.recommendations) || !value.recommendations.every(isRecommendation)) return null;
  if (!Array.isArray(value.degradations) || !value.degradations.every(isDegradation)) return null;
  if (!isDeferredFields(value.deferred)) return null;
  return value as unknown as RecommendationSetV2;
}

/**
 * Blocker 1 -- the ONLY recommendation source for the R1 ProtocolSession simulator's human
 * Copilot. Sends nothing but the already-existing sessionId; the server derives the perspective
 * (localSide) from session metadata, exactly like every other route in this file. Never reaches
 * `/api/suggestions/preview` or any Pro-Drafter route (blocker 8) -- see use-random-draft-session.ts.
 */
export async function fetchRecommendations(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<RecommendationSetV2> {
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/recommendations`);
  if (!response.ok) throw new Error(`recommendations request failed (${response.status})`);
  const parsed = parseRecommendationSet(await response.json());
  if (!parsed) throw new Error("invalid recommendations response");
  return parsed;
}

export function protocolViewToDraftState(view: ProtocolPerspectiveView, patch: string): DraftState {
  const own = visibleHeroIds(view.ownPicks);
  const enemy = visibleHeroIds(view.enemyPicks);
  return {
    sessionId: view.sessionId,
    schema: "draft-state/v1",
    format: "all_pick",
    patch,
    localSide: view.viewerSide,
    phase: view.status === "COMPLETE" ? "complete" : "active",
    banned: [...view.bannedHeroes],
    picks: view.viewerSide === "radiant" ? { radiant: own, dire: enemy } : { radiant: enemy, dire: own },
    lastSeq: own.length + enemy.length + view.bannedHeroes.length,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: view.status === "DEGRADED" ? "degraded" : "ok" },
    updatedAt: new Date().toISOString(),
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    turn: null,
  };
}
