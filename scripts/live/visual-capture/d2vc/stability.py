"""Temporal confirmation: a single frame is never draft truth.

A slot's hero is CONFIRMED only after the same hero was read in `min_frames` consecutive frames spanning at
least `min_ms`. A confirmed slot that later stably shows a DIFFERENT hero yields `revert` + the new `pick`
(the engine removes the old fact). Unreadable/empty frames reset the candidate but never revert a
confirmed pick (a transition or overlay is not evidence that the pick changed). Pure: time is a parameter.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .scan import ScanResult, SlotReading


@dataclass(frozen=True)
class VisualEvent:
    kind: str  # "pick" | "revert" | "ban"
    side: str  # "radiant" | "dire" | "ban"
    hero_id: int
    confidence: float
    slot: int  # screen slot index, informational only (NOT a Dota position)


@dataclass
class _Track:
    candidate: int | None = None
    frames: int = 0
    strong_frames: int = 0  # frames of this streak that passed the global gate (not only the overlay path)
    since_ms: float = 0.0
    score_sum: float = 0.0
    confirmed: int | None = None


@dataclass
class StabilityFilter:
    min_frames: int = 3
    min_ms: float = 350.0
    # A hero seen ONLY through the narrow overlay path (human-lobby cards under a rank medal / name strip) must stay
    # the same candidate much longer: a transient (menu, tooltip, hover) does not last this long.
    overlay_min_frames: int = 6
    overlay_min_ms: float = 3000.0
    tracks: dict[tuple[str, int], _Track] = field(default_factory=dict)

    def confirmed(self) -> dict[tuple[str, int], int]:
        return {key: t.confirmed for key, t in self.tracks.items() if t.confirmed is not None}

    def update(self, scan: ScanResult, now_ms: float) -> list[VisualEvent]:
        events: list[VisualEvent] = []
        for reading in scan.readings:
            events.extend(self._update_slot(reading, now_ms))
        return events

    def _held_elsewhere(self, hero: int, side: str, index: int) -> bool:
        """A hero cannot sit in two pick slots (or be both picked and in a second slot)."""
        if side == "ban":
            return False
        return any(t.confirmed == hero and key != (side, index) for key, t in self.tracks.items() if key[0] != "ban")

    def _update_slot(self, reading: SlotReading, now_ms: float) -> list[VisualEvent]:
        track = self.tracks.setdefault((reading.side, reading.index), _Track())
        hero = reading.hero_id if reading.state == "hero" else None
        if hero is None:
            track.candidate, track.frames, track.strong_frames, track.score_sum = None, 0, 0, 0.0
            return []
        if hero != track.candidate:
            track.candidate, track.frames, track.strong_frames, track.since_ms, track.score_sum = hero, 0, 0, now_ms, 0.0
        track.frames += 1
        track.strong_frames += reading.tier == "strong"
        # An overlay read's full-crop score is depressed by the overlay itself; the engine treats confidence < 0.6 as
        # "unconfirmed", so report the better of the two views (both measured, neither invented).
        track.score_sum += max(reading.score, reading.upper_score)
        elapsed = now_ms - track.since_ms
        strong_ok = track.strong_frames >= self.min_frames and elapsed >= self.min_ms
        overlay_ok = track.frames >= self.overlay_min_frames and elapsed >= self.overlay_min_ms
        if hero == track.confirmed or not (strong_ok or overlay_ok):
            return []
        if self._held_elsewhere(hero, reading.side, reading.index):
            return []
        confidence = round(min(1.0, track.score_sum / track.frames), 3)
        if reading.side == "ban":
            track.confirmed = hero
            return [VisualEvent("ban", "ban", hero, confidence, reading.index)]
        out: list[VisualEvent] = []
        if track.confirmed is not None:
            out.append(VisualEvent("revert", reading.side, track.confirmed, 1.0, reading.index))
        out.append(VisualEvent("pick", reading.side, hero, confidence, reading.index))
        track.confirmed = hero
        return out
