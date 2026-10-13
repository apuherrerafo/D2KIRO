// Coach Motion V2 production slice · pack manifest (emitted by scripts/coach-motion-v2/encode.py, one per resolution pack).
// The manifest is the whole contract between the encoded assets and the player: clip geometry, chunk files (content-addressed), and the semantic GRAPH
// (loops + edges). The player contains no clip names and no topology; adding a loop or an edge is a manifest change (see docs/coach-motion-v2/FOUNDATION_HARDENING.md).

export const PROD_BASE = "/coach-motion-v2/prod";
export type ProdPackId = "384" | "512";

/** Largest decoded atlas side the player accepts (iOS keeps canvas/bitmap textures at or below this); encode.py refuses to write a larger chunk. */
export const MAX_ATLAS_PX = 2048;
export const ENTRY_STRATEGIES = ["nearest-head"] as const;
export type EntryStrategy = (typeof ENTRY_STRATEGIES)[number];

export interface ChunkMeta {
  /** content-addressed: `<stem>.<first 12 hex of sha256>.avif` */
  file: string;
  frames: number;
  rows: number;
  w: number;
  h: number;
  bytes: number;
  sha256: string;
}

export interface ProdClipMeta {
  frames: number;
  loop: boolean;
  /** atlas columns of this clip when it differs from the pack's (a wide pose may use fewer columns to stay under MAX_ATLAS_PX) */
  cols?: number;
  chunks: ChunkMeta[];
}

export interface GraphLoop {
  clip: string;
}

/** A semantic transition `from` -> `to`: an entry head (one per `stride` frames of the source loop) + a shared tail that ends inside the target loop. */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** frame rate of the head and tail clips; must equal the pack fps (mixed-fps edges are not supported yet) */
  fps: number;
  entry: {
    strategy: EntryStrategy;
    /** a head exists for every source-loop phase 0, stride, 2*stride, ... */
    stride: number;
    /** clip id of the head for phase p is `${headClipPrefix}${p padded to 3}` */
    headClipPrefix: string;
    headFrames: number;
    /** authored continuity budget: the worst entry mismatch is floor(stride / 2) source frames, and it must not exceed this */
    maxStepFrames: number;
    /** entry heads armed (prefetched) once the edge is requested: the nearest one and the next ones, as a latency hedge */
    armHeads: number;
  };
  tail: { clip: string; enterFrame: number };
  /** default-path frames requested ahead while this edge plays (head + tail + target loop) */
  lookaheadFrames: number;
}

export interface Provenance {
  goldMaster: { id: string; files: Record<string, string> };
  staticFallback: { id: string; files: Record<string, string> };
}

export interface ProdManifest {
  version: 4;
  pack: string;
  /** side of the square source frame the crop box is expressed in (the pack's native render size) */
  srcPx: number;
  fps: number;
  crop: { x: number; y: number; w: number; h: number };
  cell: { w: number; h: number };
  chunkFrames: number;
  cols: number;
  limits: { maxAtlasPx: number };
  totalBytes: number;
  /** sha256 over every chunk hash, in clip/chunk order: identifies the pack as a whole */
  packHash: string;
  provenance: Provenance;
  encoder: { format: string; quality: number; speed: number; subsampling: string; library: string; libavif: string };
  graph: { loops: Record<string, GraphLoop>; edges: GraphEdge[] };
  clips: Record<string, ProdClipMeta>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown, min = 0): v is number => isNum(v) && Number.isInteger(v) && v >= min;
const HEX64 = /^[0-9a-f]{64}$/;

export const headClipId = (prefix: string, phase: number) => `${prefix}${String(phase).padStart(3, "0")}`;
/** Source-loop phases that have an entry head. */
export function headPhases(loopFrames: number, stride: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < loopFrames; p += stride) out.push(p);
  return out;
}

export const colsOf = (m: Pick<ProdManifest, "cols" | "clips">, clip: string) => m.clips[clip]?.cols ?? m.cols;
export const loopClip = (m: Pick<ProdManifest, "graph">, loop: string): string => m.graph.loops[loop].clip;
export const edgesFrom = (m: Pick<ProdManifest, "graph">, loop: string): GraphEdge[] => m.graph.edges.filter((e) => e.from === loop);
export const edgeBetween = (m: Pick<ProdManifest, "graph">, from: string, to: string): GraphEdge | undefined => m.graph.edges.find((e) => e.from === from && e.to === to);

/** The manifest is fetched JSON: checked once, so the player can index it without guarding every access. Throws on anything unusable (stale v3, oversized atlas, broken graph). */
export function parseManifest(raw: unknown): ProdManifest {
  const bad = (why: string): never => {
    throw new Error(`coach motion manifest: ${why}`);
  };
  const m = raw as Partial<ProdManifest> | null;
  if (!m || m.version !== 4) bad(`unexpected shape (version ${(m as { version?: unknown } | null)?.version ?? "?"}, expected 4)`);
  const p = m as ProdManifest;
  if (!isNum(p.srcPx) || !isNum(p.fps) || !p.crop || !p.cell || !isInt(p.chunkFrames, 1) || !isInt(p.cols, 1) || !p.clips || !p.graph?.loops || !Array.isArray(p.graph.edges) || !p.limits || !p.provenance) bad("unexpected shape");
  const maxPx = p.limits.maxAtlasPx;
  if (!isInt(maxPx, 1) || maxPx > MAX_ATLAS_PX) bad(`limits.maxAtlasPx ${maxPx} is outside 1..${MAX_ATLAS_PX}`);

  for (const [id, clip] of Object.entries(p.clips)) {
    const cols = clip.cols ?? p.cols;
    if (!isInt(cols, 1)) bad(`${id}: bad cols`);
    const sum = clip.chunks.reduce((n, c) => n + c.frames, 0);
    if (sum !== clip.frames) bad(`${id} chunks hold ${sum} frames, expected ${clip.frames}`);
    clip.chunks.forEach((c, i) => {
      if (i < clip.chunks.length - 1 && c.frames !== p.chunkFrames) bad(`${id} chunk ${i} is not full`);
      if (c.frames > p.chunkFrames) bad(`${id} chunk ${i} holds more than ${p.chunkFrames} frames`);
      const rows = Math.ceil(c.frames / cols);
      if (c.rows !== rows || c.w !== cols * p.cell.w || c.h !== rows * p.cell.h) bad(`${id} chunk ${i}: ${c.w}x${c.h} does not match ${cols} cols x ${rows} rows of ${p.cell.w}x${p.cell.h}`);
      if (c.w > maxPx || c.h > maxPx) bad(`${id} chunk ${i}: atlas ${c.w}x${c.h} exceeds ${maxPx} px`);
      if (!HEX64.test(c.sha256 ?? "")) bad(`${id} chunk ${i}: missing sha256`);
      if (!c.file.includes(`.${c.sha256.slice(0, 12)}.`) || !c.file.endsWith(".avif")) bad(`${id} chunk ${i}: ${c.file} is not content-addressed by its sha256`);
    });
  }

  const loops = Object.entries(p.graph.loops);
  if (!loops.length) bad("graph has no loops");
  for (const [loop, g] of loops) {
    const clip = p.clips[g.clip];
    if (!clip) bad(`loop ${loop}: missing clip ${g.clip}`);
    if (!clip.loop) bad(`loop ${loop}: clip ${g.clip} is not a loop`);
  }
  const seen = new Set<string>();
  for (const e of p.graph.edges) {
    if (seen.has(e.id)) bad(`duplicate edge ${e.id}`);
    seen.add(e.id);
    const from = p.graph.loops[e.from];
    const to = p.graph.loops[e.to];
    if (!from || !to) bad(`edge ${e.id}: unknown loop ${!from ? e.from : e.to}`);
    if (e.from === e.to) bad(`edge ${e.id}: from and to are the same loop`);
    if (e.fps !== p.fps) bad(`edge ${e.id}: fps ${e.fps} differs from the pack's ${p.fps} (mixed-fps edges are not supported)`);
    const en = e.entry;
    if (!en || !(ENTRY_STRATEGIES as readonly string[]).includes(en.strategy)) bad(`edge ${e.id}: unknown entry strategy ${en?.strategy}`);
    const loopFrames = p.clips[from.clip].frames;
    if (!isInt(en.stride, 1) || en.stride > loopFrames) bad(`edge ${e.id}: bad entry stride ${en.stride}`);
    if (!isInt(en.headFrames, 1) || !isInt(en.armHeads, 1)) bad(`edge ${e.id}: bad headFrames / armHeads`);
    if (!isNum(en.maxStepFrames) || Math.floor(en.stride / 2) > en.maxStepFrames) bad(`edge ${e.id}: stride ${en.stride} allows an entry mismatch of ${Math.floor(en.stride / 2)} frames, above maxStepFrames ${en.maxStepFrames}`);
    for (const ph of headPhases(loopFrames, en.stride)) {
      const head = p.clips[headClipId(en.headClipPrefix, ph)];
      if (!head) bad(`edge ${e.id}: missing ${headClipId(en.headClipPrefix, ph)}`);
      if (head.loop || head.frames !== en.headFrames) bad(`edge ${e.id}: ${headClipId(en.headClipPrefix, ph)} must be a ${en.headFrames}-frame one-shot`);
    }
    const tail = p.clips[e.tail?.clip];
    if (!tail || tail.loop) bad(`edge ${e.id}: missing tail clip ${e.tail?.clip}`);
    if (!isInt(e.tail.enterFrame) || e.tail.enterFrame >= p.clips[to.clip].frames) bad(`edge ${e.id}: bad tail.enterFrame`);
    if (!isInt(e.lookaheadFrames, p.chunkFrames)) bad(`edge ${e.id}: lookaheadFrames must be at least one chunk (${p.chunkFrames})`);
  }
  // every edge owns its head namespace: no head prefix may equal or begin with another edge's (a bare `HEAD_` would address the heads of every edge)
  for (const a of p.graph.edges) {
    for (const b of p.graph.edges) {
      if (a !== b && b.entry.headClipPrefix.startsWith(a.entry.headClipPrefix)) bad(`edges ${a.id} and ${b.id}: head prefix ${a.entry.headClipPrefix} also matches ${b.entry.headClipPrefix}`);
    }
  }
  return p;
}

export const chunkOf = (m: Pick<ProdManifest, "chunkFrames">, frame: number) => Math.floor(frame / m.chunkFrames);
export const cellOf = (m: Pick<ProdManifest, "chunkFrames">, frame: number) => frame % m.chunkFrames;
export const chunkKey = (pack: string, clip: string, chunk: number) => `${pack}/${clip}#${chunk}`;
/** Inverse of chunkKey. */
export function splitKey(key: string): { clip: string; chunk: number } {
  return { clip: key.slice(key.indexOf("/") + 1, key.lastIndexOf("#")), chunk: Number(key.slice(key.lastIndexOf("#") + 1)) };
}
export const chunkUrl = (pack: string, file: string) => `${PROD_BASE}/${pack}/${file}`;
export const manifestUrl = (pack: string) => `${PROD_BASE}/${pack}/manifest.json`;

/** Decoded size of one chunk (w x h x 4). */
export const decodedBytes = (c: ChunkMeta) => c.w * c.h * 4;
