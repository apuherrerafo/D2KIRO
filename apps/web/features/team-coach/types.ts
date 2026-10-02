// Espejo a mano (nunca un import -- apps/web y apps/engine son procesos independientes) de:
//   apps/engine/src/coach/team-coach-board.ts        -> TeamCoachBoard (schema "team-coach-board/v1")
//   apps/engine/src/live/live-capture-registry.ts    -> LiveCaptureStatus (schema "live-capture-status/v1")
//   apps/engine/src/server/routes/live-capture.ts    -> cuerpo de POST .../live-observation
//   apps/engine/src/live/gsi-normalize.ts            -> GsiDraftCapabilities / phase (TSK-219)
//   apps/engine/src/server/routes/live-gsi.ts        -> GsiLinkView (schema "live-gsi-link/v1")
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
  telemetry: string[];
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
