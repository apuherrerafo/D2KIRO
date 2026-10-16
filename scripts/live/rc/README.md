# visual 0.1.3-rc1 — local release candidate (one PC, one human Ranked match)

Internal name **visual 0.1.3-rc1**. Not visual-runtime 0.1.3: no tag, no GitHub release, no staging pin, nothing
deployed. Branch `rc/visual-0-1-3-rc1` (off the reviewed `fix/visual-runtime-0-1-3`, `36ef3d0`).

## What is in it

| Area | Change |
|---|---|
| Picks | The reviewed candidate, unchanged: lock = top-bar chroma ≥ 80, locked AND occupied before any matching; plain + synthesized human-banner bank, score = max, 0.68 / 0.15; 3 frames ≥ 350 ms. A hover never emits a hero. |
| Health | Empty / hover / locked+read = `VISUAL_OK`. Locked+unread → `VISUAL_SLOTS_UNREAD` after 1.5 s. Unreadable frames never create a fresh OK. New: when GSI opens a draft, the helper stays silent while its first baseline arms (no `LAYOUT_UNVERIFIED` blip), so the Team Coach can recommend as soon as hero selection opens. The engine's fail-closed gate (`SLOTS_UNREAD`, `FACTS_UNRESOLVED`, `CAPTURE_PARTIAL`, rejected/deferred facts) is untouched. |
| Raw GSI | Companion keeps every payload from loading to pre-game in `gsi-draft-*.jsonl` (newest 8 windows), never rotated by match traffic; both raw stores redacted on disk (no SteamID / account id / name, no coordinates). `minimap` is still NOT forwarded upstream. |
| Visual evidence | Per-draft budget: full frames every 2 s for 90 s (ban phase), then every 6 s, at every lock transition, on unread/ambiguous, plus the tail before close; per-slot records at every transition; `pick`/`revert` events. Bounded (768 MB, oldest draft first). |
| Offline tools | `scripts/live/evidence/`: `collect.py` (freeze one match), `minimap_timeline.py`, `post_match_oracle.py`, `ban_frames.py`. |
| Overwolf | `scripts/live/overwolf-shadow/`: shadow-only probe (logs roster heroId/teamId/team_slot and bans heroId locally; sends nothing). Not part of the RC. |

## Install / check / roll back (this PC)

```powershell
bun scripts/live/rc/build-rc1.ts                                   # out\companion.ps1
cd scripts/live/visual-capture; python build_runtime.py --version 0.1.3-rc1 --out ../rc/out/visual; cd ../../..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live\rc\install-rc1.ps1    # refuses while Dota is open
python -I scripts/live/rc/rc1_preflight.py                         # every line PASS -> READY
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live\rc\rollback-rc1.ps1   # back to the site's Companion + 0.1.2
```

## The match

Before: `rc1_preflight.py` says READY. Open D2KIRO `/live-draft` and Dota, queue Ranked. Nothing to click in the draft.

After (once the match ended, ideally after OpenDota has it):

```powershell
python -I scripts/live/evidence/collect.py            # -> %LOCALAPPDATA%\D2KIRO\Evidence\<match>\
```

The package holds the redacted draft GSI, the helper's records, the draft's frames, the minimap spike report,
the oracle (picks: expected / captured / correct / missed / false confirmed; bans from OpenDota `picks_bans` when
present, else UNAVAILABLE) and the ban-region index + change map. Nothing in it is uploaded anywhere.

## Status language

Human capture stays **UNVALIDATED / NO-GO** until a human Ranked run reaches 10/10 correct and 0 false confirmed.
Bot results never count as "pick capture works".
