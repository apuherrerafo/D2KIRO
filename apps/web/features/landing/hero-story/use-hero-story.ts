/* LANDING-01C · the hero's clock. The story is a short list of STEPS; each step is a moment in the
   cause → effect chain of ONE blind round: our supports are locked and the enemy's are hidden (`picks`) →
   the enemy picks are revealed (`reveal`, the new information) → that information is applied reason by reason
   (`counterA`, `counterB`, `synergy`, `pool`), each one moving the Mid scores → the call (`decide`) → the lock
   (`lock`) → the hero travels into Pos 2 (`place`) → the finished draft rests (`hold`).
   The hook only decides WHICH step is current; every visual reads flags derived from it, so CSS never keeps a
   second timeline that can drift from this one.

   The loop never unmounts the interface: after `hold` the next pass begins with the NEXT scenario's data
   (derived from `cycle`), and the tiles re-acquire in place. Reduced motion plays the same moments once, as
   crossfades, and stops on the placed hero. */
"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useInView } from "@/design/round-3a/lab-context";
import { REASON_STAGES, type ReasonStage } from "../product-state/fake-scenario-hero";

export const STEPS = ["picks", "reveal", "counterA", "counterB", "synergy", "pool", "decide", "lock", "place", "hold"] as const;
export type StoryStep = (typeof STEPS)[number];
export type HeroStoryStep = StoryStep;

/** How long each step holds, in ms. Cumulative marks: 0 · 2.2 · 3.7 · 4.6 · 5.5 · 6.4 · 7.4 · 9.1 · 9.9 · 11.0 · loop at 13.6 s. */
export const STEP_MS: Readonly<Record<StoryStep, number>> = { picks: 2200, reveal: 1500, counterA: 900, counterB: 900, synergy: 900, pool: 1000, decide: 1700, lock: 800, place: 1100, hold: 2600 };

/** Reduced motion: the same story, one beat per moment, no micro-steps. Ends on the placed hero. */
const REDUCED_BEATS: readonly StoryStep[] = ["picks", "reveal", "pool", "decide", "hold"];
const REDUCED_BEAT_MS = 2200;

export type StoryFlags = {
  /** How many of the four reasons have arrived (0..4). Scores and the live ranking are a function of this and nothing else. */
  applied: number;
  armed: boolean;
  decided: boolean;
  /** Our hero is in Pos 2 (and the flight, if any, has landed). */
  placed: boolean;
  /** The hero is travelling right now. */
  placing: boolean;
  pressed: boolean;
  revealed: boolean;
  /** The reason stage that is arriving at this very step, or null. */
  stage: ReasonStage | null;
};

const STAGE_OF_STEP: Readonly<Partial<Record<StoryStep, ReasonStage>>> = { counterA: "enemyA", counterB: "enemyB", synergy: "synergy", pool: "pool" };

/** `armed` is false until the first beat has painted, so the first draft's tiles have a before and an after to animate between. */
export function flagsFor(step: StoryStep, armed = true): StoryFlags {
  const at = STEPS.indexOf(step);
  const reached = (name: StoryStep) => at >= STEPS.indexOf(name);
  return {
    applied: Math.max(0, Math.min(REASON_STAGES.length, at - STEPS.indexOf("reveal"))),
    armed,
    decided: reached("decide"),
    placed: reached("hold"),
    placing: step === "place",
    pressed: reached("lock"),
    revealed: reached("reveal"),
    stage: STAGE_OF_STEP[step] ?? null,
  };
}

/** Which of the five product moments the step belongs to (drives the progress ticks). */
export function momentOf(step: StoryStep) {
  if (step === "picks") return 0;
  if (step === "reveal") return 1;
  if (step === "decide") return 3;
  if (step === "lock" || step === "place" || step === "hold") return 4;
  return 2;
}

export type HeroStory = {
  armed: boolean;
  /** Counts completed passes. NOT a React key: the stage is never remounted, only its data changes. */
  cycle: number;
  finished: boolean;
  paused: boolean;
  replay: () => void;
  step: StoryStep;
  toggle: () => void;
};

export function useHeroStory(host: RefObject<Element | null>, reduced: boolean, reviewStep?: HeroStoryStep): HeroStory {
  const inView = useInView(host);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState({ cycle: 0, index: 0, reduced });
  const [armed, setArmed] = useState(false);
  const [visible, setVisible] = useState(true);
  const { cycle, index } = position;

  /* A change of motion preference starts the story over (derived during render, not in an effect). */
  if (position.reduced !== reduced) setPosition({ cycle: cycle + 1, index: 0, reduced });

  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    onChange();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const sequence: readonly StoryStep[] = reduced ? REDUCED_BEATS : STEPS;
  const controlled = reviewStep !== undefined;
  const autoplayStep = sequence[Math.min(index, sequence.length - 1)];
  const step = reviewStep ?? autoplayStep;
  const finished = !controlled && reduced && index >= sequence.length - 1;
  const running = !controlled && !paused && inView && visible && !finished;

  useEffect(() => {
    if (!running) return;
    const hold = reduced ? REDUCED_BEAT_MS : STEP_MS[step];
    const advance = (current: { cycle: number; index: number; reduced: boolean }) => {
      const next = (current.index + 1) % sequence.length;
      return { ...current, cycle: next === 0 ? current.cycle + 1 : current.cycle, index: next };
    };
    const timer = window.setTimeout(() => setPosition(advance), hold);
    return () => window.clearTimeout(timer);
  }, [reduced, running, sequence.length, step]);

  const toggle = useCallback(() => setPaused((current) => !current), []);
  const replay = useCallback(() => {
    setPosition((current) => ({ ...current, cycle: current.cycle + 1, index: 0 }));
    setPaused(false);
  }, []);
  return { armed: controlled || armed, cycle, finished, paused, replay, step, toggle };
}

/** Eases a displayed number toward `target`. Reduced motion shows the target at once (the change is still said by the delta chip). */
export function useCountTo(target: number, durationMs: number, reduced: boolean) {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    if (reduced || typeof window.requestAnimationFrame !== "function") {
      shownRef.current = target;
      return;
    }
    const from = shownRef.current;
    if (from === target) return;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const value = from + (target - from) * eased;
      shownRef.current = value;
      setShown(value);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationMs, reduced, target]);

  return Math.round(reduced ? target : shown);
}
