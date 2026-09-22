import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";
import type { HeroId, SuggestionConfidence } from "@/features/draft/types";
import { parseRecommendationSet, type RecommendationSetV2 } from "./protocol-client";

// AP Ranked Roles V1 / Wave 2 -- Coach output (RecommendationOutputV3) client. Espejo a mano del
// contrato del motor (apps/engine/src/coach/recommendation-output-v3.ts): apps/web nunca importa
// tipos de apps/engine. El cliente pide el consejo con el sessionId ya existente; el servidor deriva
// la perspectiva de los metadatos de sesión -- el navegador nunca envía ni recibe estado oculto.
//
// La UI renderiza `primaryAction` (qué hacer/revelar ahora) y luego la `shortlist` (opciones de
// héroe). La `strategy` es la ÚNICA declaración de cuán específico es el Coach: una acción a nivel de
// posición nunca se presenta como si fuera un héroe concreto.

export type CoachPosition = 1 | 2 | 3 | 4 | 5;

export type CoachStrategy =
  | { kind: "REVEAL_POSITION"; position: CoachPosition; rationale: string }
  | { kind: "REVEAL_HERO"; heroId: HeroId; position: CoachPosition; rationale: string }
  | { kind: "DEFER_POSITION"; position: CoachPosition; rationale: string }
  | { kind: "REVEAL_FLEX"; possiblePositions: CoachPosition[]; rationale: string }
  | { kind: "OPPORTUNITY"; subtype: "SAFE_CORE" | "COUNTER" | "STEAL"; heroId?: HeroId; rationale: string };

export type CoachBadge = "COUNTER" | "SYNERGY" | "POSITION_FIT" | "META" | "FLEX" | "YOUR_POOL" | "OUTSIDE_YOUR_POOL";
export type CoachRoleStatus = "CONFIRMED_FORCED" | "LIKELY" | "UNRESOLVED";
export type CoachTrigger = "DRAFT_PICKS_STARTED" | "OWN_PICK_CONFIRMED" | "ROUND_REVEALED" | "PLAYER_POSITION_ASSIGNED" | "STATE_CHANGED" | "REFRESH";

export interface CoachHeroCard {
  heroId: HeroId;
  position: CoachPosition;
  roleStatus: CoachRoleStatus;
  confidence: SuggestionConfidence;
  badges: CoachBadge[];
  rationale: string;
  score: number;
  isFromPool: boolean;
}

/** Espejo de `CoachOpportunity` del motor (Safe Core, Wave 4A). `sourceType` es únicamente "CURATED": no existe evidencia estadística aprobada. */
export interface CoachOpportunity {
  subtype: "SAFE_CORE";
  label: string;
  heroId: HeroId;
  evidence: string;
  counterEvidence: {
    kind: "COUNTER_RELIEF";
    sourceType: "CURATED";
    relieved: { heroId: HeroId; level: "hard" | "medium"; status: "BANNED" | "OWN_PICK" }[];
    totalHardCounters: number;
  };
}

export interface CoachOutput {
  schema: "recommendation-output/v3";
  sessionId: string;
  primaryAction: { strategy: CoachStrategy; label: string };
  shortlist: CoachHeroCard[];
  /** Bloque informativo de Safe Core: ausente salvo que exista evidencia real. No altera acción ni shortlist. */
  opportunity?: CoachOpportunity;
  /** `seatCovered`: the Player's own picks already fill this position, so `heroes` is empty by design (engine mirror; absent in older payloads). */
  personalHeroView?: { position: CoachPosition; positionLabel: string; seatCovered?: boolean; heroes: { heroId: HeroId; rank: number; score: number; isFromPool: boolean }[] };
  outsidePoolRecommendation?: { heroId: HeroId; label: string; rationale: string };
  roleBeliefs?: { own: CoachRoleBelief[]; enemy: CoachRoleBelief[] };
  meta: {
    round: 1 | 2 | 3 | null;
    phase: string | null;
    ownPicksRemaining: number;
    confidence: SuggestionConfidence;
    decisionContext: "team_opening" | "blind_second_pick" | "response_pick" | "closing_pick" | "no_signal_available";
    trigger: CoachTrigger;
    revision: number;
    basedOn: { stateIdentity: string; evidenceVersion: string };
  };
}

export interface CoachRoleBelief {
  heroId: HeroId;
  status: "CONFIRMED" | "LIKELY" | "UNRESOLVED";
  positions: CoachPosition[];
}

export interface RecommendationsWithCoach {
  recommendationSet: RecommendationSetV2;
  /** Null: el motor no tiene nada que aconsejar ahora (sin asiento abierto), o respondió sólo V2. */
  coach: CoachOutput | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHeroId(value: unknown): value is HeroId {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isPosition(value: unknown): value is CoachPosition {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isConfidence(value: unknown): value is SuggestionConfidence {
  return value === "alta" || value === "media" || value === "baja";
}

const BADGES: readonly string[] = ["COUNTER", "SYNERGY", "POSITION_FIT", "META", "FLEX", "YOUR_POOL", "OUTSIDE_YOUR_POOL"];
const TRIGGERS: readonly string[] = ["DRAFT_PICKS_STARTED", "OWN_PICK_CONFIRMED", "ROUND_REVEALED", "PLAYER_POSITION_ASSIGNED", "STATE_CHANGED", "REFRESH"];
const CONTEXTS: readonly string[] = ["team_opening", "blind_second_pick", "response_pick", "closing_pick", "no_signal_available"];

function isStrategy(value: unknown): value is CoachStrategy {
  if (!isRecord(value) || typeof value.rationale !== "string") return false;
  if (value.kind === "REVEAL_POSITION" || value.kind === "DEFER_POSITION") return isPosition(value.position);
  if (value.kind === "REVEAL_HERO") return isHeroId(value.heroId) && isPosition(value.position);
  if (value.kind === "REVEAL_FLEX") return Array.isArray(value.possiblePositions) && value.possiblePositions.length > 0 && value.possiblePositions.every(isPosition);
  if (value.kind === "OPPORTUNITY") {
    const subtype = value.subtype === "SAFE_CORE" || value.subtype === "COUNTER" || value.subtype === "STEAL";
    return subtype && (value.heroId === undefined || isHeroId(value.heroId));
  }
  return false;
}

function isHeroCard(value: unknown): value is CoachHeroCard {
  if (!isRecord(value)) return false;
  const roleOk = value.roleStatus === "CONFIRMED_FORCED" || value.roleStatus === "LIKELY" || value.roleStatus === "UNRESOLVED";
  return isHeroId(value.heroId) && isPosition(value.position) && roleOk && isConfidence(value.confidence)
    && Array.isArray(value.badges) && value.badges.every((badge) => typeof badge === "string" && BADGES.includes(badge))
    && typeof value.rationale === "string" && typeof value.score === "number" && typeof value.isFromPool === "boolean";
}

function isMeta(value: unknown): value is CoachOutput["meta"] {
  if (!isRecord(value) || !isRecord(value.basedOn)) return false;
  const roundOk = value.round === null || value.round === 1 || value.round === 2 || value.round === 3;
  return roundOk && (value.phase === null || typeof value.phase === "string") && typeof value.ownPicksRemaining === "number"
    && isConfidence(value.confidence) && typeof value.decisionContext === "string" && CONTEXTS.includes(value.decisionContext)
    && typeof value.trigger === "string" && TRIGGERS.includes(value.trigger) && typeof value.revision === "number"
    && typeof value.basedOn.stateIdentity === "string" && typeof value.basedOn.evidenceVersion === "string";
}

function isRoleBelief(value: unknown): value is CoachRoleBelief {
  return isRecord(value) && isHeroId(value.heroId) && (value.status === "CONFIRMED" || value.status === "LIKELY" || value.status === "UNRESOLVED")
    && Array.isArray(value.positions) && value.positions.length > 0 && value.positions.every(isPosition);
}

function isRelievedCounter(value: unknown): boolean {
  return isRecord(value) && isHeroId(value.heroId) && (value.level === "hard" || value.level === "medium")
    && (value.status === "BANNED" || value.status === "OWN_PICK");
}

function isOpportunity(value: unknown): boolean {
  if (!isRecord(value) || value.subtype !== "SAFE_CORE" || typeof value.label !== "string" || typeof value.evidence !== "string" || !isHeroId(value.heroId)) return false;
  const proof = value.counterEvidence;
  return isRecord(proof) && proof.kind === "COUNTER_RELIEF" && proof.sourceType === "CURATED"
    && typeof proof.totalHardCounters === "number" && Array.isArray(proof.relieved) && proof.relieved.every(isRelievedCounter);
}

function isPersonalHeroView(value: unknown): boolean {
  return isRecord(value) && isPosition(value.position) && typeof value.positionLabel === "string" && (value.seatCovered === undefined || typeof value.seatCovered === "boolean") && Array.isArray(value.heroes)
    && value.heroes.every((hero) => isRecord(hero) && isHeroId(hero.heroId) && typeof hero.rank === "number" && typeof hero.score === "number" && typeof hero.isFromPool === "boolean");
}

export function parseCoachOutput(value: unknown): CoachOutput | null {
  if (!isRecord(value) || value.schema !== "recommendation-output/v3" || typeof value.sessionId !== "string") return null;
  if (!isRecord(value.primaryAction) || !isStrategy(value.primaryAction.strategy) || typeof value.primaryAction.label !== "string") return null;
  if (!Array.isArray(value.shortlist) || !value.shortlist.every(isHeroCard)) return null;
  if (!isMeta(value.meta)) return null;
  if (value.opportunity !== undefined && !isOpportunity(value.opportunity)) return null;
  if (value.personalHeroView !== undefined && !isPersonalHeroView(value.personalHeroView)) return null;
  if (value.roleBeliefs !== undefined && (!isRecord(value.roleBeliefs) || !Array.isArray(value.roleBeliefs.own) || !Array.isArray(value.roleBeliefs.enemy)
    || !value.roleBeliefs.own.every(isRoleBelief) || !value.roleBeliefs.enemy.every(isRoleBelief))) return null;
  return value as unknown as CoachOutput;
}

export async function assignOwnCoachPosition(sessionId: string, heroId: HeroId, position: CoachPosition | null, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/position-assignment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ heroId, position }),
  });
  if (!response.ok) throw new Error(`position assignment failed (${response.status})`);
}

/**
 * The ONLY recommendation source for the AP Simulator Copilot: the same V2 set as before plus the
 * Coach output built on it (one server call, one computation). A plain V2 body (older engine, or a
 * fixture) is still accepted -- the panel then simply has no Coach section, never a guessed one.
 */
export async function fetchRecommendationsWithCoach(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<RecommendationsWithCoach> {
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/recommendations?format=v3`);
  if (!response.ok) throw new Error(`recommendations request failed (${response.status})`);
  const body: unknown = await response.json();

  if (isRecord(body) && "output" in body && "recommendationSet" in body) {
    const recommendationSet = parseRecommendationSet(body.recommendationSet);
    if (!recommendationSet) throw new Error("invalid recommendations response");
    const coach = body.output === null ? null : parseCoachOutput(body.output);
    if (body.output !== null && coach === null) throw new Error("invalid coach response");
    return { recommendationSet, coach };
  }
  const plain = parseRecommendationSet(body);
  if (!plain) throw new Error("invalid recommendations response");
  return { recommendationSet: plain, coach: null };
}
