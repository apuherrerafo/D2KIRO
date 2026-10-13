# Coach Motion V2 · full semantic pack (384 px · 30 fps · AVIF q35)

The pack has four loops (WATCHING, ANALYZING, POINTING, CONFIRMING), five edges (W→A, A→P, P→C, C→P, P→W) and every entry-head grid. It is generated from `scripts/coach-motion-v2/graph.json` by the graph-driven pipeline (`PRODUCTION_PIPELINE.md`, `authoring/AUTHORING_PIPELINE.md`). It replaces the WATCHING / ANALYZING slice in `apps/web/public/coach-motion-v2/prod/384`. The 512 pack is untouched and is still that slice.

Review lab: `/lab/coach-motion-v2/full-pack` (`CoachFullPackLab.tsx`). It shows LIVE Gold Master next to the production player. It has state buttons (cue the edge when the graph has one, otherwise jump), Play full cycle, Replay transition, Pause and Dark / Light. It is not linked from the Landing.

## Decay-aware head → tail guard

`guards.py seam_verdict` is used by `guards.py` and `calibration-guards.py`.

### STANDARD mode (unchanged, the default)

The seam step must satisfy: `head[-1] → tail[0]` ≤ 1.25 × max(the tail's largest step, the source loop's largest ordinary step).

That rule compares the cut with the steps after it. So a cut that lands inside one continuous deceleration always looks too big: by construction, the following step is smaller. The real A→P and C→P cuts failed it for exactly that reason.

### DECAY mode (accepts that case and nothing else)

Every rule below must hold. If any one fails, the STANDARD verdict stands. The STANDARD threshold is never relaxed.

| Rule | Condition |
|---|---|
| `decelerating` | boundary ≤ before |
| `keepsDecaying` | after ≤ boundary and after2 ≤ after |
| `noAbruptStop` | boundary / before ≥ 0.5 and after / boundary ≥ 0.5 |
| `direction` | mean optical-flow cosine ≥ 0.95, both for before vs boundary and for boundary vs after (Farneback). An undefined direction fails. |
| `visorSign` | Visor yaw / pitch velocity keeps its sign across the seam. A velocity under 1e-3 rad/frame counts as having no sign. |
| `visor`, `eyes`, `ring` | The pose step at the seam is ≤ the largest step of that channel elsewhere in head + tail. The ring spin is compared as an angle. |
| `noPop` | Neither seam frame is a one-frame detour. Detour = (step in + step out) / skip distance, measured at `head[-1]` and at `tail[0]`. It must be ≤ the largest detour of the two frames on either side. |

### Negative and mutation tests (`scripts/coach-motion-v2/decay-guard.test.ts`)

The fixtures are synthetic: a soft blob on a measured path, with poses that follow it.

- **Clean fixtures.** One clean decaying seam passes via DECAY. The same seam with the ring crossing ±π also passes. A small seam passes via STANDARD.
- **Defect fixtures.** There are 15 defect fixtures. Each one is rejected by exactly the rule it targets:
  - acceleration at the seam (one fixture), and acceleration after the seam (two)
  - abrupt stop: at the seam, and right after it
  - direction reversal
  - a direction kink of about 25° (flow cosine 0.91)
  - a motion with no defined direction
  - visor flip
  - visor jump
  - eye jump
  - ring jump
  - hidden pop as a one-frame swell, and hidden pop as a one-frame flash. In both, the step series stays a monotone deceleration and the flow cosine stays above 0.95.
  - a non-decaying seam at 1.4× the ordinary step
- **Source mutation.** 18 source mutations of `guards.py` are each killed by a changed verdict on at least one fixture. They cover:
  - every rule removed
  - partial rules
  - DECAY accepted on any one rule
  - the seam step counted in its own pose maximum
  - the ring not angle-wrapped
  - the thresholds 0.5 → 0.3, 0.95 → 0.9 and 1e-3 → 0.1
  - the STANDARD factor 1.25 → 1.5

  The mutants and their killers are listed in `decay-mutation-report.json`.

### Real calibration frames (`calibration-guards-384.json`, the 2026-10-13 calibration capture)

| Edge | Heads | Mode | Boundary / standard limit | Ratios | Flow cos | Detour seam / neighbours |
|---|---|---|---|---|---|---|
| A→P | 51, 102, 153 | DECAY | 26.3–26.5 / 22.96 | 0.83 / 0.69–0.70 | ≥ 0.999 | 1.26–1.27 / 1.36–1.47 |
| C→P | 30, 54, 84 | DECAY | 27.7–27.8 / 24.70 | 0.85 / 0.71 | ≥ 0.999 | 1.29 / 1.32 |
| P→C | 27, 54, 84 | STANDARD | 7.59–7.61 / 7.84 | | | |
| P→W | 27, 54, 84 | STANDARD | 37.0–37.1 / 39.46 | | | |

W→A is not in the calibration set. In the full pack it passes STANDARD at all 42 heads (13.25 / 16.56).

## Full pack

### Capture

- 2931 frames (216 jobs) in 39 s, headless, on ANGLE / D3D11 RTX 3060.
- loop-pose self-check against HeroCoachStage: 2.2e-16.
- Determinism:
  - all 917 previously committed 384 source frames (WATCHING, ANALYZING, W→A) are byte-identical;
  - all 946 calibration frames are byte-identical.
- `source-hashes-384.json` holds the sha256 of every frame.

### Encode

- Pinned toolchain, q35, speed 4, 4:2:0.
- Crop 332×368 (it grew from 326×360 to hold the POINTING / CONFIRMING silhouettes).
- 271 content-addressed chunks.
- Largest atlas 1328×1472 (cap 2048).

### Sizes

From `pack-report.txt`, in bytes:

| | Bytes |
|---|---|
| Loops | 4,564,604 (W 1,770,612 · A 1,345,947 · P 685,937 · C 762,108) |
| Heads | 13,935,187 (W→A 2,905,853 · A→P 4,625,749 · P→C 2,609,388 · C→P 1,288,424 · P→W 2,505,773) |
| Tails | 1,173,249 (W→A 241,758 · A→P 218,337 · P→C 245,532 · C→P 218,318 · P→W 249,304) |
| **Total** | **19,673,040** (ceiling 24,000,000) |

Common-path milestones (manifest 84,466 B included; each chunk counted once):

| Point on the path | Payload |
|---|---|
| First animated frame | 181 KB (275 KB with the next chunk, which is requested at the same time) |
| W→A ready | 2.09 MB |
| Through ANALYZING (the first-load gate) | 3.58 MB (limit 8 MB) |
| Through POINTING | 4.77 MB |
| Through CONFIRMING | 6.05 MB |

`graph.json` budget rates are now the measured ones. The planner projects 19.09 MB, 3 % under the actual size, because heads cost slightly more per frame than their source loop.

### Guards and checks

- **Full guards** (`guards-384.json`): 0 failures over every loop, edge and head.
  - Every head's frame 0 equals its source phase exactly.
  - Head→tail seams: W→A 42 STANDARD · A→P 70 DECAY · P→C 38 STANDARD · C→P 19 DECAY · P→W 38 STANDARD.
  - Decoded PSNR is 29.8–30.1 dB for all four loops, the same as the approved slice.
- **verify-assets**: all pass (384: 271 chunks, 512: 78).
- **verify.mjs**: all 32 checks pass on the new pack.

### Runtime

`motion-fullpack.test.ts` runs the real manifest and the shipped controller with fake decodes. It covers the full cycle and the per-loop holds.

`fullpack-audit.mjs` runs the lab headless. Results:

| Run | Paint interval median / p95 / p99 / max | > 50 / > 100 / > 150 ms |
|---|---|---|
| Dark, 2 runs | 33.3 / 33.8 / 37.7 / 38.2 ms | 0 / 0 / 0 |
| Light | 33.3 / 33.6 / 37.4 / 37.6 ms | 0 / 0 / 0 |
| With the LIVE Three.js panel mounted | 33.3 / 41.4 / 45.6 / 50.8 ms | 1 / 0 / 0 |

Other results:

- No duplicated or skipped authored frame.
- No skipped transition opening.
- No freeze of 500 ms or more.
- Cue → head 0: 29–66 ms (one or two loop frames).
- Resident chunks: loop ≤ 2, armed ≤ 5, transition ≤ 4.
- No head or tail request outside a cue → arrival window. As a positive control, all 32–33 head / tail requests of a run fall inside those windows.
- One createImageBitmap decode: about 24 ms for a 1328×1472 loop chunk and 17–22 ms for a head (desktop Chromium).

## Regenerate

```
node scripts/coach-motion-v2/serve.mjs --port <free> --state <state.json outside the repo> --dist <NEXT_DIST_DIR of a build of this tree>
SESSION_SECRET=… CM_BASE=http://127.0.0.1:<port> node scripts/coach-motion-v2/capture.mjs --px 384 --out <frames>
python -I scripts/coach-motion-v2/encode.py --frames <frames>/384 --px 384 --out <scratch pack dir>      # STOP if pack-report fails, before it touches the repo
node scripts/coach-motion-v2/pack-report.mjs --pack <scratch pack dir>
# replace apps/web/public/coach-motion-v2/prod/384/{*.avif,manifest.json} with the scratch pack, then
python -I scripts/coach-motion-v2/guards.py --frames <frames>/384 --pack apps/web/public/coach-motion-v2/prod/384 --out docs/coach-motion-v2/full-pack/guards-384.json
node scripts/coach-motion-v2/verify-assets.mjs
# restart the lab server (next start indexes public/ at startup), then
SESSION_SECRET=… CM_BASE=… node scripts/coach-motion-v2/fullpack-audit.mjs --out docs/coach-motion-v2/full-pack/temporal-audit-dark-live0.json
SESSION_SECRET=… CM_BASE=… node scripts/coach-motion-v2/verify.mjs docs/coach-motion-v2/full-pack/verify-report.json
```
