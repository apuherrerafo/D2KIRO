// Coach Motion V2 production slice · pack manifest (emitted by scripts/coach-motion-v2/encode.py, one per resolution pack).

export const PROD_BASE = "/coach-motion-v2/prod";
export type ProdPackId = "384" | "512";

export const WATCHING_LOOP = "WATCHING_LOOP";
export const ANALYZING_LOOP = "ANALYZING_LOOP";
export const TRANSITION_TAIL = "TRANSITION_TAIL";
export const headClipId = (phase: number) => `ENTRY_HEAD_${String(phase).padStart(3, "0")}`;

export interface ChunkMeta {
  file: string;
  frames: number;
  rows: number;
  w: number;
  h: number;
  bytes: number;
}

export interface ProdClipMeta {
  frames: number;
  loop: boolean;
  chunks: ChunkMeta[];
}

export interface ProdManifest {
  version: 3;
  pack: string;
  /** side of the square source frame the crop box is expressed in (the pack's native render size) */
  srcPx: number;
  fps: number;
  crop: { x: number; y: number; w: number; h: number };
  cell: { w: number; h: number };
  chunkFrames: number;
  cols: number;
  headStride: number;
  totalBytes: number;
  encoder: { format: string; quality: number; speed: number; subsampling: string; library: string; libavif: string };
  clips: Record<string, ProdClipMeta>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The manifest is fetched JSON: checked once, so the player can index it without guarding every access. Throws on anything unusable. */
export function parseManifest(raw: unknown): ProdManifest {
  const m = raw as Partial<ProdManifest> | null;
  if (!m || m.version !== 3 || !isNum(m.srcPx) || !isNum(m.fps) || !m.crop || !m.cell || !isNum(m.chunkFrames) || !isNum(m.cols) || !isNum(m.headStride) || !m.clips) throw new Error("coach motion manifest: unexpected shape");
  for (const id of [WATCHING_LOOP, ANALYZING_LOOP, TRANSITION_TAIL]) if (!m.clips[id]) throw new Error(`coach motion manifest: missing clip ${id}`);
  for (const [id, clip] of Object.entries(m.clips)) {
    const sum = clip.chunks.reduce((n, c) => n + c.frames, 0);
    if (sum !== clip.frames) throw new Error(`coach motion manifest: ${id} chunks hold ${sum} frames, expected ${clip.frames}`);
    clip.chunks.forEach((c, i) => {
      if (i < clip.chunks.length - 1 && c.frames !== m.chunkFrames) throw new Error(`coach motion manifest: ${id} chunk ${i} is not full`);
    });
  }
  const loop = m.clips[WATCHING_LOOP];
  for (let p = 0; p < loop.frames; p += m.headStride) if (!m.clips[headClipId(p)]) throw new Error(`coach motion manifest: missing ${headClipId(p)}`);
  return m as ProdManifest;
}

export const chunkOf = (m: Pick<ProdManifest, "chunkFrames">, frame: number) => Math.floor(frame / m.chunkFrames);
export const cellOf = (m: Pick<ProdManifest, "chunkFrames">, frame: number) => frame % m.chunkFrames;
export const chunkKey = (pack: string, clip: string, chunk: number) => `${pack}/${clip}#${chunk}`;
export const chunkUrl = (pack: string, file: string) => `${PROD_BASE}/${pack}/${file}`;
export const manifestUrl = (pack: string) => `${PROD_BASE}/${pack}/manifest.json`;

/** Decoded size of one chunk (w x h x 4). */
export const decodedBytes = (c: ChunkMeta) => c.w * c.h * 4;
