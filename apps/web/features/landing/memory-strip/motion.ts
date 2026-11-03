import { MEMORY_CONTINUITY, MEMORY_TRANSITIONS, type ContinuityEntry, type ContinuityVerb, type MemoryTransitionId } from "./continuity";
import { MEMORY_SCENES } from "./fake-scenario-memory";
import { SAMPLE_N, centroid, lerpPt, lerpPts, nearestOn, revealPts, sampleClosed, sampleOpen } from "./path-sample";
import type { EvidenceItem, MemoryScene, MemorySceneId, Pt } from "./types";

/* Memory Strip motion, as data + pure functions. The choreography is DERIVED from `continuity.ts`: each evidence id
   gets one track whose behaviour follows its verb (enters/attaches draw in, strengthens pulses, moves morphs, compresses
   folds into its `into`, expands unfolds from its `from`). `frameAt(track, t)` is pure — no DOM, no clock — so the
   player can scrub it, replay it, and tests can read it. Nothing here animates by itself. */

/* ───────── tokens: a small semantic set, not a timing table ───────── */

export const MEMORY_MOTION = {
  EVIDENCE_ENTER: { dur: 420, ease: "outCubic" },
  ATTACH: { dur: 560, ease: "spring" },
  STRENGTHEN: { dur: 700, ease: "pulse" },
  QUALIFY: { dur: 820, ease: "inOutCubic" },
  COMPRESS: { dur: 700, ease: "inOutCubic" },
  EXPAND: { dur: 760, ease: "inOutCubic" },
  MODEL_REORGANIZE: { dur: 1500, ease: "inOutCubic" },
} as const;
export type MotionToken = keyof typeof MEMORY_MOTION;

const EASES = {
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  /* controlled spring: ~3% overshoot, settled by t = 1 */
  spring: (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-8 * t) * Math.cos(7 * t)),
  pulse: (t: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, t))),
} as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (a: number, b: number, t: number) => { const x = clamp01((t - a) / (b - a)); return x * x * (3 - 2 * x); };
const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;

/** Reduced motion keeps meaning (what arrived, what left) with short opacity changes and direct position updates. */
export const REDUCED_MOTION_MS = 360;
/** Labels never chase geometry: old ones leave first, new ones arrive once their evidence has settled. */
export const LABEL_OUT_MS = 240;
export const LABEL_IN_MS = 360;
/** The annotation dips while the evidence changes, so the words and the picture change together. */
export const ANNOTATION_SWAP_MS = 260;
export const ANNOTATION_FADE_MS = 340;

/* ───────── causal rhythm: when each piece of evidence starts (ms). One protagonist per transition. ───────── */

type Beat = number | readonly [start: number, dur: number];

/** The one motion event a viewer should follow in each transition; everything else is quieter and later. */
export const PRIMARY_EVENT: Record<MemoryTransitionId, readonly string[]> = {
  "match-01>match-08": ["path:reuse", "echo:a"],
  "match-08>match-24": ["matchup:m1", "marker:c1", "path:main"],
  "match-24>match-56": ["node:m1", "path:open", "echo:storm"],
  "match-56>player-model": ["path:main", "path:affinity", "path:contour-b"],
};

const MOVED_ALL: Record<string, Beat> = {
  origin: 0, "role:you": 0, "region:open": 0, "path:main": 0, "path:open": 0, "path:undertrace": 0, "path:qualified": 0,
  "matchup:m1": 0, "marker:c1": 0, "echo:viper": 0, "echo:b": 0, "echo:storm": 0, "echo:void": 0, "echo:qop": 0, "node:m1": 0,
};

export const MEMORY_BEATS: Record<MemoryTransitionId, Record<string, Beat>> = {
  /* existing evidence → first recurrence attaches → route reinforces → supporting recurrence joins → unresolved stays incomplete */
  "match-01>match-08": {
    "path:reuse": 0, "echo:a": 0, "node:m2": 220, "node:m3": 480, "path:main": 560,
    "region:open": 700, "path:weak": 900, "echo:storm": 1450,
  },
  /* recurrence → contradiction arrives → crosses the interpretation → it bends/qualifies → history stays */
  "match-08>match-24": {
    "echo:viper": 0, "matchup:m1": [80, 760], "node:m3": 600, "marker:c1": 640,
    "path:main": 900, "echo:a": 900, "node:m1": 900,
    "region:open": 1000, "path:reuse": 1000, "path:weak": 1000, "echo:storm": 1000, "path:open": 1050,
    "path:undertrace": 1500, "path:qualified": 1550, "echo:b": 2150,
  },
  /* what was folded away re-emerges from where it was recorded; groups organise; the exception joins; the open end stays open */
  "match-24>match-56": {
    "region:open": [0, 900], "node:m1": 150, "echo:storm": 150, "path:affinity": [150, 700], "path:open": 450,
    "echo:void": 750, "path:role": 900, "node:q1": 1250, "node:role": 1250, "echo:qop": 1300,
    "path:qualified": 1400, "path:exception": 1500, "node:exc": 1900,
  },
  /* everything moves together, then the strands that are not the contour fold into it and the contour closes */
  "match-56>player-model": {
    ...MOVED_ALL,
    "path:affinity": [250, 1200], "path:role": [250, 1200], "path:exception": [350, 1200], "node:m2": [300, 1200],
    "node:q1": [350, 1200], "node:role": [350, 1200], "node:exc": [350, 1200], "echo:a": [250, 1200],
    "path:contour-b": [600, 900], "path:core": [1000, 800], "node:core": 1350, "node:contour-b": 1650,
  },
};

/* The windows the CSS crops each scene to on a narrow canvas (scene units). Mid-transition the window is interpolated so
   the picture never jumps; a test keeps this table equal to `memory-strip.css`. */
export const MOBILE_WINDOW: Record<MemorySceneId, { readonly top: number; readonly h: number }> = {
  "match-01": { top: 60, h: 380 },
  "match-08": { top: 40, h: 370 },
  "match-24": { top: 50, h: 330 },
  "match-56": { top: 36, h: 420 },
  "player-model": { top: 0, h: 500 },
};

/* ───────── plan ───────── */

type Mode = "morph" | "enter" | "fold" | "unfold" | "fade";

export interface MotionTrack {
  readonly id: string;
  readonly verb: ContinuityVerb;
  readonly mode: Mode;
  readonly token: MotionToken;
  readonly start: number;
  readonly dur: number;
  readonly src: EvidenceItem | null;
  readonly dst: EvidenceItem | null;
  /** The element this one folds into (later scene) or unfolds from (earlier scene): a point, or a line to snap onto. */
  readonly anchor: { readonly point: Pt; readonly line?: readonly Pt[] } | null;
  readonly linkedId: string | null;
}

export interface MotionPlan {
  readonly transition: MemoryTransitionId;
  readonly from: MemoryScene;
  readonly to: MemoryScene;
  readonly tracks: readonly MotionTrack[];
  /** Milliseconds, scene to scene. */
  readonly duration: number;
  readonly labelsInAt: number;
  readonly reduced: boolean;
}

type PointItem = Extract<EvidenceItem, { at: Pt }>;
export const isPointItem = (item: EvidenceItem): item is PointItem =>
  item.kind === "origin" || item.kind === "echo" || item.kind === "node" || item.kind === "contradiction" || item.kind === "role";

export function anchorOf(item: EvidenceItem): Pt {
  if (isPointItem(item)) return item.at;
  if (item.kind === "region") return centroid(item.points);
  if (item.kind === "matchup") return lerpPt(item.from, item.to, 0.5);
  return sampleOpen(item.points)[Math.floor(SAMPLE_N / 2)];
}

function tokenFor(verb: ContinuityVerb, item: EvidenceItem | null, transition: MemoryTransitionId): MotionToken {
  const model = transition === "match-56>player-model";
  switch (verb) {
    case "enters": return "EVIDENCE_ENTER";
    case "attaches": return item?.kind === "path" && item.relation === "qualified" ? "QUALIFY" : "ATTACH";
    case "strengthens": return "STRENGTHEN";
    case "expands": return "EXPAND";
    case "compresses": return model ? "MODEL_REORGANIZE" : "COMPRESS";
    case "moves": return model ? "MODEL_REORGANIZE" : "QUALIFY";
    default: return "QUALIFY";
  }
}

const find = (scene: MemoryScene, id: string) => scene.items.find((item) => item.id === id) ?? null;

function anchorFor(entry: ContinuityEntry, from: MemoryScene, to: MemoryScene, near: Pt): MotionTrack["anchor"] {
  const link = entry.verb === "expands" ? entry.from : entry.into;
  if (!link) return null;
  const target = find(entry.verb === "expands" ? from : to, link);
  if (!target) return null;
  if (target.kind === "path") {
    const line = sampleOpen(target.points);
    return { point: nearestOn(line, near), line };
  }
  return { point: anchorOf(target) };
}

export function buildPlan(transition: MemoryTransitionId, reduced = false): MotionPlan {
  const meta = MEMORY_TRANSITIONS.find((t) => t.id === transition);
  if (!meta) throw new Error(`unknown transition ${transition}`);
  const from = MEMORY_SCENES[meta.from];
  const to = MEMORY_SCENES[meta.to];
  const tracks: MotionTrack[] = [];
  for (const entry of MEMORY_CONTINUITY[transition]) {
    if (entry.verb === "stays") continue;
    const src = find(from, entry.id);
    const dst = find(to, entry.id);
    const beat = MEMORY_BEATS[transition][entry.id] ?? 0;
    const start = typeof beat === "number" ? beat : beat[0];
    const token = tokenFor(entry.verb, dst ?? src, transition);
    const dur = reduced ? REDUCED_MOTION_MS - 80 : typeof beat === "number" ? MEMORY_MOTION[token].dur : beat[1];
    let mode: Mode = "morph";
    if (src && !dst) mode = entry.into ? "fold" : "fade";
    else if (!src && dst) mode = entry.verb === "expands" ? "unfold" : "enter";
    const subject = (dst ?? src) as EvidenceItem;
    tracks.push({
      id: entry.id, verb: entry.verb, mode, token, start: reduced ? 0 : start, dur,
      src, dst, anchor: mode === "fold" || mode === "unfold" ? anchorFor(entry, from, to, anchorOf(subject)) : null,
      linkedId: entry.into ?? entry.from ?? null,
    });
  }
  const end = Math.max(...tracks.map((t) => t.start + t.dur));
  return {
    transition, from, to, tracks, reduced,
    duration: reduced ? REDUCED_MOTION_MS : end + 160,
    labelsInAt: reduced ? 120 : Math.max(0, end - 250),
  };
}

/* ───────── frames ───────── */

export interface Frame {
  readonly opacity: number;
  readonly scale: number;
  /** Live position / angle (point kinds). Absent → the exact scene geometry. */
  readonly pos?: Pt;
  readonly rot?: number;
  /** Live sampled outline (paths: open, regions: closed). Absent → the exact scene geometry. */
  readonly pts?: readonly Pt[];
  readonly band?: readonly [Pt, Pt];
  /** 0 → 1 → 0 across a strengthen. */
  readonly emphasis: number;
  /** Open-ring terminal of an uncertain path: only once the path has fully arrived. */
  readonly terminal: number;
  /** The item whose exact geometry applies wherever the live fields are absent. */
  readonly item: EvidenceItem;
}

/** Pure: the state of one piece of evidence `t` ms into the transition. */
export function frameAt(track: MotionTrack, t: number, reduced = false): Frame {
  const item = (track.dst ?? track.src) as EvidenceItem;
  const local = clamp01((t - track.start) / track.dur);
  const e = EASES[MEMORY_MOTION[track.token].ease](local);
  const base: Frame = { opacity: 1, scale: 1, emphasis: 0, terminal: 1, item };

  if (reduced) {
    if (track.mode === "enter" || track.mode === "unfold") return { ...base, opacity: local };
    if (track.mode === "fold" || track.mode === "fade") return { ...base, opacity: 1 - clamp01(local * 1.4) };
    return base;
  }

  const { src, dst } = track;
  const k = EASES.inOutCubic(local);

  if (track.mode === "morph" && src && dst) {
    const emphasis = track.verb === "strengthens" ? EASES.pulse(local) : 0;
    if (dst.kind === "path" && src.kind === "path") return { ...base, pts: lerpPts(sampleOpen(src.points), sampleOpen(dst.points), k), emphasis };
    if (dst.kind === "region" && src.kind === "region") return { ...base, pts: lerpPts(sampleClosed(src.points), sampleClosed(dst.points), k) };
    if (dst.kind === "matchup" && src.kind === "matchup") return { ...base, band: [lerpPt(src.from, dst.from, k), lerpPt(src.to, dst.to, k)] };
    if (isPointItem(dst) && isPointItem(src)) {
      const rot = dst.kind === "contradiction" && src.kind === "contradiction" ? lerpN(src.angle, dst.angle, k) : undefined;
      return { ...base, pos: lerpPt(src.at, dst.at, k), rot };
    }
    return base;
  }

  if (track.mode === "enter" && dst) {
    if (dst.kind === "path") return { ...base, pts: revealPts(sampleOpen(dst.points), EASES.outCubic(local)), opacity: smooth(0, 0.12, local), terminal: smooth(0.92, 1, local) };
    if (dst.kind === "matchup") return { ...base, band: [dst.from, lerpPt(dst.from, dst.to, EASES.outCubic(local))], opacity: smooth(0, 0.2, local) };
    if (dst.kind === "contradiction") return { ...base, opacity: smooth(0, 0.45, local), scale: lerpN(0.3, 1, e), rot: dst.angle - 30 * (1 - e) };
    return { ...base, opacity: smooth(0, 0.45, local), scale: lerpN(0.3, 1, e) };
  }

  if (track.mode === "unfold" && dst) {
    const from = track.anchor?.point ?? anchorOf(dst);
    const opacity = smooth(0, 0.2, local);
    if (dst.kind === "path") return { ...base, pts: sampleOpen(dst.points).map((p) => lerpPt(from, p, e)), opacity, terminal: smooth(0.9, 1, local) };
    if (isPointItem(dst)) return { ...base, pos: lerpPt(from, dst.at, e), scale: lerpN(0.35, 1, e), opacity };
    return { ...base, opacity };
  }

  if ((track.mode === "fold" || track.mode === "fade") && src) {
    const opacity = 1 - smooth(0.2, 0.8, local);
    const sink = track.anchor;
    if (!sink) return { ...base, opacity: 1 - smooth(0, 1, local) };
    if (src.kind === "path") {
      const pts = sampleOpen(src.points);
      return { ...base, pts: lerpPts(pts, pts.map((p) => (sink.line ? nearestOn(sink.line, p) : sink.point)), k), opacity, terminal: 1 - smooth(0, 0.5, local) };
    }
    if (isPointItem(src)) return { ...base, pos: lerpPt(src.at, sink.line ? nearestOn(sink.line, src.at) : sink.point, k), scale: lerpN(1, 0.35, k), opacity };
    return { ...base, opacity };
  }
  return base;
}

/** Evidence that is only in the earlier scene stays on screen (as a ghost) until its fold completes. */
export const ghostItems = (plan: MotionPlan): EvidenceItem[] =>
  plan.tracks.filter((track) => track.src && !track.dst).map((track) => track.src as EvidenceItem);

/* ───────── labels, annotation, crop ───────── */

const sameLabel = (a: EvidenceItem, b: EvidenceItem) =>
  Boolean(a.label && b.label) && a.label?.text === b.label?.text && a.label?.kicker === b.label?.kicker && a.label?.side === b.label?.side
  && JSON.stringify(anchorOf(a)) === JSON.stringify(anchorOf(b));

/** A label identical in both scenes (same words, side and anchor) is steady: it does not blink. */
export function steadyLabelIds(from: MemoryScene, to: MemoryScene): Set<string> {
  const ids = new Set<string>();
  for (const item of to.items) {
    const before = find(from, item.id);
    if (before && sameLabel(before, item)) ids.add(item.id);
  }
  return ids;
}

export const labelInOpacity = (plan: MotionPlan, t: number) => smooth(plan.labelsInAt, plan.labelsInAt + LABEL_IN_MS, t);
export const labelOutOpacity = (t: number) => 1 - smooth(0, LABEL_OUT_MS, t);

/** 1 → 0 → 1 across the swap, and which scene's words are showing. */
export function annotationState(plan: MotionPlan, t: number): { opacity: number; scene: "from" | "to" } {
  if (plan.reduced) return { opacity: smooth(0, REDUCED_MOTION_MS * 0.6, t), scene: "to" };
  const scene = t < ANNOTATION_SWAP_MS ? "from" : "to";
  const opacity = scene === "from" ? 1 - smooth(0, ANNOTATION_SWAP_MS, t) : smooth(ANNOTATION_SWAP_MS, ANNOTATION_SWAP_MS + ANNOTATION_FADE_MS, t);
  return { opacity, scene };
}

/** The narrow-canvas crop, interpolated across the whole transition. */
export function windowAt(plan: MotionPlan, t: number): { top: number; h: number } {
  const a = MOBILE_WINDOW[plan.from.id], b = MOBILE_WINDOW[plan.to.id];
  const k = plan.reduced ? 1 : EASES.inOutCubic(clamp01(t / plan.duration));
  return { top: lerpN(a.top, b.top, k), h: lerpN(a.h, b.h, k) };
}
