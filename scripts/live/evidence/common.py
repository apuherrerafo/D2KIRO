"""Shared helpers for the local evidence tools (offline, the Player's PC only).

Nothing here ever outputs a coordinate, a SteamID, an account id or a player name: GSI lines are passed through
`redact_payload` before anything is copied, and the readers only extract the fields each report needs.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Iterable, Iterator

PHASE_OF_STATE = {
    "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD": "LOADING",
    "DOTA_GAMERULES_STATE_HERO_SELECTION": "HERO_SELECTION",
    "DOTA_GAMERULES_STATE_PLAYER_DRAFT": "HERO_SELECTION",
    "DOTA_GAMERULES_STATE_STRATEGY_TIME": "STRATEGY_TIME",
    "DOTA_GAMERULES_STATE_TEAM_SHOWCASE": "SHOWCASE",
    "DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD": "SHOWCASE",
    "DOTA_GAMERULES_STATE_PRE_GAME": "PRE_GAME",
    "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS": "MATCH",
    "DOTA_GAMERULES_STATE_POST_GAME": "POST_GAME",
}
TEAM_OF_NAME = {"radiant": 2, "dire": 3}
SIDE_OF_TEAM = {2: "radiant", 3: "dire"}
IDENTITY_KEYS = ("steamid", "accountid")
COORDINATE_KEYS = {"xpos": "hasXpos", "ypos": "hasYpos", "yaw": "hasYaw"}


def companion_diag_dir() -> Path:
    explicit = os.environ.get("D2KIRO_COMPANION_DIAG")
    if explicit:
        return Path(explicit)
    return Path(os.environ.get("LOCALAPPDATA", ".")) / "D2KIRO" / "Companion" / "diagnostics"


def visual_home() -> Path:
    explicit = os.environ.get("D2KIRO_VISUAL_HOME")
    if explicit:
        return Path(explicit)
    return Path(os.environ.get("LOCALAPPDATA", ".")) / "D2KIRO" / "Visual"


def evidence_root() -> Path:
    explicit = os.environ.get("D2KIRO_EVIDENCE_HOME")
    if explicit:
        return Path(explicit)
    return Path(os.environ.get("LOCALAPPDATA", ".")) / "D2KIRO" / "Evidence"


def parse_time(text: str) -> dt.datetime:
    """ISO-8601 UTC from either writer (.NET 'o' has 7 fractional digits; Python has 3)."""
    match = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$", text)
    if not match:
        raise ValueError(f"not an ISO time: {text!r}")
    base, fraction, zone = match.groups()
    micro = int((fraction or "0")[:6].ljust(6, "0"))
    stamp = dt.datetime.fromisoformat(base).replace(microsecond=micro)
    if zone in (None, "Z"):
        return stamp.replace(tzinfo=dt.timezone.utc)
    return stamp.replace(tzinfo=dt.datetime.fromisoformat(f"2000-01-01T00:00:00{zone}").tzinfo).astimezone(dt.timezone.utc)


def iso(stamp: dt.datetime) -> str:
    return stamp.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def read_jsonl(paths: Iterable[Path]) -> Iterator[dict]:
    for path in paths:
        try:
            handle = path.open(encoding="utf-8")
        except OSError:
            continue
        with handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue  # a line cut by a crash / rotation is not evidence
                if isinstance(row, dict):
                    yield row


def redact_payload(value: object, parent: str = "") -> object:
    """A deep copy with no identity and no coordinate (same rule as the Companion's on-disk redaction): SteamID / account
    id anywhere, a player's name, and xpos/ypos/yaw become `has*` booleans (0 = no position)."""
    if isinstance(value, dict):
        out: dict = {}
        for key, item in value.items():
            if key in IDENTITY_KEYS:
                out[key] = "redacted"
            elif key == "name" and (parent == "player" or re.fullmatch(r"player\d+", parent or "")):
                out[key] = "redacted"
            elif key in COORDINATE_KEYS:
                flag = COORDINATE_KEYS[key]
                out[flag] = bool(item) if isinstance(item, bool) else (isinstance(item, (int, float)) and item != 0)
            else:
                out[key] = redact_payload(item, key)
        return out
    if isinstance(value, list):
        return [redact_payload(item, parent) for item in value]
    return value


def load_hero_names(explicit: Path | None = None) -> dict[int, str]:
    """hero id -> internal name (npc_dota_hero_*): the visual catalog on this PC, else the repo's seed list."""
    candidates = [explicit] if explicit else [visual_home() / "catalog" / "catalog.json", Path(__file__).resolve().parents[3] / "apps" / "engine" / "src" / "meta" / "seed-heroes.json"]
    for path in candidates:
        if path is None or not path.exists():
            continue
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        names = {int(row["id"]): str(row["name"]) for row in rows if isinstance(row, dict) and isinstance(row.get("id"), int) and isinstance(row.get("name"), str)}
        if names:
            return names
    return {}


def short(name: str) -> str:
    return name.removeprefix("npc_dota_hero_")
