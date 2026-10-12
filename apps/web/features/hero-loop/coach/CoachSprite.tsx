/* HERO-LOOP LAB · pre-rendered Coach (mobile Hero, and the static reduced-motion Hero).
   Real Gold Master Base Form, Coach Web Pack V1 hero set: 4 states x 3 aims, transparent 512px stills. No canvas, no
   Three.js, no per-frame work. A state change cross-fades two stacked layers on opacity only; reduced motion swaps instantly. */
"use client";

import { useEffect, useRef } from "react";
import { allStillUrls, stillUrl, type CoachRenderInput } from "./coach-renderer";

const FADE_MS = 160;

export function CoachSprite({ input, onFirstPaint }: { input: CoachRenderInput; onFirstPaint?: () => void }) {
  const layers = useRef<Array<HTMLImageElement | null>>([null, null]);
  const front = useRef(0);
  const shown = useRef("");
  const kept = useRef<HTMLImageElement[]>([]);
  const announced = useRef(false);

  // every frame the Hero can ask for is decoded up front, so a state change never waits on the network
  useEffect(() => {
    kept.current = allStillUrls().map((url) => {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      return img;
    });
  }, []);

  useEffect(() => {
    const url = stillUrl(input);
    if (url === shown.current) return;
    const first = shown.current === "";
    shown.current = url;
    const back = first ? front.current : 1 - front.current;
    const inEl = layers.current[back];
    const outEl = layers.current[1 - back];
    if (!inEl || !outEl) return;
    const instant = input.motion === "reduced" || first;
    const ms = instant ? 0 : FADE_MS;
    inEl.style.transition = `opacity ${ms}ms linear`;
    outEl.style.transition = `opacity ${ms}ms linear`;
    inEl.src = url;
    inEl.style.opacity = "1";
    outEl.style.opacity = "0";
    front.current = back;
    if (!announced.current) {
      announced.current = true;
      onFirstPaint?.();
    }
  }, [input, onFirstPaint]);

  return (
    <div className="hl-sprite" data-testid="coach-sprite" data-state={input.state} data-aim={input.aim} data-motion={input.motion}>
      {[0, 1].map((i) => (
        // eslint-disable-next-line @next/next/no-img-element -- fixed 512px pre-rendered raster, swapped imperatively
        <img alt="" aria-hidden="true" className="hl-sprite-layer" draggable={false} height={512} key={i} ref={(el) => void (layers.current[i] = el)} style={{ opacity: 0 }} width={512} />
      ))}
    </div>
  );
}
