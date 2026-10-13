/* COACH MOTION V2 · prerendered atlas player. Draws one cell of a grid atlas into a transparent 2D canvas on a
   deterministic clock (requestAnimationFrame only decides WHEN to look at the clock). No Three.js, no model, no video,
   no CSS cross-fade: what you see is the exact pre-rendered intermediate frame the clock selects.
   A playlist of clips (e.g. an entry head followed by the transition tail) is ONE timeline: the clip hand-over costs no frame. */
"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { elapsedOfSeq, isFinished, locate, seqAt, type LoopMode } from "./atlas-clock";
import { decodedAtlas, loadAtlas, loadManifest, type ClipId, type ClipMeta, type MotionManifest, type PackId } from "./clips";

/** Device pixels never exceed 2x, same cap as the live canvas. */
const MAX_DPR = 2;

/** Paints atlas frame `frame` of `meta` into a square `side` canvas, scaled from the source frame like the live canvas would be. */
export function paintFrame(ctx: CanvasRenderingContext2D, side: number, manifest: MotionManifest, meta: ClipMeta, img: CanvasImageSource, frame: number): void {
  const { srcPx, crop, cell } = manifest;
  const s = side / srcPx;
  ctx.clearRect(0, 0, side, side);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (frame % meta.cols) * cell.w, Math.floor(frame / meta.cols) * cell.h, cell.w, cell.h, crop.x * s, crop.y * s, crop.w * s, crop.h * s);
}

export interface FrameInfo {
  clip: ClipId;
  segment: number;
}

export interface CoachMotionHandle {
  /** back to frame 0 of the current playlist */
  restart: () => void;
  /** move the sequence by `delta` frames (used while paused) */
  step: (delta: number) => void;
  /** switches to another playlist at the next frame boundary of the current one (no frame is skipped or repeated); atlases must already be decoded */
  playNext: (clips: ClipId[]) => void;
  /** the canvas, for read-back in tests */
  canvas: () => HTMLCanvasElement | null;
}

type Props = {
  pack?: PackId;
  /** one clip, or a playlist played back to back */
  clip: ClipId | ClipId[];
  playing: boolean;
  /** overrides the last clip's default loop mode */
  loop?: LoopMode;
  /** changing it restarts the playlist even when `clip` is unchanged */
  restartKey?: string | number;
  className?: string;
  onFrame?: (frame: number, count: number, info: FrameInfo) => void;
  onEnd?: () => void;
};

type Run = {
  list: ClipId[];
  mode: LoopMode;
  metas: ClipMeta[];
  imgs: HTMLImageElement[];
  ready: boolean;
  elapsed: number;
  shown: string;
  ended: boolean;
  token: number;
  next: { list: ClipId[]; seq: number } | null;
};

export const CoachMotionAtlas = forwardRef<CoachMotionHandle, Props>(function CoachMotionAtlas({ pack = "webp", clip, playing, loop, restartKey, className, onFrame, onEnd }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const manifest = useRef<MotionManifest | null>(null);
  const run = useRef<Run>({ list: [], mode: "once", metas: [], imgs: [], ready: false, elapsed: 0, shown: "", ended: false, token: 0, next: null });
  const playingRef = useRef(playing);
  const redraw = useRef<() => void>(() => {});
  const handlers = useRef({ onFrame, onEnd });
  const loopRef = useRef(loop);
  const begin = useRef<(list: ClipId[]) => void>(() => {});

  useEffect(() => {
    handlers.current = { onFrame, onEnd };
    playingRef.current = playing;
    loopRef.current = loop;
  }, [onFrame, onEnd, playing, loop]);

  // (re)start a playlist: sync when its atlases are already decoded, otherwise the last frame stays until they are
  useEffect(() => {
    manifest.current = null;
    begin.current = (list) => {
      const r = run.current;
      const token = (r.token += 1);
      r.list = list;
      r.next = null;
      r.ready = false;
      r.elapsed = 0;
      r.shown = "";
      r.ended = false;
      const m = manifest.current;
      const sync = m ? list.map((c) => (m.clips[c] ? decodedAtlas(pack, m.clips[c].file) : null)) : [];
      const finish = (mm: MotionManifest, imgs: HTMLImageElement[]) => {
        if (run.current.token !== token) return;
        r.metas = list.map((c) => mm.clips[c]);
        r.imgs = imgs;
        r.mode = loopRef.current ?? r.metas[r.metas.length - 1].loop;
        r.ready = true;
        redraw.current();
      };
      if (m && sync.every(Boolean)) {
        finish(m, sync as HTMLImageElement[]);
        return;
      }
      loadManifest(pack)
        .then(async (mm) => {
          manifest.current = mm;
          const imgs = await Promise.all(list.map((c) => loadAtlas(pack, mm.clips[c].file)));
          finish(mm, imgs);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "atlas failed"));
    };
  }, [pack]);

  const list = Array.isArray(clip) ? clip : [clip];
  const listKey = list.join("+");
  useEffect(() => {
    begin.current(listKey.split("+"));
  }, [pack, listKey, restartKey, loop]);

  useImperativeHandle(
    ref,
    () => ({
      restart: () => begin.current(run.current.list),
      step: (delta) => {
        const r = run.current;
        if (!r.ready) return;
        const total = r.metas.reduce((n, m) => n + m.frames, 0);
        const next = Math.max(0, seqAt(r.elapsed, r.metas[0].fps) + delta);
        r.elapsed = elapsedOfSeq(r.mode === "once" ? Math.min(next, total - 1) : next, r.metas[0].fps);
        redraw.current();
      },
      playNext: (clips) => {
        const r = run.current;
        if (!r.ready) {
          begin.current(clips);
          return;
        }
        r.next = { list: clips, seq: seqAt(r.elapsed, r.metas[0].fps) + 1 };
      },
      canvas: () => canvas.current,
    }),
    [],
  );

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let frameId = 0;
    let last = performance.now();
    let side = 0;

    const fit = () => {
      const px = Math.max(64, Math.round(el.clientWidth * Math.min(window.devicePixelRatio || 1, MAX_DPR)));
      if (px === side) return;
      side = px;
      el.width = px;
      el.height = px;
      run.current.shown = ""; // resizing clears the canvas
    };

    const draw = () => {
      const r = run.current;
      const m = manifest.current;
      if (!r.ready || !m) return;
      fit();
      const fps = r.metas[0].fps;
      const at = locate(seqAt(r.elapsed, fps), r.metas.map((x) => x.frames), r.mode);
      const key = `${at.segment}:${at.frame}`;
      if (key === r.shown) return;
      r.shown = key;
      paintFrame(ctx, side, m, r.metas[at.segment], r.imgs[at.segment], at.frame);
      handlers.current.onFrame?.(at.frame, r.metas[at.segment].frames, { clip: r.list[at.segment], segment: at.segment });
    };
    redraw.current = draw;

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const r = run.current;
      if (playingRef.current && dt < 500) r.elapsed += dt;
      if (r.ready && r.next && seqAt(r.elapsed, r.metas[0].fps) >= r.next.seq) {
        const carry = r.elapsed - (r.next.seq * 1000) / r.metas[0].fps; // sub-frame remainder: the new playlist continues the same timeline
        begin.current(r.next.list);
        if (run.current.ready) run.current.elapsed = carry;
      }
      draw();
      const cur = run.current;
      if (cur.ready && !cur.ended && isFinished(cur.elapsed, cur.metas.reduce((n, x) => n + x.frames, 0), cur.metas[0].fps, cur.mode)) {
        cur.ended = true;
        handlers.current.onEnd?.();
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameId);
      redraw.current = () => {};
    };
  }, []);

  return <canvas aria-hidden="true" className={className} data-clip={list[list.length - 1]} data-error={error ?? undefined} data-testid="coach-atlas" ref={canvas} />;
});
