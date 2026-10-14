/* LANDING V3 · the Differentiation figure island: built only when it is about to be reached, rebuilt for the narrow stage,
   and switched from "watching" to "analyzing" once it sits in the reading band (reduced motion shows the second state at once). */
"use client";

import { useEffect, useRef, useState } from "react";
import { DIFF } from "../copy";
import { buildDiffFigure } from "../graph/diff-figure";
import { NARROW_QUERY, useMediaQuery, useNearOnce, useReducedMotion } from "../hooks";

export function DiffFigure() {
  const figure = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery(NARROW_QUERY);
  const reduced = useReducedMotion();
  const near = useNearOnce(figure);
  const [reached, setReached] = useState(false);

  useEffect(() => {
    if (near && host.current) buildDiffFigure(host.current, narrow ? "tall" : "wide");
  }, [near, narrow]);

  useEffect(() => {
    const element = figure.current;
    if (!element || reached) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setReached(true);
    }, { rootMargin: "-30% 0px -25% 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [reached]);

  return (
    <figure className={`diff-fig${reached || reduced ? " is-in" : ""}`} data-testid="diff-figure" id="diff-fig" ref={figure}>
      <div ref={host} />
      <figcaption className="note">{DIFF.caption}</figcaption>
    </figure>
  );
}
