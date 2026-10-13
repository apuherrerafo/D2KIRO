# Coach Motion V2 · authoring pipeline (graph-driven)

`scripts/coach-motion-v2/graph.json` is the single source. Everything derives from it:

| Step | Reads graph for |
|---|---|
| `plan.mjs` | validation, job list, size estimate, STOP gates (exit 2) |
| `capture.mjs` | jobs (`planJobs`); aborts before rendering if the projection is above the ceiling; `--plan-only` |
| `loop-pose.ts` | `LOOP_DEFS` (pose per loop) + `jobPoses(job)`; head/tail computed from the two loops of the edge |
| `guards.py` | every loop and every edge (frames, held, seam, blink, head==source phase, head→tail, tail→dest, budget) |
| `encode.py` / `pack_manifest.py` | clip plan derived (no globbing), `check_graph`, `check_budget` |
| `stride-probe.ts` | strideLimit per loop, strategy study per edge; fails if graph.json disagrees |

Add a state: a `LoopDef` in loop-pose.ts, a loop + edges in graph.json (unique `ns`), then capture. No runtime change
(`motion-fullgraph.test.ts` proves it with a hypothetical state).

Head namespace: `ENTRY_HEAD_<NS>_<phase:3>` / `head-<ns>-<phase:3>`; no prefix may start with another edge's (JS, Python and the player's `parseManifest` all reject it).

Existing approved AVIFs were renamed (not re-encoded) by `migrate_head_namespace.py`: bytes identical, sha256 checked before and after.
