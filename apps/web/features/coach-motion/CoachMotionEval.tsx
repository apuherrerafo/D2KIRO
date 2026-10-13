/* COACH MOTION V2 · evaluation harness (R&D tooling, not product UI). Paints atlas frames through the SAME code path the player uses
   (paintFrame) at an explicit pixel size, so the metrics scripts compare what the browser really displays against Live rendered natively
   at that size. Also times the cold decode of an atlas. */
"use client";

import { useEffect } from "react";
import { paintFrame } from "./CoachMotionAtlas";
import { loadAtlas, loadManifest, releaseAtlas, type ClipId, type PackId } from "./clips";

declare global {
  interface Window {
    __cmEval?: {
      /** PNG data URLs of `frames` of `clip` drawn into a `side` x `side` canvas (side = CSS px x device pixel ratio of the Hero coach) */
      paint: (pack: PackId, clip: ClipId, frames: number[], side: number) => Promise<string[]>;
      /** cold decode of one atlas: time and size, then released */
      decode: (pack: PackId, clip: ClipId) => Promise<{ ms: number; w: number; h: number; bytes: number; decodedBytes: number }>;
    };
  }
}

export function CoachMotionEval() {
  useEffect(() => {
    window.__cmEval = {
      paint: async (pack, clip, frames, side) => {
        const m = await loadManifest(pack);
        const meta = m.clips[clip];
        const img = await loadAtlas(pack, meta.file);
        const canvas = document.createElement("canvas");
        canvas.width = side;
        canvas.height = side;
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        return frames.map((f) => {
          paintFrame(ctx, side, m, meta, img, f);
          return canvas.toDataURL("image/png");
        });
      },
      decode: async (pack, clip) => {
        const m = await loadManifest(pack);
        const meta = m.clips[clip];
        releaseAtlas(pack, meta.file);
        await fetch(`/coach-motion-v2/${pack === "webp" ? "" : `${pack}/`}${meta.file}`).then((r) => r.arrayBuffer()); // warm the HTTP cache: only decode is timed
        const t = performance.now();
        const img = await loadAtlas(pack, meta.file);
        const ms = performance.now() - t;
        const out = { ms, w: img.naturalWidth, h: img.naturalHeight, bytes: meta.bytes, decodedBytes: img.naturalWidth * img.naturalHeight * 4 };
        releaseAtlas(pack, meta.file);
        return out;
      },
    };
    document.documentElement.dataset.evalReady = "1";
    return () => {
      delete window.__cmEval;
    };
  }, []);
  return (
    <main style={{ background: "#111", color: "#ccc", font: "13px monospace", minHeight: "100vh", padding: 16 }}>
      <p data-testid="eval-status">coach-motion-v2 eval harness (ready when html[data-eval-ready] is set)</p>
    </main>
  );
}
