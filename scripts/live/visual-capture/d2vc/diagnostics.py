"""Local, bounded diagnostics for real-Dota calibration. NOTHING here is ever sent anywhere.

The first real Hero Selection recognized 0/10 heroes. To fix that from evidence instead of guessing, the
helper records -- on the Player's PC only -- what it saw: window/capture dimensions, the layout in use, each
slot's pixel rectangle, its occupancy distance vs. threshold, the matcher's best candidate with score and
margin, and WHY a candidate was rejected, plus lifecycle transitions.

Privacy: no secret (token, live id), no account id, no player name ever enters a record. Raw frames are NOT
saved by default; only while a flag file (`save-frames.flag`, next to the diagnostics folder) exists, and then
at most MAX_FRAMES pairs, still local. Files rotate and are capped; oldest are deleted first.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Callable

import numpy as np

from .layout import Layout, Rect, viewport

MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
DRAFT_FRAME_EVERY_MS = 1_000.0
IDLE_FRAME_EVERY_MS = 30_000.0
FRAME_SAVE_EVERY_MS = 2_000.0
MAX_FRAMES = 30
SAVE_FRAMES_FLAG = "save-frames.flag"


def rect_px(rect: Rect, vp: tuple[int, int, int, int]) -> list[int]:
    vx, vy, vw, vh = vp
    return [vx + int(round(rect.x * vw)), vy + int(round(rect.y * vh)), max(1, int(round(rect.w * vw))), max(1, int(round(rect.h * vh)))]


class Diagnostics:
    def __init__(self, directory: Path, run_id: str, clock: Callable[[], dt.datetime], enabled: bool = True) -> None:
        self.directory = directory
        self.run_id = run_id
        self.clock = clock
        self.enabled = enabled
        self._file_index = 0
        self._last_frame_ms: float | None = None
        self._last_save_ms: float | None = None
        self._saved = 0
        self._usable = enabled
        if enabled:
            try:
                self.directory.mkdir(parents=True, exist_ok=True)
            except OSError:
                self._usable = False

    # -- records -----------------------------------------------------------------------------------------

    def event(self, kind: str, **fields: object) -> None:
        self._write({"kind": kind, **fields})

    def frame(self, now_ms: float, frame: np.ndarray, layout: Layout, scan, gate, status) -> None:
        """One per second while a draft is open (so a whole Hero Selection is reconstructable), one per 30 s otherwise."""
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
                slots.append(
                    {
                        "side": reading.side,
                        "i": reading.index,
                        "rect": rect_px(rects[reading.index], vp),
                        "dist": None if distance is None else round(distance, 2),
                        "thr": None if gate.threshold_of(key) is None else round(gate.threshold_of(key), 2),
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
                "scanMs": None if scan is None else round(scan.elapsed_ms, 1),
                "slots": slots,
            }
        )

    # -- opt-in local frame dump -------------------------------------------------------------------------

    def maybe_save_frame(self, now_ms: float, frame: np.ndarray, layout: Layout) -> None:
        """Only while `save-frames.flag` exists, only inside a draft, bounded, local. Raw frame + the same frame with the layout boxes drawn."""
        if not self._usable or self._saved >= MAX_FRAMES:
            return
        if not (self.directory.parent / SAVE_FRAMES_FLAG).exists():
            return
        if self._last_save_ms is not None and now_ms - self._last_save_ms < FRAME_SAVE_EVERY_MS:
            return
        self._last_save_ms = now_ms
        try:
            import cv2

            from .calibrate import draw_preview

            frames = self.directory.parent / "frames"
            frames.mkdir(parents=True, exist_ok=True)
            stem = f"{self.run_id}-{self._saved:03d}"
            cv2.imwrite(str(frames / f"{stem}-raw.png"), frame)
            cv2.imwrite(str(frames / f"{stem}-layout.png"), draw_preview(frame, layout))
            self._saved += 1
            self.event("frame_saved", n=self._saved)
        except Exception as error:  # noqa: BLE001 - diagnostics must never break the live loop
            self.event("error", where="save_frame", type=type(error).__name__)

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
