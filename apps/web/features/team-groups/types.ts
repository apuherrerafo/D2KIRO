import type { HeroId } from "@/features/draft/types";

export type PartySize = 1 | 2 | 3 | 5;

/** A position 1..5 (carry ... hard support). */
export type Seat = 1 | 2 | 3 | 4 | 5;

/** One hero pool of one person at one position (Hero Pools V2). `version` is the compare-and-set token for saving it. */
export interface MemberPositionPool {
  position: Seat;
  heroPool: HeroId[];
  version: number;
  updatedAt: string;
}

export interface TeamMemberEntry {
  id: number;
  teamGroupId: number;
  /** Display order in the editor. NOT a position. */
  slot: number;
  /** Usual position, confirmed by the user. `null` = never confirmed (old teams): no pool is applied for them. */
  position: Seat | null;
  name: string;
  /** LEGACY single list. The engine never uses it until the user confirms which position it belongs to. */
  heroPool: HeroId[];
  /** The pools that are actually used, one per position. Edited only through the per-position endpoint. */
  positionPools: MemberPositionPool[];
  updatedAt: string;
}

export interface TeamGroupEntry {
  id: number;
  name: string;
  partySize: PartySize;
  updatedAt: string;
  members: TeamMemberEntry[];
}

export interface TeamMemberPutEntry {
  /** The saved member this entry is (same person, any nickname). Absent = a new person with no inherited pool. */
  id?: number;
  slot: number;
  position: Seat | null;
  name: string;
  heroPool: HeroId[];
}

export interface TeamGroupPutBody {
  name: string;
  partySize: PartySize;
  members: TeamMemberPutEntry[];
}

export interface DraftTeamGroup {
  id: number | null;
  name: string;
  partySize: PartySize;
  members: TeamMemberPutEntry[];
}

export interface SaveMemberPoolArgs {
  teamGroupId: number;
  memberId: number;
  position: Seat;
  heroPool: HeroId[];
  /** The `version` last read for this pool; `0` = "there is none yet". */
  expectedVersion: number;
}
