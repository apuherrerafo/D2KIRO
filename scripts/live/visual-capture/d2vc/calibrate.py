"""One-time layout calibration from a REAL hero-selection screenshot.

Instead of trusting hard-coded coordinates, find where already-picked heroes actually sit: run a multi-scale
template search of the known portraits inside the top band, then fit the slot grid (pitch, size, row) for
the left and right halves. The result is written as a normalized layout JSON and reused every match.

It needs a screenshot with at least 2 recognizable picked heroes on each side. If it cannot fit a grid it
says so -- it never invents one. Always inspect the `--preview` image before trusting the file.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .catalog import Catalog
from .layout import SLOTS_PER_SIDE, Layout, Rect, default_layout, layout_to_dict, viewport

BAND_HEIGHT = 0.2  # fraction of the viewport height searched (the top bar)
SLOT_WIDTHS = (0.040, 0.046, 0.052, 0.058, 0.064, 0.070, 0.078, 0.086)  # fraction of viewport width
MIN_HIT = 0.62


@dataclass(frozen=True)
class Hit:
    hero_id: int
    cx: float  # normalized to viewport
    cy: float
    w: float
    h: float
    score: float


def _find_hits(band: np.ndarray, catalog: Catalog, vw: int, vh: int) -> list[Hit]:
    gray_band = cv2.cvtColor(band, cv2.COLOR_BGR2GRAY)
    hits: list[Hit] = []
    for hero_id, portrait in catalog.portraits.items():
        gray_ref = cv2.cvtColor(portrait, cv2.COLOR_BGR2GRAY)
        for width in SLOT_WIDTHS:
            tw = int(width * vw)
            th = int(tw * 9 / 16)
            if th >= band.shape[0] or tw >= band.shape[1]:
                continue
            template = cv2.resize(gray_ref, (tw, th), interpolation=cv2.INTER_AREA)
            response = cv2.matchTemplate(gray_band, template, cv2.TM_CCOEFF_NORMED)
            _, best, _, where = cv2.minMaxLoc(response)
            if best >= MIN_HIT:
                hits.append(Hit(hero_id, (where[0] + tw / 2) / vw, (where[1] + th / 2) / vh, tw / vw, th / vh, float(best)))
    return hits


def _fit_row(hits: list[Hit], prior_first_cx: float) -> list[Rect] | None:
    """Fit 5 equally spaced slots to >=2 hits sharing a row and a size.

    Hits alone cannot say WHICH slot index the left-most hit occupies (picks fill seats, not left to right),
    so the grid is anchored by the shift that lands closest to the prior layout. Inspect the preview.
    """
    if len(hits) < 2:
        return None
    hits = sorted(hits, key=lambda h: h.score, reverse=True)
    anchor = hits[0]
    row = [h for h in hits if abs(h.cy - anchor.cy) < anchor.h * 0.35 and abs(h.w - anchor.w) < anchor.w * 0.25]
    row = sorted({h.hero_id: h for h in row}.values(), key=lambda h: h.cx)
    if len(row) < 2:
        return None
    diffs = np.diff([h.cx for h in row])
    gaps = diffs[diffs > anchor.w * 0.5]
    if gaps.size == 0:
        return None
    unit = float(gaps.min())  # smallest real gap ~ one pitch (or a multiple if a seat in between is empty)
    pitch = unit / max(1, round(unit / (anchor.w * 1.06)))
    span = int(round((row[-1].cx - row[0].cx) / pitch))
    if span > SLOTS_PER_SIDE - 1:
        return None
    shifts = range(0, SLOTS_PER_SIDE - span)
    best = min(shifts, key=lambda k: abs((row[0].cx - k * pitch) - prior_first_cx))
    first_cx = row[0].cx - best * pitch
    w, h, cy = float(np.median([r.w for r in row])), float(np.median([r.h for r in row])), float(np.median([r.cy for r in row]))
    return [Rect(first_cx + i * pitch - w / 2, cy - h / 2, w, h) for i in range(SLOTS_PER_SIDE)]


def calibrate(frame: np.ndarray, catalog: Catalog, left_side: str = "radiant") -> tuple[Layout | None, list[Hit], str]:
    """(layout | None, evidence hits, human-readable verdict)."""
    height, width = frame.shape[:2]
    vx, vy, vw, vh = viewport(width, height)
    band = frame[vy : vy + int(vh * BAND_HEIGHT), vx : vx + vw]
    hits = _find_hits(band, catalog, vw, vh)
    right_side = "dire" if left_side == "radiant" else "radiant"
    left = [h for h in hits if h.cx < 0.5]
    right = [h for h in hits if h.cx >= 0.5]
    prior = default_layout().slots
    left_row = _fit_row(left, prior["radiant"][0].x + prior["radiant"][0].w / 2)
    right_row = _fit_row(right, prior["dire"][0].x + prior["dire"][0].w / 2)
    if left_row is None or right_row is None:
        return None, hits, f"could not fit both rows (left hits={len(left)}, right hits={len(right)}); need >=2 recognizable picks per side in the top bar"
    layout = Layout(status="calibrated", slots={left_side: left_row, right_side: right_row})
    return layout, hits, "ok"


def draw_preview(frame: np.ndarray, layout: Layout) -> np.ndarray:
    out = frame.copy()
    height, width = out.shape[:2]
    vx, vy, vw, vh = viewport(width, height, layout.aspect)
    colors = {"radiant": (80, 200, 80), "dire": (80, 80, 230)}
    for side, rects in layout.slots.items():
        for index, rect in enumerate(rects):
            p0 = (vx + int(rect.x * vw), vy + int(rect.y * vh))
            p1 = (p0[0] + int(rect.w * vw), p0[1] + int(rect.h * vh))
            cv2.rectangle(out, p0, p1, colors.get(side, (200, 200, 200)), 2)
            cv2.putText(out, f"{side[0]}{index}", (p0[0] + 2, p1[1] - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, colors.get(side, (200, 200, 200)), 1, cv2.LINE_AA)
    return out


__all__ = ["calibrate", "draw_preview", "layout_to_dict", "Hit"]
