import type { HeroId } from "../draft/reducer";

export type CapabilityLevel = "low" | "medium" | "high";
export type DamageType = "physical" | "magical" | "pure" | "mixed";

export interface HeroCapabilities {
  hero: HeroId;
  damageType: DamageType;
  hasInitiation: boolean;
  hasCatch: boolean;
  hasWaveclear: boolean;
  structuralDamage: CapabilityLevel;
  teamfight: CapabilityLevel;
  scaling: CapabilityLevel;
}

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
  label: "Push" | "Teamfight" | "Pickoff" | "Scaling";
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
