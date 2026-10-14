"""Card-chrome lock state and the dual-reference matcher (0.1.3). Synthetic frames only: the real-corpus numbers live in
acceptance/corpus_acceptance.py (local, not CI)."""
from __future__ import annotations

import unittest

import cv2
import numpy as np

from fixtures import fake_catalog  # noqa: F401  (sets sys.path for d2vc)
from d2vc.bench import DEFAULT_THRESHOLDS
from d2vc.lockstate import AMBIGUOUS_CHROMA, BARS_REQUIRED, DIST_AMBIGUOUS, LOCK_CHROMA, bars_verified, card_chrome, classify, strip_height
from d2vc.matcher import Matcher, banner_portrait, confident
from d2vc.scan import read_slot, scan_frame
from d2vc.synth import degrade, set_card_bar
from test_visual_capture import CATALOG, LAYOUT, MATCHER, hero_slot, lock, screen

SIZES = ((1600, 900), (1920, 1080), (1280, 720), (2560, 1440))


class LockStateTests(unittest.TestCase):
    def test_thresholds_are_the_measured_ones(self):
        self.assertEqual((LOCK_CHROMA, AMBIGUOUS_CHROMA, DIST_AMBIGUOUS, BARS_REQUIRED), (80.0, 40.0, 17.5, 9))

    def test_strip_height_is_viewport_relative(self):
        self.assertEqual([strip_height(h) for h in (900, 720, 1080, 1440, 100)], [5, 4, 6, 8, 2])  # max(2, round(5 * h / 900))

    def test_a_locked_card_has_its_bar_at_the_top_and_a_free_card_at_the_bottom_on_every_resolution(self):
        for size in SIZES:
            frame = screen([1, None, None, None, None], [None, None, None, None, 5], size=size)
            chrome = card_chrome(frame, LAYOUT)
            for key in (("radiant", 0), ("dire", 4)):
                self.assertGreaterEqual(chrome[key].top, LOCK_CHROMA, (size, key))
            for key in (("radiant", 1), ("radiant", 4), ("dire", 0)):
                self.assertLess(chrome[key].top, AMBIGUOUS_CHROMA, (size, key))
                self.assertGreaterEqual(chrome[key].bottom, LOCK_CHROMA, (size, key))
            self.assertTrue(bars_verified(chrome), size)

    def test_classification_table(self):
        self.assertEqual(classify(120, True, 30), "locked")
        self.assertEqual(classify(80, True, None), "locked")
        self.assertEqual(classify(79.9, True, 3), "ambiguous")
        self.assertEqual(classify(40, False, 0), "ambiguous")
        self.assertEqual(classify(39.9, True, 3), "hover")
        self.assertEqual(classify(39.9, False, 0), "empty")
        self.assertEqual(classify(10, True, 17.5), "ambiguous")  # a big change with no bar
        self.assertEqual(classify(10, True, 17.4), "hover")
        self.assertEqual(classify(10, False, None), "empty")

    def test_occupancy_and_distance_never_create_a_lock(self):
        for occupied in (True, False):
            for dist in (0.0, 5.0, 17.5, 60.0, None):
                self.assertNotEqual(classify(AMBIGUOUS_CHROMA - 1, occupied, dist), "locked")
        self.assertEqual(classify(LOCK_CHROMA + 50, False, 99.0), "ambiguous")  # and a bar without a change is never a hero either

    def test_nine_of_ten_bars_verify_the_frame_eight_do_not(self):
        frame = screen([None] * 5, [None] * 5)
        for i in range(1):
            set_card_bar(frame, LAYOUT, "radiant", i, None)
        self.assertTrue(bars_verified(card_chrome(frame, LAYOUT)))
        set_card_bar(frame, LAYOUT, "radiant", 1, None)
        self.assertFalse(bars_verified(card_chrome(frame, LAYOUT)))

    def test_only_a_locked_card_reaches_the_matcher(self):
        frame = screen([None] * 5, [None] * 5)
        frame = lock(frame, "radiant", 0, hero_slot(3, "radiant", 0))
        crops = {("radiant", 0): hero_slot(3, "radiant", 0)}
        for state, reason in (("hover", "hover"), ("ambiguous", "ambiguous"), ("empty", "unoccupied"), ("unreadable", "unreadable")):
            reading = read_slot("radiant", 0, crops[("radiant", 0)], MATCHER, DEFAULT_THRESHOLDS, True, state)
            self.assertEqual((reading.state, reading.hero_id, reading.reason), ("empty", None, reason))
        reading = read_slot("radiant", 0, crops[("radiant", 0)], MATCHER, DEFAULT_THRESHOLDS, True, "locked")
        self.assertEqual((reading.state, reading.hero_id), ("hero", 3))
        scan = scan_frame(frame, LAYOUT, MATCHER, DEFAULT_THRESHOLDS, None, {("radiant", 0): "hover"})  # even a perfect portrait
        self.assertEqual(scan.recognized, 0)
        self.assertEqual(scan_frame(frame, LAYOUT, MATCHER, DEFAULT_THRESHOLDS, None, {}).recognized, 0)  # a slot with no verdict is empty


class DualBankMatcherTests(unittest.TestCase):
    """The human lobby draws a dark rank banner over the lower part of the portrait. The matcher keeps both references."""

    @staticmethod
    def human_card(hero: int, seed: int = 4) -> np.ndarray:
        art = banner_portrait(CATALOG.portraits[hero])  # what a human-lobby card shows (synthesized, like the second bank)
        return degrade(art, np.random.default_rng(seed), slot_size=(110, 62), severity=0.3)

    def test_the_banner_reference_is_the_portrait_under_a_dark_overlay_on_the_lower_rows_only(self):
        portrait = CATALOG.portraits[5]
        banner = banner_portrait(portrait)
        self.assertEqual(banner.shape, portrait.shape)
        np.testing.assert_array_equal(banner[:80], portrait[:80])  # the top of the art is untouched
        self.assertLess(float(banner[100:130].mean()), float(portrait[100:130].mean()))
        self.assertTrue(np.all(banner[100:130, :, 2] >= 70))  # the overlay colour (BGR 52,52,78) dominates

    def test_a_banner_covered_card_is_read_by_the_dual_bank(self):
        for hero in (2, 9, 14, 20):
            result = MATCHER.match(self.human_card(hero))
            self.assertEqual(result.hero_id, hero)
            self.assertTrue(confident(result, DEFAULT_THRESHOLDS), (hero, result.score, result.margin))

    def test_the_second_bank_only_ever_helps_a_hero_that_is_there(self):
        plain = Matcher(CATALOG, banner_bank=False)
        rng = np.random.default_rng(11)
        for hero in (1, 7, 13, 21):
            clean = degrade(CATALOG.portraits[hero], rng, severity=0.5)
            self.assertEqual(MATCHER.match(clean).hero_id, hero)
            self.assertGreaterEqual(MATCHER.match(clean).score, plain.match(clean).score - 1e-6)  # max over banks: never lower
            covered = self.human_card(hero)
            self.assertGreater(MATCHER.match(covered).score, plain.match(covered).score)

    def test_thresholds_did_not_move_and_noise_or_blends_are_still_rejected(self):
        self.assertEqual((DEFAULT_THRESHOLDS.min_score, DEFAULT_THRESHOLDS.min_margin), (0.68, 0.15))
        noise = np.random.default_rng(9).integers(0, 255, size=(62, 110, 3)).astype(np.uint8)
        self.assertFalse(confident(MATCHER.match(noise), DEFAULT_THRESHOLDS))
        blend = cv2.addWeighted(CATALOG.portraits[2], 0.5, CATALOG.portraits[9], 0.5, 0)  # no clear winner: the margin keeps it out
        self.assertFalse(confident(MATCHER.match(blend), DEFAULT_THRESHOLDS))
        for kind in range(4):  # empty / chrome slots are still not heroes
            from d2vc.synth import blank_slot

            crop = blank_slot(np.random.default_rng(kind), kind)
            self.assertFalse(confident(MATCHER.match(crop), DEFAULT_THRESHOLDS))


if __name__ == "__main__":
    unittest.main()
