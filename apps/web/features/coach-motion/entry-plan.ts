// Pure entry planner: which pre-rendered transition entry matches the idle frame that is on screen when the cue arrives.
// Entry heads exist at idle phases 0, stride, 2*stride, ... ; phase `count` is the canonical transition (it starts where the idle clip ends).
// The idle is a ping-pong: a phase is a pose, whichever direction the clip is travelling.

export type EntryStrategy = "canonical" | "nearest" | "wait";

export interface EntryPlan {
  /** idle phase the transition is entered at (`count` = the canonical clip, no head) */
  phase: number;
  /** idle frames still to play before the switch (0 = switch on the next tick) */
  wait: number;
}

/** Entry phases available for an idle of `count` frames. */
export function entryPhases(count: number, stride: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < count; p += stride) out.push(p);
  out.push(count);
  return out;
}

/**
 * `shown` = idle frame on screen when the cue arrives, `dir` = +1 / -1 travel direction of the ping-pong.
 * canonical: always the clip that starts at the idle end (what the first prototype did).
 * nearest:   enter at the entry phase closest to the next phase the idle would show (no latency, a small pose step).
 * wait:      keep playing the idle in its direction up to the next entry phase (no pose step, latency < stride frames).
 */
export function planEntry(strategy: EntryStrategy, shown: number, dir: 1 | -1, count: number, stride: number): EntryPlan {
  if (strategy === "canonical") return { phase: count, wait: 0 };
  const phases = entryPhases(count, stride);
  const next = Math.min(count, Math.max(0, shown + dir));
  if (strategy === "nearest") {
    let best = phases[0];
    for (const p of phases) if (Math.abs(p - next) < Math.abs(best - next) || (Math.abs(p - next) === Math.abs(best - next) && p > best)) best = p;
    return { phase: best, wait: 0 };
  }
  if (dir === 1) {
    const p = phases.find((q) => q >= next) ?? count;
    return { phase: p, wait: p - next };
  }
  const p = [...phases].reverse().find((q) => q <= next) ?? 0;
  return { phase: p, wait: next - p };
}
