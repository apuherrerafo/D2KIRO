/* COACH MOTION V2 · production-slice player. Fills a Coach slot with:
     1. the existing static Coach sprite (always mounted, the floor: it is what is visible until Motion V2 is READY and again if anything fails), and
     2. a transparent 2D canvas that plays the pre-rendered Gold Master frames on a deterministic clock (MotionController).
   No Three.js, no model, no video, no CSS cross-fade between stills. Reduced motion = static only: nothing of Motion V2 is requested.
   The animation loop runs only while the slot is on screen, the tab is visible and playback is not paused. */
"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CoachSprite } from "../hero-loop/coach/CoachSprite";
import type { CoachRenderInput, CoachRenderState } from "../hero-loop/coach/coach-renderer";
import { MotionController } from "./motion-controller";
import { chunkUrl, manifestUrl, parseManifest, type ProdManifest, type ProdPackId } from "./production-manifest";

/** Device pixels never exceed 2x, same cap as the live canvas (`maxDpr` lifts it for the DPR3 phone check). */
const DEFAULT_MAX_DPR = 2;

declare global {
  interface Window {
    __cmTrace?: Array<[string, string, number, number]>;
  }
}

export type MotionStatus = "static" | "loading" | "motion" | "failed";

export interface CoachMotionPlayerHandle {
  goTo: (scenario: "watching" | "analyzing") => void;
  cue: () => void;
  /** read-out for the lab and the tests */
  snapshot: () => { status: MotionStatus; clip: string | null; frame: number | null; mode: string | null; residentBytes: number; residentKeys: string[]; entry: { phase: number; step: number } | null; failure: string | null };
  canvas: () => HTMLCanvasElement | null;
}

type Props = {
  pack: ProdPackId;
  playing: boolean;
  reducedMotion: boolean;
  /** scenario the pack starts in */
  initial?: "watching" | "analyzing";
  /** semantic state of the static Coach while Motion V2 is not showing (reduced motion, loading, failed) */
  phase?: "watching" | "analyzing";
  maxDpr?: number;
  timeoutMs?: number;
  className?: string;
  onStatus?: (status: MotionStatus, detail?: string) => void;
  /** fired when the semantic state of the picture changes (the static layer follows it, so a failure shows the right state) */
  onState?: (state: "watching" | "analyzing") => void;
};

const STATIC_STATE: Record<"watching" | "analyzing", CoachRenderInput> = {
  watching: { state: "watching", aim: "center", motion: "reduced" },
  analyzing: { state: "analyzing", aim: "right", motion: "reduced" },
};

/** Decodes with createImageBitmap (explicit close() by the store). Rejects on a bad status or an undecodable file. */
function browserLoad(m: ProdManifest) {
  return async (key: string): Promise<ImageBitmap> => {
    const clip = key.slice(key.indexOf("/") + 1, key.lastIndexOf("#"));
    const chunk = Number(key.slice(key.lastIndexOf("#") + 1));
    const meta = m.clips[clip]?.chunks[chunk];
    if (!meta) throw new Error(`unknown chunk ${key}`);
    const response = await fetch(chunkUrl(m.pack, meta.file));
    if (!response.ok) throw new Error(`${meta.file}: ${response.status}`);
    return createImageBitmap(await response.blob());
  };
}

/** Paints atlas cell `cell` into a square `side` canvas, scaled from the pack's native frame like the live canvas would be. */
export function paintCell(ctx: CanvasRenderingContext2D, side: number, m: ProdManifest, bitmap: ImageBitmap, cell: number): void {
  const s = side / m.srcPx;
  ctx.clearRect(0, 0, side, side);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (cell % m.cols) * m.cell.w, Math.floor(cell / m.cols) * m.cell.h, m.cell.w, m.cell.h, m.crop.x * s, m.crop.y * s, m.crop.w * s, m.crop.h * s);
}

export const CoachMotionPlayer = forwardRef<CoachMotionPlayerHandle, Props>(function CoachMotionPlayer({ pack, playing, reducedMotion, initial = "watching", phase = "watching", maxDpr = DEFAULT_MAX_DPR, timeoutMs, className, onStatus, onState }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [status, setStatusState] = useState<MotionStatus>("static");
  const [state, setState] = useState<"watching" | "analyzing">(initial);
  const controller = useRef<MotionController<ImageBitmap> | null>(null);
  const playingRef = useRef(playing);
  const handlers = useRef({ onStatus, onState });
  const wake = useRef<() => void>(() => {});
  const redraw = useRef<() => void>(() => {});
  const statusRef = useRef<MotionStatus>("static");

  useEffect(() => {
    handlers.current = { onStatus, onState };
    playingRef.current = playing;
    wake.current();
  }, [onStatus, onState, playing]);

  const setStatus = useCallback((next: MotionStatus, detail?: string) => {
    statusRef.current = next;
    setStatusState(next);
    handlers.current.onStatus?.(next, detail);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      goTo: (scenario) => {
        controller.current?.goTo(scenario);
        wake.current();
      },
      cue: () => {
        controller.current?.cue();
        wake.current();
      },
      snapshot: () => {
        const c = controller.current;
        const shown = c?.shown ?? null;
        const res = c?.residency() ?? { keys: [], bytes: 0 };
        return { status: statusRef.current, clip: shown?.clip ?? null, frame: shown?.frame ?? null, mode: shown?.mode ?? null, residentBytes: res.bytes, residentKeys: res.keys, entry: c?.lastEntry ?? null, failure: c?.failure ?? null };
      },
      canvas: () => canvas.current,
    }),
    [],
  );

  // Motion V2 is only ever started when motion is allowed: reduced motion never reaches fetch().
  useEffect(() => {
    const el = canvas.current;
    const host = root.current;
    // the prop can still be the server snapshot during hydration: the live media query is the authority before anything is requested
    if (reducedMotion || !el || !host || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStatus("static");
      return;
    }
    const ctx = el.getContext("2d");
    if (!ctx) {
      setStatus("failed", "no 2d context");
      return;
    }
    let alive = true;
    let frameId = 0;
    let last = 0;
    let visible = document.visibilityState !== "hidden";
    let onScreen = true;
    let side = 0;
    let lastMode = initial;

    const fit = () => {
      const px = Math.max(64, Math.round(el.clientWidth * Math.min(window.devicePixelRatio || 1, maxDpr)));
      if (px === side) return false;
      side = px;
      el.width = px; // resizing clears the canvas
      el.height = px;
      return true;
    };

    const ctl = new MotionController<ImageBitmap>({
      pack,
      timeoutMs,
      fetchManifest: async () => {
        const response = await fetch(manifestUrl(pack));
        if (!response.ok) throw new Error(`manifest ${pack}: ${response.status}`);
        return parseManifest(await response.json());
      },
      makeLoad: browserLoad,
      paint: (bitmap, m, cell, shown) => {
        fit();
        paintCell(ctx, side, m, bitmap, cell);
        window.__cmTrace?.push([pack, shown.clip, shown.frame, performance.now()]); // test hook: only exists when a test installs the array
        const next = shown.mode === "watching" ? "watching" : "analyzing";
        if (next !== lastMode) {
          lastMode = next;
          setState(next);
          handlers.current.onState?.(next);
        }
      },
      onReady: () => {
        if (alive) setStatus("motion");
      },
      onFail: (reason) => {
        if (!alive) return;
        ctx.clearRect(0, 0, el.width, el.height);
        setStatus("failed", reason);
      },
    });
    controller.current = ctl;
    setStatus("loading");

    const active = () => alive && visible && onScreen && playingRef.current && statusRef.current === "motion";
    const loop = (now: number) => {
      frameId = 0;
      if (!active()) return;
      ctl.tick(now - last);
      last = now;
      frameId = requestAnimationFrame(loop);
    };
    wake.current = () => {
      if (frameId || !active()) return;
      last = performance.now(); // resuming after a pause / off-screen / hidden stretch must not look like one long frame
      frameId = requestAnimationFrame(loop);
    };
    redraw.current = () => {
      if (fit()) ctl.repaint();
    };

    const onVisibility = () => {
      visible = document.visibilityState !== "hidden";
      wake.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      wake.current();
    });
    io.observe(host);
    const ro = new ResizeObserver(() => redraw.current());
    ro.observe(el);

    ctl.start(initial);
    return () => {
      alive = false;
      if (frameId) cancelAnimationFrame(frameId);
      document.removeEventListener("visibilitychange", onVisibility);
      io.disconnect();
      ro.disconnect();
      ctl.dispose();
      controller.current = null;
      wake.current = () => {};
      redraw.current = () => {};
    };
    // one controller per (pack, reducedMotion); scenario changes go through the handle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, reducedMotion, maxDpr, timeoutMs]);

  // the loop starts when the controller turns ready (status flips to "motion")
  useEffect(() => {
    wake.current();
  }, [status]);

  const staticInput = STATIC_STATE[reducedMotion || status === "static" ? phase : state];
  const staticState: CoachRenderState = staticInput.state;
  return (
    <div className={className} data-motion-status={status} data-static-state={staticState} data-testid={`motion-player-${pack}`} ref={root} style={{ height: "100%", position: "relative", width: "100%" }}>
      <CoachSprite input={staticInput} />
      <canvas aria-hidden="true" className="cm-atlas" data-testid="coach-prod-canvas" ref={canvas} style={{ visibility: status === "motion" ? "visible" : "hidden" }} />
    </div>
  );
});
