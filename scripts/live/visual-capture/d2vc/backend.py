"""Window capture backend: Windows Graphics Capture through `windows-capture` (Rust, GPU-composited).

Why WGC: it captures one WINDOW (no desktop, no other apps, no overlay of ours), works for windowed and
borderless Dota, costs ~no CPU, and is a documented Windows 10+ API. DXGI Desktop Duplication
(`windows_capture.DxgiDuplicationSession`) is the fallback for exclusive-fullscreen setups.

NOT verified against a running Dota client yet (this machine had no Dota session): see README "What still
needs a real Dota test". Frames stay in this process: nothing here serializes or stores them.
"""
from __future__ import annotations

import threading
import time

import numpy as np

from .geometry import WindowMetrics, find_window, measure_window


class WgcBackend:
    def __init__(self, window_name: str = "Dota 2") -> None:
        from windows_capture import WindowsCapture  # imported lazily: tests and the lab never need it

        # The window is resolved to ONE handle that is both captured and measured (geometry.py): `window_name` alone is a
        # substring match inside windows-capture and could pick a different window than the one whose metrics we read.
        self.hwnd = find_window(window_name)
        self._latest: np.ndarray | None = None
        self._latest_metrics: WindowMetrics | None = None
        self._latest_at = 0.0
        self._lock = threading.Lock()
        self._closed = False
        self._capture = WindowsCapture(cursor_capture=False, draw_border=False, window_hwnd=self.hwnd, minimum_update_interval=100)

        @self._capture.event
        def on_frame_arrived(frame, control):  # noqa: ANN001
            bgr = np.ascontiguousarray(frame.frame_buffer[:, :, :3])
            metrics = measure_window(self.hwnd)  # measured as the frame arrives, so the pair describes the same moment
            with self._lock:
                self._latest, self._latest_metrics, self._latest_at = bgr, metrics, time.monotonic()

        @self._capture.event
        def on_closed():
            self._closed = True

        self._control = self._capture.start_free_threaded()

    def latest_capture(self, max_age_s: float = 1.0) -> tuple[np.ndarray, WindowMetrics | None] | None:
        """The newest frame with the window metrics measured when it arrived (None metrics = they could not be read)."""
        with self._lock:
            if self._latest is None or time.monotonic() - self._latest_at > max_age_s:
                return None
            return self._latest, self._latest_metrics

    def latest(self, max_age_s: float = 1.0) -> np.ndarray | None:
        capture = self.latest_capture(max_age_s)
        return None if capture is None else capture[0]

    @property
    def window_found(self) -> bool:
        return not self._closed

    def stop(self) -> None:
        try:
            self._control.stop()
        except Exception:  # noqa: BLE001 - shutting down
            pass
