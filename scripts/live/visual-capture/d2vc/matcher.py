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
# Human lobbies draw a rank medal + the player-name strip over the LOWER half of every card (and darken it). The upper
# half stays clean: thumbnail rows above this index are the "upper view" used to corroborate a weak full-crop match.
UPPER_ROWS = 11
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
    # Secondary "overlay" path (see `overlay_confident`). `overlay_score=None` switches it off.
    overlay_score: float | None = 0.45
    overlay_margin: float = 0.20
    upper_score: float = 0.55
    upper_margin: float = 0.20
    # Hover previews and hidden-enemy silhouettes are dimmed greys (upper-half contrast ~13-22 on real 1600x900
    # frames); a revealed portrait is far above (>= 33, the weak human/bot cases ~52-55).
    upper_min_std: float = 35.0


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


def _upper_vector(thumb: np.ndarray) -> np.ndarray:
    """Same mean-centred NCC vector, but only over the upper rows of the thumbnail (no rank medal / name strip)."""
    return _ncc_vector(thumb[:UPPER_ROWS])


class Matcher:
    def __init__(self, catalog: Catalog, hist_weight: float = 0.0) -> None:
        self.hist_weight = hist_weight
        self.ids: list[int] = []
        ncc_rows: list[np.ndarray] = []
        hist_rows: list[np.ndarray] = []
        upper_rows: list[np.ndarray] = []
        owners: list[int] = []
        for index, (hero_id, portrait) in enumerate(catalog.portraits.items()):
            self.ids.append(hero_id)
            for zoom, dx, dy in VARIANTS:
                thumb = _thumb(crop_region(portrait, zoom, dx, dy))
                ncc_rows.append(_ncc_vector(thumb))
                hist_rows.append(_hist_vector(thumb))
                upper_rows.append(_upper_vector(thumb))
                owners.append(index)
        self._ncc = np.stack(ncc_rows)
        self._hist = np.stack(hist_rows)
        self._upper = np.stack(upper_rows)
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

    def _result(self, per_hero: np.ndarray) -> MatchResult:
        order = np.argsort(per_hero)[::-1][:3]
        top = [(self.ids[i], float(per_hero[i])) for i in order]
        best, second = top[0], top[1]
        return MatchResult(best[0], best[1], second[0], second[1], best[1] - second[1], tuple(top))

    def match(self, crop: np.ndarray) -> MatchResult:
        if crop is None or crop.size == 0 or crop.shape[0] < 4 or crop.shape[1] < 4:
            return MatchResult(None, 0.0, None, 0.0, 0.0, ())
        return self._result(self.scores(crop))

    def match_upper(self, crop: np.ndarray) -> MatchResult:
        """The same question asked of the UPPER half of the card only (NCC over `UPPER_ROWS` thumbnail rows)."""
        if crop is None or crop.size == 0 or crop.shape[0] < 4 or crop.shape[1] < 4:
            return MatchResult(None, 0.0, None, 0.0, 0.0, ())
        scores = self._upper @ _upper_vector(_thumb(crop_region(crop)))
        per_hero = np.full(len(self.ids), -1.0, dtype=np.float32)
        np.maximum.at(per_hero, self._owners, scores)
        return self._result(per_hero)


def confident(result: MatchResult, thresholds: Thresholds) -> bool:
    return result.hero_id is not None and result.score >= thresholds.min_score and result.margin >= thresholds.min_margin


def upper_contrast(crop: np.ndarray) -> float:
    """Pixel standard deviation (gray levels) of the upper half of the card."""
    if crop is None or crop.size == 0:
        return 0.0
    upper = crop[: max(1, crop.shape[0] // 2)]
    gray = cv2.cvtColor(upper, cv2.COLOR_BGR2GRAY) if upper.ndim == 3 else upper
    return float(np.std(gray.astype(np.float32)))


def overlay_read(result: MatchResult, crop: np.ndarray, matcher: Matcher, thresholds: Thresholds) -> MatchResult | None:
    """Secondary, narrow path for cards a human lobby partly covers (rank medal, name strip, dimming): the full-crop
    score is depressed although the portrait is right. NOT a lower global threshold -- it needs ALL of:
      - a strong margin over the runner-up on the full crop (placeholders / menus have almost none),
      - the SAME hero from an independent view of the clean upper half, also with a strong margin,
      - a revealed, full-contrast upper half (not a dimmed hover preview / hidden-enemy silhouette),
    and callers additionally require a longer temporal confirmation (`StabilityFilter.overlay_min_*`).
    Returns the upper-half match that vouched for the hero (its score is the honest confidence of an overlay read), else None."""
    if thresholds.overlay_score is None or result.hero_id is None:
        return None
    if result.score < thresholds.overlay_score or result.margin < thresholds.overlay_margin:
        return None
    if upper_contrast(crop) < thresholds.upper_min_std:
        return None
    upper = matcher.match_upper(crop)
    if upper.hero_id == result.hero_id and upper.score >= thresholds.upper_score and upper.margin >= thresholds.upper_margin:
        return upper
    return None


def is_blank(crop: np.ndarray, min_std: float = 6.0) -> bool:
    """A flat/empty slot has almost no pixel variation: there is nothing to match."""
    if crop is None or crop.size == 0:
        return True
    return float(np.std(crop.astype(np.float32))) < min_std


def match_many(matcher: Matcher, crops: Iterable[np.ndarray]) -> list[MatchResult]:
    return [matcher.match(crop) for crop in crops]
