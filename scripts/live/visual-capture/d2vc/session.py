"""The visual capture session: frames in, `draft-event/v1` envelopes + a one-line status out.

Pure orchestration over (scan -> temporal confirmation -> allowlisted envelopes). Frames, time and the
network are all injected, so the whole thing is tested without a screen, a clock or a server.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .emit import EnvelopeFactory
from .layout import Layout
from .matcher import Matcher, Thresholds
from .scan import ScanResult, scan_frame
from .stability import StabilityFilter

LOST_AFTER_MS = 3_000.0
HEARTBEAT_EVERY_MS = 5_000.0


@dataclass
class VisualStatus:
    window_found: bool = False
    selection_detected: bool = False
    recognized: int = 0
    confirmed: int = 0
    latency_ms: float = 0.0
    layout: str = "standard"

    def line(self) -> str:
        if not self.window_found:
            return "Visual capture: looking for the Dota window..."
        if self.confirmed == 0 and not self.selection_detected:
            return "Visual capture: Dota window found - waiting for hero selection"
        return f"Visual capture: Dota window found - {self.confirmed}/10 heroes recognized"


class VisualSession:
    def __init__(self, matcher: Matcher, layout: Layout, thresholds: Thresholds, factory: EnvelopeFactory, stability: StabilityFilter | None = None) -> None:
        self.matcher, self.layout, self.thresholds, self.factory = matcher, layout, thresholds, factory
        self.stability = stability or StabilityFilter()
        self.status = VisualStatus(layout=layout.status)
        self._last_frame_ms: float | None = None
        self._lost = False
        self._last_heartbeat_ms: float | None = None
        self._first_seen_ms: dict[tuple[str, int, int], float] = {}

    def process(self, frame: np.ndarray, now_ms: float) -> list[dict]:
        """One captured frame -> the envelopes it confirms (usually none)."""
        out: list[dict] = []
        self._last_frame_ms = now_ms
        self.status.window_found = True
        if self._lost:
            self._lost = False
            out.append(self.factory.health("ok", "VISUAL_OK"))
            self._last_heartbeat_ms = now_ms
        scan: ScanResult = scan_frame(frame, self.layout, self.matcher, self.thresholds)
        self._note_first_seen(scan, now_ms)
        events = self.stability.update(scan, now_ms)
        self.status.recognized = scan.recognized
        self.status.selection_detected = scan.recognized > 0 or len(self.stability.confirmed()) > 0
        self.status.confirmed = sum(1 for key in self.stability.confirmed() if key[0] != "ban")
        for event in events:
            envelope = self.factory.from_event(event)
            out.append(envelope)
            if event.kind == "pick":
                first = self._first_seen_ms.get((event.side, event.slot, event.hero_id), now_ms)
                self.status.latency_ms = now_ms - first
        if self._last_heartbeat_ms is None or now_ms - self._last_heartbeat_ms >= HEARTBEAT_EVERY_MS:
            out.append(self.factory.health("ok", "VISUAL_OK"))
            self._last_heartbeat_ms = now_ms
        return out

    def _note_first_seen(self, scan: ScanResult, now_ms: float) -> None:
        for reading in scan.readings:
            if reading.state == "hero" and reading.hero_id is not None:
                self._first_seen_ms.setdefault((reading.side, reading.index, reading.hero_id), now_ms)

    def tick_no_frame(self, now_ms: float, window_found: bool) -> list[dict]:
        """Called when the backend delivered nothing. Loss is REPORTED, never filled in with guesses."""
        self.status.window_found = window_found
        if not window_found:
            self.status.selection_detected = False
        last = self._last_frame_ms
        if self._lost or (last is not None and now_ms - last < LOST_AFTER_MS) or (last is None and window_found):
            return []
        self._lost = True
        detail = "VISUAL_CAPTURE_LOST" if last is not None else "VISUAL_NO_WINDOW"
        return [self.factory.health("lost" if last is not None else "degraded", detail)]
