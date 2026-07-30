import type { HeroId } from "@/features/draft/types";

export type DraftPathArchetype = "push" | "teamfight" | "pickoff" | "scaling";

export type DraftCapabilityGap =
  | "initiation"
  | "catch"
  | "waveclear"
  | "structural_damage"
  | "teamfight"
  | "scaling"
  | "damage_mix";

export interface DraftPathStep {
  hero: HeroId;
  score: number;
  fills: DraftCapabilityGap[];
  reasons: string[];
}

export interface DraftPath {
  archetype: DraftPathArchetype;
  label: string;
  score: number;
  missing: DraftCapabilityGap[];
  nextPick: DraftPathStep;
  followUps: DraftPathStep[];
  reason: string;
}

export interface DraftPathSet {
  schema: "draft-paths/v1";
  sessionId: string;
  basedOnSeq: number;
  paths: DraftPath[];
  computedInMs: number;
}

export type CoverFlowPosition = "previous" | "active" | "next";

export interface VisibleDraftPathCard {
  path: DraftPath;
  index: number;
  position: CoverFlowPosition;
}
