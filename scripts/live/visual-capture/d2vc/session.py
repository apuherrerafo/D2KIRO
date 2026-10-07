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

from .diagnostics import Diagnostics
from .emit import EnvelopeFactory
from .layout import Layout
from .matcher import Matcher, Thresholds
from .occupancy import OccupancyGate
from .scan import ScanResult, scan_frame, slot_crops
from .stability import StabilityFilter
from .transport import DraftLifecycle

LOST_AFTER_MS = 3_000.0
HEARTBEAT_EVERY_MS = 5_000.0
# A slot that looks occupied (or a hero still being confirmed) may stay unsettled this long before the helper stops
# vouching that the draft is fully read: temporal confirmation alone needs ~400 ms.
UNREAD_GRACE_MS = 1_500.0
# Only a layout calibrated against a real hero-selection screen may vouch for "nothing is picked yet" on its own.
VERIFIED_LAYOUT_STATUSES = frozenset({"calibrated", "verified"})
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
    def __init__(self, matcher: Matcher, layout: Layout, thresholds: Thresholds, factory: EnvelopeFactory, stability: StabilityFilter | None = None, gate: OccupancyGate | None = None, diagnostics: Diagnostics | None = None) -> None:
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
        self.diagnostics = diagnostics
        self._window_logged = False
        self._unsettled_since: float | None = None
        self._seen_hero = False  # a hero was confirmed on THIS draft screen: the boxes are demonstrably on the draft bar
        self._last_health: tuple[str, str] | None = None

    def on_lifecycle(self, lifecycle: DraftLifecycle | None) -> bool:
        """The server's draft lifecycle (GSI). True on a draft boundary: the caller drops queued facts.

        Entering hero selection -- or a NEW draft (epoch changed) -- re-arms from scratch, so the baseline is
        taken on THIS hero-selection screen. Leaving it closes the session. None (no answer yet / server
        unreachable) changes nothing: an open draft is not closed by a dropped request."""
        if lifecycle is None:
            return False
        if not self.status.server_seen:
            self._note("server_seen", phase=lifecycle.phase)
        self.status.server_seen = True
        if lifecycle.drafting and (not self.status.draft_open or lifecycle.epoch != self._draft_epoch):
            self.rearm()
            self.status.draft_open, self._draft_epoch = True, lifecycle.epoch
            self._note("draft_open", epoch=lifecycle.epoch)
            return True
        if not lifecycle.drafting and self.status.draft_open:
            self.rearm()
            self.status.draft_open = False
            self._note("draft_closed", phase=lifecycle.phase)
            return True
        return False

    def _note(self, kind: str, **fields: object) -> None:
        if self.diagnostics is not None:
            self.diagnostics.event(kind, **fields)

    def process(self, frame: np.ndarray, now_ms: float) -> list[dict]:
        """One captured frame -> the envelopes it confirms (usually none)."""
        out: list[dict] = []
        self._last_frame_ms = now_ms
        self.status.window_found = True
        if not self._window_logged:
            self._window_logged = True
            self._note("window_found", frame=[frame.shape[1], frame.shape[0]])
        if self._lost:
            self._lost = False
            self._note("capture_resumed")
            out.append(self.factory.health("ok", "VISUAL_OK"))
            self._last_heartbeat_ms = now_ms
        if not self.status.draft_open:
            # Not a draft (menu, lobby, loading, the match itself): nothing is baselined, matched or emitted.
            self.status.selection_detected = False
            if self.diagnostics is not None:
                self.diagnostics.frame(now_ms, frame, self.layout, None, self.gate, self.status)
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
        if self.diagnostics is not None:
            self.diagnostics.frame(now_ms, frame, self.layout, scan, self.gate, self.status)
            self.diagnostics.maybe_save_frame(now_ms, frame, self.layout)
        events = self.stability.update(scan, now_ms)
        confirmed_now = self.stability.confirmed()
        self._seen_hero = self._seen_hero or len(confirmed_now) > 0
        self.status.recognized = scan.recognized
        self.status.selection_detected = scan.recognized > 0 or len(self.stability.confirmed()) > 0
        self.status.confirmed = sum(1 for key in self.stability.confirmed() if key[0] != "ban")
        for event in events:
            envelope = self.factory.from_event(event)
            out.append(envelope)
            if event.kind == "pick":
                first = self._first_seen_ms.get((event.side, event.slot, event.hero_id), now_ms)
                self.status.latency_ms = now_ms - first
        health = self._coverage(scan, occupancy.occupied, confirmed_now, now_ms)
        if health != self._last_health or self._last_heartbeat_ms is None or now_ms - self._last_heartbeat_ms >= HEARTBEAT_EVERY_MS:
            out.append(self.factory.health(*health))
            self._last_health = health
            self._last_heartbeat_ms = now_ms
            self._note("health", status=health[0], detail=health[1])
        return out

    def _coverage(self, scan: ScanResult, occupied, confirmed, now_ms: float) -> tuple[str, str]:
        """Does the helper VOUCH that the draft on screen is fully read? Only then may the server stop treating the
        draft as partial (and the Team Coach recommend). It must prove it, never assume it:
          - no trusted empty baseline yet                      -> cannot judge anything
          - occupied slot(s) it cannot read / is still unsure  -> picks exist that we do not know
          - a layout nobody verified and not a single hero read -> we cannot tell an empty bar from boxes on the wrong place"""
        if not self.status.armed:
            return ("degraded", "VISUAL_LAYOUT_UNVERIFIED")
        unsettled = False
        for reading in scan.radiant + scan.dire:
            if not occupied.get((reading.side, reading.index), False):
                continue
            if reading.state != "hero" or confirmed.get((reading.side, reading.index)) != reading.hero_id:
                unsettled = True
        if unsettled:
            if self._unsettled_since is None:
                self._unsettled_since = now_ms
            if now_ms - self._unsettled_since >= UNREAD_GRACE_MS:
                return ("degraded", "VISUAL_SLOTS_UNREAD")
            return self._last_health or ("degraded", "VISUAL_LAYOUT_UNVERIFIED")
        self._unsettled_since = None
        if self.layout.status not in VERIFIED_LAYOUT_STATUSES and not self._seen_hero:
            return ("degraded", "VISUAL_LAYOUT_UNVERIFIED")
        return ("ok", "VISUAL_OK")

    def _reset_draft(self) -> None:
        self._unsettled_since = None
        self._seen_hero = False
        self._last_health = None
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
        self._window_logged = False
        self._note("capture_lost" if last is not None else "no_window")
        self.rearm()  # whatever comes back may be a different screen: do not trust the old baseline
        detail = "VISUAL_CAPTURE_LOST" if last is not None else "VISUAL_NO_WINDOW"
        return [self.factory.health("lost" if last is not None else "degraded", detail)]
