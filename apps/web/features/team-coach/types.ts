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
export type TeamCoachTargetBasis = "STRATEGIC" | "DETERMINISTIC_DEFAULT";

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
  source: "gsi" | "overwolf" | "manual";
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

/**
 * What the paired Overwolf adapter reported for this draft (engine `LiveOverwolfStatus`). Presence of Overwolf
 * GEP info keys only -- never a hero, a player or any identity.
 */
export interface LiveOverwolfStatus {
  connected: boolean;
  roster: boolean;
  bans: boolean;
  draft: boolean;
  players: boolean;
  /** Server clock: ms since the last adapter batch. */
  lastUpdateAgeMs: number;
  /** Overwolf is the source of the full draft right now (connected and it has stated draft heroes). */
  authoritative: boolean;
}

/** Which Party 5 preset the engine applied to this live session (never hero ids or names). */
export interface LiveTeamContext {
  teamGroupId: number | null;
  positions: Record<"1" | "2" | "3" | "4" | "5", boolean>;
}

/** A Party 5 preset as the live selector shows it: a name and which positions carry a pool. */
export interface LivePartyPreset {
  id: number;
  name: string;
  positions: Record<"1" | "2" | "3" | "4" | "5", boolean>;
}

export type LiveTeamGroupRefusal = "not_found" | "not_party5" | "no_pools" | "unsupported";

/** PUT /engine/api/live/team-group (schema "live-team-group/v1"). */
export interface LiveTeamGroupResult {
  applied: boolean;
  reason: LiveTeamGroupRefusal | null;
  teamContext: LiveTeamContext | null;
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
  picks: number;
  deferredPicks: number;
  rejectedFacts: number;
  /** Present once Dota GSI has spoken to this session (absent from older engines). */
  gsi?: LiveGsiStatus | null;
  /** Party 5 preset applied to this live session (absent from older engines). */
  teamContext?: LiveTeamContext;
  /** Present once the paired Overwolf adapter has spoken to this session (absent from older engines). */
  overwolf?: LiveOverwolfStatus | null;
}

/** POST /engine/api/live/capture-pairing (schema "live-capture-pairing/v1"): a one-time code, shown once. */
export interface CapturePairingCode {
  code: string;
  expiresAt: string;
}

/** GET/DELETE /engine/api/live/capture-pairing (schema "live-capture-pairing-state/v1"). Never the credential. */
export interface CapturePairingState {
  paired: boolean;
  expiresAt: string | null;
  overwolf: LiveOverwolfStatus | null;
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
