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
  Order: occupancy -> lock state -> matcher -> score+margin -> 3-frame confirmation -> draft fact.
  `lab`/`bench` stay matcher-only diagnostics (single frame, no baseline).
- **Lock state from the card chrome (`lockstate.py`) -- a hover is never a pick.** The player-colour bar of a card sits at
  the BOTTOM while the card is empty / hovered and moves to the TOP when the pick locks. The chroma of the top strip
  (`max(2, round(5 * viewport_height / 900))` rows, middle 60% of the card) is >= 103 on every locked card and <= 45 on
  everything else in the saved real corpus: `>= 80` = locked. A slot enters hero matching only when it is **locked AND
  occupied**; occupancy / distance only ever downgrade (a locked-looking bar on a slot that did not change is
  `ambiguous`, never a hero). Per slot: `locked | ambiguous | hover | empty`. Hover = no hero, no health problem.
- A hero is emitted only if `score >= 0.68` **and** `margin over runner-up >= 0.15`; a flat slot never matches. Each hero
  has two references, the clean portrait and the portrait under a synthesized human-lobby rank banner (0.15 x portrait +
  BGR 52,52,78 over rows 0.62-0.95); its score is the better of the two, over the whole card (no region-only matching).
- **Recovery of a stable sub-threshold lock (`stability.py`, `RecoveryPolicy`).** The normal threshold is untouched. A
  **locked** card whose best candidate is just under 0.68 but clearly ahead of the runner-up is confirmed by a second,
  slower proof: the SAME candidate, **every frame** `score >= 0.60` and `margin >= 0.15`, for **>= 1.0 s and >= 6
  frames** (> 2x the normal 350 ms / 3 frames, < the 1.5 s unread grace, so a recovered card never flashes
  `VISUAL_SLOTS_UNREAD`). It only fills an unconfirmed pick slot; a hero already confirmed -- or being read as a candidate --
  in another slot is never taken; any dip, other hero or empty/unreadable frame restarts the run. Never reached by a
  hover/ambiguous/empty card (they are not matched at all). Origin: draft 0374e6d9, Phantom Assassin 0.634 / 0.269 and
  Mars 0.675 / 0.203, both correct and static for 30-90 s, left the whole draft `VISUAL_SLOTS_UNREAD`. Recovered picks log
  `recovered: true`. `StabilityFilter(recovery=None)` is the old behaviour. The calibration rationale is in `stability.py`.
- **Health (`session._health`).** Frame/layout verified = armed baseline + readable frame + a card bar on >= 9 of the 10
  cards. Verified and no locked card unread -> `VISUAL_OK`, **including an empty or hover-only draft** (zero picks is a
  readable draft; the Team Coach may recommend from the start). When GSI opens a draft the helper stays SILENT while its
  first baseline arms (~0.9 s at 8 fps, at most 1.5 s) instead of saying `VISUAL_LAYOUT_UNVERIFIED`, so an empty hero
  selection never flickers to "incomplete"; it never says OK before the baseline is verified. A locked card still unread
  (or an ambiguous card) after 1.5 s -> `VISUAL_SLOTS_UNREAD` (the engine then refuses to recommend). A frame that is black / partial / not the hero-selection bar never yields a fresh OK: the
  previous word is retained (silently) for at most 1.5 s, then `VISUAL_LAYOUT_UNVERIFIED` -- the engine can never hold
  a stale OK. Unknown beats wrong.
- A hero is **confirmed** only after 3 consecutive frames spanning >= 350 ms. Flicker creates nothing. A
  confirmed slot that stably changes yields `pick_reverted` + new `hero_picked`. Unreadable frames never revert.
- Screen slot order is **not** Pos 1-5. Nothing here sends a position.
- Allowlist (`emit.assert_allowlisted`) runs on every envelope: hero id, side, pick/ban, confidence, health code.
- The engine accepts only `hero_picked | pick_reverted | hero_banned | capture_health` on this channel, bound to
  the link's session; GSI keeps lifecycle, our side and our own hero. Same hero from both = one pick.

## Local evidence (`save-frames.flag`)

With the flag file `%LOCALAPPDATA%/D2KIRO/Visual/save-frames.flag` present, and only then, the helper keeps -- locally,
never uploaded -- per draft epoch (the budget restarts every draft; 0.1.2 kept 30 frames per PROCESS): strip PNGs of the
top bar on a lock-state change / ambiguity / health change / hero confirmation / every 10 s (last 6 flushed at close), and
FULL frames across hero selection AND strategy time: `armed`, `firstlock`, `lastreadable`, `closed`; `periodic` every 2 s
for the first 90 s (the ban phase) then every 6 s; `lock` at every lock change / confirmation / revert; `unread` when a card
is ambiguous or the health leaves OK; `tail` (the last frames before the close). Each saved frame is logged
(`frame_saved`, label + file + time). `frames/` is pruned to 768 MB, oldest draft epoch first -- run
`scripts/live/evidence/collect.py` after a match to freeze it. Per slot, the JSONL carries `side`, `i`, `locked`/`lockstate`,
`chroma` (`top`/`bot`), `dist`/`thr`, `cand`, `score`, `runnerUp`, `margin`, `stab` (candidate, frames, ms) and `confirmed`,
once a second AND on every transition (`triggers`), plus a `pick` / `revert` event per confirmed fact.

**Incident recorder (`incidents.py`).** On top of the per-draft schedule above, a ring of the last 5 FULL frames is kept in
memory only (one every 0.5 s) and written to disk around an incident: the 5 frames before, the frame that tripped it and the
next 6. Triggers: a locked card whose best candidate sits under `min_score` for >= 1 s (`subthreshold`), a locked card nobody
can name (`uncertain`), `VISUAL_SLOTS_UNREAD`, a `recovered` hero, a `reverted` pick, and a draft that closes with < 10
confirmed picks (`short_end`; `draft_end` logs `picks` and `short`). One incident per episode (the condition must clear to fire
again); a second trigger inside the post window joins the open incident. Bounded: <= 10 incidents and 256 MB per draft (+ one
`short_end`), inside the same 768 MB `frames/` cap. Files are `<run>-e<epoch>-inc-<n>-<kind>-{pre,at,post}<k>.png`; each is logged as `frame_saved`.
The helper's `start` record carries `version` (from the `manifest.json` next to the exe) so a QA can prove which build recorded it.

## Offline acceptance on the saved real corpus

```powershell
python -I acceptance/corpus_acceptance.py --corpus "$env:LOCALAPPDATA\D2KIRO\VisualCorpus"
```
Not CI (the frames are the Player's own screenshots): lock gate, matcher, negatives, session replay, health and shift gates
on the real 1600x900 Spanish-UI corpus. Evidence is primarily 1600x900 / Spanish; native 1280x720, 1920x1080 human
captures and other languages are NOT validated.

## Tests

```powershell
python -m unittest discover -s scripts/live/visual-capture/tests -v     # from the repo root
bun test apps/engine/src/live/live-visual.test.ts
bun test apps/web/app/api/live/visual-relay.test.ts
```
