# D2KIRO Visual Capture (local, Windows)

Reads the **hero portraits** on Dota's hero-selection screen, on the Player's PC, and sends only derived
facts (`heroId`, `radiant|dire`, pick/ban, confidence, a health code) to the same live session GSI feeds.
No Overwolf, no manual entry, no OCR text, no GPU, no model. **No frame ever leaves this process.**

```
Dota window ──WGC──► frame ──► slots (normalized layout) ──► portrait match ──► temporal confirm ──► allowlisted draft-event/v1 (source "ocr")
```

## Real use (Ranked All Pick, Party 5) -- no calibration, no screenshots, no flags

1. Start the helper **before queueing** and leave it running: `cd scripts/live/visual-capture` then `python -m d2vc live`
2. Open Dota / queue (D2KIRO at `/live-draft`, Dota GSI link installed).
3. Play. Zero actions during hero selection, and none between games.

The helper never decides when a draft starts: GSI does (server side), and every visual POST is answered with that
lifecycle (`live-visual-ack/v1`: phase + a draft counter). In menu / lobby / matchmaking / loading / the match the
helper is closed -- no baseline, no matching, no facts, one heartbeat a second asking "draft yet?". When GSI enters
hero selection (a new draft counter) it re-arms by itself, takes its empty-slot baseline on THAT screen, and picks
appear as each hero is stable for 3 frames. When the draft ends it closes again; the next game re-arms the same
process. The engine independently drops visual facts before GSI's `draft_started` and after the draft ended.

Bans are not required: with no verified ban region, bans stay unknown and the Team Coach works from picks.
Calibration (below) is **optional** and only refines the built-in 16:9 layout.

## One-time setup

```powershell
pip install opencv-python numpy windows-capture pywin32   # already present on this machine
cd scripts/live/visual-capture
python -m d2vc fetch          # downloads ~127 public hero portraits into local/ (gitignored)
```

## The lab (validate BEFORE going live)

```powershell
python -m d2vc lab path\to\screenshot.png            # Radiant / Dire / Bans, with confidence
python -m d2vc lab shot1.png shot2.png --json        # machine-readable
python -m d2vc lab shot.png --debug-dir local\debug  # draws the slot boxes over your screenshot (stays local)
python -m d2vc calibrate shot.png --out local\layout.json   # ONE time, from a real hero-selection screenshot
python -m d2vc bench                                  # offline benchmark (synthetic degradations)
python -m d2vc synth local\x.png --width 1280 --height 720   # a SYNTHETIC frame, for demos only
```

Output contains only hero names/ids and scores. Uncertain slots print `?` and emit nothing.

## Live

```powershell
python -m d2vc live            # built-in 16:9 layout; uses local\layout.json only if you calibrated one
```

Credentials: it reuses the Dota GSI cfg D2KIRO already installed
(`...\dota 2 beta\game\dota\cfg\gamestate_integration\gamestate_integration_d2kiro.cfg`: https origin, live id,
link token). Override with `D2KIRO_GSI_CFG=<path>`, or `D2KIRO_BASE_URL` + `D2KIRO_LIVE_ID` +
`D2KIRO_LINK_TOKEN`, or a local engine (`D2KIRO_LOCAL_ENGINE_URL` + `D2KIRO_CAPTURE_TOKEN`). The token is held
in memory only and is never printed.

Status line: `Visual capture: Dota window found - 6/10 heroes recognized` (also shown on `/live-draft`).

## Rules the code enforces

- **Layout is normalized to a 16:9 viewport** (letter/pillar-boxed frames handled). No pixel constants.
- The built-in layout is the **default** (`standard`); `live` never refuses to run for lack of calibration
  (`--allow-provisional-layout` is a legacy no-op). Safety is in the matcher, not the layout: a misplaced box
  can only lose recall, never produce a wrong hero.
- **Occupancy gate first (`occupancy.py`).** The matcher cannot tell an empty slot from an occupied one (an empty
  slot is not flat, and it will always name *some* hero). Every slot must first change materially from **its own
  empty baseline** (high-passed 32x18 grayscale thumbnail, mean abs difference >= `max(6, 3 x its baseline noise)`,
  so glow/pulse/brightness do not count). Baseline = >= 6 frames over >= 800 ms with its own noise <= 4; until
  then NOTHING is eligible (fail closed). A helper started on an already-filled bar baselines those picks as
  "unchanged" and never reports them. The baseline resets on `rearm()`, window loss, frame-size change, and when
  >= 6 slots turn occupied within 500 ms (menu / loading screen / restarted draft, not ten picks).
  Order: occupancy -> matcher -> score+margin -> 3-frame confirmation -> draft fact.
  `lab`/`bench` stay matcher-only diagnostics (single frame, no baseline).
- A hero is emitted only if `score >= 0.70` **and** `margin over runner-up >= 0.15`; a flat slot never matches.
- A hero is **confirmed** only after 3 consecutive frames spanning >= 350 ms. Flicker creates nothing. A
  confirmed slot that stably changes yields `pick_reverted` + new `hero_picked`. Unreadable frames never revert.
- Screen slot order is **not** Pos 1-5. Nothing here sends a position.
- Allowlist (`emit.assert_allowlisted`) runs on every envelope: hero id, side, pick/ban, confidence, health code.
- The engine accepts only `hero_picked | pick_reverted | hero_banned | capture_health` on this channel, bound to
  the link's session; GSI keeps lifecycle, our side and our own hero. Same hero from both = one pick.

## Tests

```powershell
python -m unittest discover -s scripts/live/visual-capture/tests -v     # from the repo root
bun test apps/engine/src/live/live-visual.test.ts
bun test apps/web/app/api/live/visual-relay.test.ts
```
