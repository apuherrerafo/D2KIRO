/* Data reorder (Motion 07) — FLIP that survives interruption. The study read `getBoundingClientRect`
   while a previous animation was still running, so its "before" included the in-flight transform and a
   second reorder inside the settle window jumped. Here: read each row's in-flight offset, cancel, measure
   the real layout position, and animate from the VISUAL position. Document coordinates, so scroll between
   renders cannot corrupt the delta. Transform-only, critically damped (peak ≤ 1) by contract. */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { SETTLE } from "./timing";

/** `matrix(a,b,c,d,tx,ty)` / `matrix3d(...)` / "none" → vertical translation in px. */
export function translateYOf(transform: string): number {
  if (!transform || transform === "none") return 0;
  const match = /^matrix(3d)?\((.+)\)$/.exec(transform.trim());
  if (!match) return 0;
  const parts = match[2].split(",").map((part) => Number.parseFloat(part));
  const value = match[1] ? parts[13] : parts[5];
  return Number.isFinite(value) ? value : 0;
}

/** Offset to start the animation from so the row begins where the user SEES it, ends at its new layout slot. */
export function flipOffset(previousLayoutTop: number, inFlightY: number, nextLayoutTop: number) {
  return previousLayoutTop + inFlightY - nextLayoutTop;
}

export function useSettleFlip(container: RefObject<HTMLElement | null>, orderKey: string, reduced: boolean) {
  const layout = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-flip-key]")];
    const inFlight = rows.map((row) => translateYOf(getComputedStyle(row).transform));
    for (const row of rows) row.getAnimations?.().forEach((animation) => animation.cancel());
    const next = new Map<string, number>();
    rows.forEach((row, index) => {
      const key = row.dataset.flipKey ?? "";
      const top = row.getBoundingClientRect().top + window.scrollY;
      next.set(key, top);
      const before = layout.current.get(key);
      if (before === undefined || reduced || typeof row.animate !== "function") return;
      const offset = flipOffset(before, inFlight[index], top);
      if (Math.abs(offset) < 1) return;
      row.animate([{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }], { duration: SETTLE.durationMs, easing: SETTLE.easing });
    });
    layout.current = next;
  }, [container, orderKey, reduced]);
}
