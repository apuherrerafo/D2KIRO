"""Where Dota actually RENDERS inside the captured frame: one geometry for windowed, borderless and fullscreen.

A WGC frame is the whole window surface of the captured HWND (title bar and borders included in windowed mode, a few
extra rows/columns in some borderless setups). The layout is normalized to the 16:9 area Dota draws into, so it needs
that area -- the CONTENT rectangle -- not the outer frame. This module derives it from runtime facts about the SAME
HWND that is being captured, then the session crops ONCE and everything downstream (viewport, layout, occupancy, card
chrome, matcher, stability) keeps working on the cropped content. There is no per-display-mode recognition: fullscreen
simply resolves to the whole frame when the OS facts say so.

  raw measurements (`WindowMetrics`)  --resolve_content-->  `Geometry` (content rect | unresolved + reason)

Two worlds, explicit in `Geometry.source`:
  - LIVE has a window handle. Metrics missing / contradictory => UNRESOLVED => the session reads nothing (fail closed).
    A guessed viewport on a live window is a wrong viewport: unknown > wrong.
  - OFFLINE (saved PNGs, lab, acceptance, fixtures) has no window. `Geometry.legacy()` keeps the centred 16:9 viewport.

Pure except for `find_window` / `measure_window` (Win32 via ctypes, never imported on the offline paths).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

LEGACY = "legacy_viewport"  # offline: no HWND exists, the centred 16:9 viewport of the frame is used
WINDOW = "window_metrics"  # live: the content rect was derived from the captured HWND's own metrics
UNRESOLVED = "unresolved"  # live: the metrics are missing or contradict the captured frame -- nothing may be read

# Smallest content area worth reading (no tolerance is invented here: this only rejects degenerate rectangles).
MIN_CONTENT_W = 640
MIN_CONTENT_H = 360


@dataclass(frozen=True)
class WindowMetrics:
    """Raw facts about ONE window, in screen pixels. Never interpreted here."""

    hwnd: int
    client_origin: tuple[int, int]  # ClientToScreen(0, 0): where the render area starts on the desktop
    client_size: tuple[int, int]  # GetClientRect: the render area's size
    frame_bounds: tuple[int, int, int, int]  # DWMWA_EXTENDED_FRAME_BOUNDS (left, top, right, bottom): what WGC captures
    minimized: bool = False


@dataclass(frozen=True)
class ContentRect:
    x: int
    y: int
    w: int
    h: int

    def covers(self, frame_size: tuple[int, int]) -> bool:
        return (self.x, self.y, self.w, self.h) == (0, 0, frame_size[0], frame_size[1])


@dataclass(frozen=True)
class Geometry:
    source: str
    content: ContentRect | None = None  # frame pixels; None for LEGACY (whole frame, viewport() decides) and UNRESOLVED
    hwnd: int | None = None
    reason: str = ""  # why UNRESOLVED
    facts: dict = field(default_factory=dict)  # the raw measurements, for diagnostics

    @classmethod
    def legacy(cls) -> "Geometry":
        return cls(LEGACY)

    @property
    def usable(self) -> bool:
        return self.source != UNRESOLVED

    def identity(self, frame_size: tuple[int, int]) -> tuple:
        """What a baseline is only valid for: the outer frame, the content rectangle inside it, the captured window."""
        content = None if self.content is None else (self.content.x, self.content.y, self.content.w, self.content.h)
        return (frame_size, content, self.hwnd)

    def describe(self, frame_size: tuple[int, int]) -> dict:
        content = None if self.content is None else [self.content.x, self.content.y, self.content.w, self.content.h]
        return {"source": self.source, "frame": list(frame_size), "content": content, "hwnd": self.hwnd, **({"reason": self.reason} if self.reason else {}), **self.facts}


def _facts(metrics: WindowMetrics) -> dict:
    return {
        "clientOrigin": list(metrics.client_origin),
        "clientSize": list(metrics.client_size),
        "dwmBounds": list(metrics.frame_bounds),
        "minimized": metrics.minimized,
    }


def resolve_content(frame_size: tuple[int, int], metrics: WindowMetrics | None) -> Geometry:
    """The LIVE path. A content rect is trusted only when the metrics agree with the captured frame; anything else is
    UNRESOLVED with the reason. Conservative on purpose: the DWM frame bounds must equal the captured surface exactly
    (a resize / mode switch between the metrics and the frame therefore never yields a half-old rectangle)."""
    if metrics is None:
        return Geometry(UNRESOLVED, reason="metrics_unavailable")
    base = {"hwnd": metrics.hwnd, "facts": _facts(metrics)}
    if metrics.minimized:
        return Geometry(UNRESOLVED, reason="window_minimized", **base)
    client_w, client_h = metrics.client_size
    if client_w <= 0 or client_h <= 0:
        return Geometry(UNRESOLVED, reason="client_empty", **base)
    left, top, right, bottom = metrics.frame_bounds
    if right - left <= 0 or bottom - top <= 0:
        return Geometry(UNRESOLVED, reason="frame_bounds_empty", **base)
    if (right - left, bottom - top) != tuple(frame_size):
        return Geometry(UNRESOLVED, reason="frame_size_mismatch", **base)  # resize / mode-switch race or contradictory facts
    content = ContentRect(metrics.client_origin[0] - left, metrics.client_origin[1] - top, client_w, client_h)
    if content.x < 0 or content.y < 0 or content.x + content.w > frame_size[0] or content.y + content.h > frame_size[1]:
        return Geometry(UNRESOLVED, reason="content_outside_frame", **base)
    if content.w < MIN_CONTENT_W or content.h < MIN_CONTENT_H:
        return Geometry(UNRESOLVED, reason="content_too_small", **base)
    return Geometry(WINDOW, content=content, **base)


def crop_to_content(frame: np.ndarray, geometry: Geometry) -> np.ndarray:
    """The one crop. LEGACY and full-frame content are returned as-is (a view, no copy)."""
    content = geometry.content
    if content is None or content.covers((frame.shape[1], frame.shape[0])):
        return frame
    return frame[content.y : content.y + content.h, content.x : content.x + content.w]


# -- Win32 (live only; imported lazily by the backend) --------------------------------------------------------------


def find_window(title: str) -> int:
    """The HWND of the visible top-level window titled exactly `title` (the largest one if several). The capture is then
    started on THIS handle, so the window that is measured is the window that is captured. (`windows-capture`'s own
    `window_name` is a substring match: a browser tab called "Dota 2 - guide" could win.) Raises LookupError."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    found: list[tuple[int, int]] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(hwnd, _):  # noqa: ANN001
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length != len(title):
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        if buffer.value == title:
            rect = wintypes.RECT()
            user32.GetClientRect(hwnd, ctypes.byref(rect))
            found.append((rect.right * rect.bottom, int(hwnd)))
        return True

    user32.EnumWindows(visit, 0)
    if not found:
        raise LookupError(f"no visible window titled {title!r}")
    return max(found)[1]


def measure_window(hwnd: int) -> WindowMetrics | None:
    """Raw facts about `hwnd`, or None if they cannot be read (window gone, call failed). Physical pixels: the calls run
    under a per-monitor-v2 DPI context so a DPI-scaled desktop does not virtualize the numbers."""
    import ctypes
    from ctypes import wintypes

    user32, dwmapi = ctypes.windll.user32, ctypes.windll.dwmapi
    DWMWA_EXTENDED_FRAME_BOUNDS = 9
    previous = None
    try:
        user32.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
        user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        previous = user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))  # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
    except (AttributeError, OSError):
        previous = None  # pre-1703 Windows: the numbers are whatever the process awareness gives; the coherence check still guards them
    try:
        handle = wintypes.HWND(hwnd)
        if not user32.IsWindow(handle):
            return None
        minimized = bool(user32.IsIconic(handle))
        client = wintypes.RECT()
        if not user32.GetClientRect(handle, ctypes.byref(client)):
            return None
        origin = wintypes.POINT(0, 0)
        if not user32.ClientToScreen(handle, ctypes.byref(origin)):
            return None
        bounds = wintypes.RECT()
        if dwmapi.DwmGetWindowAttribute(handle, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(bounds), ctypes.sizeof(bounds)) != 0:
            return None
        return WindowMetrics(hwnd, (origin.x, origin.y), (client.right - client.left, client.bottom - client.top), (bounds.left, bounds.top, bounds.right, bounds.bottom), minimized)
    except OSError:
        return None
    finally:
        if previous:
            user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(previous))
