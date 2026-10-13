/* LANDING V2 · 2 · MEMORY. The approved Memory Physics V1.1 as a scroll-driven chapter: the graph is pinned and the scroll
   chooses the scene — Match 01 → 08 → 24 → 56 → what it knows about you. The graph stays deterministic (same fixed-step world,
   same seed); scroll only picks WHICH scene plays and a scene is never skipped on the way forward: the next one starts once
   the current one has settled. Match 24 is the peak (the contradiction, the loss of equilibrium, the condition, the new
   topology, the Coach confirming after the evidence). The Coach here is the pre-rendered Gold Master, never Three.js.
   Offscreen the paint loop halts; reduced motion uses the interpolating controller (no force simulation). */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { useMemoryAssets } from "./assets";
import { MEMORY } from "./copy";
import MemoryGraph from "./memory/MemoryGraph";
import { SCENES } from "./memory/fixtures";
import { LATE_PROGRESS, pastExitDeadline, holdFor, mustSettle, paceFor } from "./memory/scroll-pace";
import { pinProgress, sceneForProgress } from "./memory/scroll-scene";
import type { LayoutId } from "./memory/types";
import { useNear } from "./viewport";
import "./memory/memory-graph.css";

const NARROW_BELOW = 720;
const LOOKAHEAD_RESET = 0.5;
const LAST_SCENE = SCENES.length - 1;

function useLayout(ref: React.RefObject<HTMLElement | null>): LayoutId {
  const [layout, setLayout] = useState<LayoutId>("wide");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setLayout(el.clientWidth < NARROW_BELOW ? "narrow" : "wide");
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return layout;
}

/** What the scroll position is asking for: the scene, whether the exit catch-up is on, whether the exit deadline has passed. Listens only while the section is near the screen. */
function useScrollTarget(track: React.RefObject<HTMLElement | null>, pin: React.RefObject<HTMLElement | null>, near: boolean, onDeadline: () => void) {
  const [target, setTarget] = useState(0);
  const [late, setLate] = useState(false);
  const [deadline, setDeadline] = useState(false);
  useEffect(() => {
    if (!near) return;
    let latched = false;
    let lastProgress = -1;
    let lastTime = 0;
    const read = (initial = false) => {
      const t = track.current;
      const p = pin.current;
      if (!t || !p) return;
      const stuck = parseFloat(getComputedStyle(p).top) || 0;
      const progress = pinProgress(t.getBoundingClientRect().top, t.offsetHeight, p.offsetHeight, stuck);
      const now = performance.now();
      const velocity = lastProgress >= 0 && now > lastTime ? (progress - lastProgress) / (now - lastTime) : 0;
      lastProgress = progress;
      lastTime = now;
      // latched: velocity noise must not hand the scene back once the viewer is leaving; scrolling back below mid-pin re-arms it
      const wasLatched = latched;
      if (progress < LOOKAHEAD_RESET) latched = false;
      else if (!latched && pastExitDeadline(progress, velocity)) latched = true;
      const apply = () => {
        setTarget(sceneForProgress(progress));
        setLate(progress >= LATE_PROGRESS);
        setDeadline(latched);
        if (latched && !wasLatched) onDeadline();
      };
      // the deadline is a race against the momentum: render Final in this very frame
      if (latched && !wasLatched && !initial) flushSync(apply);
      else apply();
    };
    // read in the scroll event itself (no extra frame): the exit deadline is a race against the momentum
    const schedule = () => read();
    read(true);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [near, onDeadline, pin, track]);
  return { target, late, deadline };
}

export function MemorySection() {
  const reduced = useReducedMotion();
  const track = useRef<HTMLElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const near = useNear(track, "40% 0px 40% 0px");
  const ready = useMemoryAssets(near);
  const layout = useLayout(stage);
  const [shown, setShown] = useState(0);
  const [done, setDone] = useState(-1);
  const [snap, setSnap] = useState(false);
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);
  /* Exit deadline reached on the scroll event: the settled final composition (rendered in that same frame by the scroll read). */
  const settleNow = useCallback(() => {
    if (!mustSettle(shownRef.current, LAST_SCENE, true)) return;
    setSnap(true);
    setShown(LAST_SCENE);
    setDone(-1);
  }, []);
  const { target, late, deadline } = useScrollTarget(track, pin, near, settleNow);

  /* Forward: one scene at a time, each after the previous has settled. Backward: straight there (the world restores the
     settled composition). Offscreen: settle on the target — nobody is watching the intermediate scenes. */
  /* eslint-disable react-hooks/set-state-in-effect -- the shown scene is sequenced against the graph's own done signal */
  useEffect(() => {
    if (shown === target) return;
    // the exit deadline was reached on the scroll's momentum: Final stays, the scroll is about to arrive there
    if (near && deadline && shown === LAST_SCENE) return;
    if (!near || target < shown) {
      setSnap(false);
      setShown(target);
      setDone(-1);
      return;
    }
    if (done !== shown) return;
    const timer = window.setTimeout(() => {
      setSnap(false);
      setShown(shown + 1);
      setDone(-1);
    }, holdFor(shown, target, reduced));
    return () => window.clearTimeout(timer);
  }, [deadline, done, near, reduced, shown, target]);

  /* The exit deadline is a scroll position, not a timer after the release: a momentum flick keeps carrying the page, so
     Final has to be on screen before the viewer has left Memory. */
  useEffect(() => {
    if (!near || !deadline || !mustSettle(shown, LAST_SCENE, true)) return;
    setSnap(true);
    setShown(LAST_SCENE);
    setDone(-1);
  }, [near, deadline, shown]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const pace = paceFor(shown, target, LAST_SCENE, late);
  const def = SCENES[shown];
  const resting = reduced || done === shown;
  const bg = `${shown}-${resting ? "rest" : "live"}`;

  return (
    <section aria-labelledby="memory-title" className="lv2-memory" data-bg={bg} data-layout={layout} data-reduced={reduced ? "true" : "false"} data-pace={pace.toFixed(1)} data-scene={shown} data-exit-catchup={late ? "true" : "false"} data-section="memory" data-settled={resting ? "true" : "false"} data-snapped={snap ? "true" : "false"} data-target={target} id="memory" ref={track} tabIndex={-1}>
      <div className="lv2-memory-pin" ref={pin}>
        <div aria-hidden="true" className="lv2m-atmos">
          <i className="lv2m-bg-field" data-field="cyan" />
          <i className="lv2m-bg-field" data-field="pink" />
          <i className="lv2m-bg-field" data-field="lime" />
        </div>
        <header className="ld-wrap lv2-memory-head">
          <p className="ld-kicker">{MEMORY.kicker}</p>
          <h2 className="lv2-h2" id="memory-title">{MEMORY.title}</h2>
        </header>
        <div className="ld-wrap lv2-memory-body">
          <div className="lv2-memory-stage" data-testid="memory-stage" ref={stage}>
            <MemoryGraph active={near && ready} layout={layout} onDone={setDone} pace={pace} reduced={reduced} scene={shown} snap={snap} />
            <div aria-live="polite" className="lv2-memory-copy" data-scene={shown}>
              <div className="lv2-memory-copy-inner" key={shown}>
                <p className="lv2-memory-eyebrow">{def.eyebrow}</p>
                <p className="lv2-memory-headline">{def.headline}</p>
                <p className="lv2-memory-line">{def.line}</p>
              </div>
            </div>
          </div>
          <ol aria-hidden="true" className="lv2-memory-beats">
            {SCENES.map((scene, index) => (
              <li data-state={index < shown ? "done" : index === shown ? "now" : "next"} key={scene.id}>
                <span className="lv2-memory-beat-bar" />
                <span className="lv2-memory-beat-label">{index === SCENES.length - 1 ? "About you" : scene.tab}</span>
              </li>
            ))}
          </ol>
          <p className="lv2-memory-cue" data-visible={shown <= 1 ? "true" : "false"}>{MEMORY.scrollCue}</p>
          <p className="ld-illustrative lv2-memory-note">{MEMORY.illustrative}</p>
        </div>
        <p className="ld-sr">{MEMORY.summary}</p>
      </div>
    </section>
  );
}
