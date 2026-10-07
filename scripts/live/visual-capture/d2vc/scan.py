"""One frame -> what every slot shows (hero / uncertain / empty). Pure given (frame, layout, matcher)."""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Mapping

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
    # Diagnostics only (never sent anywhere): the best candidate even when it was rejected, and why.
    candidate_id: int | None = None
    runner_up_score: float = 0.0
    reason: str = ""  # "ok" | "unoccupied" | "blank" | "below_score" | "below_margin"


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


def read_slot(side: str, index: int, crop_bgr: np.ndarray, matcher: Matcher, thresholds: Thresholds, occupied: bool | None = None) -> SlotReading:
    """`occupied=False` (the occupancy gate says the slot still looks empty) means the matcher never runs."""
    if occupied is False:
        return SlotReading(side, index, "empty", None, 0.0, 0.0, reason="unoccupied")
    if is_blank(crop_bgr):
        return SlotReading(side, index, "empty", None, 0.0, 0.0, reason="blank")
    result: MatchResult = matcher.match(crop_bgr)
    if confident(result, thresholds):
        return SlotReading(side, index, "hero", result.hero_id, result.score, result.margin, result.hero_id, result.runner_up_score, "ok")
    reason = "below_score" if result.score < thresholds.min_score else "below_margin"
    return SlotReading(side, index, "uncertain", None, result.score, result.margin, result.hero_id, result.runner_up_score, reason)


def slot_crops(frame: np.ndarray, layout: Layout) -> dict[tuple[str, int], np.ndarray]:
    height, width = frame.shape[:2]
    vp = viewport(width, height, layout.aspect)
    crops = {(side, i): crop(frame, rect, vp) for side in SIDES for i, rect in enumerate(layout.slots[side])}
    crops.update({("ban", i): crop(frame, rect, vp) for i, rect in enumerate(layout.bans)})
    return crops


def scan_frame(frame: np.ndarray, layout: Layout, matcher: Matcher, thresholds: Thresholds, occupancy: Mapping[tuple[str, int], bool] | None = None) -> ScanResult:
    """`occupancy=None` is matcher-only (lab/bench diagnostics). The live loop ALWAYS passes the gate's verdict;
    a slot missing from a given `occupancy` is treated as empty (fail closed)."""
    start = time.perf_counter()
    height, width = frame.shape[:2]
    crops = slot_crops(frame, layout)

    def read(side: str, index: int) -> SlotReading:
        occupied = None if occupancy is None else bool(occupancy.get((side, index), False))
        return read_slot(side, index, crops[(side, index)], matcher, thresholds, occupied)

    rows = {side: tuple(read(side, i) for i in range(len(layout.slots[side]))) for side in SIDES}
    bans = tuple(read("ban", i) for i in range(len(layout.bans)))
    return ScanResult(rows["radiant"], rows["dire"], bans, (time.perf_counter() - start) * 1000, (width, height))
