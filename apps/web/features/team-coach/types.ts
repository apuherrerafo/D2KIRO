// Espejo a mano (nunca un import -- apps/web y apps/engine son procesos independientes) de:
//   apps/engine/src/coach/team-coach-board.ts        -> TeamCoachBoard (schema "team-coach-board/v1")
//   apps/engine/src/live/live-capture-registry.ts    -> LiveCaptureStatus (schema "live-capture-status/v1")
//   apps/engine/src/server/routes/live-capture.ts    -> cuerpo de POST .../live-observation
//   apps/engine/src/live/gsi-normalize.ts            -> GsiDraftCapabilities / phase (TSK-219)
//   apps/engine/src/server/routes/live-gsi.ts        -> GsiLinkView (schema "live-gsi-link/v1"), LiveTeamGroupResult ("live-team-group/v1")
// Se mueven en el mismo cambio que el motor o la validación (validation.ts) rechaza la respuesta.

import type { HeroId, TeamSide } from "@/features/draft/types";

export type TeamPosition = 1 | 2 | 3 | 4 | 5;

export type TeamCoachPositionState = "RANKED" | "UNRANKED_POSITIONAL" | "UNAVAILABLE" | "FILLED" | "WAITING";
/** PHASE_FALLBACK (live, and the simulator with >= 2 open positions): the position was chosen by draft-phase order because nothing tactical distinguishes them. */
export type TeamCoachTargetBasis = "STRATEGIC" | "DETERMINISTIC_DEFAULT" | "PHASE_FALLBACK";

export interface TeamCoachCandidate {
  heroId: HeroId;
  rank: number;
  /** `null` for an unranked positional alternative. */
  score: number | null;
  reasons: string[];
  isPrimary: boolean;
}

export interface TeamCoachColumn {
  position: TeamPosition;
  eligibleNow: boolean;
  alreadyFilled: boolean;
  filledHeroId: HeroId | null;
  state: TeamCoachPositionState;
  primaryHeroId: HeroId | null;
  top: TeamCoachCandidate[];
  stateIdentity: string;
  note: string | null;
}

export interface TeamCoachDecision {
  recommendedPosition: TeamPosition | null;
  recommendedHeroId: HeroId | null;
  targetBasis: TeamCoachTargetBasis | null;
  reason: string;
  actionablePositions: TeamPosition[];
  roundCapacity: number;
}

export interface TeamCoachBoardData {
  schema: "team-coach-board/v1";
  sessionId: string;
  stateIdentity: string;
  currentDecision: TeamCoachDecision;
  positions: TeamCoachColumn[];
  unboundOwnHeroIds: HeroId[];
}

export type LiveConnection = "waiting" | "connected" | "stale";
export type LiveCaptureHealth = "unknown" | "ok" | "degraded" | "lost";
export type LiveDraftPhase = "waiting" | "hero_selection" | "ended";

export interface LiveDetectedPick {
  side: TeamSide;
  heroId: HeroId;
  position: TeamPosition | null;
  source: "gsi" | "overwolf" | "manual" | "ocr";
  at: string;
}

export type GsiPhase = "idle" | "loading" | "draft" | "match";

/** What the Player's own Dota client actually reported this draft (never assumed). */
export interface GsiDraftCapabilities {
  draftBlock: boolean;
  side: boolean;
  ownHero: boolean;
  bans: boolean;
  allyPicks: boolean;
  enemyPicks: boolean;
}

export interface LiveGsiStatus {
  gameState: string | null;
  phase: GsiPhase;
  draft: GsiDraftCapabilities;
  /** This draft: Dota reported MORE draft facts in a later update than in an earlier one. */
  draftProgression?: boolean;
  telemetry: string[];
  /** Structural capability labels (engine `GSI_STRUCTURE_LABELS`): which sections / roster shapes Dota ever sent. Presence only. */
  structure?: string[];
  /** Server clock: ms since the last GSI update. */
  lastPacketAgeMs?: number;
  /** A GSI update (only ever via the https link route) arrived within the engine's stale window. */
  active?: boolean;
}

/** Which Party 5 preset the engine applied to this live session (never hero ids or names). */
export interface LiveTeamContext {
  teamGroupId: number | null;
  positions: Record<"1" | "2" | "3" | "4" | "5", boolean>;
}

/**
 * The Player's own seat in the live draft (mirror of the engine's LiveLocalPlayerStatus). `position` is what they
 * declared ("Soy Pos N"); `heroId` is the hero Dota says is theirs; `bound` is true only when the engine bound that
 * hero to that position. The screen shows what the ENGINE reports, never what was clicked.
 */
export interface LiveLocalPlayer {
  position: TeamPosition | null;
  heroId: HeroId | null;
  bound: boolean;
}

/** PUT /engine/api/live/human-position (schema "live-human-position/v1"). */
export interface LiveHumanPositionResult {
  localPlayer: LiveLocalPlayer;
}

/** A Party 5 preset as the live selector shows it: a name and which positions carry a pool. */
export interface LivePartyPreset {
  id: number;
  name: string;
  positions: Record<"1" | "2" | "3" | "4" | "5", boolean>;
}

export type LiveTeamGroupRefusal = "not_found" | "not_party5" | "no_pools" | "positions_unconfirmed" | "unsupported";

/** PUT /engine/api/live/team-group (schema "live-team-group/v1"). */
export interface LiveTeamGroupResult {
  applied: boolean;
  reason: LiveTeamGroupRefusal | null;
  teamContext: LiveTeamContext | null;
}

/** What the local visual capturer last reported (health only; never a frame). Mirror of the engine's LiveVisualStatus. */
export interface LiveVisualStatus {
  active: boolean;
  health: "ok" | "degraded" | "lost";
  detail: string | null;
  lastEventAgeMs: number;
  /** The helper's last word while a draft was open: it survives the draft, `health` does not (absent from older engines). */
  draft?: { health: "ok" | "degraded" | "lost"; detail: string | null } | null;
}

/** D2KIRO Companion's Dota state on the Player's PC. Mirror of the engine's LiveCompanionDota. */
export type LiveCompanionDota = "connected" | "waiting" | "not_running";
/** The visual helper as the Companion supervises it on the Player's PC. Mirror of the engine's LiveCompanionVisual. */
export type LiveCompanionVisual = "absent" | "downloading" | "failed" | "restarting" | "running";
/** Dota lifecycle as the Companion reads it from local GSI. Mirror of the engine's LiveCompanionPhase. */
export type LiveCompanionPhase = "MENU" | "LOADING" | "HERO_SELECTION" | "STRATEGY_TIME" | "MATCH" | "POST_GAME" | "OTHER";

/** D2KIRO Companion's last heartbeat (presence only, never identity). Mirror of the engine's LiveCompanionStatus. */
export interface LiveCompanionStatus {
  version: string;
  dota: LiveCompanionDota;
  phase: LiveCompanionPhase | null;
  restartNeeded: boolean;
  /** The visual helper's state on that PC (absent from older Companions/engines). */
  visual?: LiveCompanionVisual | null;
  /** The visual runtime build the Companion supervises, e.g. "0.1.1" (absent from older Companions/engines). */
  visualVersion?: string | null;
  active: boolean;
  lastSeenAgeMs: number;
}

/** Picks known (NONE / PARTIAL / PICKS_COMPLETE), independent of capture health. Mirrors the engine's LiveDraftCompleteness. */
export type LiveDraftCompleteness = "NONE" | "PARTIAL" | "PICKS_COMPLETE";
export type LiveBanKnowledge = "UNKNOWN" | "PARTIAL";
export type LiveRecommendationBlock = "CAPTURE_PARTIAL" | "SLOTS_UNREAD" | "FACTS_UNRESOLVED";

/** The engine's verdict on whether the Team Coach may recommend on this draft right now (it enforces it at its own routes too). */
export interface LiveRecommendationReadiness {
  available: boolean;
  reason: LiveRecommendationBlock | null;
}

export interface LiveCaptureStatus {
  schema: "live-capture-status/v1";
  sessionId: string;
  connection: LiveConnection;
  lastEventAt: string | null;
  captureHealth: LiveCaptureHealth;
  captureDetail: string | null;
  draftPhase: LiveDraftPhase;
  localSide: TeamSide | null;
  lastDetectedPick: LiveDetectedPick | null;
  bans: number;
  /** Positive ban evidence known (absent from older engines). */
  banKnowledge?: LiveBanKnowledge;
  picks: number;
  deferredPicks: number;
  rejectedFacts: number;
  /** Absent from older engines. */
  factsRevision?: number;
  /** Absent from older engines. */
  completeness?: LiveDraftCompleteness;
  /** Absent from older engines. */
  recommendation?: LiveRecommendationReadiness;
  /** Present once Dota GSI has spoken to this session (absent from older engines). */
  gsi?: LiveGsiStatus | null;
  /** Present once the local visual capturer has spoken to this session (absent from older engines). */
  visual?: LiveVisualStatus | null;
  /** Present once D2KIRO Companion has sent a heartbeat to this session (absent from older engines). */
  companion?: LiveCompanionStatus | null;
  /** Party 5 preset applied to this live session (absent from older engines). */
  teamContext?: LiveTeamContext;
  /** The Player's declared seat and whether their GSI hero is bound to it (absent from older engines). */
  localPlayer?: LiveLocalPlayer;
}

/** The browser's view of its Dota link: which live session to watch, until when. Never the credential. */
export interface GsiLinkView {
  sessionId: string;
  createdAt: string;
  expiresAt: string;
}

export type LiveObservationInput =
  | { type: "draft_started" }
  | { type: "side"; side: TeamSide }
  | { type: "ban"; heroId: HeroId }
  | { type: "unban"; heroId: HeroId }
  | { type: "bans_closed" }
  | { type: "pick"; side: TeamSide; heroId: HeroId; position: TeamPosition | null }
  | { type: "revert"; side: TeamSide; heroId: HeroId };

export type RequestStatus = "idle" | "loading" | "ready" | "failed";
