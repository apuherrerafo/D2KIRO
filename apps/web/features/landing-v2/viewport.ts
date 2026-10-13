/* LANDING V2 · viewport awareness. Only the section that is on screen (or about to be) performs meaningful animation:
   everything else halts its loop and keeps its last composition. Plain IntersectionObserver; no scroll listeners here. */
"use client";

import { useEffect, useState, type RefObject } from "react";

/** True while any part of the element is within `rootMargin` of the viewport ("near-active"). */
export function useNear(ref: RefObject<Element | null>, rootMargin = "50% 0px 50% 0px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  return near;
}

/** True while at least `threshold` of the element is on screen; false the moment it is fully gone. */
export function useShare(ref: RefObject<Element | null>, threshold: number): { engaged: boolean; gone: boolean } {
  const [state, setState] = useState({ engaged: false, gone: true });
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setState({ engaged: true, gone: false });
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        setState({ engaged: e.isIntersecting && e.intersectionRatio >= threshold, gone: !e.isIntersecting });
      },
      { threshold: [0, threshold, 1] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold]);
  return state;
}
