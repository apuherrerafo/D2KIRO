# D2KIRO Companion V0

The small Windows background app that keeps Dota 2 connected to D2KIRO without anyone running a command.
Branch `feat/companion-v0` (off `staging/private-beta-1`). Not merged, not deployed.

## What the player does

**Once:** run `instalar-d2kiro-companion.cmd` (double-click). If Steam does not already have it, add
`-gamestateintegration` to Dota 2's launch options. If Dota was open during the install, restart it once.

**Every day after that:** open D2KIRO in the browser, open Dota 2, queue. Nothing else.

The Companion starts with Windows (HKCU `Run`, no admin rights) and has no window (`conhost --headless`). It
reconnects on its own after Dota, the browser or the network restart. Uninstall from Windows Settings → Apps →
D2KIRO Companion.

## Architecture

```
Dota 2 ──GSI──▶ http://127.0.0.1:53120/gsi ──▶ Companion ──HTTPS──▶ /api/live/gsi/<liveId>         (unchanged ingest)
  (local token)                                (link token, DPAPI)  /api/live/companion/<liveId>   (heartbeat, new)
                                                     │
                                                     └─▶ %LOCALAPPDATA%\D2KIRO\Companion\diagnostics\  (local only)
```

- **Runtime:** Windows PowerShell 5.1 + .NET Framework 4, which every Windows 10/11 already has, so there is nothing
  else to install. Same reasoning as the existing GSI installer (`apps/web/lib/gsi-windows-installer.ts`).
- **Pairing:** the existing per-account GSI link (liveId + token). In order of preference: the link inside a personal
  download (`/api/live/companion-installer`), then a D2KIRO site cfg already in Dota (adopted), then the previous
  pairing. At runtime a freshly downloaded site cfg (`Descargar instalador para Windows`) is adopted within 30 s,
  so re-pairing is just downloading again.
- **What leaves the PC:** exactly the sections D2KIRO's own cfg always sent (provider, map, player, hero, draft,
  abilities, items). Every other section Dota now reports (wearables, minimap, events, …) stays local.
- **Server change:** only the heartbeat (`/api/live/companion/<liveId>`, link-authenticated, 1 KB, closed
  vocabulary), so the page can show "Companion conectado" while Dota is closed. The GSI ingest is unchanged, so the
  generic installer works against the currently deployed staging.
- **Local surface:** `127.0.0.1` only, Host header pinned (DNS rebinding). `GET /health` (no identity; CORS and
  Private-Network preflight only for the paired D2KIRO origin). `POST /relay/api/live/visual/*` lets the existing
  Python visual helper keep working: it now posts with the local token and the Companion adds the link token.

## Diagnostics (automatic, local, bounded)

- `diagnostics\gsi-raw-<run>-NNN.jsonl`: every payload outside a match, one per 2 s during a match (plus every
  state or key-set change). The local token is stripped. Files rotate at 16 MB and are capped at 160 MB in total,
  oldest deleted first. Raw payloads include your own SteamID and name, so they never leave the PC and are gitignored
  if ever copied into the repo.
- `diagnostics\inventory-latest.json`: per phase, every JSON path with counts and types only. No value is stored,
  and digits in keys are normalized to `#`.
- After a real match, a developer runs `bun scripts/live/companion/inventory-report.ts`, which prints the
  FIELD × PHASE research table. It is safe to share.

## Files

| Path | What |
|---|---|
| `apps/web/server/companion/companion-scripts.ts` | The PowerShell: shared helpers, runtime (`companion.ps1`), installer |
| `apps/web/server/companion/companion-installer.ts` | Builds the `.cmd` (personal with an embedded link / generic) |
| `apps/web/server/companion/companion-installer.test.ts` | Pure shape checks plus a real Windows run against fake Steam and a fake server |
| `apps/web/app/api/live/companion-installer/route.ts` | Personal download (session plus Origin check, rotates the link) |
| `apps/web/app/api/live/companion/[liveId]/route.ts` | Public heartbeat relay (same door as GSI and visual) |
| `apps/engine/src/server/routes/live-gsi.ts` | `postCompanion` and `parseCompanionHeartbeat` |
| `apps/engine/src/live/live-capture-registry.ts` | `noteCompanion`, `status().companion` |
| `apps/web/features/team-coach/*` | Status mirror, COMPANION and PHASE pills, the "Instalar D2KIRO Companion" button |
| `scripts/live/visual-capture/d2vc/gsicfg.py` | The visual helper follows the Companion's local relay |
| `scripts/live/companion/build-installer.ts` | Writes the generic installer to `out/` (gitignored) |
| `scripts/live/companion/inventory-report*.ts` | Inventory → research report |

## Tests

```
cd apps/web && bun test server/companion        # real cmd.exe + PowerShell on Windows; pure checks anywhere
bun test apps/engine/src/server/routes/live-gsi.test.ts
bun test scripts/live/companion
python -m unittest discover -s scripts/live/visual-capture/tests
```

## Known limits (V0)

- Unsigned script: SmartScreen or Smart App Control may warn or block it, the same as the existing GSI installer.
  Antivirus heuristics may also dislike a hidden PowerShell that starts at logon. Not observed yet.
- No tray icon: silent background only. Status is visible on the web page and at `http://127.0.0.1:53120/health`.
- The launch option `-gamestateintegration` is not set automatically, because that would mean editing Steam's
  per-account `localconfig.vdf`.
- If the process crashes, it comes back at the next Windows logon (no service or watchdog in V0).
- The web page detects the Companion through the server heartbeat, not the localhost probe. Chrome's Local Network
  Access would prompt every visitor, and the TSK-214 gate forbids loopback calls from browser code. The local
  `/health` endpoint is ready for a deliberate opt-in probe later.
- The Python visual helper is not started by the Companion: it needs a Python install.
