/* LANDING V3 · the living decision graph's controller. Scroll chooses the beat; each beat then plays on its own clock.
   beat = f(scroll progress) with a small hysteresis band, and the stage state is a pure function of the beat, so a fast flick that skips
   beats simply lands in the right state. Nothing here feeds scroll position into animation frames. The stage is built only once the story
   is near the viewport (its Coach stills are not fetched at page entry) and rebuilt when the layout switches between wide and narrow. */
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { BEAT_COUNT, beatForProgress, clamp, progressForBeat, type Beat } from "./model";
import { makeStage } from "./stage";
import { alignThread } from "./thread";

const LOCK_MS = 1100;

interface Args {
  story: RefObject<HTMLDivElement | null>;
  stick: RefObject<HTMLDivElement | null>;
  host: RefObject<HTMLDivElement | null>;
  /** build the animated stage (false while it is far away, or in reduced motion) */
  active: boolean;
  narrow: boolean;
  reduced: boolean;
}

function storyProgress(story: HTMLElement, stick: HTMLElement): { range: number; p: number } {
  const range = story.offsetHeight - stick.offsetHeight;
  const top = story.getBoundingClientRect().top - parseFloat(getComputedStyle(stick).top);
  return { range, p: range > 0 ? clamp(-top / range, 0, 1) : 0 };
}

export function useStoryController({ story, stick, host, active, narrow, reduced }: Args): { beat: Beat; goto: (k: number) => void } {
  const [beat, setBeat] = useState<Beat>(1);
  /** the beat survives a rebuild (wide <-> narrow), so the story never jumps back to 01 */
  const lastBeat = useRef<Beat>(1);
  const control = useRef<{ goto: (k: number) => void }>({ goto: () => undefined });

  useEffect(() => {
    const storyEl = story.current;
    const stickEl = stick.current;
    const hostEl = host.current;
    if (!active || reduced || !storyEl || !stickEl || !hostEl) return;

    const api = control.current;
    const stage = makeStage(hostEl, narrow ? "tall" : "wide", false, false);
    let current = 0;
    let locked = false;
    let lockTimer = 0;
    let queued = false;

    const show = (k: Beat, instant: boolean) => {
      stage.setBeat(k, instant || current === 0);
      current = k;
      lastBeat.current = k;
      setBeat(k);
    };
    const follow = () => {
      if (locked) return;
      const k = beatForProgress(storyProgress(storyEl, stickEl).p, current);
      if (k !== current) show(k, false);
    };
    const handleScroll = () => {
      if (queued || locked) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        follow();
      });
    };
    const handleLayout = () => {
      alignThread(stage, stickEl);
      follow();
    };
    api.goto = (k: number) => {
      const target = clamp(k, 1, BEAT_COUNT) as Beat;
      const { range } = storyProgress(storyEl, stickEl);
      const y0 = window.scrollY + storyEl.getBoundingClientRect().top - parseFloat(getComputedStyle(stickEl).top);
      locked = true;
      window.clearTimeout(lockTimer);
      show(target, false);
      window.scrollTo({ top: y0 + progressForBeat(target) * range, behavior: reduced ? "auto" : "smooth" });
      lockTimer = window.setTimeout(() => {
        locked = false;
        follow();
      }, LOCK_MS);
    };

    stage.setBeat(lastBeat.current, true);
    current = lastBeat.current;
    alignThread(stage, stickEl);
    window.requestAnimationFrame(follow); // a reload in the middle of the story lands on the right beat
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleLayout);
    window.addEventListener("load", handleLayout);
    void document.fonts?.ready.then(handleLayout);
    const card = document.getElementById("pay-card");
    const observer = card ? new ResizeObserver(handleLayout) : null;
    if (card) observer?.observe(card);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleLayout);
      window.removeEventListener("load", handleLayout);
      window.clearTimeout(lockTimer);
      observer?.disconnect();
      api.goto = () => undefined;
      stage.destroy();
    };
  }, [active, narrow, reduced, story, stick, host]);

  return { beat, goto: (k: number) => control.current.goto(k) };
}
