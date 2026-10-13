// Pure, deterministic frame clock for the Coach Motion V2 atlas player (no DOM, no rAF). Everything is a function of
// elapsed milliseconds, so the lab, the tests and any later controller agree on which pre-rendered frame is on screen.

export type LoopMode = "once" | "loop" | "pingpong";

/** Index in the playback sequence (not the atlas) at `elapsedMs`. */
export function seqAt(elapsedMs: number, fps: number): number {
  return Math.max(0, Math.floor((elapsedMs * fps) / 1000 + 1e-9));
}

/** Atlas frame shown at sequence index `seq`. pingpong plays 0..n-1..1 and repeats, so no frame is doubled at the turns. */
export function frameOfSeq(seq: number, count: number, mode: LoopMode): number {
  if (count <= 1) return 0;
  if (mode === "once") return Math.min(seq, count - 1);
  if (mode === "loop") return seq % count;
  const period = 2 * (count - 1);
  const p = seq % period;
  return p < count ? p : period - p;
}

/** Back-to-back segments (frame counts) played as one timeline: every segment but the last plays once, the last follows `mode`. */
export function locate(seq: number, counts: readonly number[], mode: LoopMode): { segment: number; frame: number } {
  let rest = seq;
  for (let i = 0; i < counts.length - 1; i += 1) {
    if (rest < counts[i]) return { segment: i, frame: rest };
    rest -= counts[i];
  }
  const last = counts.length - 1;
  return { segment: last, frame: frameOfSeq(rest, counts[last], mode) };
}

export function frameAt(elapsedMs: number, count: number, fps: number, mode: LoopMode): number {
  return frameOfSeq(seqAt(elapsedMs, fps), count, mode);
}

/** A "once" clip has played its last frame. Looping clips never finish. */
export function isFinished(elapsedMs: number, count: number, fps: number, mode: LoopMode): boolean {
  return mode === "once" && seqAt(elapsedMs, fps) >= count - 1;
}

/** Elapsed time that lands exactly on sequence index `seq` (used by the frame stepper). */
export function elapsedOfSeq(seq: number, fps: number): number {
  return (Math.max(0, seq) * 1000) / fps + 0.001;
}
