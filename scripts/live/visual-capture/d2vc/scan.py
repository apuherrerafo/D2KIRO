"""One frame -> what every slot shows (hero / uncertain / empty). Pure given (frame, layout, matcher)."""
from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from .layout import SIDES, Layout, crop, viewport
from .matcher import Matcher, MatchResult, Thresholds, confident, is_blank


@dataclass(frozen=True)
class SlotReading:
    side: str  # "radiant" | "dire" | "ban"
    index: int  # 0-based position on screen (NOT a Dota position 1-5)
    state: str  # "hero" | "uncertain" | "empty"
    hero_id: int | None
    score: float
    margin: float


@dataclass(frozen=True)
class ScanResult:
    radiant: tuple[SlotReading, ...]
    dire: tuple[SlotReading, ...]
    bans: tuple[SlotReading, ...]
    elapsed_ms: float
    frame_size: tuple[int, int]

    @property
    def readings(self) -> tuple[SlotReading, ...]:
        return self.radiant + self.dire + self.bans

    @property
    def recognized(self) -> int:
        return sum(1 for r in self.radiant + self.dire if r.state == "hero")


def read_slot(side: str, index: int, crop_bgr: np.ndarray, matcher: Matcher, thresholds: Thresholds) -> SlotReading:
    if is_blank(crop_bgr):
        return SlotReading(side, index, "empty", None, 0.0, 0.0)
    result: MatchResult = matcher.match(crop_bgr)
    if confident(result, thresholds):
        return SlotReading(side, index, "hero", result.hero_id, result.score, result.margin)
    return SlotReading(side, index, "uncertain", None, result.score, result.margin)


def scan_frame(frame: np.ndarray, layout: Layout, matcher: Matcher, thresholds: Thresholds) -> ScanResult:
    start = time.perf_counter()
    height, width = frame.shape[:2]
    vp = viewport(width, height, layout.aspect)
    rows = {side: tuple(read_slot(side, i, crop(frame, rect, vp), matcher, thresholds) for i, rect in enumerate(layout.slots[side])) for side in SIDES}
    bans = tuple(read_slot("ban", i, crop(frame, rect, vp), matcher, thresholds) for i, rect in enumerate(layout.bans))
    return ScanResult(rows["radiant"], rows["dire"], bans, (time.perf_counter() - start) * 1000, (width, height))
