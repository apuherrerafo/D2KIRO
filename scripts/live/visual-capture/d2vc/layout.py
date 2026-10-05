"""Where the hero slots are on Dota's hero-selection screen, as NORMALIZED rectangles of a 16:9 viewport.

Nothing is a pixel coordinate: every rect is a fraction of the viewport, so 1280x720, 1920x1080 and
2560x1440 use the same layout. The viewport is the largest centred 16:9 area of the captured frame
(letter/pillar-boxed setups included). A different screen layout is a different JSON file, calibrated ONCE
with `calibrate` -- not every match.

STATUS: the built-in layout is `standard` -- the default for common 16:9 Ranked All Pick screens, derived from
the known shape of the Dota 2 top bar. It is usable out of the box: calibration is OPTIONAL and only refines
it (`calibrated`). Safety does not depend on the layout: a slot that does not clearly match a portrait emits
nothing (threshold + margin + temporal stability), so a misplaced box costs recall, never a wrong hero.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SIDES = ("radiant", "dire")
SLOTS_PER_SIDE = 5


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    w: float
    h: float


@dataclass
class Layout:
    status: str = "standard"  # "standard" (built-in default) | "calibrated" (optional refinement)
    aspect: float = 16 / 9
    slots: dict[str, list[Rect]] = field(default_factory=dict)
    bans: list[Rect] = field(default_factory=list)  # empty until bans are verified visible


# Slots are stored per SIDE (not per screen half): `slots["radiant"]` is where Radiant's heroes are drawn.
def _row(x0: float, y: float, w: float, h: float, gap: float) -> list[Rect]:
    return [Rect(x0 + i * (w + gap), y, w, h) for i in range(SLOTS_PER_SIDE)]


def default_layout() -> Layout:
    left = _row(0.045, 0.012, 0.062, 0.070, 0.004)
    right = _row(0.625, 0.012, 0.062, 0.070, 0.004)
    return Layout(status="standard", slots={"radiant": left, "dire": right})


def viewport(frame_w: int, frame_h: int, aspect: float = 16 / 9) -> tuple[int, int, int, int]:
    """(x, y, w, h) of the centred `aspect` area inside the frame."""
    if frame_w / frame_h > aspect:
        w = int(round(frame_h * aspect))
        return ((frame_w - w) // 2, 0, w, frame_h)
    h = int(round(frame_w / aspect))
    return (0, (frame_h - h) // 2, frame_w, h)


def crop(frame: np.ndarray, rect: Rect, vp: tuple[int, int, int, int]) -> np.ndarray:
    vx, vy, vw, vh = vp
    x0, y0 = vx + int(round(rect.x * vw)), vy + int(round(rect.y * vh))
    x1, y1 = x0 + max(1, int(round(rect.w * vw))), y0 + max(1, int(round(rect.h * vh)))
    height, width = frame.shape[:2]
    return frame[max(0, y0):min(height, y1), max(0, x0):min(width, x1)]


def layout_from_dict(data: dict) -> Layout:
    def rects(rows: list[dict]) -> list[Rect]:
        return [Rect(float(r["x"]), float(r["y"]), float(r["w"]), float(r["h"])) for r in rows]

    layout = Layout(
        status=str(data.get("status", "calibrated")),
        aspect=float(data.get("aspect", 16 / 9)),
        slots={side: rects(data["slots"][side]) for side in SIDES},
        bans=rects(data.get("bans", [])),
    )
    for side in SIDES:
        if len(layout.slots[side]) != SLOTS_PER_SIDE:
            raise ValueError(f"layout needs {SLOTS_PER_SIDE} slots for {side}")
    return layout


def layout_to_dict(layout: Layout) -> dict:
    def rows(rects: list[Rect]) -> list[dict]:
        return [{"x": round(r.x, 5), "y": round(r.y, 5), "w": round(r.w, 5), "h": round(r.h, 5)} for r in rects]

    return {
        "status": layout.status,
        "aspect": layout.aspect,
        "slots": {side: rows(layout.slots[side]) for side in SIDES},
        "bans": rows(layout.bans),
    }


def load_layout(path: Path | None) -> Layout:
    if path is None:
        return default_layout()
    return layout_from_dict(json.loads(path.read_text(encoding="utf-8")))


def save_layout(layout: Layout, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(layout_to_dict(layout), indent=1), encoding="utf-8")
