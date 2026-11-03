"""Occupancy gate: is this slot showing something DIFFERENT from its own empty baseline?

The portrait matcher answers "which hero does this crop look like?" -- it has no concept of "no hero here".
An empty slot is not flat (frame, art, glow), so the matcher happily names a hero for it. This gate runs
BEFORE the matcher and answers the question the matcher cannot:

    empty/change detection -> portrait matching -> confidence/margin -> temporal confirmation -> draft fact

Method (deterministic, CPU only, no ML/OCR/GPU): every slot crop becomes a 32x18 grayscale thumbnail with its
low frequencies removed (`x - GaussianBlur(x, sigma=3)`), so a uniform glow, a pulse or a brightness shift
vanishes while the structure of a portrait (edges, face, items) stays. The distance between two signatures is
their mean absolute difference (gray levels, 0..255).

Arming: a slot is only eligible after a stable EMPTY BASELINE was observed for it -- at least `baseline_frames`
frames spanning `baseline_ms`, whose own frame-to-frame deviation stays under `max_baseline_noise`. Until then
(and whenever the baseline cannot be trusted) NOTHING is eligible: fail closed. A helper started mid-draft
baselines the picks already on screen as "unchanged" and never reports them -- missing a late pick is
preferable to inventing one.

A slot is OCCUPIED when its distance to the baseline exceeds `max(min_delta, noise_k * its own baseline noise)`.
Re-arming (new baseline) happens on `rearm()`, on window loss and on a frame-size change. Screen lifecycle
comes from GSI, not from a count of changed portraits: bot lobbies can fill a whole roster in one rendered frame.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Mapping

import cv2
import numpy as np

SlotKey = tuple[str, int]

SIG_W, SIG_H = 32, 18
HP_SIGMA = 3.0


@dataclass(frozen=True)
class OccupancyFrame:
    armed: bool
    occupied: Mapping[SlotKey, bool]
    rearmed: bool = False  # the baseline changed on this frame: downstream temporal state must reset too


def signature(crop: np.ndarray) -> np.ndarray:
    """High-passed grayscale thumbnail: structure without glow."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    small = cv2.resize(gray, (SIG_W, SIG_H), interpolation=cv2.INTER_AREA).astype(np.float32)
    return small - cv2.GaussianBlur(small, (0, 0), HP_SIGMA)


def distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean(np.abs(a - b)))


def readable(crops: Mapping[SlotKey, np.ndarray]) -> bool:
    """A frame with a missing/degenerate slot crop, or a uniformly flat bar, is not evidence of anything."""
    if not crops:
        return False
    flat = 0
    for crop in crops.values():
        if crop is None or crop.size == 0 or crop.shape[0] < 4 or crop.shape[1] < 4:
            return False
        if float(np.std(crop.astype(np.float32))) < 1.0:
            flat += 1
    return flat < len(crops)


@dataclass
class OccupancyGate:
    baseline_frames: int = 6
    baseline_ms: float = 800.0
    max_baseline_noise: float = 4.0
    min_delta: float = 6.0
    noise_k: float = 3.0
    _buffer: deque = field(default_factory=deque)  # (now_ms, {key: signature})
    _baseline: dict[SlotKey, np.ndarray] = field(default_factory=dict)
    _threshold: dict[SlotKey, float] = field(default_factory=dict)
    # Diagnostics only: what the last update() saw.
    last_state: str = "idle"  # idle | unreadable | collecting | armed | rearmed
    last_distance: dict[SlotKey, float] = field(default_factory=dict)

    @property
    def armed(self) -> bool:
        return bool(self._baseline)

    def rearm(self) -> None:
        self._buffer.clear()
        self._baseline.clear()
        self._threshold.clear()

    def update(self, crops: Mapping[SlotKey, np.ndarray], now_ms: float) -> OccupancyFrame:
        closed = {key: False for key in crops}
        self.last_distance = {}
        if not readable(crops):
            self.last_state = "unreadable"
            return OccupancyFrame(self.armed, closed)
        signatures = {key: signature(crop) for key, crop in crops.items()}
        if not self.armed:
            self._collect(signatures, now_ms)
            self.last_state = "armed" if self.armed else "collecting"
            return OccupancyFrame(self.armed, closed)
        if set(signatures) != set(self._baseline):
            self.rearm()
            self.last_state = "rearmed"
            return OccupancyFrame(False, closed, rearmed=True)
        self.last_distance = {key: distance(sig, self._baseline[key]) for key, sig in signatures.items()}
        occupied = {key: self.last_distance[key] >= self._threshold[key] for key in signatures}
        self.last_state = "armed"
        return OccupancyFrame(True, occupied)

    def _collect(self, signatures: dict[SlotKey, np.ndarray], now_ms: float) -> None:
        if self._buffer and set(self._buffer[-1][1]) != set(signatures):
            self._buffer.clear()
        self._buffer.append((now_ms, signatures))
        while len(self._buffer) > self.baseline_frames and now_ms - self._buffer[0][0] > self.baseline_ms * 2:
            self._buffer.popleft()
        if len(self._buffer) < self.baseline_frames or now_ms - self._buffer[0][0] < self.baseline_ms:
            return
        keys = list(signatures)
        means = {key: np.mean([frame[key] for _, frame in self._buffer], axis=0) for key in keys}
        noise = {key: max(distance(frame[key], means[key]) for _, frame in self._buffer) for key in keys}
        if max(noise.values()) > self.max_baseline_noise:
            self._buffer.popleft()  # the bar is still moving: keep waiting, trust nothing
            return
        self._baseline = means
        self._threshold = {key: max(self.min_delta, self.noise_k * noise[key]) for key in keys}
        self._buffer.clear()

    def threshold_of(self, key: SlotKey) -> float | None:
        """Diagnostics only: the distance a slot must exceed to count as occupied."""
        return self._threshold.get(key)
