import type { DraftDecisionContext, DraftState, HeroId, SignalContribution, SuggestionConfidence, TeamSide } from "@/features/draft/types";
import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";

export type ProtocolStatus = "ACTIVE" | "UNCONFIRMED_STATE" | "WAITING_FOR_COLLISION_AUTHORITY" | "COMPLETE" | "DEGRADED";
export type RankedApPhase = "BAN_RESOLUTION" | "PICK_ROUND_1" | "PICK_ROUND_2" | "PICK_ROUND_3" | "COMPLETE";

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
  rankedAp: { phase: RankedApPhase; banResolutionComplete: boolean };
}

export type ProtocolLegalAction =
  | { type: "RECORD_RESOLVED_BANS" }
  | { type: "BAN_RESOLUTION_COMPLETE" }
  | { type: "SUBMIT_SEALED_SELECTION"; side: TeamSide; slotIndex: number };

export interface ProtocolSnapshot {
  view: ProtocolPerspectiveView;
  legalActions: ProtocolLegalAction[];
}

type ProtocolCommand =
  | { type: "RECORD_RESOLVED_BANS"; heroes: HeroId[] }
  | { type: "BAN_RESOLUTION_COMPLETE" }
  | { type: "SUBMIT_SEALED_SELECTION"; side: TeamSide; slotIndex: number; heroId: HeroId };

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

function parseSnapshot(value: unknown): ProtocolSnapshot | null {
  if (!isRecord(value) || !isRecord(value.view) || !Array.isArray(value.legalActions)) return null;
  const view = value.view;
  if (view.schema !== "draft-protocol-perspective/v1") return null;
  if (typeof view.sessionId !== "string") return null;
  if (view.viewerSide !== "radiant" && view.viewerSide !== "dire") return null;
  if (!Array.isArray(view.bannedHeroes) || !view.bannedHeroes.every(isHeroId)) return null;
  if (!Array.isArray(view.ownPicks) || !view.ownPicks.every(isSlot)) return null;
  if (!Array.isArray(view.enemyPicks) || !view.enemyPicks.every(isSlot)) return null;
  if (!isRecord(view.rankedAp) || typeof view.rankedAp.phase !== "string") return null;
  return value as unknown as ProtocolSnapshot;
}

async function readSnapshot(response: Response): Promise<ProtocolSnapshot> {
  if (!response.ok) throw new Error(`protocol request failed (${response.status})`);
  const parsed = parseSnapshot(await response.json());
  if (!parsed) throw new Error("invalid protocol response");
  return parsed;
}

export async function createSimulatorProtocolSession(
  patch: string,
  localSide: TeamSide,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rulesetId: "dota2/ranked-all-pick",
      patch,
      localSide,
      adapterKind: "simulator",
      partyContext: {
        partySize: 5,
        side: localSide,
        controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: localSide, slotIndex, controllerId: `simulator-local-${slotIndex}` })),
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

export interface RecommendationSetV2 {
  schema: "recommendation-set/v2";
  sessionId: string;
  decision: RecommendationDecisionV2;
  recommendations: RecommendationV2[];
  degradations: RecommendationDegradationV2[];
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

function isRecommendation(value: unknown): value is RecommendationV2 {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.actions) || value.actions.length === 0) return false;
  if (!value.actions.every((action) => isRecord(action) && isRecommendationSlot(action.slot) && isHeroId(action.hero))) return false;
  if (typeof value.score !== "number" || !isConfidence(value.confidence)) return false;
  if (!isRecord(value.roleImpact) || !Object.values(value.roleImpact).every(isRoleImpact)) return false;
  if (!Array.isArray(value.risks)) return false;
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

function parseRecommendationSet(value: unknown): RecommendationSetV2 | null {
  if (!isRecord(value)) return null;
  if (value.schema !== "recommendation-set/v2") return null;
  if (typeof value.sessionId !== "string") return null;
  if (!isRecommendationDecision(value.decision)) return null;
  if (!Array.isArray(value.recommendations) || !value.recommendations.every(isRecommendation)) return null;
  if (!Array.isArray(value.degradations) || !value.degradations.every(isDegradation)) return null;
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
