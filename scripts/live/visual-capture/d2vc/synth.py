"""Synthetic degradations of reference portraits (SUPPLEMENTAL test data, never proof of real accuracy).

Simulates what a hero-selection slot looks like on screen: a different size, slightly misaligned, blurred,
re-lit, tinted, with a name-plate shadow, and compressed. Seeded: same seed -> same pixels.
"""
from __future__ import annotations

import cv2
import numpy as np

from .matcher import crop_region


def degrade(portrait: np.ndarray, rng: np.random.Generator, *, slot_w: int | None = None, slot_size: tuple[int, int] | None = None, severity: float = 1.0) -> np.ndarray:
    """One slot-sized view of `portrait`. `severity` scales every nuisance (0 = clean resize)."""
    if slot_size is not None:
        slot_w, slot_h = slot_size
    else:
        slot_w = slot_w or int(rng.integers(36, 220))
        slot_h = max(8, int(round(slot_w / float(rng.uniform(1.45, 1.9)))))
    zoom = 1.0 - float(rng.uniform(0, 0.12)) * severity
    dx, dy = (float(rng.uniform(-0.04, 0.04)) * severity for _ in range(2))
    view = crop_region(portrait, zoom, dx, dy, margin=0.0)
    out = cv2.resize(view, (slot_w, slot_h), interpolation=cv2.INTER_AREA).astype(np.float32)
    # lighting
    out = out * (1 + float(rng.uniform(-0.3, 0.3)) * severity) + float(rng.uniform(-25, 25)) * severity
    # team-colour tint overlay
    tint = rng.uniform(0, 255, size=3).astype(np.float32)
    alpha = float(rng.uniform(0, 0.22)) * severity
    out = out * (1 - alpha) + tint * alpha
    # name-plate shadow on the bottom of the slot
    shadow = np.linspace(0, float(rng.uniform(0, 0.55)) * severity, slot_h, dtype=np.float32) ** 2
    out = out * (1 - shadow[:, None, None])
    out = np.clip(out, 0, 255).astype(np.uint8)
    sigma = float(rng.uniform(0, 1.4)) * severity
    if sigma > 0.2:
        out = cv2.GaussianBlur(out, (0, 0), sigma)
    quality = int(95 - float(rng.uniform(0, 55)) * severity)
    ok, encoded = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR) if ok else out


def blank_slot(rng: np.random.Generator, kind: int) -> np.ndarray:
    """Slots that hold NO hero (negatives): empty, gradient, noise, UI chrome with text."""
    w, h = int(rng.integers(60, 200)), int(rng.integers(34, 110))
    if kind == 0:
        return np.full((h, w, 3), int(rng.integers(0, 40)), np.uint8)
    if kind == 1:
        ramp = np.linspace(rng.integers(0, 60), rng.integers(60, 120), w, dtype=np.float32)
        return np.repeat(np.tile(ramp, (h, 1))[:, :, None], 3, axis=2).astype(np.uint8)
    if kind == 2:
        return rng.integers(0, 90, size=(h, w, 3)).astype(np.uint8)
    img = np.full((h, w, 3), 35, np.uint8)
    cv2.putText(img, "PICK", (4, h // 2 + 4), cv2.FONT_HERSHEY_SIMPLEX, max(0.4, w / 160), (200, 200, 200), 1, cv2.LINE_AA)
    cv2.rectangle(img, (1, 1), (w - 2, h - 2), (90, 90, 90), 1)
    return img


def transition_blend(a: np.ndarray, b: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Half-way hover/animation frame between two portraits (should NOT be read as either hero)."""
    weight = float(rng.uniform(0.35, 0.65))
    return cv2.addWeighted(a, weight, b, 1 - weight, 0)


def compose_screen(catalog, layout, width: int, height: int, *, radiant: list[int | None], dire: list[int | None], bans: list[int] | None = None, seed: int = 1, severity: float = 0.6, with_grid: bool = True) -> np.ndarray:
    """A fake hero-selection frame: dark scene, the pickable-hero grid as distractors, and the top bar slots.

    Built from the SAME layout the scanner reads, so it proves the pipeline mechanics (viewport maths,
    cropping, matching, temporal logic) -- it cannot prove the layout matches real Dota.
    """
    from .layout import Rect, crop, viewport  # local import: layout does not depend on synth

    rng = np.random.default_rng(seed)
    frame = np.zeros((height, width, 3), np.uint8)
    ramp = np.linspace(18, 40, height, dtype=np.float32)[:, None, None]
    frame += ramp.astype(np.uint8)
    frame = (frame + rng.integers(0, 6, size=frame.shape)).astype(np.uint8)
    vx, vy, vw, vh = viewport(width, height, layout.aspect)
    ids = list(catalog.portraits)
    if with_grid:
        cols, cell_w = 14, int(vw * 0.055)
        cell_h = int(cell_w * 9 / 16)
        for index, hero_id in enumerate(ids):
            gx, gy = vx + int(vw * 0.22) + (index % cols) * (cell_w + 4), vy + int(vh * 0.28) + (index // cols) * (cell_h + 4)
            if gx + cell_w >= width or gy + cell_h >= height:
                continue
            frame[gy : gy + cell_h, gx : gx + cell_w] = degrade(catalog.portraits[hero_id], rng, slot_size=(cell_w, cell_h), severity=severity * 0.5)
    for side, picks in (("radiant", radiant), ("dire", dire)):
        for index, rect in enumerate(layout.slots[side]):
            x0, y0 = vx + int(rect.x * vw), vy + int(rect.y * vh)
            w, h = max(2, int(rect.w * vw)), max(2, int(rect.h * vh))
            hero = picks[index] if index < len(picks) else None
            if hero is None:
                frame[y0 : y0 + h, x0 : x0 + w] = (28, 26, 24)
                cv2.rectangle(frame, (x0, y0), (x0 + w - 1, y0 + h - 1), (60, 60, 60), 1)
            else:
                frame[y0 : y0 + h, x0 : x0 + w] = degrade(catalog.portraits[hero], rng, slot_size=(w, h), severity=severity)
    for index, rect in enumerate(layout.bans):
        x0, y0 = vx + int(rect.x * vw), vy + int(rect.y * vh)
        w, h = max(2, int(rect.w * vw)), max(2, int(rect.h * vh))
        hero = (bans or [])[index] if index < len(bans or []) else None
        if hero is not None:
            frame[y0 : y0 + h, x0 : x0 + w] = degrade(catalog.portraits[hero], rng, slot_size=(w, h), severity=severity)
    del Rect, crop
    return frame
