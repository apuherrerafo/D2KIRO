"""Lock state of a pick card, read from the card's own CHROME -- never from the hero portrait.

A Dota hero-selection card shows a player-colour bar. While a player is only hovering a hero (or the card is
empty) the bar sits at the BOTTOM of the card; the moment the pick is LOCKED it moves to the TOP. That is a
deterministic, resolution-independent signal (absolute colourfulness of a thin strip), measured on the saved real
corpus: locked cards >= 103.5, non-locked draft cards <= 24.2, non-draft screens <= 45.3. A slot may enter hero
matching only when the card is locked AND the occupancy gate says it changed from its empty baseline; the
occupancy distance is supporting evidence and can never CREATE a lock.

Per slot:
  locked     top-bar chroma >= LOCK_CHROMA and occupied             -> the matcher may read a hero
  ambiguous  chroma in [AMBIGUOUS_CHROMA, LOCK_CHROMA), or a locked-looking bar on a slot that is not occupied
             (e.g. the helper started on an already-filled bar), or a big change with no bar -> never a hero;
             persisting it degrades the health (the helper does not vouch for a draft it cannot read)
  hover      occupied, not locked, nothing ambiguous (ghost / own hover)  -> never a hero, never a problem
  empty      untouched
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np

from .layout import SIDES, Layout, viewport

SlotKey = tuple[str, int]

LOCK_CHROMA = 80.0
AMBIGUOUS_CHROMA = 40.0
DIST_AMBIGUOUS = 17.5
BARS_REQUIRED = 9  # of the 10 pick cards must show a bar for the frame to count as "the hero-selection bar"

REF_HEIGHT = 900.0
TOP_STRIP_ROWS = 5  # at the 1600x900 reference geometry: the top bar of a locked card
BOTTOM_STRIP_Y = 55  # ... and the bottom bar of an unlocked card (rows 55-60)
INNER_X = (0.2, 0.8)  # the middle of the card: clear of the rounded corners and neighbours


@dataclass(frozen=True)
class CardChrome:
    top: float  # chroma of the top strip (the LOCK signal)
    bottom: float  # chroma of the bottom strip (the unlocked-card bar)

    @property
    def bar_present(self) -> bool:
        return max(self.top, self.bottom) >= LOCK_CHROMA


def strip_height(viewport_height: int) -> int:
    return max(2, int(round(TOP_STRIP_ROWS * viewport_height / REF_HEIGHT)))


def _chroma(frame: np.ndarray, x0: int, x1: int, y0: int, y1: int) -> float:
    height, width = frame.shape[:2]
    region = frame[max(0, y0):min(height, y1), max(0, x0):min(width, x1)]
    if region.size == 0:
        return 0.0
    pixels = region.reshape(-1, region.shape[-1]).astype(np.int16)
    return float(np.mean(pixels.max(axis=1) - pixels.min(axis=1)))


def card_chrome(frame: np.ndarray, layout: Layout) -> dict[SlotKey, CardChrome]:
    """The top and bottom strip chroma of every pick card (bans have no chrome)."""
    height, width = frame.shape[:2]
    vx, vy, vw, vh = viewport(width, height, layout.aspect)
    strip = strip_height(vh)
    bottom_y = vy + int(round(BOTTOM_STRIP_Y * vh / REF_HEIGHT))
    out: dict[SlotKey, CardChrome] = {}
    for side in SIDES:
        for index, rect in enumerate(layout.slots[side]):
            x0 = vx + int(round(rect.x * vw))
            w = max(1, int(round(rect.w * vw)))
            xa, xb = x0 + int(INNER_X[0] * w), x0 + max(int(INNER_X[0] * w) + 1, int(INNER_X[1] * w))
            out[(side, index)] = CardChrome(_chroma(frame, xa, xb, vy, vy + strip), _chroma(frame, xa, xb, bottom_y, bottom_y + strip))
    return out


def classify(top: float, occupied: bool, dist: float | None) -> str:
    """`locked` | `ambiguous` | `hover` | `empty` for one card. `occupied`/`dist` only ever DOWNGRADE a lock."""
    if top >= LOCK_CHROMA:
        return "locked" if occupied else "ambiguous"
    if top >= AMBIGUOUS_CHROMA:
        return "ambiguous"
    if dist is not None and dist >= DIST_AMBIGUOUS:
        return "ambiguous"
    return "hover" if occupied else "empty"


def bars_verified(chrome: Mapping[SlotKey, CardChrome]) -> bool:
    return sum(1 for card in chrome.values() if card.bar_present) >= BARS_REQUIRED
