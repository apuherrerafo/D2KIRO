/* HERO-LOOP LAB · the Hero's Coach slot. Locked strategy:
     desktop Hero  → REAL live Gold Master (Three.js)         mode "live"
     mobile Hero   → pre-rendered Hero pack                    mode "sprite"
     reduced motion→ static state stills, instant swaps        mode "static"
   Landing V2 adds mode "motion" (supported desktop): the approved pre-rendered Motion V2 pack, following the same semantic cue.
   The loop hands this slot a CoachCue (what is happening) and nothing else; it never learns which renderer drew it.
   Hierarchy is scale + position + timing + amplitude. The Coach is never desaturated. */
"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CoachCue, Verb } from "../loop";
import { HeroMotionCoach } from "../../coach-motion/HeroMotionCoach";
import type { MotionStatus } from "../../coach-motion/CoachMotionPlayer";
import { CoachLive } from "./CoachLive";
import { CoachSprite } from "./CoachSprite";
import type { CoachRenderInput } from "./coach-renderer";
import type { StageQuality } from "./live-stage";

export type CoachMode = "live" | "sprite" | "static" | "motion";
export type CoachOverride = "auto" | "live" | "sprite";

const DESKTOP_QUERY = "(min-width: 900px) and (hover: hover) and (pointer: fine)";

function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** SSR and the first client render say "sprite" so hydration matches; the live swap happens right after. */
export function useCoachMode(reduced: boolean, override: CoachOverride): CoachMode {
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);
  if (reduced) return "static";
  if (override === "sprite") return "sprite";
  if (override === "live") return "live";
  return desktop ? "live" : "sprite";
}

/** Landing V2: Motion V2 on supported desktop, the pre-rendered stills on phones, static stills under reduced motion. SSR and the first client render say "sprite". */
export function useLandingCoachMode(reduced: boolean): CoachMode {
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);
  if (reduced) return "static";
  return desktop ? "motion" : "sprite";
}

/** The pre-rendered Coach cannot re-pose, so the shared verbs reach it as small transform-only gestures (the live Coach
    answers the same verbs with real pose impulses). SCATTER and GATHER are the interface's, not the Coach's. */
const SPRITE_GESTURE: Partial<Record<Verb, Keyframe[]>> = {
  ATTRACT: [{ transform: "translateX(0)" }, { transform: "translateX(5px) scale(1.02)", offset: 0.4 }, { transform: "translateX(2px)" }],
  REPEL: [{ transform: "translateX(0)" }, { transform: "translateX(-7px) scale(.985)", offset: 0.25 }, { transform: "translateX(2px)", offset: 0.6 }, { transform: "translateX(0)" }],
  TETHER: [{ transform: "scale(1)" }, { transform: "scale(.985)", offset: 0.5 }, { transform: "scale(1)" }],
  SETTLE: [{ transform: "translateY(0) scaleY(1)" }, { transform: "translateY(2px) scaleY(.975)", offset: 0.3 }, { transform: "translateY(-1px) scaleY(1.01)", offset: 0.65 }, { transform: "translateY(0) scaleY(1)" }],
  TRANSFER: [{ transform: "translateX(0)" }, { transform: "translateX(6px)", offset: 0.35 }, { transform: "translateX(0)" }],
};

function useSpriteGesture(target: React.RefObject<HTMLDivElement | null>, verb: Verb | null, beatKey: string, enabled: boolean) {
  useEffect(() => {
    const el = target.current;
    const frames = verb ? SPRITE_GESTURE[verb] : undefined;
    if (!enabled || !el || !frames || typeof el.animate !== "function") return;
    const run = el.animate(frames, { duration: 700, easing: "cubic-bezier(.22,.8,.24,1)" });
    return () => run.cancel();
  }, [target, verb, beatKey, enabled]);
}

type Props = {
  cue: CoachCue;
  /** Changes at every beat (restarts the verb flourish). */
  beatKey: string;
  mode: CoachMode;
  quality?: StageQuality;
  /** Motion V2 only: false holds the picture (the Hero's Pause). */
  playing?: boolean;
};

export function HeroCoach({ cue, beatKey, mode, quality = "lite", playing = true }: Props) {
  const [liveReady, setLiveReady] = useState(false);
  const [liveFailed, setLiveFailed] = useState<string | null>(null);
  const wantsLive = mode === "live" && liveFailed === null;
  const handleReady = useCallback(() => setLiveReady(true), []);
  const handleFail = useCallback((reason: string) => setLiveFailed(reason), []);
  const flourish = useRef<HTMLDivElement>(null);
  const [motionStatus, setMotionStatus] = useState<MotionStatus>("static");
  const spriteShown = !(wantsLive && liveReady) && mode !== "motion";
  useSpriteGesture(flourish, cue.verb, beatKey, spriteShown && mode !== "static");

  const input: CoachRenderInput = { state: cue.state, aim: cue.aim, motion: mode === "static" ? "reduced" : "full" };
  const renderer = mode === "motion" ? (motionStatus === "motion" ? "motion-v2" : "sprite") : wantsLive ? (liveReady ? "live" : "sprite-loading") : mode === "static" ? "static" : "sprite";

  return (
    <div
      className="hl-coach"
      data-aim={cue.aim}
      data-fallback={liveFailed || (mode === "motion" && motionStatus === "failed") ? "true" : "false"}
      data-mode={mode}
      data-renderer={renderer}
      data-state={cue.state}
      data-testid="hero-coach"
      data-verb={cue.verb ?? "none"}
      style={{ "--hl-coach-scale": String(cue.scale) } as React.CSSProperties}
    >
      <div className="hl-coach-body">
        <div className="hl-coach-flourish" data-verb={cue.verb ?? "none"} ref={flourish}>
          {spriteShown && <CoachSprite input={input} />}
          {mode === "motion" && <HeroMotionCoach onStatus={setMotionStatus} playing={playing} state={cue.state} />}
          {wantsLive && <CoachLive cue={cue} onFail={handleFail} onReady={handleReady} quality={quality} verbKey={beatKey} />}
        </div>
      </div>
    </div>
  );
}
