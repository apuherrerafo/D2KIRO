import { MEMORY_SCENE_ORDER, type MemorySceneId } from "./types";

/* Continuity map: for each step of the sequence, what happens to every piece of evidence (by its stable id).
   Static data for a future motion pass — nothing here animates. Historical evidence rarely disappears: when it
   leaves the picture it is folded into something that remains (`into`), not dropped.

   stays · strengthens · weakens · qualifies · moves  → in both scenes
   enters · attaches                                  → only in the later scene (attaches = joins existing evidence)
   exits                                              → only in the earlier scene
   compresses                                         → in the earlier scene; folded into `into` (or shrinks in place)
   expands                                            → only in the later scene; unfolds `from` the element that absorbed it
                                                        earlier (the exact reverse of a prior `compresses … into`) */

export type ContinuityVerb = "stays" | "enters" | "attaches" | "strengthens" | "weakens" | "qualifies" | "moves" | "compresses" | "expands" | "exits";

export interface ContinuityEntry {
  readonly id: string;
  readonly verb: ContinuityVerb;
  /** compresses: the evidence that absorbs this one in the later scene. */
  readonly into?: string;
  /** expands: the evidence (present in the earlier scene) this one unfolds from in the later scene. */
  readonly from?: string;
}

export type MemoryTransitionId = "match-01>match-08" | "match-08>match-24" | "match-24>match-56" | "match-56>player-model";

export const MEMORY_TRANSITIONS: readonly { readonly id: MemoryTransitionId; readonly from: MemorySceneId; readonly to: MemorySceneId }[] =
  MEMORY_SCENE_ORDER.slice(1).map((to, i) => ({ id: `${MEMORY_SCENE_ORDER[i]}>${to}` as MemoryTransitionId, from: MEMORY_SCENE_ORDER[i], to }));

const e = (id: string, verb: ContinuityVerb, link?: string): ContinuityEntry => {
  if (!link) return { id, verb };
  return verb === "expands" ? { id, verb, from: link } : { id, verb, into: link };
};

export const MEMORY_CONTINUITY: Record<MemoryTransitionId, readonly ContinuityEntry[]> = {
  "match-01>match-08": [
    e("origin", "stays"), e("role:you", "stays"), e("node:m1", "stays"), e("path:open", "stays"),
    e("path:main", "strengthens"), e("region:open", "compresses"),
    e("path:reuse", "attaches"), e("path:weak", "attaches"), e("echo:a", "attaches"), e("echo:storm", "attaches"),
    e("node:m2", "enters"), e("node:m3", "enters"),
  ],
  "match-08>match-24": [
    e("origin", "stays"), e("role:you", "stays"), e("node:m2", "stays"),
    e("path:main", "moves"), e("echo:a", "moves"), e("region:open", "compresses"),
    e("node:m1", "compresses", "node:m2"), e("node:m3", "compresses", "marker:c1"),
    e("path:reuse", "compresses", "path:main"), e("path:weak", "compresses", "path:main"), e("echo:storm", "compresses", "path:main"),
    e("path:open", "compresses", "region:open"),
    e("matchup:m1", "enters"), e("marker:c1", "enters"),
    e("path:undertrace", "attaches"), e("path:qualified", "attaches"), e("echo:viper", "attaches"), e("echo:b", "attaches"),
  ],
  "match-24>match-56": [
    e("origin", "stays"), e("role:you", "stays"), e("path:main", "stays"), e("path:undertrace", "stays"), e("matchup:m1", "stays"),
    e("marker:c1", "stays"), e("node:m2", "stays"), e("echo:a", "stays"), e("echo:viper", "stays"), e("echo:b", "stays"),
    e("path:qualified", "strengthens"), e("region:open", "moves"),
    e("path:affinity", "attaches"), e("path:role", "attaches"), e("path:exception", "attaches"),
    e("echo:void", "attaches"), e("echo:qop", "attaches"), e("node:q1", "attaches"),
    e("node:role", "enters"), e("node:exc", "enters"),
    e("node:m1", "expands", "node:m2"), e("path:open", "expands", "region:open"), e("echo:storm", "expands", "path:main"),
  ],
  "match-56>player-model": [
    e("origin", "moves"), e("role:you", "moves"), e("region:open", "moves"), e("path:main", "moves"),
    e("path:open", "moves"), e("path:undertrace", "moves"), e("path:qualified", "moves"), e("matchup:m1", "moves"),
    e("marker:c1", "moves"), e("echo:viper", "moves"), e("echo:b", "moves"),
    e("echo:storm", "moves"), e("echo:void", "moves"), e("echo:qop", "moves"), e("node:m1", "moves"),
    e("path:affinity", "compresses", "path:main"), e("path:role", "compresses", "path:contour-b"),
    e("path:exception", "compresses", "path:contour-b"), e("node:m2", "compresses", "node:core"),
    e("node:q1", "compresses", "path:qualified"), e("node:role", "compresses", "node:contour-b"),
    e("node:exc", "compresses", "region:open"), e("echo:a", "compresses", "origin"),
    e("path:contour-b", "enters"), e("path:core", "attaches"), e("node:core", "enters"), e("node:contour-b", "enters"),
  ],
};
