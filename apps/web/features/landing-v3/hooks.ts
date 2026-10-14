/* LANDING V3 · small client hooks shared by the islands. */
"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from "react";

/** A media query as React state. The server (and the first client render) say `false`, so hydration always matches. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, read, () => false);
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const NARROW_QUERY = "(max-width: 820px)";
/** Supported desktop: the only place the Coach plays Motion V2 (phones and reduced motion never request the pack). */
export const DESKTOP_QUERY = "(min-width: 900px) and (hover: hover) and (pointer: fine)";

export const useReducedMotion = (): boolean => useMediaQuery(REDUCED_MOTION_QUERY);

/** True once the element has come within `margin` of the viewport (and stays true): used to build heavy figures only when they are about to be reached. */
export function useNearOnce(ref: RefObject<Element | null>, margin = "100% 0px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: margin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin, near]);
  return near;
}
