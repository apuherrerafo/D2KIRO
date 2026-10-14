/* COACH MOTION V2 · following a semantic target. The Hero tells the Coach WHAT is happening (a state); the pack's graph only has edges between neighbouring
   states and a request is refused while a transition plays. `nextHop` is the one decision this needs: from the loop being played, which edge to cue towards the
   target. The adjacency below is the approved cycle WATCHING -> ANALYZING -> POINTING -> CONFIRMING -> POINTING -> WATCHING; a test checks every hop against the
   committed manifest's graph, so it cannot drift from the pack. */

import type { MotionState } from "./CoachMotionPlayer";

export const COACH_HOPS: Readonly<Record<MotionState, readonly MotionState[]>> = {
  watching: ["analyzing"],
  analyzing: ["pointing"],
  pointing: ["confirming", "watching"],
  confirming: ["pointing"],
};

/** First edge to take from `from` on the shortest path to `to`; null when already there (or unreachable). */
export function nextHop(from: MotionState, to: MotionState): MotionState | null {
  if (from === to) return null;
  const seen = new Set<MotionState>([from]);
  let frontier: Array<{ at: MotionState; first: MotionState }> = COACH_HOPS[from].map((hop) => ({ at: hop, first: hop }));
  while (frontier.length) {
    const hit = frontier.find((f) => f.at === to);
    if (hit) return hit.first;
    const next: typeof frontier = [];
    for (const f of frontier) {
      if (seen.has(f.at)) continue;
      seen.add(f.at);
      for (const hop of COACH_HOPS[f.at]) next.push({ at: hop, first: f.first });
    }
    frontier = next;
  }
  return null;
}
