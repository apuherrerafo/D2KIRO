"""Local, bounded diagnostics for real-Dota calibration. NOTHING here is ever sent anywhere.

The first real Hero Selection recognized 0/10 heroes. To fix that from evidence instead of guessing, the
helper records -- on the Player's PC only -- what it saw: window/capture dimensions, the layout in use, each
slot's pixel rectangle, its card-chrome lock state (top/bottom bar chroma), its occupancy distance vs. threshold,
the matcher's best candidate with score and margin, and WHY a candidate was rejected, plus lifecycle transitions.

Privacy: no secret (token, live id), no account id, no player name ever enters a record. Pixels are NOT saved
by default; only while a flag file (`save-frames.flag`, next to the diagnostics folder) exists. Then, per DRAFT
EPOCH (the budget restarts with every draft, so a late failure still has evidence), still local:
  * strip PNGs of the top bar (rows 0-70, x 160-1440 of the 1600x900 reference, scaled to the viewport) on a
    lock-state change, ambiguity, a health change, a hero confirmation, and every 10 s as a keepalive; the last
    few strips are also kept in memory and flushed when the draft closes;
  * at most four full frames: after arming, at the first lock, the last readable one, and the first after close.
`frames/` is pruned to MAX_FRAMES_BYTES, oldest draft epoch first. Files rotate and are capped.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from collections import deque
from pathlib import Path
from typing import Callable, Mapping

import numpy as np

from .layout import Layout, Rect, viewport

MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_FRAMES_BYTES = 64 * 1024 * 1024  # frames/ folder budget (strips + full frames), oldest draft epoch first
DRAFT_FRAME_EVERY_MS = 1_000.0
IDLE_FRAME_EVERY_MS = 30_000.0
SAVE_FRAMES_FLAG = "save-frames.flag"
FLAG_CHECK_EVERY_MS = 1_000.0

# Per draft epoch.
MAX_FULL_FRAMES = 4
MAX_EVENT_STRIPS = 80
MAX_KEEPALIVE_STRIPS = 40
STRIP_MIN_SPACING_MS = 1_500.0  # between event strips (a health change or a hero confirmation is always saved)
STRIP_AMBIGUOUS_EVERY_MS = 5_000.0  # a persisting ambiguity must not eat the whole budget
STRIP_KEEPALIVE_MS = 10_000.0
RING_STRIPS = 6  # the last strips, kept in memory and flushed when the draft closes
RING_EVERY_MS = 1_000.0

REF_WIDTH, REF_HEIGHT = 1600.0, 900.0
STRIP_ROWS = 70.0
STRIP_X = (160.0, 1440.0)

_EPOCH_FILE = re.compile(r"^(?P<run>[^-]+)-e(?P<epoch>\d+)-.+\.png$")
_LEGACY_FILE = re.compile(r"^(?P<run>[^-]+)-\d+-(?:raw|layout)\.png$")  # 0.1.2 and earlier: one 'epoch' per run


def rect_px(rect: Rect, vp: tuple[int, int, int, int]) -> list[int]:
    vx, vy, vw, vh = vp
    return [vx + int(round(rect.x * vw)), vy + int(round(rect.y * vh)), max(1, int(round(rect.w * vw))), max(1, int(round(rect.h * vh)))]


def strip_of(frame: np.ndarray, layout: Layout) -> np.ndarray:
    """The top-bar strip (rows 0-70, x 160-1440 of the 1600x900 reference), scaled to the viewport. A copy."""
    height, width = frame.shape[:2]
    vx, vy, vw, vh = viewport(width, height, layout.aspect)
    x0, x1 = vx + int(round(STRIP_X[0] / REF_WIDTH * vw)), vx + int(round(STRIP_X[1] / REF_WIDTH * vw))
    y1 = vy + max(1, int(round(STRIP_ROWS / REF_HEIGHT * vh)))
    return frame[vy:min(height, y1), max(0, x0):min(width, x1)].copy()


class Diagnostics:
    def __init__(self, directory: Path, run_id: str, clock: Callable[[], dt.datetime], enabled: bool = True) -> None:
        self.directory = directory
        self.run_id = run_id
        self.clock = clock
        self.enabled = enabled
        self._file_index = 0
        self._last_frame_ms: float | None = None
        self._usable = enabled
        # Evidence state, per draft epoch (begin_epoch resets all of it).
        self._epoch: int | None = None
        self._stem = ""
        self._full_done: set[str] = set()
        self._strips = 0
        self._event_strips = 0
        self._keepalive_strips = 0
        self._last_strip_ms: float | None = None
        self._last_ambiguous_strip_ms: float | None = None
        self._last_ring_ms: float | None = None
        self._ring: deque[tuple[float, np.ndarray]] = deque(maxlen=RING_STRIPS)
        self._last_readable: np.ndarray | None = None
        self._closed_pending = False
        self._flag_at_ms: float | None = None
        self._flag_on = False
        if enabled:
            try:
                self.directory.mkdir(parents=True, exist_ok=True)
            except OSError:
                self._usable = False

    # -- records -----------------------------------------------------------------------------------------

    def event(self, kind: str, **fields: object) -> None:
        self._write({"kind": kind, **fields})

    def frame(self, now_ms: float, frame: np.ndarray, layout: Layout, scan, gate, status, chrome: Mapping | None = None, states: Mapping | None = None) -> None:
        """One per second while a draft is open (so a whole Hero Selection is reconstructable), one per 30 s otherwise.
        Per slot: `top`/`bot` = chroma of the top/bottom card-bar strip, `chroma` = the value the lock decision used (the
        top strip), `lockstate`, `bar_present`, plus the occupancy `dist`/`thr` and the matcher's candidate."""
        every = DRAFT_FRAME_EVERY_MS if status.draft_open else IDLE_FRAME_EVERY_MS
        if self._last_frame_ms is not None and now_ms - self._last_frame_ms < every:
            return
        self._last_frame_ms = now_ms
        height, width = frame.shape[:2]
        vp = viewport(width, height, layout.aspect)
        slots = []
        if scan is not None:
            for reading in scan.readings:
                key = (reading.side, reading.index)
                rects = layout.bans if reading.side == "ban" else layout.slots[reading.side]
                distance = gate.last_distance.get(key)
                card = None if chrome is None else chrome.get(key)
                slots.append(
                    {
                        "side": reading.side,
                        "i": reading.index,
                        "rect": rect_px(rects[reading.index], vp),
                        "dist": None if distance is None else round(distance, 2),
                        "thr": None if gate.threshold_of(key) is None else round(gate.threshold_of(key), 2),
                        "top": None if card is None else round(card.top, 1),
                        "bot": None if card is None else round(card.bottom, 1),
                        "chroma": None if card is None else round(card.top, 1),
                        "bar_present": None if card is None else card.bar_present,
                        "lockstate": None if states is None else states.get(key),
                        "state": reading.state,
                        "reason": reading.reason,
                        "cand": reading.candidate_id,
                        "score": round(reading.score, 3),
                        "runnerUp": round(reading.runner_up_score, 3),
                        "margin": round(reading.margin, 3),
                    }
                )
        self._write(
            {
                "kind": "frame",
                "frame": [width, height],
                "viewport": list(vp),
                "layout": layout.status,
                "gate": gate.last_state,
                "draftOpen": status.draft_open,
                "armed": status.armed,
                "recognized": status.recognized,
                "confirmed": status.confirmed,
                "barsPresent": None if not chrome else sum(1 for card in chrome.values() if card.bar_present),
                "scanMs": None if scan is None else round(scan.elapsed_ms, 1),
                "slots": slots,
            }
        )

    # -- opt-in local evidence (strips + a few full frames), per draft epoch ----------------------------------

    def _evidence_enabled(self, now_ms: float | None = None) -> bool:
        """`save-frames.flag` exists (re-checked at most once a second)."""
        if not self._usable:
            return False
        if now_ms is not None and self._flag_at_ms is not None and now_ms - self._flag_at_ms < FLAG_CHECK_EVERY_MS:
            return self._flag_on
        self._flag_on = (self.directory.parent / SAVE_FRAMES_FLAG).exists()
        self._flag_at_ms = now_ms
        return self._flag_on

    def _frames_dir(self) -> Path:
        return self.directory.parent / "frames"

    def begin_epoch(self, epoch: int) -> None:
        """A draft opened: the evidence budget restarts (it used to be one process-global budget, spent before Strategy Time)."""
        self._epoch = epoch
        self._stem = f"{self.run_id}-e{epoch:03d}"
        self._full_done = set()
        self._strips = self._event_strips = self._keepalive_strips = 0
        self._last_strip_ms = self._last_ambiguous_strip_ms = self._last_ring_ms = None
        self._ring.clear()
        self._last_readable = None
        self._closed_pending = False
        self._flag_at_ms = None
        if self._evidence_enabled():
            self._prune_frames()

    def evidence(self, now_ms: float, frame: np.ndarray, layout: Layout, triggers: list[str], *, readable: bool, armed: bool, any_locked: bool) -> None:
        """Called for every frame of an open draft. `triggers` come from the session: lock | ambiguous | health | confirm."""
        if self._epoch is None or not self._evidence_enabled(now_ms):
            return
        try:
            if readable:
                self._last_readable = frame
                if armed:
                    self._save_full("armed", frame)
                if any_locked:
                    self._save_full("firstlock", frame)
            strip = strip_of(frame, layout)
            if self._last_ring_ms is None or now_ms - self._last_ring_ms >= RING_EVERY_MS:
                self._last_ring_ms = now_ms
                self._ring.append((now_ms, strip))
            reason = self._strip_reason(now_ms, triggers)
            if reason is not None:
                self._save_strip(strip, reason, now_ms)
        except Exception as error:  # noqa: BLE001 - diagnostics must never break the live loop
            self.event("error", where="evidence", type=type(error).__name__)

    def _strip_reason(self, now_ms: float, triggers: list[str]) -> str | None:
        since = None if self._last_strip_ms is None else now_ms - self._last_strip_ms
        if self._event_strips < MAX_EVENT_STRIPS:
            for reason in ("health", "confirm"):  # always worth keeping
                if reason in triggers:
                    return reason
            if "lock" in triggers and (since is None or since >= STRIP_MIN_SPACING_MS):
                return "lock"
            if "ambiguous" in triggers and (self._last_ambiguous_strip_ms is None or now_ms - self._last_ambiguous_strip_ms >= STRIP_AMBIGUOUS_EVERY_MS) and (since is None or since >= STRIP_MIN_SPACING_MS):
                return "ambiguous"
        if self._keepalive_strips < MAX_KEEPALIVE_STRIPS and (since is None or since >= STRIP_KEEPALIVE_MS):
            return "keepalive"
        return None

    def _save_strip(self, strip: np.ndarray, reason: str, now_ms: float | None) -> None:
        import cv2

        folder = self._frames_dir()
        folder.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(folder / f"{self._stem}-strip-{self._strips:03d}-{reason}.png"), strip):
            return
        self._strips += 1
        if reason == "keepalive":
            self._keepalive_strips += 1
        elif reason != "tail":
            self._event_strips += 1
            if reason == "ambiguous":
                self._last_ambiguous_strip_ms = now_ms
        if now_ms is not None:
            self._last_strip_ms = now_ms
        self.event("strip_saved", n=self._strips, reason=reason)
        self._prune_frames()

    def _save_full(self, label: str, frame: np.ndarray) -> None:
        if label in self._full_done or len(self._full_done) >= MAX_FULL_FRAMES:
            return
        import cv2

        self._full_done.add(label)  # one attempt per label per epoch, even if the write fails
        folder = self._frames_dir()
        folder.mkdir(parents=True, exist_ok=True)
        if cv2.imwrite(str(folder / f"{self._stem}-full-{label}.png"), frame):
            self.event("frame_saved", label=label)
            self._prune_frames()

    def end_epoch(self) -> None:
        """The draft closed: flush the in-memory tail and the last readable frame; the first frame after is saved by closed_frame()."""
        if self._epoch is None:
            return
        try:
            if self._evidence_enabled():
                for _, strip in list(self._ring):
                    self._save_strip(strip, "tail", None)
                if self._last_readable is not None:
                    self._save_full("lastreadable", self._last_readable)
                self._closed_pending = "closed" not in self._full_done
        except Exception as error:  # noqa: BLE001
            self.event("error", where="end_epoch", type=type(error).__name__)
        self._ring.clear()
        self._last_readable = None
        self._epoch = None  # no more evidence until the next draft opens (the stem stays for closed_frame)

    def closed_frame(self, frame: np.ndarray) -> None:
        """Called for frames outside a draft: the first one after a close is the epoch's fourth (and last) full frame."""
        if not self._closed_pending:
            return
        self._closed_pending = False
        try:
            self._save_full("closed", frame)
        except Exception as error:  # noqa: BLE001
            self.event("error", where="closed_frame", type=type(error).__name__)

    def _prune_frames(self) -> None:
        """frames/ <= MAX_FRAMES_BYTES, oldest draft epoch first (never the running epoch; unrelated files are left alone)."""
        folder = self._frames_dir()
        groups: dict[str, list[tuple[Path, int, float]]] = {}
        try:
            for path in folder.glob("*.png"):
                match = _EPOCH_FILE.match(path.name)
                legacy = _LEGACY_FILE.match(path.name)
                key = f"{match['run']}-e{int(match['epoch']):03d}" if match else (legacy["run"] if legacy else None)
                if key is None:
                    continue
                stat = path.stat()
                groups.setdefault(key, []).append((path, stat.st_size, stat.st_mtime))
        except OSError:
            return
        total = sum(size for files in groups.values() for _, size, _ in files)
        for key in sorted(groups, key=lambda k: max(m for _, _, m in groups[k])):
            if total <= MAX_FRAMES_BYTES:
                break
            if key == self._stem:
                continue
            for path, size, _ in groups[key]:
                try:
                    path.unlink()
                    total -= size
                except OSError:
                    continue

    # -- file handling -----------------------------------------------------------------------------------

    def _path(self) -> Path:
        return self.directory / f"visual-{self.run_id}-{self._file_index:03d}.jsonl"

    def _write(self, record: dict) -> None:
        if not self._usable:
            return
        record = {"t": self.clock().astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z", **record}
        try:
            path = self._path()
            if path.exists() and path.stat().st_size >= MAX_FILE_BYTES:
                self._file_index += 1
                path = self._path()
                self._prune()
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, separators=(",", ":")) + "\n")
        except OSError:
            self._usable = False  # a full or read-only disk silences diagnostics, never the helper

    def _prune(self) -> None:
        files = sorted(self.directory.glob("visual-*.jsonl"), key=lambda p: p.stat().st_mtime)
        total = sum(p.stat().st_size for p in files)
        while files and total > MAX_TOTAL_BYTES:
            oldest = files.pop(0)
            total -= oldest.stat().st_size
            try:
                oldest.unlink()
            except OSError:
                break


def default_directory() -> Path:
    from .paths import user_data_dir

    explicit = os.environ.get("D2KIRO_VISUAL_DIAG_DIR")
    return Path(explicit) if explicit else user_data_dir() / "diagnostics"
