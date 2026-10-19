import type { HeroId } from "@/features/draft/types";

export type PartySize = 1 | 2 | 3 | 5;

/** A position 1..5 (carry ... hard support). */
export type Seat = 1 | 2 | 3 | 4 | 5;

export interface TeamMemberEntry {
  id: number;
  teamGroupId: number;
  /** Display order in the editor. NOT a position. */
  slot: number;
  /** Usual position, confirmed by the user. `null` = never confirmed (old teams): no pool is applied for them. */
  position: Seat | null;
  name: string;
  heroPool: HeroId[];
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
