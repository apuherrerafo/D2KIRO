# Coach Motion V2 · production slice pipeline (WATCHING loop · WATCHING→ANALYZING · ANALYZING loop)

Everything here regenerates from the repository. Nothing depends on a Claude scratchpad, a session folder or an absolute path.

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
| Encoder | Pillow 12.3.0 + bundled libavif 1.4.2 (`scripts/coach-motion-v2/encode.py`), AVIF, quality 35, speed 4, 4:2:0, full range, codec `auto`; the exact values are also written into each pack's `manifest.json` |
| Atlas / chunk rules | one atlas = one chunk = ≤ 14 consecutive frames (0.47 s) of ONE clip, 4 columns, cell = union alpha bbox of every frame of the pack (+2 px, even). 252 = 18×14, 210 = 15×14, tail 35 = 14+14+7, entry head 10 (one chunk). Decoded chunk ≤ 1736×1912 at 512 (≤ 2048) |

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
# 3 encode
python -I scripts/coach-motion-v2/encode.py --frames <frames dir>/384 --px 384 --out apps/web/public/coach-motion-v2/prod/384 --quality 35
python -I scripts/coach-motion-v2/encode.py --frames <frames dir>/512 --px 512 --out apps/web/public/coach-motion-v2/prod/512 --quality 35
# 4 guards
python -I scripts/coach-motion-v2/guards.py --frames <frames dir>/384 --pack apps/web/public/coach-motion-v2/prod/384 --out docs/coach-motion-v2/production/guards-384.json
SESSION_SECRET=… node scripts/coach-motion-v2/verify.mjs      # network / reduced motion / failure / continuity
SESSION_SECRET=… node scripts/coach-motion-v2/shots.mjs       # DPR 1 and 2 screenshots
```

## Reproducibility

Source frames: capturing the same jobs twice on the same machine (NVIDIA RTX 3060, ANGLE/D3D11, Chromium of the pinned Playwright 1.62.1) produced **byte-identical PNGs (507/507 per resolution)**. The sha256 of all 917 frames per resolution is committed in `docs/coach-motion-v2/production/source-hashes-{384,512}.json` and `capture-report.json`. GPU rasterisation is hardware/driver dependent, so another GPU may differ by sub-LSB amounts: the approved masters are the committed AVIF packs under `apps/web/public/coach-motion-v2/prod/` (each chunk's sha256 is in its manifest). Not yet verified: byte-exact AVIF re-encode on a second machine.

## Deviations from the Live (deliberate, flagged for review)

The Live is aperiodic (free-running sines + linear ring spin), so no window of it loops forward. Snapped time parameters:

* WATCHING slow sways yaw 0.45→0.75 and pitch 0.31→0.75 rad/s (peak 1.7° / 0.7° after amplitude damping), breath 1.1→1.5 rad/s.
* WATCHING ring: the Live turns it at 0.08 rad/s one way (78 s per revolution). Inside an 8.4 s loop it **sways** ±6° at the same peak speed instead.
* ANALYZING: scan 2.6→2.69, eye bob 1.7→1.80, ring pulse 3.1→2.69 rad/s; ring spin 0.9→0.8976 (one revolution per loop).
* The Live pops the ring's direct terms (spin / radius / squash) on the cue; the heads ease them over 8 frames.
