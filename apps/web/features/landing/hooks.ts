/* LANDING-01B · small state hooks. Motion here is gated on real changes of product state, never on a
   timer — the one exception is the demo's opt-in single pass, which stops at the first interaction. */
"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { useInView } from "@/design/round-3a/lab-context";
import type { DraftFrame } from "./product-state/types";

export const AUTOPLAY_STEP_MS = 4800;

export type DemoPlayer = {
  frame: DraftFrame;
  index: number;
  previous: DraftFrame | null;
  replay: () => void;
  select: (index: number) => void;
};

/**
 * Steps through the product-state frames. Autoplay runs ONE pass, only while the demo is on screen,
 * and stops for good on the first manual action. Reduced motion never autoplays (WCAG 2.2.2).
 */
export function useDemoPlayer(frames: readonly DraftFrame[], host: RefObject<Element | null>, autoplay: boolean): DemoPlayer {
  const inView = useInView(host);
  const [state, setState] = useState({ index: 0, previous: -1, manual: false });
  const last = frames.length - 1;

  useEffect(() => {
    if (!autoplay || state.manual || !inView || state.index >= last) return;
    const timer = window.setTimeout(() => setState((current) => ({ ...current, index: current.index + 1, previous: current.index })), AUTOPLAY_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [autoplay, inView, last, state.index, state.manual]);

  const select = useCallback((index: number) => setState((current) => ({ index, manual: true, previous: current.index })), []);
  const replay = useCallback(() => setState({ index: 0, manual: false, previous: -1 }), []);
  const frame = frames[Math.min(state.index, last)];
  const previous = state.previous >= 0 ? frames[Math.min(state.previous, last)] : null;
  return { frame, index: state.index, previous, replay, select };
}

/** True once the element has entered the viewport — a one-way latch, so section transitions play once. */
export function useSeen(ref: RefObject<Element | null>, reduced: boolean) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen || reduced || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    }, { threshold: 0.2 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [reduced, ref, seen]);
  return seen || reduced;
}

/** Latches `true` shortly after mount so a one-shot transition has a before and an after. Reduced motion is already "entered". */
export function useEntered(reduced: boolean, delayMs: number) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (reduced) return;
    const timer = window.setTimeout(() => setEntered(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, reduced]);
  return entered || reduced;
}
