"""Before asking for the next human Ranked match: is visual 0.1.3-rc1 really installed and alive on THIS PC?

    python -I scripts/live/rc/rc1_preflight.py

Read-only. Prints one line per check and READY / NOT_READY. Never prints a token, a live id or an account id.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

RC_VERSION = "0.1.3-rc1"
LOCAL = Path(os.environ.get("LOCALAPPDATA", "."))
APP = LOCAL / "D2KIRO" / "Companion"
VISUAL = LOCAL / "D2KIRO" / "Visual"
CFG_NAME = "gamestate_integration_d2kiro.cfg"


def check(name: str, ok: bool, detail: str) -> bool:
    print(f"{'PASS' if ok else 'FAIL'}  {name:<34} {detail}")
    return ok


def processes() -> list[tuple[str, str]]:
    script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('powershell.exe','d2kiro-visual.exe','dota2.exe') } | ForEach-Object { $_.Name + '|' + $_.ExecutablePath + '|' + $_.CommandLine }"
    out = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True, timeout=60).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3:
            rows.append((parts[0], parts[1] + " " + parts[2]))
    return rows


def dota_cfgs() -> list[Path]:
    """Every D2KIRO GSI cfg under the Steam libraries (registry SteamPath + libraryfolders.vdf)."""
    roots: list[Path] = []
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
            roots.append(Path(winreg.QueryValueEx(key, "SteamPath")[0]))
    except OSError:
        pass
    libraries = list(roots)
    for root in roots:
        vdf = root / "steamapps" / "libraryfolders.vdf"
        if vdf.exists():
            libraries += [Path(p.replace("\\\\", "\\")) for p in re.findall(r'"path"\s+"([^"]+)"', vdf.read_text(encoding="utf-8", errors="replace"))]
    found = []
    for library in dict.fromkeys(libraries):
        cfg = library / "steamapps" / "common" / "dota 2 beta" / "game" / "dota" / "cfg" / "gamestate_integration" / CFG_NAME
        if cfg.exists():
            found.append(cfg)
    return found


def main() -> int:
    results = []
    runtime = APP / "companion.ps1"
    text = runtime.read_text(encoding="utf-8-sig", errors="replace") if runtime.exists() else ""
    results.append(check("Companion runtime is the RC", f"VisualVersion = '{RC_VERSION}'" in text and "Write-DraftRawLine" in text and "Protect-RawLine" in text, str(runtime)))
    results.append(check("rollback copy kept", (APP / "companion.ps1.pre-rc1").exists(), "companion.ps1.pre-rc1"))
    manifest = APP / "visual" / RC_VERSION / "manifest.json"
    version = json.loads(manifest.read_text(encoding="utf-8")).get("version") if manifest.exists() else None
    results.append(check("RC visual build installed", version == RC_VERSION, f"visual/{RC_VERSION} manifest={version}"))

    procs = processes()
    companion = [cmd for name, cmd in procs if name == "powershell.exe" and str(runtime).lower() in cmd.lower()]
    helper = [cmd for name, cmd in procs if name == "d2kiro-visual.exe"]
    results.append(check("Companion process running", len(companion) == 1, f"{len(companion)} process(es)"))
    results.append(check("RC helper running (only the RC)", len(helper) == 1 and f"\\visual\\{RC_VERSION}\\" in helper[0], f"{len(helper)} helper(s)" + (" -- " + ("rc" if helper and RC_VERSION in helper[0] else "NOT the RC") if helper else "")))
    dota_open = any(name == "dota2.exe" for name, _ in procs)

    port = json.loads((APP / "config.json").read_text(encoding="utf-8-sig")).get("port") if (APP / "config.json").exists() else None
    health = None
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=4) as response:
            health = json.loads(response.read(8192))
    except Exception:  # noqa: BLE001
        health = None
    results.append(check("Companion /health", bool(health) and health.get("paired") is True and health.get("cfgInstalled") is True and health.get("visual") == "running", "paired={} cfgInstalled={} visual={} liveSession={} heartbeat={}".format(*(None if not health else health.get(k) for k in ("paired", "cfgInstalled", "visual", "liveSession", "heartbeat")))))

    cfgs = dota_cfgs()
    minimap = bool(cfgs) and all(re.search(r'"minimap"\s+"1"', cfg.read_text(encoding="utf-8", errors="replace")) for cfg in cfgs)
    local = bool(cfgs) and all("127.0.0.1" in cfg.read_text(encoding="utf-8", errors="replace") for cfg in cfgs)
    results.append(check("Dota cfg asks for minimap (local)", minimap and local, f"{len(cfgs)} cfg(s), points at the Companion={local}"))

    results.append(check("save-frames.flag (local evidence on)", (VISUAL / "save-frames.flag").exists(), str(VISUAL / "save-frames.flag")))
    catalog = VISUAL / "catalog" / "catalog.json"
    heroes = len(json.loads(catalog.read_text(encoding="utf-8"))) if catalog.exists() else 0
    portraits = len(list((VISUAL / "catalog" / "portraits").glob("*"))) if (VISUAL / "catalog" / "portraits").exists() else 0
    results.append(check("hero catalog on this PC", heroes >= 120 and portraits >= 120, f"{heroes} heroes / {portraits} portraits"))
    free = shutil.disk_usage(LOCAL).free / 2**30
    results.append(check("disk space for evidence", free >= 5, f"{free:.0f} GB free (frames <= 768 MB, draft raw <= 8 x 64 MB)"))

    records = []
    newest = sorted((VISUAL / "diagnostics").glob("visual-*.jsonl"), key=lambda p: p.stat().st_mtime)[-1:] if (VISUAL / "diagnostics").exists() else []
    for path in newest:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                records.append(json.loads(line))
            except ValueError:
                pass
    kinds = {r.get("kind") for r in records}
    results.append(check("RC helper: frozen build, catalog, relay", {"start", "catalog", "credentials"} <= kinds and any(r.get("kind") == "start" and r.get("frozen") for r in records) and any(r.get("target") == "local_relay" for r in records), ", ".join(sorted(k for k in kinds if k in ("start", "catalog", "credentials", "server_seen", "window_found")))))
    results.append(check("RC helper reached D2KIRO (lifecycle ack)", "server_seen" in kinds, "server_seen" if "server_seen" in kinds else "no ack yet (needs the Dota window -- open Dota to finish this check)"))
    print(f"\nDota 2 open: {dota_open}")
    ready = all(results)
    print(f"RC1 LOCAL INSTALL: {'READY' if ready else 'NOT_READY'}")
    return 0 if ready else 1


if __name__ == "__main__":
    sys.exit(main())
