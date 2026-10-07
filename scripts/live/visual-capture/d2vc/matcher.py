"""Deterministic hero-portrait matcher (CPU only, no model, no GPU).

A slot crop and every reference portrait go through the same preparation (central 16:9 area, inner margin
trimmed, small BGR thumbnail). Candidates are scored against a bank of slightly shifted/zoomed reference
variants (so a few pixels of misalignment do not matter) and the best variant per hero is kept.

Score = mean-centred normalized cross-correlation of the thumbnail (colour + brightness tolerant) blended
with an HSV histogram correlation. Which blend is used was chosen by the offline benchmark (`bench.py`).

A hero is only EMITTED when `confident(result)` is true: absolute score AND margin over the runner-up.
Anything else is "uncertain" and produces no draft fact.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import cv2
import numpy as np

from .catalog import Catalog

THUMB_W, THUMB_H = 40, 22
HIST_BINS = (12, 4)
INNER_MARGIN = 0.05
# (zoom, dx, dy) of the reference variants, as a fraction of the reference size.
VARIANTS: tuple[tuple[float, float, float], ...] = tuple(
    (zoom, dx, dy) for zoom in (1.0, 0.9) for dx in (-0.04, 0.0, 0.04) for dy in (-0.04, 0.0, 0.04)
)


@dataclass(frozen=True)
class MatchResult:
    hero_id: int | None
    score: float
    runner_up_id: int | None
    runner_up_score: float
    margin: float
    top3: tuple[tuple[int, float], ...]


@dataclass(frozen=True)
class Thresholds:
    min_score: float
    min_margin: float


def crop_region(image: np.ndarray, zoom: float = 1.0, dx: float = 0.0, dy: float = 0.0, margin: float = INNER_MARGIN) -> np.ndarray:
    """Central 16:9 area of `image`, optionally zoomed/shifted, with the inner margin trimmed."""
    height, width = image.shape[:2]
    aspect = 16 / 9
    crop_w, crop_h = (width, width / aspect) if width / height < aspect else (height * aspect, height)
    crop_w, crop_h = crop_w * zoom * (1 - 2 * margin), crop_h * zoom * (1 - 2 * margin)
    cx, cy = width / 2 + dx * width, height / 2 + dy * height
    x0 = int(round(min(max(cx - crop_w / 2, 0), max(width - crop_w, 0))))
    y0 = int(round(min(max(cy - crop_h / 2, 0), max(height - crop_h, 0))))
    x1, y1 = min(width, x0 + max(2, int(round(crop_w)))), min(height, y0 + max(2, int(round(crop_h))))
    return image[y0:y1, x0:x1]


def _thumb(crop: np.ndarray) -> np.ndarray:
    return cv2.resize(crop, (THUMB_W, THUMB_H), interpolation=cv2.INTER_AREA)


def _ncc_vector(thumb: np.ndarray) -> np.ndarray:
    flat = thumb.astype(np.float32).reshape(-1, 3)
    flat = flat - flat.mean(axis=0, keepdims=True)
    vector = flat.reshape(-1)
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 1e-6 else np.zeros_like(vector)


def _hist_vector(thumb: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(thumb, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, list(HIST_BINS), [0, 180, 0, 256]).reshape(-1).astype(np.float32)
    total = float(hist.sum())
    hist = hist / total if total > 0 else hist
    root = np.sqrt(hist)  # Hellinger: dot product of roots = Bhattacharyya coefficient
    return root


class Matcher:
    def __init__(self, catalog: Catalog, hist_weight: float = 0.0) -> None:
        self.hist_weight = hist_weight
        self.ids: list[int] = []
        ncc_rows: list[np.ndarray] = []
        hist_rows: list[np.ndarray] = []
        owners: list[int] = []
        for index, (hero_id, portrait) in enumerate(catalog.portraits.items()):
            self.ids.append(hero_id)
            for zoom, dx, dy in VARIANTS:
                thumb = _thumb(crop_region(portrait, zoom, dx, dy))
                ncc_rows.append(_ncc_vector(thumb))
                hist_rows.append(_hist_vector(thumb))
                owners.append(index)
        self._ncc = np.stack(ncc_rows)
        self._hist = np.stack(hist_rows)
        self._owners = np.array(owners)

    def scores(self, crop: np.ndarray) -> np.ndarray:
        """Per-hero score in [-1, 1] (index aligned with `self.ids`)."""
        thumb = _thumb(crop_region(crop))
        ncc = self._ncc @ _ncc_vector(thumb)
        hist = self._hist @ _hist_vector(thumb)
        blended = (1 - self.hist_weight) * ncc + self.hist_weight * hist
        per_hero = np.full(len(self.ids), -1.0, dtype=np.float32)
        np.maximum.at(per_hero, self._owners, blended)
        return per_hero

    def match(self, crop: np.ndarray) -> MatchResult:
        if crop is None or crop.size == 0 or crop.shape[0] < 4 or crop.shape[1] < 4:
            return MatchResult(None, 0.0, None, 0.0, 0.0, ())
        per_hero = self.scores(crop)
        order = np.argsort(per_hero)[::-1][:3]
        top = [(self.ids[i], float(per_hero[i])) for i in order]
        best, second = top[0], top[1]
        return MatchResult(best[0], best[1], second[0], second[1], best[1] - second[1], tuple(top))


def confident(result: MatchResult, thresholds: Thresholds) -> bool:
    return result.hero_id is not None and result.score >= thresholds.min_score and result.margin >= thresholds.min_margin


def is_blank(crop: np.ndarray, min_std: float = 6.0) -> bool:
    """A flat/empty slot has almost no pixel variation: there is nothing to match."""
    if crop is None or crop.size == 0:
        return True
    return float(np.std(crop.astype(np.float32))) < min_std


def match_many(matcher: Matcher, crops: Iterable[np.ndarray]) -> list[MatchResult]:
    return [matcher.match(crop) for crop in crops]
