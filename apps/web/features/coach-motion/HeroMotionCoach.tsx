/* COACH MOTION V2 · the Landing Hero's Coach on desktop. The Hero loop says WHAT is happening (a semantic state); this slot follows it through the pack's graph.
     - the static Coach is on screen from the first paint (CoachMotionPlayer always mounts it), so the Hero reads before any animation exists;
     - the pack is only requested once the page has gone idle (and never on Save-Data / reduced motion), starting in the loop the Hero is already in;
     - a state change is a CUE, taken at a frame boundary on the entry head nearest to the loop's phase; the Coach never jumps ahead of the Hero because it only ever
       follows a state the Hero has already shown.
   No Three.js, no model, no video: pre-rendered 384 px frames on a 2D canvas. */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CoachMotionPlayer, type CoachMotionPlayerHandle, type MotionState, type MotionStatus } from "./CoachMotionPlayer";
import { nextHop } from "./follow";

/** Quiet time after mount before the pack is requested: the Hero's own first frames and portraits go first. */
const START_AFTER_MS = 900;
/** How often an unsettled follower re-tries its next hop (a request is refused while a transition plays). */
const CHASE_MS = 100;

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 400);
  return () => window.clearTimeout(id);
}

type Props = {
  state: MotionState;
  playing: boolean;
  onStatus?: (status: MotionStatus) => void;
};

export function HeroMotionCoach({ state, playing, onStatus }: Props) {
  const handle = useRef<CoachMotionPlayerHandle | null>(null);
  const want = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The state the Hero is in when the pack is requested; null until then (the player stays static, nothing is fetched). */
  const [startedIn, setStartedIn] = useState<MotionState | null>(null);

  useEffect(() => {
    want.current = state;
  }, [state]);

  useEffect(() => {
    if (saveData()) return;
    let cancelIdle: (() => void) | null = null;
    const wait = window.setTimeout(() => {
      cancelIdle = whenIdle(() => setStartedIn(want.current));
    }, START_AFTER_MS);
    return () => {
      window.clearTimeout(wait);
      cancelIdle?.();
    };
  }, []);

  const chase = useCallback(() => {
    const step = () => {
      timer.current = null;
      const h = handle.current;
      const s = h?.snapshot();
      if (!h || !s || s.status !== "motion") return;
      const target = want.current;
      if (s.mode === target) return; // settled in the loop that was asked for
      if (s.mode !== "transition") {
        const hop = nextHop(s.mode as MotionState, target);
        if (hop) h.cue(hop);
      }
      timer.current = setTimeout(step, CHASE_MS);
    };
    if (timer.current) clearTimeout(timer.current);
    step();
  }, []);

  useEffect(() => {
    chase();
  }, [state, chase]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleStatus = useCallback(
    (status: MotionStatus) => {
      onStatus?.(status);
      if (status === "motion") chase();
    },
    [chase, onStatus],
  );

  return <CoachMotionPlayer initial={startedIn ?? state} onStatus={handleStatus} pack="384" phase={state} playing={playing} reducedMotion={startedIn === null} ref={handle} />;
}
