"""The visual capture session: frames in, `draft-event/v1` envelopes + a one-line status out.

Pure orchestration over (card chrome -> lock state -> scan -> temporal confirmation -> allowlisted envelopes).
Frames, time and the network are all injected, so the whole thing is tested without a screen, a clock or a server.

Order per frame: occupancy gate -> LOCK state of every card (its player-colour bar, lockstate.py) -> only locked
cards reach the matcher -> score+margin -> 3-frame confirmation -> draft fact. A hover never becomes a pick.

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
from .incidents import PERSIST_MS as INCIDENT_PERSIST_MS
from .layout import Layout
from .lockstate import CardChrome, bars_verified, card_chrome, classify
from .matcher import Matcher, Thresholds
from .occupancy import OccupancyGate
from .scan import ScanResult, scan_frame, slot_crops
from .stability import StabilityFilter, VisualEvent
from .transport import DraftLifecycle

LOST_AFTER_MS = 3_000.0
HEARTBEAT_EVERY_MS = 5_000.0
# A locked card (or an ambiguous one) may stay unsettled this long before the helper stops vouching that the draft is
# fully read: temporal confirmation alone needs ~400 ms. The same grace is how long the previous health is retained
# when a frame cannot be read at all (black / alt-tab / partial): after it the helper degrades, it never vouches.
UNREAD_GRACE_MS = 1_500.0
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
        self._unverified_since: float | None = None
        self._last_health: tuple[str, str] | None = None
        # A draft just opened and the helper has not spoken in it yet: while its first empty-bar baseline arms (~1 s) it
        # stays SILENT (the server keeps its previous word) for at most UNREAD_GRACE_MS instead of shouting
        # LAYOUT_UNVERIFIED -- a fresh hero selection is empty, so the Team Coach may recommend at once. It never says OK
        # before the baseline is verified; after the grace an unarmed helper still degrades.
        self._opening = False
        self._lock_signature: tuple = ()
        self.lock_states: dict[tuple[str, int], str] = {}  # the last frame's verdict per card (tests / diagnostics)

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
            if self.diagnostics is not None and self.status.draft_open:
                self.diagnostics.end_epoch(picks=self._confirmed_picks())  # a new draft replaced an open one: keep the old one's evidence
            self.rearm()
            self._opening = True
            self.status.draft_open, self._draft_epoch = True, lifecycle.epoch
            if self.diagnostics is not None:
                self.diagnostics.begin_epoch(lifecycle.epoch)
            self._note("draft_open", epoch=lifecycle.epoch)
            return True
        if not lifecycle.drafting and self.status.draft_open:
            picks = self._confirmed_picks()  # before the re-arm forgets them
            self.rearm()
            self.status.draft_open = False
            self._note("draft_closed", phase=lifecycle.phase)
            if self.diagnostics is not None:
                self.diagnostics.end_epoch(picks=picks)
            return True
        return False

    def _confirmed_picks(self) -> int:
        return sum(1 for key in self.stability.confirmed() if key[0] != "ban")

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
            if not self.status.draft_open:  # inside a draft the helper was re-armed on loss: only _health may speak, never a blind OK
                out.append(self.factory.health("ok", "VISUAL_OK"))
                self._last_heartbeat_ms = now_ms
        if not self.status.draft_open:
            # Not a draft (menu, lobby, loading, the match itself): nothing is baselined, matched or emitted.
            self.status.selection_detected = False
            if self.diagnostics is not None:
                self.diagnostics.frame(now_ms, frame, self.layout, None, self.gate, self.status)
                self.diagnostics.closed_frame(frame)
            if self._last_heartbeat_ms is None or now_ms - self._last_heartbeat_ms >= LIFECYCLE_PROBE_MS:
                out.append(self.factory.health("ok", "VISUAL_OK"))
                self._last_heartbeat_ms = now_ms
            return out
        size = (frame.shape[1], frame.shape[0])
        if self._frame_size is not None and size != self._frame_size:
            self.rearm()  # a different capture geometry invalidates every baseline
        self._frame_size = size
        crops = slot_crops(frame, self.layout)
        occupancy = self.gate.update(crops, now_ms)
        if occupancy.rearmed:
            self._reset_draft()
        self.status.armed = occupancy.armed
        readable = self.gate.last_state != "unreadable"
        chrome = card_chrome(frame, self.layout) if readable else {}
        verified = readable and occupancy.armed and bars_verified(chrome)  # armed + readable + a bar on >= 9/10 cards
        self.lock_states = self._lock_states(crops, chrome, occupancy.occupied, readable)
        scan: ScanResult = scan_frame(frame, self.layout, self.matcher, self.thresholds, occupancy.occupied, self.lock_states)
        self._note_first_seen(scan, now_ms)
        events = self.stability.update(scan, now_ms)
        confirmed_now = self.stability.confirmed()
        self.status.recognized = scan.recognized
        self.status.selection_detected = scan.recognized > 0 or len(self.stability.confirmed()) > 0
        self.status.confirmed = sum(1 for key in self.stability.confirmed() if key[0] != "ban")
        for event in events:
            envelope = self.factory.from_event(event)
            out.append(envelope)
            self._note(event.kind, side=event.side, slot=event.slot, heroId=event.hero_id, confidence=event.confidence, **({"recovered": True} if event.recovered else {}))
            if event.kind == "pick":
                first = self._first_seen_ms.get((event.side, event.slot, event.hero_id), now_ms)
                self.status.latency_ms = now_ms - first
        health = self._health(scan, confirmed_now, verified, now_ms)
        health_changed = health is not None and health != self._last_health
        if health is not None and (health_changed or self._last_heartbeat_ms is None or now_ms - self._last_heartbeat_ms >= HEARTBEAT_EVERY_MS):
            out.append(self.factory.health(*health))
            self._opening = False
            self._last_health = health
            self._last_heartbeat_ms = now_ms
            self._note("health", status=health[0], detail=health[1])
        if self.diagnostics is not None:
            self._record(now_ms, frame, scan, chrome, readable, health_changed, events)
        return out

    def _lock_states(self, crops, chrome: dict[tuple[str, int], CardChrome], occupied, readable: bool) -> dict[tuple[str, int], str]:
        """Per card: locked | ambiguous | hover | empty (| unreadable). Occupancy and distance only ever downgrade a lock."""
        states: dict[tuple[str, int], str] = {}
        for key in crops:
            is_occupied = bool(occupied.get(key, False))
            if key[0] == "ban":  # ban boxes (calibrated layouts only) have no card chrome: occupancy alone, as before
                states[key] = "locked" if is_occupied else "empty"
            elif not readable:
                states[key] = "unreadable"
            else:
                states[key] = classify(chrome[key].top if key in chrome else 0.0, is_occupied, self.gate.last_distance.get(key))
        return states

    def _record(self, now_ms: float, frame: np.ndarray, scan: ScanResult, chrome: dict[tuple[str, int], CardChrome], readable: bool, health_changed: bool, events: list[VisualEvent]) -> None:
        confirmed_pick = any(e.kind in ("pick", "revert") for e in events)
        signature = tuple(sorted(item for item in self.lock_states.items() if item[1] in ("locked", "ambiguous")))
        triggers = []
        if readable and signature != self._lock_signature:
            triggers.append("lock")
        if any(state == "ambiguous" for state in self.lock_states.values()):
            triggers.append("ambiguous")
        if health_changed:
            triggers.append("health")
            if self._last_health is not None and self._last_health[1] != "VISUAL_OK":
                triggers.append("unread")  # the helper stopped vouching: keep the screen that made it stop
        if confirmed_pick:
            triggers.append("confirm")
        if readable:
            self._lock_signature = signature
        # Every transition gets its own per-slot record (not only the 1 Hz one): a lock that settles between two ticks
        # is still reconstructable, with each slot's stability track and confirmed hero.
        self.diagnostics.frame(now_ms, frame, self.layout, scan, self.gate, self.status, chrome=chrome, states=self.lock_states, stability=self.stability.tracks, force=bool(triggers) and triggers != ["ambiguous"], triggers=triggers)
        self.diagnostics.evidence(now_ms, frame, self.layout, triggers, readable=readable, armed=self.status.armed, any_locked=any(state == "locked" for state in self.lock_states.values()), conditions=self._incident_conditions(scan, events))

    def _incident_conditions(self, scan: ScanResult, events: list[VisualEvent]) -> dict[str, float]:
        """What deserves the frames around it (incidents.py): a locked card that stays unnamed, the helper no longer vouching,
        a hero recovered, a pick reverted. A hover is never one: `uncertain` is only ever reported for a LOCKED card."""
        found: dict[str, float] = {}
        for reading in scan.readings:
            if reading.side == "ban" or reading.state != "uncertain":
                continue
            kind = "subthreshold" if reading.reason == "below_score" and reading.candidate_id is not None else "uncertain"
            found[f"{kind}:{reading.side}{reading.index}"] = INCIDENT_PERSIST_MS
        if self._last_health is not None and self._last_health[1] == "VISUAL_SLOTS_UNREAD":
            found["unread"] = 0.0
        for event in events:
            if event.recovered:
                found[f"recovered:{event.side}{event.slot}"] = 0.0
            elif event.kind == "revert":
                found[f"reverted:{event.side}{event.slot}"] = 0.0
        return found

    def _health(self, scan: ScanResult, confirmed, verified: bool, now_ms: float) -> tuple[str, str] | None:
        """Does the helper VOUCH that the draft on screen is fully read? Only then may the server stop treating the
        draft as partial (and the Team Coach recommend). It must prove it, never assume it. None = no new word this frame.
          - frame/layout not verified (no baseline yet, an unreadable / black / partial frame, no card bar on >= 9/10
            cards)  -> never a fresh OK: the previous word is retained (silently) for at most UNREAD_GRACE_MS, then
            LAYOUT_UNVERIFIED -- so the engine can never be left holding a 15 s old OK
          - a locked card not (yet) read, or an ambiguous card that persists -> after UNREAD_GRACE_MS: SLOTS_UNREAD
          - otherwise (empty bar, hovers, every locked card read) -> OK. Zero picks is a perfectly readable draft."""
        if not verified:
            if self._unverified_since is None:
                self._unverified_since = now_ms
            if now_ms - self._unverified_since >= UNREAD_GRACE_MS or (self._last_health is None and not self._opening):
                return ("degraded", "VISUAL_LAYOUT_UNVERIFIED")
            return None
        self._unverified_since = None
        unsettled = False
        for reading in scan.radiant + scan.dire:
            key = (reading.side, reading.index)
            state = self.lock_states.get(key)
            if state == "ambiguous":
                unsettled = True
            elif state == "locked":
                # read = a confident hero that is the confirmed one, or a RECOVERED lock (stable sub-threshold candidate) still reading as it
                read_hero = reading.hero_id if reading.state == "hero" else self.stability.recovered_hero(reading)
                if read_hero is None or confirmed.get(key) != read_hero:
                    unsettled = True
        if not unsettled:
            self._unsettled_since = None
            return ("ok", "VISUAL_OK")
        if self._unsettled_since is None:
            self._unsettled_since = now_ms
        if now_ms - self._unsettled_since >= UNREAD_GRACE_MS:
            return ("degraded", "VISUAL_SLOTS_UNREAD")
        return ("degraded", "VISUAL_LAYOUT_UNVERIFIED") if self._last_health is None else None

    def _reset_draft(self) -> None:
        self._opening = False  # a re-arm inside a draft (geometry change, wholesale change) is not a fresh empty bar
        self._unsettled_since = None
        self._unverified_since = None
        self._lock_signature = ()
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
