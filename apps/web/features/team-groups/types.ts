import type { HeroId } from "@/features/draft/types";

export type PartySize = 1 | 2 | 3 | 5;

export interface TeamMemberEntry {
  id: number;
  teamGroupId: number;
  slot: number;
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
  slot: number;
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
