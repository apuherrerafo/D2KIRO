import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { EvidenceView } from "./MemoryStripScene";
import { MEMORY_TRANSITIONS, type MemoryTransitionId } from "./continuity";
import { MEMORY_SCENES } from "./fake-scenario-memory";
import { bandCorners, polygonPath, smoothPath } from "./geometry";
import {
  annotationState, buildPlan, frameAt, ghostItems, labelInOpacity, labelOutOpacity, steadyLabelIds, windowAt,
  type Frame, type MotionPlan,
} from "./motion";
import { polylinePath } from "./path-sample";
import { MEMORY_SCENE_ORDER, type EvidenceItem, type MemoryScene, type MemorySceneId, type Pt } from "./types";

/* The Memory Strip player. It renders the same evidence components as the static scene — the union of the later scene's
   evidence and the earlier scene's folding evidence (ghosts), each under its stable id — and then writes transform /
   opacity / SVG attributes straight onto those elements frame by frame. No remounting, no layout reads, no loop while idle:
   a transition only runs when the scene changes. Everything it writes is saved first and restored exactly when it ends. */

export interface MemoryStripMotionProps {
  /** The scene to show. Moving to the NEXT scene plays that transition; any other change cuts. */
  sceneId: MemorySceneId;
  /** Bump to replay the transition INTO `sceneId` from its predecessor. */
  replayKey?: number;
  /** Review tool: freeze the transition into `sceneId` at this fraction (0–1) instead of playing it. */
  scrub?: number | null;
  /** "auto" follows prefers-reduced-motion; the story can force it to review the reduced behaviour. */
  reducedMotion?: "auto" | "reduce" | "full";
  /** Playback rate for review (1 = real time). */
  speed?: number;
  onSettled?: (sceneId: MemorySceneId) => void;
}

type Attr = "d" | "transform" | "points" | "x1" | "y1" | "x2" | "y2" | "cx" | "cy";
const sceneUnits = (p: Pt, ref: Pt) => `calc(var(--u) * ${Math.round((p[0] - ref[0]) * 100) / 100}), calc(var(--u) * ${Math.round((p[1] - ref[1]) * 100) / 100})`;

function usePrefersReduced(mode: "auto" | "reduce" | "full") {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (mode !== "auto" || typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [mode]);
  if (mode === "reduce") return true;
  if (mode === "full") return false;
  return reduced;
}

/** Writes frames onto the live DOM and remembers what it overwrote, so `restore()` puts the static scene back exactly. */
class Painter {
  private saved = new Map<Element, Map<string, string | null>>();
  private byId = new Map<string, Element>();
  private labels = new Map<string, HTMLElement>();
  private ghostLabels: HTMLElement[] = [];
  private nextLabels: HTMLElement[] = [];

  constructor(private canvas: HTMLElement, private annotation: HTMLElement | null) {
    canvas.querySelectorAll("[data-evidence]").forEach((el) => this.byId.set(el.getAttribute("data-evidence") as string, el));
    canvas.querySelectorAll<HTMLElement>(".ms-label").forEach((el) => {
      const id = el.getAttribute("data-for") as string;
      if (id.startsWith("ghost:")) this.ghostLabels.push(el);
      else this.labels.set(id, el);
    });
  }

  private remember(el: Element, name: string) {
    let attrs = this.saved.get(el);
    if (!attrs) { attrs = new Map(); this.saved.set(el, attrs); }
    if (!attrs.has(name)) attrs.set(name, el.getAttribute(name));
  }
  private attr(el: Element | null, name: Attr, value: string) {
    if (!el) return;
    this.remember(el, name);
    el.setAttribute(name, value);
  }
  private style(el: HTMLElement | SVGElement | null, prop: string, value: string) {
    if (!el) return;
    this.remember(el, "style");
    el.style.setProperty(prop, value);
  }

  paint(frame: Frame) {
    const item = frame.item;
    const el = this.byId.get(item.id);
    if (!el) return;
    const style = el as HTMLElement | SVGElement;
    this.style(style, "opacity", String(frame.opacity));
    switch (item.kind) {
      case "path": return this.path(el, item, frame);
      case "region": return this.attr(el, "d", frame.pts ? polylinePath(frame.pts, true) : polygonPath(item.points));
      case "matchup": return this.matchup(el, frame.band ?? [item.from, item.to]);
      case "node": return this.attr(el, "transform", `translate(${at(frame.pos ?? item.at)}) scale(${frame.scale})`);
      case "contradiction": return this.attr(el, "transform", `translate(${at(frame.pos ?? item.at)}) rotate(${frame.rot ?? item.angle}) scale(${1.25 * frame.scale})`);
      case "role": return this.attr(el, "transform", `translate(${at(frame.pos ?? item.at)})`);
      default: return this.dom(style, item, frame);
    }
  }

  private path(el: Element, item: Extract<EvidenceItem, { kind: "path" }>, frame: Frame) {
    const pts = frame.pts ?? item.points;
    const d = frame.pts ? polylinePath(frame.pts) : smoothPath(item.points);
    const core = el.querySelector(".ms-path-core");
    this.attr(core, "d", d);
    this.attr(el.querySelector(".ms-path-halo"), "d", d);
    if (core && frame.emphasis > 0) this.style(core as SVGElement, "stroke-width", String((item.relation === "qualified" ? 1.75 : 1.5) + frame.emphasis * 1.5));
    const terminal = el.querySelector<SVGElement>(".ms-terminal");
    if (terminal && pts.length > 0) {
      const last = pts[pts.length - 1];
      this.attr(terminal, "cx", String(last[0]));
      this.attr(terminal, "cy", String(last[1]));
      this.style(terminal, "opacity", String(frame.terminal));
    }
  }

  private matchup(el: Element, band: readonly [Pt, Pt]) {
    const corners = bandCorners(band[0], band[1], 16);
    const points = corners.map((p) => p.join(",")).join(" ");
    el.querySelectorAll("polygon").forEach((polygon) => this.attr(polygon, "points", points));
    const lines = el.querySelectorAll("line");
    const pairs: [Pt, Pt][] = [[corners[0], corners[1]], [corners[3], corners[2]]];
    lines.forEach((line, i) => {
      this.attr(line, "x1", String(pairs[i][0][0])); this.attr(line, "y1", String(pairs[i][0][1]));
      this.attr(line, "x2", String(pairs[i][1][0])); this.attr(line, "y2", String(pairs[i][1][1]));
    });
  }

  /** Origin seal and hero echoes are DOM: they translate from their rendered home by scene units, no measuring. */
  private dom(el: HTMLElement | SVGElement, item: EvidenceItem, frame: Frame) {
    if (!("at" in item)) return;
    const pos = frame.pos ?? item.at;
    this.style(el, "transform", `translate(-50%, -50%) translate(${sceneUnits(pos, item.at)}) scale(${frame.scale})`);
  }

  labelsAt(plan: MotionPlan, t: number, steady: Set<string>) {
    const incoming = labelInOpacity(plan, t);
    this.labels.forEach((el, id) => { if (!steady.has(id)) this.style(el, "opacity", String(incoming)); });
    const outgoing = labelOutOpacity(t);
    this.ghostLabels.forEach((el) => this.style(el, "opacity", String(outgoing)));
  }

  windowAt(plan: MotionPlan, t: number) {
    const w = windowAt(plan, t);
    this.style(this.canvas, "--ms-top", String(w.top));
    this.style(this.canvas, "--ms-h", String(w.h));
  }

  annotationOpacity(opacity: number) {
    if (this.annotation) this.style(this.annotation, "opacity", String(opacity));
  }

  restore() {
    this.saved.forEach((attrs, el) => attrs.forEach((value, name) => (value === null ? el.removeAttribute(name) : el.setAttribute(name, value))));
    this.saved.clear();
  }
}

const at = (p: Pt) => `${Math.round(p[0] * 100) / 100} ${Math.round(p[1] * 100) / 100}`;

const predecessor = (id: MemorySceneId): MemorySceneId | null => MEMORY_SCENE_ORDER[MEMORY_SCENE_ORDER.indexOf(id) - 1] ?? null;
const transitionId = (from: MemorySceneId, to: MemorySceneId) => MEMORY_TRANSITIONS.find((t) => t.from === from && t.to === to)?.id as MemoryTransitionId;

export function MemoryStripMotion({ sceneId, replayKey = 0, scrub = null, reducedMotion = "auto", speed = 1, onSettled }: MemoryStripMotionProps) {
  const reduced = usePrefersReduced(reducedMotion);
  const [settled, setSettled] = useState<MemorySceneId>(sceneId);
  const [plan, setPlan] = useState<MotionPlan | null>(null);
  const [annotationFrom, setAnnotationFrom] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const annotationRef = useRef<HTMLDivElement>(null);
  const previous = useRef({ sceneId, replayKey });
  const live = useRef<{ plan: MotionPlan | null; settled: MemorySceneId; painter: Painter | null; painterFor: MotionPlan | null; stale: MotionPlan | null; raf: number; speed: number }>({ plan: null, settled: sceneId, painter: null, painterFor: null, stale: null, raf: 0, speed });
  const scrubbing = scrub !== null;

  /* Keep the imperative side's view of the latest render (read by the request effect and the frame loop). */
  useLayoutEffect(() => {
    live.current.plan = plan;
    live.current.settled = settled;
    live.current.speed = speed;
  });

  /* A request (new scene, replay, scrub on/off, reduced-motion change): end whatever is running, then decide play / cut. */
  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = { sceneId, replayKey };
    const state = live.current;
    cancelAnimationFrame(state.raf);
    state.painter?.restore();
    state.painter = null;
    state.painterFor = null;
    /* The plan effect below still sees the plan of THIS render; it must not repaint something that was just ended. */
    state.stale = state.plan;
    const current = state.plan?.to.id ?? state.settled;
    const pred = predecessor(sceneId);
    const replay = replayKey !== was.replayKey;
    const forward = sceneId !== was.sceneId && pred !== null && current === pred;
    const next = pred && (scrubbing || replay || forward) ? buildPlan(transitionId(pred, sceneId), reduced) : null;
    /* A request is the boundary where props (external intent) become the player's state; the DOM it ends must be restored first. */
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setAnnotationFrom(false);
    setPlan(next);
    if (!next) setSettled(sceneId);
  }, [sceneId, replayKey, scrubbing, reduced]);

  const ghosts = useMemo(() => (plan ? ghostItems(plan) : []), [plan]);
  const steady = useMemo(() => (plan ? steadyLabelIds(plan.from, plan.to) : new Set<string>()), [plan]);
  const ghostLabelItems = useMemo(() => (plan ? plan.from.items.filter((item) => item.label && !steady.has(item.id)) : []), [plan, steady]);

  /* Paint one instant of the active plan. */
  const paintAt = (activePlan: MotionPlan, painter: Painter, t: number) => {
    activePlan.tracks.forEach((track) => painter.paint(frameAt(track, t, activePlan.reduced)));
    painter.labelsAt(activePlan, t, steady);
    painter.windowAt(activePlan, t);
    const note = annotationState(activePlan, t);
    painter.annotationOpacity(note.opacity);
    setAnnotationFrom(note.scene === "from");
  };

  /* Frozen frame (scrub) or a running transition. Starts after the union is committed, before paint. */
  useLayoutEffect(() => {
    const state = live.current;
    if (!plan || !canvasRef.current || state.stale === plan) return;
    /* One painter per plan: it holds what was overwritten, so a scrub must keep using it. */
    if (state.painterFor !== plan || !state.painter) {
      state.painter?.restore();
      state.painter = new Painter(canvasRef.current, annotationRef.current);
      state.painterFor = plan;
    }
    const painter = state.painter;
    if (scrub !== null) { paintAt(plan, painter, scrub * plan.duration); return; }
    paintAt(plan, painter, 0);
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(plan.duration, (now - started) * state.speed);
      if (t >= plan.duration) {
        /* Commit the settled scene (ghosts leave) in the same frame, then put the exact static geometry back. */
        flushSync(() => { setPlan(null); setSettled(plan.to.id); });
        painter.restore();
        state.painter = null;
        state.painterFor = null;
        onSettled?.(plan.to.id);
        return;
      }
      paintAt(plan, painter, t);
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(state.raf);
    // paintAt closes over `steady`, derived from `plan`; both change together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, scrub]);

  useEffect(() => () => { cancelAnimationFrame(live.current.raf); live.current.painter?.restore(); }, []);

  const shown: MemoryScene = plan ? plan.to : MEMORY_SCENES[settled];
  const annotationScene = plan && annotationFrom ? plan.from : shown;
  /* A scroll-driven scrub re-renders the player every frame; the evidence tree only changes with the plan, so React
     never re-walks it mid-transition (the painter owns those frames). */
  return useMemo(() => (
    <EvidenceView
      scene={shown}
      items={plan ? [...shown.items, ...ghosts] : shown.items}
      ghostLabelItems={ghostLabelItems}
      annotationScene={annotationScene}
      motion={plan !== null}
      canvasRef={canvasRef}
      annotationRef={annotationRef}
    />
  ), [annotationScene, ghostLabelItems, ghosts, plan, shown]);
}
