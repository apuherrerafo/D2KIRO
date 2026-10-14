/* LANDING V3 · the Hero stage island: the map canvas, the system-layer SVG and the Coach slot.
   The Coach: supported desktop = the approved Coach Motion V2 pack (pre-rendered frames following the Hero's two cues, requested only
   once the page is idle); phones = the approved still sprite (the Coach stays at home); reduced motion = the static still.
   The live Gold Master (Three.js) is never requested by this page. */
"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CoachSprite } from "../../hero-loop/coach/CoachSprite";
import { HeroMotionCoach } from "../../coach-motion/HeroMotionCoach";
import { DESKTOP_QUERY, useMediaQuery, useReducedMotion } from "../hooks";
import { motionStore } from "../hero/motion-store";
import { createHeroScene, type HeroScene } from "../hero/scene";
import type { HeroCue } from "../hero/timeline";

type CoachMode = "motion" | "sprite" | "static";

const subscribeNothing = () => () => undefined;
/** False on the server and during hydration, true once the browser has taken over: the Coach is only mounted then, so it is never swapped between renderers. */
function useIsClient(): boolean {
  return useSyncExternalStore(subscribeNothing, () => true, () => false);
}

function useCoachMode(reduced: boolean): CoachMode {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (reduced) return "static";
  return desktop ? "motion" : "sprite";
}

function CoachPicture({ mode, cue, playing }: { mode: CoachMode; cue: HeroCue; playing: boolean }) {
  if (mode === "motion") return <HeroMotionCoach playing={playing} state={cue} />;
  return <CoachSprite input={{ state: cue, aim: cue === "analyzing" ? "right" : "center", motion: mode === "static" ? "reduced" : "full" }} />;
}

export function HeroStage() {
  const reduced = useReducedMotion();
  const mode = useCoachMode(reduced);
  const client = useIsClient();
  const paused = useSyncExternalStore(motionStore.subscribe, motionStore.get, () => false);
  const [cue, setCue] = useState<HeroCue>("watching");
  const canvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const scene = useRef<HeroScene | null>(null);

  useEffect(() => {
    const hero = canvas.current?.closest<HTMLElement>(".hero");
    const root = canvas.current?.closest<HTMLElement>(".lv3");
    if (!canvas.current || !svg.current || !slot.current || !hero || !root) return;
    const created = createHeroScene({ hero, root, mapCanvas: canvas.current, svg: svg.current, coachSlot: slot.current, still: reduced, onCue: setCue });
    scene.current = created;
    created.clock.hold("paused", motionStore.get());
    if (window.__d2kiroQA) window.__d2kiroHero = { seek: created.seek };
    return () => {
      created.destroy();
      scene.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    scene.current?.clock.hold("paused", paused);
  }, [paused]);

  return (
    <>
      <div aria-hidden="true" className="hero-map"><canvas ref={canvas} /></div>
      <div aria-hidden="true" className="stage">
        <svg focusable="false" ref={svg} />
        <div className="coach-slot" data-coach-mode={mode} data-cue={cue} data-testid="hero-coach-slot" ref={slot}>
          {client && <CoachPicture cue={cue} mode={mode} playing={!paused} />}
        </div>
      </div>
    </>
  );
}

declare global {
  interface Window {
    /** set by tests before load: exposes the Hero loop's seek hook */
    __d2kiroQA?: boolean;
    __d2kiroHero?: { seek: (ms: number) => void };
  }
}
