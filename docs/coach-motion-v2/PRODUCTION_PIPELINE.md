# Coach Motion V2 · production slice pipeline (WATCHING loop · WATCHING→ANALYZING · ANALYZING loop)

Everything here regenerates from the repository. Nothing depends on a Claude scratchpad, a session folder or an absolute path.

**The 384 pack is now the FULL semantic pack** (4 loops, 5 edges, 207 entry heads, 19.67 MB). See `full-pack/FULL_PACK.md` for its generation, the decay-aware head → tail guard, the size gates and the playback audit. The capture and encode specifics below still apply; the clip list below describes the original WATCHING / ANALYZING slice, which the 512 pack still is.

Foundation hardening (manifest v4: data-driven graph, content-addressed chunks, cue-armed prefetch, watchdog, budgets, fallback identity, update contract): see `FOUNDATION_HARDENING.md`. This file keeps the capture / encode specifics.

## Pinned inputs

| Item | Value |
|---|---|
| Gold Master source | `apps/web/public/coach-gold-master/modular/coach-modular.{json,bin}` rendered by `HeroCoachStage` (quality `lite`: direct transparent render, MSAA, no bloom) |
| Poses | `apps/web/features/coach-motion/loop-pose.ts` (pure, unit-tested). Live pose space, Live amplitudes, Live blink, Live smoothing; only the time parameters are snapped so the cycle closes (see "Deviations from Live") |
| Cues | draft → WATCHING (aim centre, amplitude 0.6), reveal → ANALYZING (aim right, amplitude 0.8, verb GATHER): the Landing's own `CUE_BY_PHASE` values |
| Capture timing | 120 Hz fixed-step simulation, one frame sampled every 4th step = 30 fps, 3 s warm-up so the smoothing is in its steady cycle |
| Capture harness | `/lab/coach-motion-v2/capture` (`CoachMotionCapture.tsx`, `window.__coachCapture.production`), driven by `scripts/coach-motion-v2/capture.mjs`; headless Chromium, `readPixels` through `canvas.toDataURL("image/png")` |
| Self-check | every capture run first proves loop-pose.ts's smoothing equals `HeroCoachStage.update` on the Live clock (max abs pose diff 2.2e-16) and aborts above 1e-9 |
| Resolutions | 384 and 512 px, rendered NATIVELY (no resampling) |
| Alpha | straight alpha PNG from the WebGL read-back; encoder pre-pass bleeds RGB under alpha 0 from the nearest visible colour (visible pixels and alpha untouched) |
| Toolchain | pinned in `scripts/coach-motion-v2/toolchain.json` + `requirements.txt` (Python 3.12.10, Pillow 12.3.0, libavif 1.4.2, numpy 2.5.3, opencv-python 5.0.0.93, Node 24.19.0, Playwright 1.62.1, Bun 1.4.2); `encode.py` refuses any other |
| Encoder | Pillow 12.3.0 + bundled libavif 1.4.2 (`scripts/coach-motion-v2/encode.py`), AVIF, quality 35, speed 4, 4:2:0, full range, codec `auto`; the exact values are also written into each pack's `manifest.json` |
| Clips / graph | `scripts/coach-motion-v2/graph.json` (loops, edges, entry stride per edge); copied into the manifest as `graph` |
| Chunk files | content-addressed `<stem>.<sha256[:12]>.avif`; manifest v4 carries per-chunk SHA-256, `packHash`, `provenance` (Gold Master + static fallback ids), `limits.maxAtlasPx` |
| Atlas / chunk rules | one atlas = one chunk = ≤ 14 consecutive frames (0.47 s) of ONE clip, 4 columns (per clip `--cols-for CLIP=N`), cell = union alpha bbox of every frame of the pack (+2 px, even). 252 = 18×14, 210 = 15×14, tail 35 = 14+14+7, entry head 10 (one chunk). **Decoded chunk ≤ 2048 on both sides, enforced** (encode aborts, manifest rejected): 1304×1440 at 384, 1736×1912 at 512 |

## Clips (30 fps, forward only, no ping-pong)

* `WATCHING_LOOP` 252 frames = 8.4 s = exactly two Live blink periods; two real blinks (frames ~29 and ~155).
* `ANALYZING_LOOP` 210 frames = 7.0 s; the ring turns one way, exactly one revolution per loop (Live 0.9 rad/s, authored 0.8976).
* `ENTRY_HEAD_000…246` (42 heads, stride 6) × 10 frames: frame 0 is the exact WATCHING pose of that loop frame, then the Live reveal response.
* `TRANSITION_TAIL` 35 frames shared by all heads, ending on ANALYZING frame 0.

## Regenerate

```
# 1 build + start an isolated lab server (own port, ephemeral secrets, loopback only)
cd apps/web && NEXT_DIST_DIR=.next-coach-motion-v2-production SESSION_SECRET=<32+ chars> INTERNAL_AUTH_SECRET=<32+ chars> npx next build
node scripts/coach-motion-v2/serve.mjs --port 3162 --state <state.json outside the repo>
# 2 render the source frames (needs a GPU; path outside the repo)
SESSION_SECRET=<that server's> CM_BASE=http://localhost:3162 node scripts/coach-motion-v2/capture.mjs --px 384,512 --out <frames dir>
# 3 encode (python -I with the pinned toolchain: pip install -r scripts/coach-motion-v2/requirements.txt)
python -I scripts/coach-motion-v2/encode.py --frames <frames dir>/384 --px 384 --out apps/web/public/coach-motion-v2/prod/384
python -I scripts/coach-motion-v2/encode.py --frames <frames dir>/512 --px 512 --out apps/web/public/coach-motion-v2/prod/512
# 4 guards
python -I scripts/coach-motion-v2/guards.py --frames <frames dir>/384 --pack apps/web/public/coach-motion-v2/prod/384 --out docs/coach-motion-v2/production/guards-384.json
node scripts/coach-motion-v2/verify-assets.mjs                 # SHA-256 of every asset vs the manifests, toolchain, fallback identity (no server needed)
SESSION_SECRET=… node scripts/coach-motion-v2/verify.mjs      # network / cue-armed prefetch / cache / reduced motion / hidden / failure + stall / continuity
SESSION_SECRET=… node scripts/coach-motion-v2/net-metrics.mjs # idle requests, cache hits and bytes over the network
SESSION_SECRET=… node scripts/coach-motion-v2/shots.mjs       # DPR 1 and 2 screenshots
bun scripts/coach-motion-v2/stride-probe.ts <report.json>     # entry-stride probe of the pose tracks (before capturing heads for a new edge)
```

A visual-only Gold Master change adds, between 2 and 3, regenerating the static stills and `verify-assets.mjs --seal-fallback` (FOUNDATION_HARDENING §10–11).

## Reproducibility

Source frames: capturing the same jobs twice on the same machine (NVIDIA RTX 3060, ANGLE/D3D11, Chromium of the pinned Playwright 1.62.1) produced **byte-identical PNGs (507/507 per resolution at the first run; 917/917 at 384 in the hardening re-run)**. The sha256 of all 917 frames per resolution is committed in `docs/coach-motion-v2/production/source-hashes-{384,512}.json` and `capture-report.json`. GPU rasterisation is hardware/driver dependent, so another GPU may differ by sub-LSB amounts: the approved masters are the committed AVIF packs under `apps/web/public/coach-motion-v2/prod/` (each chunk's sha256 is in its manifest and in its file name; `verify-assets.mjs` recalculates them).

Second run (hardening pass, `hardening/determinism-second-run.json`): two fresh captures + two fresh encodes of the 384 slice reproduce the committed masters byte-for-byte on the pinned toolchain (917/917 PNGs, 78/78 AVIF chunks). Still not verified: a different machine / GPU, and the 512 pack.

The packs moved from manifest v3 to v4 without re-encoding (`migrate_v3_to_v4.py`: chunk hashes checked, files renamed to their content address).

## Deviations from the Live (deliberate, flagged for review)

The Live is aperiodic (free-running sines + linear ring spin), so no window of it loops forward. Snapped time parameters:

* WATCHING slow sways yaw 0.45→0.75 and pitch 0.31→0.75 rad/s (peak 1.7° / 0.7° after amplitude damping), breath 1.1→1.5 rad/s.
* WATCHING ring: the Live turns it at 0.08 rad/s one way (78 s per revolution). Inside an 8.4 s loop it **sways** ±6° at the same peak speed instead.
* ANALYZING: scan 2.6→2.69, eye bob 1.7→1.80, ring pulse 3.1→2.69 rad/s; ring spin 0.9→0.8976 (one revolution per loop).
* The Live pops the ring's direct terms (spin / radius / squash) on the cue; the heads ease them over 8 frames.
