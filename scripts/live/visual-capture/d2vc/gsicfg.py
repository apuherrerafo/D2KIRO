"""Reuse the Dota GSI link the Player already installed: its cfg carries the https origin, the live id and the
link token, so the visual helper needs NO extra setup and no secret on a command line.

The token is read into memory only. It is never printed, logged or written anywhere by this helper.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

CFG_FILENAME = "gamestate_integration_d2kiro.cfg"
URI = re.compile(r'"uri"\s+"(https://[^"\s]+)/api/live/gsi/([A-Za-z0-9_-]{43})"')
TOKEN = re.compile(r'"token"\s+"([0-9a-f]{64})"')
COMMON_DIRS = (
    r"C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration",
    r"C:\Program Files\Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration",
    r"D:\SteamLibrary\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration",
)


@dataclass(frozen=True)
class GsiLink:
    base_url: str
    live_id: str
    token: str


def parse_cfg(text: str) -> GsiLink | None:
    uri, token = URI.search(text), TOKEN.search(text)
    if not uri or not token:
        return None
    return GsiLink(uri.group(1), uri.group(2), token.group(1))


def find_cfg() -> Path | None:
    explicit = os.environ.get("D2KIRO_GSI_CFG")
    candidates = [Path(explicit)] if explicit else [Path(d) / CFG_FILENAME for d in COMMON_DIRS]
    return next((p for p in candidates if p.is_file()), None)


def load_link() -> GsiLink | None:
    path = find_cfg()
    return parse_cfg(path.read_text(encoding="utf-8", errors="ignore")) if path else None
