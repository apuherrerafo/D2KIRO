import type { HeroId } from "../draft/reducer";

export type Confidence = "high" | "medium" | "exploratory" | "none";

export interface ProSourceRef {
  readonly source: "opendota_match" | "opendota_league" | "opendota_position_est";
  readonly fetchedAt: string;
  readonly sampleSize: number;
}

export interface ProTournament {
  readonly leagueId: number;
  readonly name: string;
  readonly tier: "premium" | "professional" | "excluded" | "amateur" | "unknown";
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly region: "unknown";
  readonly ref: ProSourceRef;
  readonly confidence: Confidence;
}

export interface ProDraftTurn {
  readonly order: number;
  readonly isPick: boolean;
  readonly heroId: HeroId;
  readonly team: 0 | 1;
}

export interface ProDraftSlot {
  readonly heroId: HeroId;
  readonly team: 0 | 1;
  readonly positionEst: 1 | 2 | 3 | 4 | 5;
  readonly laneRole: number;
  readonly isRoaming: boolean;
  readonly netWorth: number;
}

export interface ProDraft {
  readonly matchId: string;
  readonly leagueId: number;
  readonly patch: string;
  readonly startTime: number;
  readonly gameMode: number;
  readonly radiantTeamId: number | null;
  readonly direTeamId: number | null;
  readonly winningSide: "radiant" | "dire";
  readonly turns: readonly ProDraftTurn[];
  readonly slots: readonly ProDraftSlot[];
  readonly ref: ProSourceRef;
}
