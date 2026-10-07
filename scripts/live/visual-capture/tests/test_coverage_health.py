"""The helper must PROVE it read the draft before it vouches for it. A healthy-looking helper that read 0/10 heroes
must never clear the server's "partial draft" state (the historical real-Dota result was 0/10)."""
from __future__ import annotations

import copy
import unittest

import numpy as np

from fixtures import fake_catalog  # noqa: F401  (sets sys.path for d2vc)
from d2vc.bench import DEFAULT_THRESHOLDS
from d2vc.emit import HEALTH_DETAILS, EnvelopeFactory
from d2vc.session import UNREAD_GRACE_MS, VisualSession
from d2vc.transport import DraftLifecycle
from test_visual_capture import CLOCK, LAYOUT, MATCHER, arm, feed, hero_slot, paste, screen, slot_rect_px


def health_of(envelopes):
    return [(e["payload"]["status"], e["payload"]["detail"]) for e in envelopes if e["payload"]["type"] == "capture_health"]


def session(layout=LAYOUT):
    s = VisualSession(MATCHER, layout, DEFAULT_THRESHOLDS, EnvelopeFactory("live-session-1", "run1", CLOCK))
    s.on_lifecycle(DraftLifecycle("hero_selection", 1))
    return s


def noise_slot(side, index, size=(1920, 1080)):
    """An occupied slot whose art is NOT any catalog hero: occupancy fires, the matcher cannot name it."""
    _, _, w, h = slot_rect_px(side, index, size)
    return np.random.default_rng(99).integers(0, 255, size=(h, w, 3), dtype=np.uint8)


class CoverageHealthTests(unittest.TestCase):
    def test_new_detail_is_allowlisted(self):
        self.assertIn("VISUAL_SLOTS_UNREAD", HEALTH_DETAILS)

    def test_before_the_baseline_exists_it_does_not_vouch(self):
        s = session()
        sent = s.process(screen([None] * 5, [None] * 5), 0)
        self.assertEqual(health_of(sent), [("degraded", "VISUAL_LAYOUT_UNVERIFIED")])

    def test_an_empty_bar_on_an_unverified_layout_is_never_healthy(self):
        """0/10 and an empty bar look identical: with the unverified built-in layout that must NOT read as 'all good'."""
        s = session()
        now, sent = arm(s)
        _, more = feed(s, screen([None] * 5, [None] * 5), now, 40)
        statuses = {h for h in health_of(sent + more)}
        self.assertEqual(LAYOUT.status, "standard")
        self.assertNotIn(("ok", "VISUAL_OK"), statuses)
        self.assertIn(("degraded", "VISUAL_LAYOUT_UNVERIFIED"), statuses)

    def test_one_confirmed_hero_proves_the_boxes_are_on_the_bar_and_it_vouches(self):
        s = session()
        now, _ = arm(s)
        frame = paste(screen([None] * 5, [None] * 5), "radiant", 0, hero_slot(3, "radiant", 0))
        _, sent = feed(s, frame, now, 30)
        self.assertEqual(health_of(sent)[-1], ("ok", "VISUAL_OK"))

    def test_an_occupied_slot_it_cannot_read_withdraws_the_vouch_after_the_grace_period(self):
        s = session()
        now, _ = arm(s)
        good = paste(screen([None] * 5, [None] * 5), "radiant", 0, hero_slot(3, "radiant", 0))
        now, sent = feed(s, good, now, 30)
        self.assertEqual(health_of(sent)[-1], ("ok", "VISUAL_OK"))
        unreadable = paste(good, "dire", 0, noise_slot("dire", 0))
        frames = int(UNREAD_GRACE_MS / 125) + 8
        _, after = feed(s, unreadable, now, frames)
        self.assertEqual(health_of(after)[-1], ("degraded", "VISUAL_SLOTS_UNREAD"))

    def test_a_verified_layout_may_vouch_for_a_genuinely_empty_bar(self):
        calibrated = copy.deepcopy(LAYOUT)
        calibrated.status = "calibrated"
        s = session(calibrated)
        now, sent = arm(s)
        _, more = feed(s, screen([None] * 5, [None] * 5), now, 20)
        self.assertEqual(health_of(sent + more)[-1], ("ok", "VISUAL_OK"))

    def test_outside_a_draft_the_lifecycle_probe_stays_ok(self):
        s = VisualSession(MATCHER, LAYOUT, DEFAULT_THRESHOLDS, EnvelopeFactory("live-session-1", "run1", CLOCK))
        sent = s.process(screen([None] * 5, [None] * 5), 0)
        self.assertEqual(health_of(sent), [("ok", "VISUAL_OK")])


if __name__ == "__main__":
    unittest.main()
