/* LANDING-01B · the pinned scroll of the Counterfactual section, as a view. Geometry is measured once and again only on
   resize (never per frame); each scroll costs one `scrollY` read in one animation frame, and React only hears about it
   when the view actually changes — a rest re-renders nothing. */
"use client";

import { useEffect, useState, type RefObject } from "react";
import { counterfactualView, sameView, type CounterfactualView } from "./scroll";

export function useCounterfactualScroll(track: RefObject<HTMLElement | null>, stage: RefObject<HTMLElement | null>, reduced: boolean): CounterfactualView {
  const [view, setView] = useState(() => counterfactualView(0, reduced));
  useEffect(() => {
    const host = track.current;
    const pinned = stage.current;
    if (!host || !pinned || typeof window === "undefined") return;
    let start = 0;
    let span = 1;
    let frame = 0;
    const measure = () => {
      const pinTop = Number.parseFloat(window.getComputedStyle(pinned).top) || 0;
      start = host.getBoundingClientRect().top + window.scrollY - pinTop;
      span = Math.max(1, host.offsetHeight - pinned.offsetHeight);
    };
    const update = () => {
      frame = 0;
      const next = counterfactualView((window.scrollY - start) / span, reduced);
      setView((current) => (sameView(current, next) ? current : next));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const remeasure = () => {
      measure();
      schedule();
    };
    remeasure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure);
    /* Content above (hero art, the memory track, fonts) can still settle after mount and move where the pin starts. */
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remeasure);
    observer?.observe(document.body);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
      observer?.disconnect();
    };
  }, [reduced, stage, track]);
  return view;
}
