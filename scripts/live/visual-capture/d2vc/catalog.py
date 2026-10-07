"""Hero portrait catalog: the reference set the matcher compares against.

`fetch_catalog` is a one-time DEV step (it downloads the public hero portraits from Valve's CDN into the
gitignored `local/` folder). Nothing here runs in the live loop, and nothing in `local/` is committed.
"""
from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .paths import resource_root

ROOT = resource_root()
LOCAL = ROOT / "local"
OPENDOTA_HERO_STATS = "https://api.opendota.com/api/heroStats"
CDN_HOSTS = ("https://cdn.cloudflare.steamstatic.com", "https://cdn.akamai.steamstatic.com")
USER_AGENT = "Mozilla/5.0 d2kiro-visual-lab"


@dataclass(frozen=True)
class Hero:
    id: int
    name: str
    localized_name: str


@dataclass
class Catalog:
    heroes: list[Hero]
    portraits: dict[int, np.ndarray]  # hero id -> BGR image (landscape, 256x144 from the CDN)

    def name_of(self, hero_id: int) -> str:
        for hero in self.heroes:
            if hero.id == hero_id:
                return hero.localized_name
        return f"#{hero_id}"


MIN_HEROES = 100  # a catalog missing more than a handful of heroes is a failed download, not a catalog


def catalog_ready(dest: Path) -> bool:
    return (dest / "catalog.json").is_file() and sum(1 for _ in (dest / "portraits").glob("*.png")) >= MIN_HEROES


def resolve_catalog_dir() -> Path:
    """A catalog shipped next to the code (dev checkout), else the Player's local copy (downloaded once, first run)."""
    from .paths import user_data_dir

    return LOCAL if catalog_ready(LOCAL) else user_data_dir() / "catalog"


def _get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def fetch_catalog(dest: Path = LOCAL) -> int:
    """Download every hero portrait. Returns how many were stored. Network: dev step only."""
    (dest / "portraits").mkdir(parents=True, exist_ok=True)
    stats = json.loads(_get(OPENDOTA_HERO_STATS))
    heroes = []
    for entry in stats:
        hero_id, img = int(entry["id"]), str(entry["img"]).split("?")[0]
        target = dest / "portraits" / f"{hero_id}.png"
        if not target.exists():
            data = None
            for host in CDN_HOSTS:
                try:
                    data = _get(host + img)
                    break
                except Exception:  # noqa: BLE001 - try the next CDN host
                    continue
            if data is None:
                continue
            target.write_bytes(data)
        heroes.append({"id": hero_id, "name": entry["name"], "localizedName": entry["localized_name"]})
    (dest / "catalog.json").write_text(json.dumps(heroes, indent=1), encoding="utf-8")
    return len(heroes)


def load_catalog(dest: Path = LOCAL) -> Catalog:
    listing = json.loads((dest / "catalog.json").read_text(encoding="utf-8"))
    heroes: list[Hero] = []
    portraits: dict[int, np.ndarray] = {}
    for row in listing:
        image = cv2.imread(str(dest / "portraits" / f"{row['id']}.png"), cv2.IMREAD_COLOR)
        if image is None:
            continue
        if image.shape[:2] != (144, 256):
            image = cv2.resize(image, (256, 144), interpolation=cv2.INTER_AREA)
        heroes.append(Hero(int(row["id"]), row["name"], row["localizedName"]))
        portraits[int(row["id"])] = image
    return Catalog(heroes, portraits)
