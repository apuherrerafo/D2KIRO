// Coach Motion V2 production slice · fetch + decode of one chunk, checked against the manifest.
// The URL is content-addressed (immutable in the HTTP cache), so a cached answer is trusted on the first try. The bytes are still checked: the size must be the
// manifest's and the decoded atlas must have the manifest's dimensions, so a truncated, stale or substituted file fails the load (and gets its one retry, which
// bypasses the cache) instead of painting garbage.

import type { Decoded, LoadChunk } from "./bitmap-store";
import { chunkUrl, splitKey, type ProdManifest } from "./production-manifest";

export interface ChunkIO<B extends Decoded> {
  fetch: (url: string, init: { cache: "default" | "reload"; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; blob: () => Promise<{ size: number }> }>;
  decode: (blob: { size: number }) => Promise<B>;
}

export function makeChunkLoader<B extends Decoded>(m: ProdManifest, io: ChunkIO<B>): LoadChunk<B> {
  return async (key, attempt, signal) => {
    const { clip, chunk } = splitKey(key);
    const meta = m.clips[clip]?.chunks[chunk];
    if (!meta) throw new Error(`unknown chunk ${key}`);
    const response = await io.fetch(chunkUrl(m.pack, meta.file), { cache: attempt > 1 ? "reload" : "default", signal });
    if (!response.ok) throw new Error(`${meta.file}: ${response.status}`);
    const blob = await response.blob();
    if (blob.size !== meta.bytes) throw new Error(`${meta.file}: ${blob.size} bytes, manifest says ${meta.bytes}`);
    const bitmap = await io.decode(blob);
    if (bitmap.width !== meta.w || bitmap.height !== meta.h) {
      bitmap.close();
      throw new Error(`${meta.file}: decoded ${bitmap.width}x${bitmap.height}, manifest says ${meta.w}x${meta.h}`);
    }
    return bitmap;
  };
}

/** The browser instance: fetch + createImageBitmap (explicit close() by the store). */
export function browserChunkLoader(m: ProdManifest): LoadChunk<ImageBitmap> {
  return makeChunkLoader<ImageBitmap>(m, { fetch: (url, init) => fetch(url, init), decode: (blob) => createImageBitmap(blob as Blob) });
}
