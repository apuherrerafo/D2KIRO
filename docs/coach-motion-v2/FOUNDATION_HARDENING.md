# Coach Motion V2 · foundation hardening

Base: `c0aa957` (`lab/coach-motion-v2-production-slice`). Scope: the motion foundation only. No new motion, no Landing integration, no Coach change, no 512 default, no mobile Motion V2 (mobile stays static), no `proxy.ts` change.

Frozen baseline (unchanged): prerendered real Gold Master frames · 384 px · 30 fps · AVIF · long forward loops · canonical semantic transitions · entry-head continuity · chunked playback · `createImageBitmap` with explicit bitmap lifecycle · static sprite fallback · reduced motion = static.

Evidence in this folder: `hardening/determinism-second-run.json`, `hardening/stride-probe-analyzing.json`, `hardening/before-after.json`.

---

## 1. Cue-armed prefetch

**Before.** While WATCHING idled, `wanted()` asked for the entry heads of the next two phases on every frame. Over one 8.4 s loop that touched all 42 heads, then again on every following loop.

**Now.** The sequencer names a transition's resources only while a request is pending, and only for the requested edge.

| State | Wanted, in priority order | Flag |
|---|---|---|
| Idle in a loop | current chunk, next chunk | required |
| Loop + request pending | current, next · **nearest entry head** · **tail opening (chunk 0)** · next entry head (latency hedge, `armHeads` = 2) | required · speculative · required · speculative |
| Inside an edge (head, tail) | default path for `lookaheadFrames` (28): head, tail chunks, then the target loop's chunk 0 | required |

* The request is **taken** at a frame boundary only when the nearest head **and** the tail's first chunk are decoded. A transition therefore never starts and then freezes at frame 10 because the tail opening lost a race; until both are ready the loop keeps playing.
* Priority is enforced by the store (`bitmap-store.ts`): an ordered queue, required loads always start immediately, speculative loads wait behind a cap of 2 in flight, a key that stops being wanted is **aborted** (`AbortSignal` into `fetch`) so stale slow prefetches cannot hold the cap.
* Order after a request: visible loop → nearest head → tail opening → (head taken) → remaining tail chunks → target loop chunk 0 → later chunks. Verified by `cue-armed-prefetch.test.ts` with held loaders.

| Measured, 384 px, real geometry | Before (`c0aa957`) | After |
|---|---|---|
| Idle, one 8.4 s pass: requests (unit harness) | 65 (44 head requests, all 42 heads) | 20 (0 head) |
| Idle, three passes: head requests | 128 | **0** |
| Idle, three passes: decode work | 185 decodes, 1096 MiB | 56 decodes, 401 MiB |
| Idle, two passes, real Chromium: head requests | 89 (42 distinct URLs) | **0** |
| Idle, two passes, real Chromium: network transfers / bytes | 127 / 4.30 MB | 16 / 1.58 MB (all in pass 1) |
| Steady idle residency | 32.2 MiB | **14.3 MiB** |

The remaining idle decode (≈ 129 MiB per pass = 18 chunks × 7.16 MiB) is the loop itself, each chunk decoded once per pass: the price of holding 2 chunks instead of the whole 129 MiB loop.

**Trade-off, measured.** Heads are no longer resident, so the first transition frame appears after fetch + decode of one head and the tail opening. In headless Chromium on loopback that is **31–57 ms** (1–2 frames) from the cue. On a cold network it adds the transfer of ≈ 170 KB (head ≈ 70 KB + tail chunk ≈ 97 KB); see risk R1.

## 2. Encoded asset cache

* **Content-addressed names.** Every chunk is `<stem>.<sha256[:12]>.avif` (`watching-00.db5a6ce240c8.avif`). The manifest lists name, size and full SHA-256 per chunk, plus `packHash`.
* **Plain HTTP caching, no custom cache.** `apps/web/next.config.ts` `headers()`: `…/prod/:pack/:file(.+\.avif)` → `Cache-Control: public, max-age=31536000, immutable`; `…/prod/:pack/manifest.json` → `public, no-cache` (always revalidated). The player fetches the manifest with `cache: "no-cache"`.
* **A new manifest can never reach stale bytes**: a changed chunk has a different name; the only mutable URL is the manifest and it is revalidated on every load. `encode.py` deletes unreferenced AVIFs from the pack folder and `verify-assets.mjs` fails on any orphan.
* **Validated on load** (`chunk-loader.ts`): byte size equals the manifest's, decoded `width × height` equals the manifest's (a mismatch closes the bitmap and fails the load). The retry (attempt 2) fetches with `cache: "reload"` so a corrupt cached answer cannot be served twice.
* **Measured** (real Chromium, `net-metrics.mjs`, `verify.mjs`): the second loop pass issues 36 loop-chunk requests, **0 cross the network**; response headers are asserted in `verify.mjs`.
* Note: a bare CDN in front of Vercel must keep these headers (do not strip `immutable`).

## 3. Failure and stall hardening

| Situation | Behaviour |
|---|---|
| Required chunk fails (a chunk on the path of the frames about to be shown, or the tail opening of a pending request) | **one retry** after 250 ms (attempt 2, cache bypassed); second failure → fallback to static, `onFail` once |
| Speculative chunk fails (an armed entry head) | reported (`stats.speculativeFailures`), **never fatal, never retried on its own**; the sequencer steps over it (nearest *decoded* head wins; a neighbour is at most `stride` frames away) |
| A speculative key becomes required | it gets its one retry then |
| Clock held (next chunk not decoded) | the current frame stays, nothing is skipped; visible-tick time accumulates; ≥ **2.5 s** → fallback (`stalled N ms waiting for <chunk>`) |
| `goTo` whose first chunk never lands | same watchdog |
| A request whose entry never decodes (loop keeps painting) | request watchdog, same 2.5 s |
| Tab hidden / off-screen / paused | the player stops ticking → no clock, no watchdog, no work; resuming continues on the very next frame |
| Any fallback | canvas hidden, static Coach shows the **requested** semantic phase (`phase` prop), bitmaps released, no more canvas writes. Never a frozen frame, never a blank Coach |

Watchdog time counts only ticks (each clamped to 100 ms), so a hidden tab or a long frame cannot trip it. Budget is `stallMs` (default 2500, lab `?stall=`).

## 4. Data-driven motion graph (manifest v4)

The manifest carries `graph: { loops, edges }`; the sequencer/controller/player contain no clip name and no topology.

```json
"graph": {
  "loops": { "watching": { "clip": "WATCHING_LOOP" }, "analyzing": { "clip": "ANALYZING_LOOP" } },
  "edges": [{
    "id": "watching>analyzing", "from": "watching", "to": "analyzing", "fps": 30,
    "entry": { "strategy": "nearest-head", "stride": 6, "headClipPrefix": "ENTRY_HEAD_", "headFrames": 10, "maxStepFrames": 3, "armHeads": 2 },
    "tail": { "clip": "TRANSITION_TAIL", "enterFrame": 0 },
    "lookaheadFrames": 28
  }]
}
```

* `parseManifest` validates: loops reference loop clips; edges reference loops; unknown entry strategy; head grid complete (`ENTRY_HEAD_000…` at every `stride`); head frame counts; tail; `stride/2 ≤ maxStepFrames`; `fps` equals the pack's (mixed-fps edges are rejected, not silently mis-timed); atlas ≤ 2048 px; content-addressed names; per-clip `cols` override consistency.
* Loop ids are `CoachRenderState` names (`watching`, `analyzing`, later `pointing`, `confirming`): the static Coach and the picture share one vocabulary.
* `controller.cue(target)` asks for the edge `current loop → target`; it returns `false` when the graph has none (nothing changes). A pending request may be re-targeted before it is taken.
* Proven on a synthetic 3-loop / 4-edge graph built from the real geometry (`motion-graph.test.ts`): `watching → analyzing → pointing → watching`, each edge using its own heads, tail and stride.

**Adding a future edge (e.g. ANALYZING → POINTING)** touches: (1) a capture definition (`loop-pose.ts` `Job` + `capture.mjs` jobs) and the new loop/heads/tail frames; (2) `scripts/coach-motion-v2/graph.json` (loop + edge); (3) `encode.py` run. No player, sequencer, store or controller edit. `strategy` is a closed set (`nearest-head`) checked at load; a second strategy would be one function in the sequencer plus one entry in `ENTRY_STRATEGIES`.

## 5. Stride per edge, and the ANALYZING exit

Stride is `edge.entry.stride`, parsed per edge; nothing assumes 6. The probe (`stride-probe.ts`, `scripts/coach-motion-v2/stride-probe.ts`) measures, with the real authored pose tracks and the guards' pose-distance metric, the jump from `pose(f)` to the pose of the nearest head phase for every possible cue frame.

| ANALYZING exit | heads | worst frames off | max jump (× ordinary frame step) |
|---|---|---|---|
| stride 2 | 105 | 1 | 1.0 |
| **stride 3** | **70** | **1** | **1.0** |
| stride 4 | 53 | 2 | 2.0 |
| stride 6 | 35 | 3 | 3.0 |

ANALYZING turns its ring at a constant ≈ 3.35 pose-units per frame (WATCHING's median step is 0.24), so its jump grows linearly with the frames the nearest head is off.

**Recommended ANALYZING-exit stride: 3** (worst entry mismatch = one natural motion step). Rule used: largest probed stride whose p95 jump is ≤ 1.5 × the loop's own p95 step; the same rule returns 6 for WATCHING, i.e. it reproduces the approved choice. Cost: ≈ 70 heads per outgoing ANALYZING edge (≈ 4.8 MB at 384, fetched lazily, one head per cue). Stride 4 (53 heads, jump 2 steps) is the fallback if payload matters more than the seam. The edge declares `maxStepFrames: 1` for stride 3.

## 6. Memory budgets (real manifest geometry; decoded = w × h × 4)

Chunk 384 (full semantic pack, crop 332×368): loop 1328×1472 = 7.46 MiB · head 1328×1104 = 5.59 MiB · tail chunks 7.46 / 7.46 / 3.73 MiB. (The WATCHING / ANALYZING slice before it: 1304×1440 = 7.16 MiB, 1304×1080 = 5.37 MiB.)

| Budget | Definition | 384 | 512 |
|---|---|---|---|
| **IDLE LOOP** | 2 loop chunks (current + next) | **14.9 MiB** | 25.3 MiB |
| **ARMED SINGLE EDGE** | idle + `armHeads` heads + tail opening | **33.6 MiB** with 2 armed heads (W→A, C→P); 44.7 MiB with 4 (A→P, P→C, P→W) | 57.0 MiB |
| In-transition peak (measured) | head + tail + target chunks, `lookaheadFrames` 28 | 25.1 MiB | 44.3 MiB |
| **STATE WITH TWO OUTGOING EDGES** | idle is independent of the number of edges; only the requested edge arms | idle 14.9 · armed ≤ 33.6 (either edge) | 25.3 · ≤ 57.0 |
| (avoided) both edges armed | idle + 2 × (heads + tail) | 14.9 + 2 × 18.6 = 52.2 | |

The old design held the *armed* figure permanently (32.2 / 57.0 MiB); now it is reached only between a request and the transition start (a fraction of a second). `memory-budget.test.ts` asserts all of these through the real controller and store on the committed manifests, plus a synthetic watching-with-two-edges state, and that the other edge's heads are never requested.

## 7. Chunk size cap

`MAX_ATLAS_PX = 2048` in three places that must agree: `encode.py`/`pack_manifest.check_atlas` (aborts **before packing** with the clip, chunk, size and the remedy), `parseManifest` (rejects a manifest whose `limits.maxAtlasPx` exceeds 2048 or any chunk exceeds its limit), `verify-assets.mjs`. A wide pose can use fewer columns: `encode.py --cols-for CLIP=N`, recorded as `clips[CLIP].cols` and honoured by the painter (`colsOf`). Largest shipped atlas: 1328×1472 (384, full semantic pack), 1736×1912 (512).

## 8. Transition lead time

Request → first use, measured (30 fps, instant loader):

| Resource | Before | After |
|---|---|---|
| tail chunk 0 | resident since idle (prefetched on every frame) | requested at the cue, **gated**: the transition does not start until it is decoded (367 ms before its first frame) |
| tail chunk 1 | 467 ms | **800 ms** |
| tail chunk 2 | 467 ms | **933 ms** |
| ANALYZING chunk 0 | 467 ms | **933 ms** |

Slow-loader tests (held decodes, no timing luck): slow head, slow tail opening (request not taken), slow tail chunk 1 (holds on tail frame 13, resumes at 14, nothing skipped), slow destination (holds on tail frame 34, ANALYZING from frame 0), required load never queued behind a full speculative cap.

## 9. Reproducibility

* **Toolchain pinned as data**: `scripts/coach-motion-v2/toolchain.json` (Python 3.12.10, Pillow 12.3.0, libavif 1.4.2, numpy 2.5.3, opencv-python 5.0.0.93, Node 24.19.0, Playwright 1.62.1, Bun 1.4.2) and `requirements.txt`. `encode.py` refuses other versions (`--allow-toolchain-drift` for exploration); `verify-assets.mjs` checks every manifest's encoder block against it.
* **`node scripts/coach-motion-v2/verify-assets.mjs`** (`bun run verify:coach-motion-assets`): recalculates the SHA-256 of every chunk and compares with the manifest (and the hash embedded in the file name), size, `packHash`, `totalBytes`, orphans, atlas cap, toolchain, fallback identity. Exit 1 on any mismatch. Tested against tampered copies (`verify-assets.test.ts`).
* **Second-run determinism artifact** (`hardening/determinism-second-run.json`): two fresh captures and two fresh encodes of the approved 384 slice on the pinned toolchain: 917/917 PNGs identical to each other and to the committed source hashes; 78/78 AVIF chunks identical to each other and to the committed masters. Not claimed: cross-GPU identity of the WebGL render (the committed AVIFs are canonical) and the 512 pack.
* **v3 → v4 migration** did not re-encode: `migrate_v3_to_v4.py` checks each v3 chunk hash, renames files to their content address and adds the graph/provenance; the AVIF bytes are the approved ones. A fresh `encode.py` run on the second-run frames emits the same v4 manifest (see the artifact).
* Regenerate: unchanged from `PRODUCTION_PIPELINE.md`; encode default quality is now 35 (the value the approved packs were encoded with; the previous CLI default of 33 disagreed with the manifests).

## 10. Gold Master update contract

```
appearance (Gold Master)  →  motion capture  →  encoded motion pack  →  semantic graph  →  player  →  product integration
 coach-modular.{json,bin}     capture.mjs +       encode.py + graph.json    manifest.graph     features/        Landing (not
                              loop-pose.ts jobs   → prod/<px>/*.avif        (data)             coach-motion     started)
```

* **Visual-only change** (materials, colours, lighting, visor, model detail): replace the Gold Master files → `capture.mjs` (same jobs) → `encode.py` (same `graph.json`) → regenerate the static stills (their own pipeline) → `verify-assets.mjs --seal-fallback` → `verify-assets.mjs` + `verify.mjs`. The semantic pack, graph, player and Landing are untouched; pose timing does not move.
* **New motion** (a loop or an edge): new capture jobs (`loop-pose.ts`), new frames, one loop/edge entry in `graph.json`, `encode.py`. Pick the entry stride with the probe first (`stride-probe.ts`). No player/sequencer/store edit; `parseManifest` rejects an incomplete head grid or a stride that breaks `maxStepFrames` at load and `check_graph` at build time.
* **Timing change** to an existing loop/edge is a *motion* change: re-capture everything that shares it (a loop change invalidates all heads that start from it).

## 11. Static fallback drift check

The static Coach (`public/coach-web-pack/hero/*.webp`) comes from a separate pipeline. Nothing linked it to the Gold Master the motion pack was built from. Now:

* every pack manifest records `provenance.goldMaster.id` (hash of `coach-modular.json` + `.bin`) and `provenance.staticFallback.id` (hash of the 12 stills) it was sealed against;
* `scripts/coach-motion-v2/identity.lock.json` records the static stills' id **and the Gold Master they were built from**; it is written only by `verify-assets.mjs --seal-fallback`, which refuses to re-seal a Gold Master change that left the stills byte-identical (`--static-unchanged-ok` to override knowingly).

| Drift | Caught by |
|---|---|
| Gold Master changed, motion not regenerated | pack `goldMaster.id` ≠ repo |
| Gold Master changed, motion regenerated, **static not** (NEW motion + OLD fallback) | lock `builtFromGoldMaster` ≠ repo |
| static stills changed without sealing | repo static id ≠ lock / pack |

Baseline sealed at this commit against Gold Master `809d420b086d` and static `e07aface56f3`. Both were introduced together in `d24da56` and are unchanged since (`git log` on both paths), which is the evidence the baseline pairing is genuine. Covered by `verify-assets.test.ts`.

## 12. Repo hygiene

* `.gitignore`: `apps/web/.next-coach-*/` (the dedicated `NEXT_DIST_DIR` outputs: `.next-coach-audit`, `.next-coach-motion-audit`, `.next-coach-motion-v2-production`, `.next-coach-motion-v2-hardening`).
* Nothing under `docs/coach-motion-v2/{raw,src-frames-384,…}` is staged. Identified, **not deleted**, not for production integration: `public/coach-motion-v2/{A,B,C}/**`, `watching-idle.webp`, `watching-to-analyzing.webp` (first-prototype assets, not referenced by the production player), `features/coach-motion/{CoachMotionLab,Atlas,Capture,EntryLab,Eval}.tsx`, `clips.ts`, `atlas-clock.ts`, `entry-plan.ts`, `lab-params.ts` and their `/lab/coach-motion-v2/*` pages, `public/coach-motion-v2/prod/512/**`. A Landing integration should copy only `prod/384/**` and the production player modules.
* Untracked, pre-existing, untouched: `docs/coach-motion-audit/`, `docs/landing-v2-integration/*`, `docs/coach-motion-v2/{raw,src-frames-384,*.png,*.json,*.webm}`, `apps/web/tsconfig.json` (local `include` additions for the dist dirs).
* No cookies, session state or scratchpad paths are written into the repo: the lab server state file (secrets + pid) must be passed with `--state <outside the repo>`.

## 13. Landing integration gate · public asset exposure (PLAN ONLY, `proxy.ts` untouched)

Finding (verified against a running build with no session cookie): `proxy.ts` lets only `/`, `/login`, `/access-denied`, `/healthz`, `/api/auth/*` and the GSI/visual/companion ingest prefixes through. Its matcher covers every other path, `public/` files included. A logged-out request for `/coach-motion-v2/prod/384/manifest.json`, `/coach-web-pack/hero/watching-c.webp` or `/coach-gold-master/modular/coach-modular.json` is refused (503 on a lab server without a canonical origin; a redirect to `/login` where one is configured). So a public Landing visitor gets **no Motion V2 and also no static fallback**.

Integration requirement (explicit gate, to be done in the Landing integration task):

1. Production Motion V2 public assets must be fetchable by logged-out visitors **without exposing lab or authenticated routes**: allow exactly `/coach-motion-v2/prod/384/` (manifest + `*.avif`), and the static fallback `/coach-web-pack/hero/*.webp`. Prefer an exact-prefix allow-list in `isPublicPath` (as the GSI prefixes do) over loosening the matcher; do **not** allow `/coach-motion-v2/` as a whole (it contains the prototype folders), `/lab/**`, or `/coach-gold-master/**` (the 3D model is not needed by the prerendered path).
2. Add an e2e/prod check that an unauthenticated browser gets 200 and the cache headers of §2 for the manifest and one chunk, and that `/lab/coach-motion-v2/*` still redirects.
3. Ship only `prod/384/**` in the Landing build (not 512, not `A/B/C`).
4. Re-run `verify-assets.mjs` as part of the integration gate.
5. Keep `Cache-Control` headers from §2 on whatever serves the assets.

---

## Remaining risks

* **R1 · first-cue latency on a cold network.** Heads/tail are fetched at the cue (≈ 170 KB). Local latency is 31–57 ms; on a slow first visit it adds that transfer. Cheap mitigation if the Landing measures it: let the host warm the *encoded* tail opening and the first heads into the HTTP cache (no decode, no memory) when a cue is likely; not built, not needed for the foundation.
* **R2 · 512 decode cost** is unchanged in kind and larger in size (armed 57 MiB); 512 stays a non-default.
* **R3 · stride 3 for ANALYZING exits** means ≈ 70 heads per outgoing edge (≈ 4.8 MB at 384 on the CDN; only ≈ 70 KB is fetched per cue). With several outgoing edges the pack grows accordingly; stride 4 is the lever.
* **R4 · WebGL render determinism across GPUs** is not asserted; mitigated by committing the AVIF masters.
* **R5 · static fallback pipeline** is still separate; the check detects drift, it does not regenerate.
* **R6 · hidden-tab behaviour with decodes in flight**: a decode that lands while hidden is kept (≤ the armed budget) until the tab resumes; there is no timer-based eviction.
