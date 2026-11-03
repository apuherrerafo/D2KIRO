"""Temporal confirmation: a single frame is never draft truth.

A slot's hero is CONFIRMED only after the same hero was read in `min_frames` consecutive frames spanning at
least `min_ms`. A confirmed slot that later stably shows a DIFFERENT hero yields `revert` + the new `pick`
(the engine removes the old fact). Unreadable/empty frames reset the candidate but never revert a
confirmed pick (a transition or overlay is not evidence that the pick changed). Pure: time is a parameter.

RECOVERY (a second, slower proof -- never a lower threshold). A LOCKED card whose best candidate sits just under
`min_score` but is clearly ahead of the runner-up (draft 0374e6d9: Phantom Assassin 0.634 / margin 0.269, Mars 0.675 / 0.203,
both correct, both static for 30-90 s) is confirmed after `RECOVERY_MIN_MS` / `RECOVERY_MIN_FRAMES` of the SAME candidate with
EVERY frame >= `RECOVERY_MIN_SCORE` and >= `RECOVERY_MIN_MARGIN`. It only ever fills an unconfirmed pick slot, never takes a hero
confirmed elsewhere or contested by another slot, and anything that breaks the run (a dip, another hero, an empty / unreadable
frame) restarts it. A card that is not locked never reaches here: `scan.read_slot` only reports `uncertain` for a locked card.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .scan import ScanResult, SlotReading

# Recovery calibration (draft 0374e6d9 + the saved labelled corpus):
#  - floor 0.60: under the lowest real correct reading seen below the normal threshold (0.634) with room for its jitter (a
#    static candidate wobbles +-0.007). Ungated negatives (no lock) top out at 0.631, so the LOCK GATE (card chrome) -- not the
#    floor -- is what keeps hover / empty cards out; the floor, the margin and the window are three more bars on top of it.
#  - margin 0.15: the NORMAL margin, never relaxed (the real junk reads have margin < 0.08).
#  - 1.0 s / 6 frames: > 2x the normal path (350 ms / 3 frames), so a lock animation or a one-sample dip (the real transients
#    were one sample under 0.60) cannot complete it; < the 1.5 s UNREAD grace, so a recovered card never flashes SLOTS_UNREAD.
RECOVERY_MIN_SCORE = 0.60
RECOVERY_MIN_MARGIN = 0.15
RECOVERY_MIN_MS = 1000.0
RECOVERY_MIN_FRAMES = 6


@dataclass(frozen=True)
class VisualEvent:
    kind: str  # "pick" | "revert" | "ban"
    side: str  # "radiant" | "dire" | "ban"
    hero_id: int
    confidence: float
    slot: int  # screen slot index, informational only (NOT a Dota position)
    recovered: bool = False  # confirmed by the recovery path (sub-threshold but stable); diagnostics only


@dataclass(frozen=True)
class RecoveryPolicy:
    min_score: float = RECOVERY_MIN_SCORE
    min_margin: float = RECOVERY_MIN_MARGIN
    min_ms: float = RECOVERY_MIN_MS
    min_frames: int = RECOVERY_MIN_FRAMES


@dataclass
class _Track:
    candidate: int | None = None
    frames: int = 0
    since_ms: float = 0.0
    score_sum: float = 0.0
    confirmed: int | None = None
    # the recovery run: the same sub-threshold candidate, every frame above the recovery floor and margin
    rec_candidate: int | None = None
    rec_frames: int = 0
    rec_since_ms: float = 0.0
    rec_score_sum: float = 0.0
    recovered: bool = False  # `confirmed` came from the recovery path


@dataclass
class StabilityFilter:
    min_frames: int = 3
    min_ms: float = 350.0
    tracks: dict[tuple[str, int], _Track] = field(default_factory=dict)
    recovery: RecoveryPolicy | None = field(default_factory=RecoveryPolicy)  # None = the 0.1.3-rc1 behaviour

    def confirmed(self) -> dict[tuple[str, int], int]:
        return {key: t.confirmed for key, t in self.tracks.items() if t.confirmed is not None}

    def update(self, scan: ScanResult, now_ms: float) -> list[VisualEvent]:
        events: list[VisualEvent] = []
        for reading in scan.readings:
            events.extend(self._update_slot(reading, now_ms))
        return events

    def recovered_hero(self, reading: SlotReading) -> int | None:
        """The hero a RECOVERED slot stands for while its card still reads as that same stable candidate (else None, so the
        card counts as unread again): lets the session health treat a recovered lock as read without a confident reading."""
        track = self.tracks.get((reading.side, reading.index))
        if track is None or not track.recovered or track.confirmed is None:
            return None
        return track.confirmed if self._qualifies(reading) and reading.candidate_id == track.confirmed else None

    def _qualifies(self, reading: SlotReading) -> bool:
        policy = self.recovery
        return (
            policy is not None
            and reading.side != "ban"
            and reading.state == "uncertain"
            and reading.reason == "below_score"
            and reading.candidate_id is not None
            and reading.score >= policy.min_score
            and reading.margin >= policy.min_margin
        )

    def _contested(self, hero: int, side: str, index: int) -> bool:
        """Another pick slot already holds this hero or is a candidate for it right now (normal or recovery): nobody gets it."""
        for key, other in self.tracks.items():
            if key[0] == "ban" or key == (side, index):
                continue
            if other.confirmed == hero or other.candidate == hero or other.rec_candidate == hero:
                return True
        return False

    def _held_elsewhere(self, hero: int, side: str, index: int) -> bool:
        """A hero cannot sit in two pick slots (or be both picked and in a second slot)."""
        if side == "ban":
            return False
        return any(t.confirmed == hero and key != (side, index) for key, t in self.tracks.items() if key[0] != "ban")

    def _update_slot(self, reading: SlotReading, now_ms: float) -> list[VisualEvent]:
        track = self.tracks.setdefault((reading.side, reading.index), _Track())
        hero = reading.hero_id if reading.state == "hero" else None
        if hero is None:
            track.candidate, track.frames, track.score_sum = None, 0, 0.0
            return self._update_recovery(reading, track, now_ms)
        track.rec_candidate, track.rec_frames, track.rec_score_sum = None, 0, 0.0  # a confident reading supersedes a recovery run
        if hero != track.candidate:
            track.candidate, track.frames, track.since_ms, track.score_sum = hero, 0, now_ms, 0.0
        track.frames += 1
        track.score_sum += reading.score
        if hero == track.confirmed:
            track.recovered = False  # the normal path now vouches for the same hero
            return []
        if track.frames < self.min_frames or now_ms - track.since_ms < self.min_ms:
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
        track.confirmed, track.recovered = hero, False
        return out

    def _update_recovery(self, reading: SlotReading, track: _Track, now_ms: float) -> list[VisualEvent]:
        """No confident hero this frame: advance, restart or drop this slot's sub-threshold recovery run."""
        policy = self.recovery
        if policy is None or track.confirmed is not None or not self._qualifies(reading):
            track.rec_candidate, track.rec_frames, track.rec_score_sum = None, 0, 0.0
            return []
        hero = reading.candidate_id
        if hero != track.rec_candidate:
            track.rec_candidate, track.rec_frames, track.rec_since_ms, track.rec_score_sum = hero, 0, now_ms, 0.0
        track.rec_frames += 1
        track.rec_score_sum += reading.score
        if track.rec_frames < policy.min_frames or now_ms - track.rec_since_ms < policy.min_ms:
            return []
        if self._contested(hero, reading.side, reading.index):
            return []
        track.confirmed, track.recovered = hero, True
        confidence = round(min(1.0, track.rec_score_sum / track.rec_frames), 3)
        return [VisualEvent("pick", reading.side, hero, confidence, reading.index, recovered=True)]
