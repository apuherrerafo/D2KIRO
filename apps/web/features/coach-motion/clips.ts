// Coach Motion V2 atlas packs (manifest + atlases emitted by docs/coach-motion-v2/tools/pack.py (webp prototype) and pack2.py (A / B / C AVIF)).
// The loader decodes a clip on request (prefetch), shares it while it is held and drops it on release, so the player can keep
// CURRENT + NEXT only. `retainedDecodedBytes()` is the model of that footprint: width x height x 4 per decoded atlas.

import type { LoopMode } from "./atlas-clock";

export const MOTION_BASE = "/coach-motion-v2";

/** "webp" = the first prototype (root folder); A / B / C = the production-format candidates (AVIF); X / Y = encoder-flag ablations of A, L30 / L24 = lossless references (eval only). */
export type PackId = "webp" | "A" | "B" | "C" | "X" | "Y" | "L30" | "L24";
export type ClipId = string;

export interface ClipMeta {
  file: string;
  frames: number;
  fps: number;
  cols: number;
  rows: number;
  /** how the clip is meant to be played by default */
  loop: LoopMode;
  atlas: { w: number; h: number };
  bytes: number;
}

export interface MotionManifest {
  /** side of the square source frame the crop box is expressed in */
  srcPx: number;
  /** box of the source frame every cell of every atlas holds (source px; fractional for downscaled packs) */
  crop: { x: number; y: number; w: number; h: number };
  /** atlas cell size in atlas pixels */
  cell: { w: number; h: number };
  clips: Record<ClipId, ClipMeta>;
}

const baseOf = (pack: PackId) => (pack === "webp" ? MOTION_BASE : `${MOTION_BASE}/${pack}`);

const manifests = new Map<PackId, Promise<MotionManifest>>();

export function loadManifest(pack: PackId = "webp"): Promise<MotionManifest> {
  let hit = manifests.get(pack);
  if (!hit) {
    hit = fetch(`${baseOf(pack)}/manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`coach motion manifest ${pack}: ${r.status}`);
      return r.json() as Promise<MotionManifest>;
    });
    manifests.set(pack, hit);
  }
  return hit;
}

type Held = { promise: Promise<HTMLImageElement>; img: HTMLImageElement | null; w: number; h: number };
const held = new Map<string, Held>();
const keyOf = (pack: PackId, file: string) => `${pack}/${file}`;

/** Fetches and decodes an atlas once; later calls share the same decoded image until it is released. */
export function loadAtlas(pack: PackId, file: string): Promise<HTMLImageElement> {
  const key = keyOf(pack, file);
  let hit = held.get(key);
  if (!hit) {
    const img = new Image();
    img.decoding = "async";
    img.src = `${baseOf(pack)}/${file}`;
    const entry: Held = { promise: Promise.resolve(img), img: null, w: 0, h: 0 };
    entry.promise = img.decode().then(() => {
      entry.img = img;
      entry.w = img.naturalWidth;
      entry.h = img.naturalHeight;
      return img;
    });
    held.set(key, entry);
    hit = entry;
  }
  return hit.promise;
}

/** The decoded atlas if it is ready right now (lets the player swap clips inside one frame, no await). */
export function decodedAtlas(pack: PackId, file: string): HTMLImageElement | null {
  return held.get(keyOf(pack, file))?.img ?? null;
}

/** Drops the decoded bitmap so the browser can reclaim it (a later request fetches again, from the HTTP cache). */
export function releaseAtlas(pack: PackId, file: string): void {
  const key = keyOf(pack, file);
  const hit = held.get(key);
  if (!hit) return;
  held.delete(key);
  if (hit.img) hit.img.src = "";
}

/** Sum of w x h x 4 over the atlases held right now. The browser may also keep the compressed bytes; this is the dominant term. */
export function retainedDecodedBytes(): number {
  let total = 0;
  for (const h of held.values()) if (h.img) total += h.w * h.h * 4;
  return total;
}

export function heldAtlasKeys(): string[] {
  return [...held.keys()];
}
