/**
 * Landing V2 Memory - shared types (the controlled force graph and its Coach interpreter).
 */

export type LayoutId = 'wide' | 'narrow';
export type Vec = readonly [number, number];
export type Tone = 'cyan' | 'pink' | 'lime' | 'neutral';
export type NodeKind = 'you' | 'hero' | 'match' | 'concept' | 'condition' | 'open';
export type LabelDir = 't' | 'b' | 'l' | 'r';
export type CoachState = 'watching' | 'analyzing' | 'pointing' | 'confirming' | 'uncertain';

export type NodeId =
  | 'you'
  | 'puck'
  | 'm01'
  | 'm08'
  | 'storm'
  | 'void'
  | 'qop'
  | 'viper'
  | 'm24'
  | 'condition'
  | 'lane'
  | 'm56'
  | 'open';

export interface NodeDef {
  id: NodeId;
  label: string;
  kind: NodeKind;
  tone: Tone;
  r: number;
  mass: number;
  charge: number;
  dir: LabelDir;
  dirNarrow: LabelDir;
}

export interface LinkDef {
  id: string;
  a: NodeId;
  b: NodeId;
  tone: Tone;
  weight: number;
  k: number;
}

export interface RegionDef {
  id: string;
  caption: string;
  members: NodeId[];
  tone: Tone;
  dashed?: boolean;
  /** vertical offset of the caption from the topmost member (negative = above). */
  capDy: number;
  /** horizontal offset of the caption from the members' centroid. */
  capDx?: number;
  /** phone layout override (viewBox px offsets) or hide the caption. */
  narrow?: { dx: number; dy: number } | 'hidden';
}

/** Spawn origin, authored in WIDE coordinates; narrow is derived by the layout transform. */
export type SpawnFrom = { p: Vec } | { near: NodeId; dist: number };

export type Step =
  | { at: number; kind: 'spawn'; ids: NodeId[]; from: Partial<Record<NodeId, SpawnFrom>>; speed?: number; k?: number; anchor?: Partial<Record<NodeId, Vec>> }
  | { at: number; kind: 'tether'; links: string[] }
  | { at: number; kind: 'repel'; from: NodeId; targets: Array<[NodeId, number]>; strength: number; radius: number; duration: number }
  | { at: number; kind: 'reheat'; amount: number }
  | { at: number; kind: 'loosen'; ids: NodeId[]; k: number; duration: number }
  | { at: number; kind: 'slack'; factor: number; duration: number }
  | { at: number; kind: 'rebalance'; ids?: NodeId[] }
  | { at: number; kind: 'ghost'; links: string[] }
  | { at: number; kind: 'coach'; state: CoachState; focus: NodeId[]; /** Base Form dissolve/rebuild beat (live motion only) */ reconstruct?: boolean }
  | { at: number; kind: 'tone'; id: NodeId; tone: Tone };

export interface SceneDef {
  id: string;
  tab: string;
  eyebrow: string;
  headline: string;
  line: string;
  /** Final anchors for this scene (wide px), cumulative over earlier scenes. */
  anchors: Partial<Record<NodeId, Vec>>;
  /** Steps with a fixed time (ms since scene start). */
  timed: Step[];
  /** Steps whose `at` is a delay AFTER the system has settled. */
  afterSettle: Step[];
  /** Target visual weights of the shared layers. */
  layers: { soft: number; crisp: number; caption: number; ghost: number };
  /** Ghost weight while the system is still in motion; `layers.ghost` is the weight once it has settled. */
  ghostLive?: number;
  /** The same nodes travel to a new topology: draw a brief trail from where each one started. */
  transfer?: boolean;
  /** Coach state the reduced-motion composition shows. */
  restCoach: { state: CoachState; focus: NodeId[] };
}
