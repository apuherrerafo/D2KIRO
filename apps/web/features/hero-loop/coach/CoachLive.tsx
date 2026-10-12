/* HERO-LOOP LAB · live Gold Master Coach (DESKTOP Hero only).
   The real modular Gold Master rendered with Three.js into one transparent canvas. The Three.js chunk and the 7.7 MB
   modular package are imported on demand, so the mobile Hero never downloads either. No GPU probing: if the context or the
   package cannot be created, `onFail` hands the slot back to the pre-rendered sprite. Pauses off screen and in a hidden tab. */
"use client";

import { useEffect, useRef } from "react";
import type { CoachCue } from "../loop";
import type { HeroCoachStage, StageQuality } from "./live-stage";

/** Device pixels never exceed 2x: the lab measured the 1000 px direct render, a 360 css-px canvas at 2x is 720 px. */
const MAX_DPR = 2;

type Props = {
  cue: CoachCue;
  /** Changes at every beat, so a verb restarts even when the same verb comes twice in a row. */
  verbKey: string;
  quality: StageQuality;
  onFail: (reason: string) => void;
  onReady: () => void;
};

export function CoachLive({ cue, verbKey, quality, onFail, onReady }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HeroCoachStage | null>(null);
  const clock = useRef(0);
  const latest = useRef(cue);
  const lastVerbKey = useRef("");
  const handlers = useRef({ onFail, onReady });

  useEffect(() => {
    handlers.current = { onFail, onReady };
  }, [onFail, onReady]);

  // the cue is read by the frame loop; it is written here, not during render
  useEffect(() => {
    latest.current = cue;
    const s = stage.current;
    if (!s) return;
    s.setState(cue.state, clock.current);
    s.amplitude = cue.amplitude;
    s.aim = { x: cue.aim === "left" ? -1 : cue.aim === "right" ? 1 : 0, y: cue.aim === "right" ? 0.15 : 0 };
    if (lastVerbKey.current !== verbKey) {
      lastVerbKey.current = verbKey;
      s.triggerVerb(cue.verb, clock.current);
    }
  }, [cue, verbKey]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let alive = true;
    let frame = 0;
    let visible = true;
    let onScreen = true;
    let origin = 0;
    let observer: IntersectionObserver | null = null;
    let resizer: ResizeObserver | null = null;
    const onVisibility = () => void (visible = document.visibilityState !== "hidden");

    const loop = (now: number) => {
      frame = 0;
      const s = stage.current;
      if (!alive || !s) return;
      if (visible && onScreen) {
        clock.current = (now - origin) / 1000;
        s.update(clock.current);
        s.render();
      }
      frame = requestAnimationFrame(loop);
    };

    (async () => {
      try {
        const [{ HeroCoachStage: Stage }, { loadModularPackage }] = await Promise.all([import("./live-stage"), import("./gold-master/package")]);
        const data = await loadModularPackage();
        if (!alive) return;
        const s = new Stage(el, data, quality);
        stage.current = s;
        const fit = () => s.resize(el.clientWidth * Math.min(window.devicePixelRatio || 1, MAX_DPR));
        fit();
        resizer = new ResizeObserver(fit);
        resizer.observe(el);
        observer = new IntersectionObserver((entries) => void (onScreen = entries.some((e) => e.isIntersecting)));
        observer.observe(el);
        document.addEventListener("visibilitychange", onVisibility);
        origin = performance.now();
        const c = latest.current;
        s.setState(c.state, 0);
        s.amplitude = c.amplitude;
        s.aim = { x: c.aim === "left" ? -1 : c.aim === "right" ? 1 : 0, y: 0 };
        // the first frame is rendered before the canvas is announced, so the swap from the sprite never shows an empty canvas
        s.update(0);
        s.render();
        handlers.current.onReady();
        frame = requestAnimationFrame(loop);
      } catch (error) {
        if (alive) handlers.current.onFail(error instanceof Error ? error.message : "live coach failed");
      }
    })();

    return () => {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      resizer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stage.current?.dispose();
      stage.current = null;
    };
    // the stage is built once per quality; cues reach it through `latest` and the effect above
  }, [quality]);

  return <canvas aria-hidden="true" className="hl-live" data-quality={quality} data-testid="coach-live" ref={canvas} />;
}
