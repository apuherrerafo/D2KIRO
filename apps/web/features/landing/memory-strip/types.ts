/* Memory Strip — scene model. One evolving evidence object: every item carries a STABLE id, so a later
   motion pass can transform the same evidence between scenes instead of unmounting it. Puck is only the
   Storybook fixture; nothing here is specific to a hero. Coordinates live in one shared viewBox. */

export type Pt = readonly [number, number];

export const MEMORY_VIEWBOX = { w: 480, h: 500 } as const;

export type MemorySceneId = "match-01" | "match-08" | "match-24" | "match-56" | "player-model";

/** Canonical order of the evidence sequence. */
export const MEMORY_SCENE_ORDER: readonly MemorySceneId[] = ["match-01", "match-08", "match-24", "match-56", "player-model"];

/** cyan = retained / continuity · pink = contradiction · lime = qualified · neutral = unresolved. */
export type EvidenceTone = "cyan" | "pink" | "lime" | "neutral";

/** What the evidence MEANS. Geometry encodes this too, so colour is never the only carrier. */
export type PathRelation = "retained" | "uncertain" | "undertrace" | "qualified";

export interface EvidenceLabel {
  readonly text: string;
  readonly kicker?: string;
  readonly side: "above" | "below" | "below-left" | "left" | "right";
  /** Extra scene units of horizontal air for a below-left label, keeping it off a nearby line. */
  readonly extraGap?: number;
}

interface ItemBase {
  readonly id: string;
  /** Plain-language reading of this evidence, used for the textual (non-visual) description. */
  readonly meaning: string;
  readonly label?: EvidenceLabel;
  /** Active evidence is the one the annotation is talking about; on narrow screens only it keeps its label. */
  readonly active?: boolean;
}

export interface OriginItem extends ItemBase { readonly kind: "origin"; readonly at: Pt; readonly heroId: number }
export interface PathItem extends ItemBase {
  readonly kind: "path";
  readonly relation: PathRelation;
  readonly tone: EvidenceTone;
  readonly points: readonly Pt[];
  /** An uncertain path visibly stops: it ends in an open ring instead of a node. */
  readonly terminal?: boolean;
}
export interface NodeItem extends ItemBase { readonly kind: "node"; readonly at: Pt; readonly tone: EvidenceTone; readonly shape: "diamond" | "capsule" }
export interface EchoItem extends ItemBase { readonly kind: "echo"; readonly at: Pt; readonly heroId: number; readonly tone: EvidenceTone }
export interface MatchupItem extends ItemBase { readonly kind: "matchup"; readonly from: Pt; readonly to: Pt }
export interface ContradictionItem extends ItemBase { readonly kind: "contradiction"; readonly at: Pt; readonly angle: number }
export interface RoleItem extends ItemBase { readonly kind: "role"; readonly at: Pt }
export interface RegionItem extends ItemBase { readonly kind: "region"; readonly points: readonly Pt[] }

export type EvidenceItem =
  | OriginItem | PathItem | NodeItem | EchoItem | MatchupItem | ContradictionItem | RoleItem | RegionItem;

export interface MemoryScene {
  readonly id: MemorySceneId;
  /** Selected hero, role and draft context the memory is about. */
  readonly hero: { readonly id: number; readonly name: string };
  readonly role: string;
  readonly draftContext: string;
  readonly stage: { readonly kicker: string; readonly number?: string };
  readonly annotation: string;
  readonly evidenceNote: string;
  readonly items: readonly EvidenceItem[];
}
