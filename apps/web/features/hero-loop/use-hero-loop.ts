/* HERO-LOOP LAB · the loop's clock. It only decides WHICH beat is current (a position in an endless walk through the
   scenarios); every visual reads `frameFor(scenario, beat)`. The interface never unmounts and there is no reset beat:
   the last beat of scenario C hands over to the first beat of scenario A of the next cycle. */
"use client";

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { useInView } from "@/design/round-3a/lab-context";
import { BEATS_BY_SCENARIO } from "./beats";
import { advance, frameFor, type Beat, type LoopFrame, type LoopPosition } from "./loop";
import { LOOP_SCENARIOS } from "./scenarios";

/** Reduced motion plays the same beats a little slower: it is crossfades, so each state needs longer to be read. */
const REDUCED_STRETCH = 1.3;

export type HeroLoopClock = {
  armed: boolean;
  beat: Beat;
  beats: readonly Beat[];
  frame: LoopFrame;
  jumpTo: (scenarioIndex: number, beatId?: string) => void;
  position: LoopPosition;
  step: () => void;
};

export function positionFor(scenarioIndex: number, beatId = "draft", cycle = 0): LoopPosition {
  const beats = BEATS_BY_SCENARIO[scenarioIndex] ?? BEATS_BY_SCENARIO[0];
  const beat = Math.max(0, beats.findIndex((b) => b.id === beatId));
  return { cycle, scenario: LOOP_SCENARIOS[scenarioIndex] ? scenarioIndex : 0, beat };
}

/** `ready` holds the clock until the portraits of every draft are in; the first draft is already on screen meanwhile. */
export function useHeroLoop(host: RefObject<Element | null>, reduced: boolean, paused: boolean, start: LoopPosition, ready = true): HeroLoopClock {
  const inView = useInView(host);
  const [position, setPosition] = useState<LoopPosition>(start);
  const [armed, setArmed] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const scenario = LOOP_SCENARIOS[position.scenario];
  const beats = BEATS_BY_SCENARIO[position.scenario];
  const beat = beats[position.beat];
  const running = !paused && inView && visible && ready;

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setPosition((current) => advance(current, BEATS_BY_SCENARIO[current.scenario], LOOP_SCENARIOS.length)), beat.ms * (reduced ? REDUCED_STRETCH : 1));
    return () => window.clearTimeout(timer);
  }, [beat, position, reduced, running]);

  const frame = useMemo(() => frameFor(scenario, beat), [scenario, beat]);
  const step = useCallback(() => setPosition((current) => advance(current, BEATS_BY_SCENARIO[current.scenario], LOOP_SCENARIOS.length)), []);
  const jumpTo = useCallback((scenarioIndex: number, beatId?: string) => setPosition((current) => positionFor(scenarioIndex, beatId, current.cycle)), []);

  return { armed, beat, beats, frame, jumpTo, position, step };
}
