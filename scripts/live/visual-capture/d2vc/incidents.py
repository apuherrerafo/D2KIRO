"""Incident recorder: a small in-memory ring of recent FULL frames, persisted around the moments that matter.

0.1.2 spent its 30 frames before the failure (draft 0374e6d9: two correct heroes sat under the threshold for 30-90 s and the
evidence was gone). The periodic frames of 0.1.3-rc1 keep the draft's shape; this keeps the INCIDENT: a few frames from
just BEFORE the condition appeared, the frame that tripped it, and a few frames AFTER, so the post-match tooling can see what
the screen did on both sides of it. Nothing here records video and nothing grows without a bound:

  * the ring holds PRE_FRAMES frames (one every SAMPLE_EVERY_MS) in memory only; it is written to disk only for an incident;
  * one incident = at most PRE_FRAMES + 1 + POST_FRAMES PNGs; at most MAX_INCIDENTS per draft epoch (+1 `short_end`);
  * a condition that stays true fires ONCE per episode (it must clear to fire again); a second condition that trips while an
    incident is still collecting its post frames joins it instead of opening a new one;
  * MAX_INCIDENT_BYTES per draft epoch, on top of the folder-wide cap `Diagnostics` already enforces (oldest epoch first).

Conditions are keys `kind` or `kind:slot` mapped to the time the condition must have held (0 = an instant event):
`subthreshold` (a locked card whose best candidate sits under min_score), `uncertain` (a locked card nobody can name),
`unread` (health is VISUAL_SLOTS_UNREAD), `recovered`, `reverted`; plus `short_end` when a draft closes with fewer than
SHORT_DRAFT_PICKS confirmed picks. Pure given its writer: no clock, no disk of its own, no network.
"""
from __future__ import annotations

import re
from collections import deque
from typing import Callable, Mapping

import numpy as np

PRE_FRAMES = 5
POST_FRAMES = 6
SAMPLE_EVERY_MS = 500.0  # 2.5 s of context before, 3 s after
PERSIST_MS = 1_000.0  # a sub-threshold / uncertain card must hold this long before it is an incident (a hover transient is not)
MAX_INCIDENTS = 10
MAX_INCIDENT_BYTES = 256 * 1024 * 1024
SHORT_DRAFT_PICKS = 10

Writer = Callable[[str, np.ndarray], int]  # (file name, frame) -> bytes written, 0 when the write failed
Logger = Callable[..., None]

_SAFE = re.compile(r"[^a-z0-9_]+")


def kind_of(key: str) -> str:
    return _SAFE.sub("", key.split(":", 1)[0].lower()) or "incident"


class IncidentRecorder:
    def __init__(self, writer: Writer, log: Logger) -> None:
        self._write = writer
        self._log = log
        self._stem: str | None = None
        self._reset()

    def _reset(self) -> None:
        self._ring: deque[tuple[float, np.ndarray]] = deque(maxlen=PRE_FRAMES)
        self._last_sample_ms: float | None = None
        self._since: dict[str, float] = {}
        self._fired: set[str] = set()
        self._count = 0
        self._bytes = 0
        self._exhausted_logged = False
        self._open: dict | None = None

    def begin(self, stem: str) -> None:
        """A draft epoch opened: the budget restarts (a late failure in a long match still has evidence)."""
        self._reset()
        self._stem = stem

    def observe(self, now_ms: float, frame: np.ndarray, conditions: Mapping[str, float]) -> None:
        """Called for every frame of an open draft, after the session decided which conditions hold."""
        if self._stem is None:
            return
        self._advance_post(now_ms, frame)
        fired = self._episodes(now_ms, conditions)
        if fired:
            self._trip(now_ms, frame, fired)
        if self._last_sample_ms is None or now_ms - self._last_sample_ms >= SAMPLE_EVERY_MS:
            self._last_sample_ms = now_ms
            self._ring.append((now_ms, frame))

    def close(self, picks: int | None) -> None:
        """The draft ended. A draft that ends short of 10 picks keeps the frames that led up to it."""
        if self._stem is None:
            return
        short = picks is not None and picks < SHORT_DRAFT_PICKS
        if self._open is not None:
            self._finish(partial=True)
        if short and not self._over_bytes():
            self._count += 1  # short_end is the one incident allowed past MAX_INCIDENTS
            pre = list(self._ring)
            incident = self._new("short_end")
            for index, (_, old) in enumerate(pre):
                self._save(incident, "pre", index, old)
            self._log("incident_open", id=incident["id"], kinds=["short_end"], pre=len(pre), picks=picks)
        self._ring.clear()
        self._open = None
        self._stem = None

    # -- internals ---------------------------------------------------------------------------------------

    def _episodes(self, now_ms: float, conditions: Mapping[str, float]) -> list[str]:
        fired: list[str] = []
        for key, persist in conditions.items():
            since = self._since.setdefault(key, now_ms)
            if key not in self._fired and now_ms - since >= persist:
                self._fired.add(key)
                fired.append(key)
        for key in [k for k in self._since if k not in conditions]:
            del self._since[key]
            self._fired.discard(key)
        return fired

    def _over_bytes(self) -> bool:
        return self._bytes >= MAX_INCIDENT_BYTES

    def _new(self, key: str) -> dict:
        return {"id": self._count, "kind": kind_of(key), "post": 0, "last_post_ms": None, "files": 0}

    def _save(self, incident: dict, role: str, index: int, frame: np.ndarray) -> None:
        name = f"{self._stem}-inc-{incident['id']:02d}-{incident['kind']}-{role}{index}.png"
        written = self._write(name, frame)
        if written:
            self._bytes += written
            incident["files"] += 1
            self._log("frame_saved", label=f"inc-{incident['id']:02d}-{incident['kind']}-{role}", file=name)

    def _trip(self, now_ms: float, frame: np.ndarray, fired: list[str]) -> None:
        kinds = sorted({kind_of(key) for key in fired})
        if self._open is not None:
            self._log("incident_join", id=self._open["id"], kinds=kinds, keys=sorted(fired))
            return
        if self._count >= MAX_INCIDENTS or self._over_bytes():
            if not self._exhausted_logged:
                self._exhausted_logged = True
                self._log("incident_budget_exhausted", count=self._count, bytes=self._bytes)
            return
        self._count += 1
        incident = self._new(fired[0])
        pre = list(self._ring)
        for index, (_, old) in enumerate(pre):
            self._save(incident, "pre", index, old)
        self._save(incident, "at", 0, frame)
        incident["last_post_ms"] = now_ms
        self._open = incident
        self._log("incident_open", id=incident["id"], kinds=kinds, keys=sorted(fired), pre=len(pre))

    def _advance_post(self, now_ms: float, frame: np.ndarray) -> None:
        incident = self._open
        if incident is None:
            return
        if now_ms - incident["last_post_ms"] < SAMPLE_EVERY_MS:
            return
        incident["last_post_ms"] = now_ms
        self._save(incident, "post", incident["post"], frame)
        incident["post"] += 1
        if incident["post"] >= POST_FRAMES or self._over_bytes():
            self._finish(partial=False)

    def _finish(self, partial: bool) -> None:
        incident = self._open
        self._open = None
        if incident is not None:
            self._log("incident_closed", id=incident["id"], what=incident["kind"], files=incident["files"], post=incident["post"], partial=partial)
