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

export interface ProtocolSnapshot {
  view: ProtocolPerspectiveView;
  legalActions: ProtocolLegalAction[];
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
  return value as unknown as ProtocolSnapshot;
}

async function readSnapshot(response: Response): Promise<ProtocolSnapshot> {
  if (!response.ok) throw new Error(`protocol request failed (${response.status})`);
  const parsed = parseSnapshot(await response.json());
  if (!parsed) throw new Error("invalid protocol response");
  return parsed;
}

export interface CreateSimulatorSessionOptions {
  rulesetId?: RulesetId;
  /**
   * R1 S7 (Blocker 2) -- the human operator still submits every local-side sealed selection
   * itself (the simulator's whole premise: coach your team's picks), so `controlledSlots` here is
   * NOT "how many slots the browser is allowed to submit for" -- isCommandAuthorized never checked
   * that (protocol-session.ts). It is purely the declared party-size metadata S4's role-belief
   * system (role_gate) reads to size how much of the side is "known" vs a random teammate. Party 4
   * is never offered here -- createPartyContext (engine, authoritative) rejects it with
   * INVALID_PARTY_SIZE; the engine stays the one source of truth for that rule, never duplicated
   * here (web.md/invariantes.md: "no reimplementes reglas en frontend").
   */
  partySize?: PartySize;
}

export async function createSimulatorProtocolSession(
  patch: string,
  localSide: TeamSide,
  fetchImpl: typeof fetch = fetch,
  options: CreateSimulatorSessionOptions = {},
): Promise<string> {
  const partySize = options.partySize ?? 5;
  const controlledSlotCount = Math.min(partySize, 5);
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rulesetId: options.rulesetId ?? "dota2/ranked-all-pick",
      patch,
      localSide,
      adapterKind: "simulator",
      partyContext: {
        partySize,
        side: localSide,
        controlledSlots: Array.from({ length: controlledSlotCount }, (_, slotIndex) => ({
          side: localSide,
          slotIndex,
          controllerId: `simulator-local-${slotIndex}`,
        })),
      },
    }),
  });
  if (!response.ok) throw new Error(`protocol session creation failed (${response.status})`);
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.sessionId !== "string" || body.sessionId.length === 0) throw new Error("invalid protocol session response");
  return body.sessionId;
}

export function submitProtocolCommand(
  sessionId: string,
  command: ProtocolCommand,
  fetchImpl: typeof fetch = fetch,
): Promise<ProtocolSnapshot> {
  return fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command }),
  }).then(readSnapshot);
}

export function requestBotSelection(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<ProtocolSnapshot> {
  return fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/bot-selection`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }).then(readSnapshot);
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
  return isRecord(value) && (value.side === "radiant" || value.side === "dire") && typeof value.slotIndex === "number";
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

function parseRecommendationSet(value: unknown): RecommendationSetV2 | null {
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
