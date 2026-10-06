"""The visual capture session: frames in, `draft-event/v1` envelopes + a one-line status out.

Pure orchestration over (scan -> temporal confirmation -> allowlisted envelopes). Frames, time and the
network are all injected, so the whole thing is tested without a screen, a clock or a server.

Draft lifecycle comes from GSI, never from the screen: the helper is started BEFORE the queue and stays
closed (no baseline, no matching, no facts) through menu / lobby / matchmaking / loading. When the server's
answer says a draft started (`on_lifecycle`, new `epoch`), it re-arms by itself and takes its empty-slot
baseline on the real hero-selection screen; when the draft ends it closes again. Zero clicks in hero selection.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .emit import EnvelopeFactory
from .layout import Layout
from .matcher import Matcher, Thresholds
from .occupancy import OccupancyGate
from .scan import ScanResult, scan_frame, slot_crops
from .stability import StabilityFilter
from .transport import DraftLifecycle

LOST_AFTER_MS = 3_000.0
HEARTBEAT_EVERY_MS = 5_000.0
# Outside a draft every heartbeat is also the question "has hero selection started?": ask once a second.
LIFECYCLE_PROBE_MS = 1_000.0


@dataclass
class VisualStatus:
    window_found: bool = False
    selection_detected: bool = False
    recognized: int = 0
    confirmed: int = 0
    latency_ms: float = 0.0
    layout: str = "standard"
    armed: bool = False  # an empty baseline was observed: only now may a slot be read as a hero
    draft_open: bool = False  # GSI (via the server) says hero selection is on
    server_seen: bool = False  # the server has answered at least one draft lifecycle

    def line(self) -> str:
        if not self.window_found:
            return "Visual capture: looking for the Dota window..."
        if not self.server_seen:
            return "Visual capture: Dota window found - connecting to D2KIRO..."
        if not self.draft_open:
            return "Visual capture: Dota window found - waiting for hero selection"
        if not self.armed:
            return "Visual capture: hero selection started - reading the empty draft bar..."
        return f"Visual capture: Dota window found - {self.confirmed}/10 heroes recognized"


class VisualSession:
    def __init__(self, matcher: Matcher, layout: Layout, thresholds: Thresholds, factory: EnvelopeFactory, stability: StabilityFilter | None = None, gate: OccupancyGate | None = None) -> None:
        self.matcher, self.layout, self.thresholds, self.factory = matcher, layout, thresholds, factory
        self.stability = stability or StabilityFilter()
        self.gate = gate or OccupancyGate()
        self._frame_size: tuple[int, int] | None = None
        self.status = VisualStatus(layout=layout.status)
        self._last_frame_ms: float | None = None
        self._lost = False
        self._last_heartbeat_ms: float | None = None
        self._first_seen_ms: dict[tuple[str, int, int], float] = {}
        self._draft_epoch: int | None = None

    def on_lifecycle(self, lifecycle: DraftLifecycle | None) -> bool:
        """The server's draft lifecycle (GSI). True on a draft boundary: the caller drops queued facts.

        Entering hero selection -- or a NEW draft (epoch changed) -- re-arms from scratch, so the baseline is
        taken on THIS hero-selection screen. Leaving it closes the session. None (no answer yet / server
        unreachable) changes nothing: an open draft is not closed by a dropped request."""
        if lifecycle is None:
            return False
        self.status.server_seen = True
        if lifecycle.drafting and (not self.status.draft_open or lifecycle.epoch != self._draft_epoch):
            self.rearm()
            self.status.draft_open, self._draft_epoch = True, lifecycle.epoch
            return True
        if not lifecycle.drafting and self.status.draft_open:
            self.rearm()
            self.status.draft_open = False
            return True
        return False

    def process(self, frame: np.ndarray, now_ms: float) -> list[dict]:
        """One captured frame -> the envelopes it confirms (usually none)."""
        out: list[dict] = []
        self._last_frame_ms = now_ms
        self.status.window_found = True
        if self._lost:
            self._lost = False
            out.append(self.factory.health("ok", "VISUAL_OK"))
            self._last_heartbeat_ms = now_ms
        if not self.status.draft_open:
            # Not a draft (menu, lobby, loading, the match itself): nothing is baselined, matched or emitted.
            self.status.selection_detected = False
            if self._last_heartbeat_ms is None or now_ms - self._last_heartbeat_ms >= LIFECYCLE_PROBE_MS:
                out.append(self.factory.health("ok", "VISUAL_OK"))
                self._last_heartbeat_ms = now_ms
            return out
        size = (frame.shape[1], frame.shape[0])
        if self._frame_size is not None and size != self._frame_size:
            self.rearm()  # a different capture geometry invalidates every baseline
        self._frame_size = size
        occupancy = self.gate.update(slot_crops(frame, self.layout), now_ms)
        if occupancy.rearmed:
            self._reset_draft()
        self.status.armed = occupancy.armed
        scan: ScanResult = scan_frame(frame, self.layout, self.matcher, self.thresholds, occupancy.occupied)
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

    def _reset_draft(self) -> None:
        self.stability.tracks.clear()
        self._first_seen_ms.clear()
        self.status.confirmed = 0
        self.status.recognized = 0

    def rearm(self) -> None:
        """New draft / unknown scene: forget the empty baseline AND every candidate. Nothing is eligible until a
        fresh stable baseline exists."""
        self.gate.rearm()
        self._reset_draft()
        self.status.armed = False

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
        self.rearm()  # whatever comes back may be a different screen: do not trust the old baseline
        detail = "VISUAL_CAPTURE_LOST" if last is not None else "VISUAL_NO_WINDOW"
        return [self.factory.health("lost" if last is not None else "degraded", detail)]
