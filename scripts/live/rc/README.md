# visual 0.1.3-rc2 — local release candidate (one PC, one human Ranked match)

Internal name **visual 0.1.3-rc2**. Not visual-runtime 0.1.3: no tag, no GitHub release, no staging pin, nothing
deployed. Branch `rc/visual-0-1-3-rc2` (off the reviewed `fix/visual-runtime-0-1-3`, `36ef3d0`). Commits on top of it:
`rc1 content` (it was never committed) → `recovery fix` → `incident recorder + 0.1.3-rc2`.

rc2 exists because the 2026-10-16 draft (`0374e6d9`) ran on **0.1.2** (the site's Companion had been reinstalled over rc1) and
lost two correct heroes under the threshold. It does not reuse the rc1 name: every check below says `0.1.3-rc2` or fails.

## What is in it

| Area | Change |
|---|---|
| Picks | The reviewed candidate, unchanged: lock = top-bar chroma ≥ 80, locked AND occupied before any matching; plain + synthesized human-banner bank, score = max, 0.68 / 0.15; 3 frames ≥ 350 ms. A hover never emits a hero. |
| **Recovery (new vs rc1)** | A **locked** card whose candidate sits under 0.68 but holds score ≥ 0.60 and margin ≥ 0.15 on **every frame** for ≥ 1.0 s / ≥ 6 frames is confirmed by a second, slower proof (`stability.py`). Origin: Phantom Assassin 0.634 / 0.269 and Mars 0.675 / 0.203. Never takes a hero held or contested by another slot; any dip restarts it. |
| Health | Empty / hover / locked+read = `VISUAL_OK`. Locked+unread → `VISUAL_SLOTS_UNREAD` after 1.5 s. A recovered lock counts as read. The engine's fail-closed gate is untouched. |
| Raw GSI | Companion keeps every payload from loading to pre-game in `gsi-draft-*.jsonl` (newest 8 windows), redacted on disk (no SteamID / account id / name, no coordinates). |
| Visual evidence | Per-draft budget: full frames every 2 s for 90 s then every 6 s, at every lock transition, on unread/ambiguous, plus the tail; per-slot records at every transition. |
| **Incident recorder (new vs rc1)** | `d2vc/incidents.py`. A ring of the last 5 full frames lives **in memory only**; when something goes wrong it is written to disk with the frame that tripped it and the next 6 (2.5 s before, 3 s after). Triggers: a locked card with a sub-threshold candidate held ≥ 1 s (`subthreshold`), a locked card nobody can name (`uncertain`), `VISUAL_SLOTS_UNREAD`, a hero `recovered`, a pick `reverted`, and a draft that closes with < 10 picks (`short_end`, with `draft_end picks=N` logged). One incident per episode; a second trigger inside the window joins it. Needs `save-frames.flag` like every other frame. |
| **Version proof (new vs rc1)** | The helper's own `start` record carries `version` (read from the `manifest.json` next to the exe). The preflight checks it, the Companion's `/health` `visualVersion`, and the folder the running exe lives in. |

### Disk bound (all local, none uploaded)

| Store | Bound |
|---|---|
| Incident frames | ≤ 10 incidents × (5 pre + 1 + 6 post) = 120 PNGs and ≤ 256 MB per draft, + 1 `short_end` (≤ 5 PNGs) |
| `Visual\frames\` (everything) | ≤ 768 MB, oldest draft epoch first, never the running one |
| `Visual\diagnostics\*.jsonl` | ≤ 64 MB, rotating |
| `Companion\diagnostics\gsi-draft-*` | ≤ 8 windows × 64 MB; `gsi-raw-*` ≤ 160 MB |
| Memory | ≤ 5 full frames for the ring + 4 for the tail (a few tens of MB) |

## Install / check / roll back (this PC)

```powershell
bun scripts/live/rc/build-rc2.ts                                   # out\companion.ps1
cd scripts/live/visual-capture; python build_runtime.py --version 0.1.3-rc2 --out ../rc/out/visual; cd ../../..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live\rc\install-rc2.ps1    # refuses while Dota is open
python -I scripts/live/rc/rc2_preflight.py                         # every line PASS -> READY
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live\rc\rollback-rc2.ps1   # back to the Companion that was there + its 0.1.2
```

Install keeps `config.json` (pairing, DPAPI link token, local token) and the autostart entry untouched. It backs the current
`companion.ps1` up once as `companion.ps1.pre-rc2`. **If the site's Companion installer is run again, it overwrites
`companion.ps1` with the 0.1.2 pin** — that is what happened to rc1; run `rc2_preflight.py` again before every match.

## The match

Before: `rc2_preflight.py` says READY. Open D2KIRO `/live-draft` and Dota, queue Ranked. Nothing to click in the draft.

After (once the match ended, ideally after OpenDota has it):

```powershell
python -I scripts/live/evidence/collect.py            # -> %LOCALAPPDATA%\D2KIRO\Evidence\<match>\
```

## Known gap

The web diagnostics panel (`visual.runtimeVersion`) only accepts `x.y.z`, and so does the engine's heartbeat parser — a
non-numeric build such as `0.1.3-rc2` is sent as *unknown* (otherwise the engine would drop the whole heartbeat). The proof
of the runtime is therefore the Companion `/health`, the helper's `start` record and the preflight, not that panel.

## Status language

Human capture stays **UNVALIDATED / NO-GO** until a human Ranked run reaches 10/10 correct and 0 false confirmed.
Bot results never count as "pick capture works".
