"""Test fixtures: a procedurally generated hero catalog. No network, no real Dota art, no local/ files."""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from d2vc.catalog import Catalog, Hero  # noqa: E402


def fake_portrait(seed: int) -> np.ndarray:
    """256x144 'portrait': smooth colour field + a few shapes. Distinct per seed, structured like art."""
    rng = np.random.default_rng(1000 + seed)
    base = rng.uniform(20, 200, size=3)
    ys, xs = np.mgrid[0:144, 0:256].astype(np.float32)
    angle = rng.uniform(0, np.pi)
    ramp = (np.cos(angle) * xs / 256 + np.sin(angle) * ys / 144)[:, :, None]
    image = base[None, None, :] + ramp * rng.uniform(-90, 90, size=3)[None, None, :]
    image = np.clip(image, 0, 255).astype(np.uint8)
    for _ in range(7):
        color = tuple(int(c) for c in rng.integers(0, 255, size=3))
        center = (int(rng.integers(20, 236)), int(rng.integers(15, 130)))
        if rng.random() < 0.5:
            cv2.circle(image, center, int(rng.integers(8, 40)), color, -1)
        else:
            cv2.rectangle(image, center, (center[0] + int(rng.integers(10, 70)), center[1] + int(rng.integers(10, 50))), color, -1)
    return cv2.GaussianBlur(image, (0, 0), 1.2)


def fake_catalog(count: int = 24) -> Catalog:
    heroes = [Hero(i + 1, f"npc_dota_hero_fake{i + 1}", f"Fake Hero {i + 1}") for i in range(count)]
    return Catalog(heroes, {hero.id: fake_portrait(hero.id) for hero in heroes})
