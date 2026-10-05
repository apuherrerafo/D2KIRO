"""Visual capture tests. Run: `python -m unittest discover -s scripts/live/visual-capture/tests -v`.

Self-contained: a generated catalog and generated frames. Nothing touches the network, local/ or real Dota art.
"""
from __future__ import annotations

import datetime as dt
import json
import unittest

import numpy as np

from fixtures import fake_catalog  # noqa: F401  (sets sys.path for d2vc)
from d2vc.bench import DEFAULT_THRESHOLDS
from d2vc.emit import EnvelopeFactory, PrivacyViolation, assert_allowlisted
from d2vc.layout import default_layout, viewport
from d2vc.matcher import Matcher, confident
from d2vc.scan import scan_frame
from d2vc.session import VisualSession
from d2vc.stability import StabilityFilter
from d2vc.synth import blank_slot, compose_screen, degrade
from d2vc.transport import Outbox

CATALOG = fake_catalog()
MATCHER = Matcher(CATALOG)
LAYOUT = default_layout()
CLOCK = lambda: dt.datetime(2026, 10, 4, 12, 0, 0, tzinfo=dt.timezone.utc)  # noqa: E731


def screen(radiant, dire, *, size=(1920, 1080), seed=1):
    return compose_screen(CATALOG, LAYOUT, size[0], size[1], radiant=radiant, dire=dire, seed=seed, with_grid=False)


def new_session():
    return VisualSession(MATCHER, LAYOUT, DEFAULT_THRESHOLDS, EnvelopeFactory("live-session-1", "run1", CLOCK))


def picks(envelopes):
    return [(e["payload"]["type"], e["payload"].get("side"), e["payload"].get("hero")) for e in envelopes if e["payload"]["type"] != "capture_health"]


class MatcherTests(unittest.TestCase):
    def test_1_known_portrait_is_recognized_under_degradation(self):
        rng = np.random.default_rng(5)
        for hero in (1, 7, 13, 21):
            result = MATCHER.match(degrade(CATALOG.portraits[hero], rng))
            self.assertEqual(result.hero_id, hero)
            self.assertTrue(confident(result, DEFAULT_THRESHOLDS))

    def test_2_blank_and_chrome_slots_emit_nothing(self):
        frame = screen([None] * 5, [None] * 5)
        scan = scan_frame(frame, LAYOUT, MATCHER, DEFAULT_THRESHOLDS)
        self.assertEqual([r.hero_id for r in scan.readings], [None] * 10)
        from d2vc.matcher import is_blank

        rng = np.random.default_rng(2)
        for index in range(40):
            crop = blank_slot(rng, index % 4)
            self.assertTrue(is_blank(crop) or not confident(MATCHER.match(crop), DEFAULT_THRESHOLDS), f"blank kind {index % 4} produced a hero")

    def test_3_low_confidence_match_emits_nothing(self):
        rng = np.random.default_rng(9)
        noise = rng.integers(0, 255, size=(60, 100, 3)).astype(np.uint8)
        scan_noise = MATCHER.match(noise)
        self.assertFalse(confident(scan_noise, DEFAULT_THRESHOLDS))
        # a 50/50 blend of two heroes has no clear winner: the margin must keep it out
        blend = cv2_blend_even(CATALOG.portraits[2], CATALOG.portraits[9])
        self.assertFalse(confident(MATCHER.match(blend), DEFAULT_THRESHOLDS))

    def test_8_regions_map_to_the_right_side_at_every_resolution(self):
        for size in ((1280, 720), (1920, 1080), (2560, 1440), (1366, 768), (2560, 1080), (1920, 1200)):
            frame = screen([1, 2, 3, None, None], [11, 12, None, None, None], size=size)
            scan = scan_frame(frame, LAYOUT, MATCHER, DEFAULT_THRESHOLDS)
            self.assertEqual([r.hero_id for r in scan.radiant], [1, 2, 3, None, None], size)
            self.assertEqual([r.hero_id for r in scan.dire], [11, 12, None, None, None], size)

    def test_viewport_letterboxes_non_16_9(self):
        self.assertEqual(viewport(2560, 1080), (320, 0, 1920, 1080))
        self.assertEqual(viewport(1920, 1200), (0, 60, 1920, 1080))


def cv2_blend_even(a, b):
    import cv2

    return cv2.addWeighted(a, 0.5, b, 0.5, 0)


class StabilityTests(unittest.TestCase):
    def run_frames(self, frames, step_ms=125):
        """frames: list of (radiant, dire) pick lists; returns events with the time each was emitted."""
        stability = StabilityFilter()
        out = []
        for i, (radiant, dire) in enumerate(frames):
            scan = scan_frame(screen(radiant, dire), LAYOUT, MATCHER, DEFAULT_THRESHOLDS)
            for event in stability.update(scan, i * step_ms):
                out.append((i * step_ms, event))
        return out

    def test_4_stable_hero_emits_once(self):
        events = self.run_frames([([5, None, None, None, None], [None] * 5)] * 12)
        self.assertEqual([(e.kind, e.side, e.hero_id) for _, e in events], [("pick", "radiant", 5)])

    def test_4b_confirmation_is_fast_enough(self):
        events = self.run_frames([([5, None, None, None, None], [None] * 5)] * 12)
        self.assertLess(events[0][0], 600)  # < 0.6 s after the portrait first appears (8 fps)

    def test_5_repeated_frames_produce_no_duplicate(self):
        stability = StabilityFilter()
        scan = scan_frame(screen([5, None, None, None, None], [None] * 5), LAYOUT, MATCHER, DEFAULT_THRESHOLDS)
        total = sum(len(stability.update(scan, t * 100)) for t in range(30))
        self.assertEqual(total, 1)

    def test_6_a_portrait_that_flickers_before_locking_creates_no_stale_pick(self):
        flicker = [([a, None, None, None, None], [None] * 5) for a in (3, 4, 3, 4, 3, 4)]
        settle = [([9, None, None, None, None], [None] * 5)] * 8
        events = self.run_frames(flicker + settle)
        self.assertEqual([(e.kind, e.hero_id) for _, e in events], [("pick", 9)])

    def test_6b_a_confirmed_pick_that_really_changes_is_reverted_then_replaced(self):
        events = self.run_frames([([3, None, None, None, None], [None] * 5)] * 6 + [([4, None, None, None, None], [None] * 5)] * 6)
        self.assertEqual([(e.kind, e.hero_id) for _, e in events], [("pick", 3), ("revert", 3), ("pick", 4)])

    def test_6c_unreadable_frames_never_revert_a_confirmed_pick(self):
        events = self.run_frames([([3, None, None, None, None], [None] * 5)] * 6 + [([None] * 5, [None] * 5)] * 10)
        self.assertEqual([(e.kind, e.hero_id) for _, e in events], [("pick", 3)])

    def test_a_hero_cannot_sit_in_two_slots(self):
        events = self.run_frames([([3, None, None, None, None], [3, None, None, None, None])] * 8)
        self.assertEqual(len(events), 1)


class SessionAndPrivacyTests(unittest.TestCase):
    def test_session_emits_allowlisted_ocr_envelopes_for_both_sides(self):
        session = new_session()
        frame = screen([1, 2, None, None, None], [11, None, None, None, None])
        sent = []
        for t in range(10):
            sent += session.process(frame, t * 125)
        self.assertEqual(sorted(picks(sent)), sorted([("hero_picked", "radiant", 1), ("hero_picked", "radiant", 2), ("hero_picked", "dire", 11)]))
        for envelope in sent:
            assert_allowlisted(envelope)
            self.assertEqual(envelope["source"], "ocr")
        self.assertEqual(session.status.confirmed, 3)

    def test_9_no_screenshot_or_pixel_leaves_the_process(self):
        wire = []

        class Capture:
            def post(self, envelope):
                wire.append(json.dumps(envelope))
                return True

        session = new_session()
        outbox = Outbox(Capture())
        frame = screen([1, 2, None, None, None], [11, None, None, None, None], size=(2560, 1440))
        for t in range(10):
            outbox.submit(session.process(frame, t * 125))
        self.assertTrue(wire)
        self.assertLess(max(len(w) for w in wire), 400)  # a fact is a few hundred bytes, never an image
        allowed = {"schema", "eventId", "sessionId", "seq", "emittedAt", "source", "confidence", "payload"}
        for message in wire:
            self.assertLessEqual(set(json.loads(message)), allowed)

    def test_allowlist_rejects_anything_else(self):
        factory = EnvelopeFactory("s", "r", CLOCK)
        good = factory.health("ok", "VISUAL_OK")
        for mutate in (
            lambda e: e.update(screenshot="AAAA"),
            lambda e: e["payload"].update(playerName="x"),
            lambda e: e["payload"].update(detail="chat: hello"),
            lambda e: e.update(source="manual"),
            lambda e: e["payload"].update(type="session_started"),
        ):
            bad = json.loads(json.dumps(good))
            mutate(bad)
            with self.assertRaises(PrivacyViolation):
                assert_allowlisted(bad)
        with self.assertRaises(PrivacyViolation):
            assert_allowlisted({**good, "payload": {**good["payload"], "detail": b"raw"}})

    def test_12_losing_the_window_reports_degraded_and_invents_nothing(self):
        session = new_session()
        frame = screen([1, None, None, None, None], [None] * 5)
        for t in range(8):
            session.process(frame, t * 125)
        self.assertEqual(session.tick_no_frame(1_500, True), [])  # a short gap is not a loss
        lost = session.tick_no_frame(5_000, False)
        self.assertEqual([(e["payload"]["type"], e["payload"]["status"], e["payload"]["detail"]) for e in lost], [("capture_health", "lost", "VISUAL_CAPTURE_LOST")])
        self.assertEqual(picks(lost), [])
        self.assertEqual(session.tick_no_frame(6_000, False), [])  # reported once, not spammed
        self.assertFalse(session.status.window_found)
        recovered = session.process(frame, 7_000)
        self.assertEqual(recovered[0]["payload"]["status"], "ok")

    def test_never_seen_window_reports_degraded(self):
        session = new_session()
        out = session.tick_no_frame(5_000, False)
        self.assertEqual(out[0]["payload"]["detail"], "VISUAL_NO_WINDOW")
        self.assertEqual(picks(out), [])

    def test_status_line_is_plain_language(self):
        session = new_session()
        session.process(screen([1, None, None, None, None], [None] * 5), 0)
        line = session.status.line()
        self.assertIn("Visual capture", line)
        self.assertIn("Dota window found", line)
        self.assertIn("/10 heroes recognized", line)
        for jargon in ("score", "layout", "provisional", " ms", "confidence"):
            self.assertNotIn(jargon, line.lower())

    def test_status_line_waits_then_looks_for_window(self):
        session = new_session()
        self.assertIn("looking for the Dota window", session.status.line())
        session.process(screen([None] * 5, [None] * 5), 0)
        self.assertIn("waiting for hero selection", session.status.line())


class DefaultLayoutLiveTests(unittest.TestCase):
    """Real Party 5 use: `python -m d2vc live` with NO calibration, NO flag, bans not verified."""

    def test_default_layout_is_standard_and_has_no_ban_region(self):
        self.assertEqual(default_layout().status, "standard")
        self.assertEqual(default_layout().bans, [])

    def test_all_ten_picks_confirm_on_common_16_9_resolutions_and_bans_stay_unknown(self):
        radiant, dire = [1, 2, 3, 4, 5], [6, 7, 8, 9, 10]
        for size in ((1600, 900), (1920, 1080), (1280, 720), (2560, 1440)):
            session = new_session()
            frame = screen(radiant, dire, size=size)
            out: list[dict] = []
            for step in range(5):
                out += session.process(frame, step * 200)
            hero_picks = [e for e in out if e["payload"]["type"] == "hero_picked"]
            self.assertEqual(len(hero_picks), 10, size)
            self.assertEqual([e for e in out if e["payload"]["type"] == "hero_banned"], [], size)
            self.assertEqual(session.status.confirmed, 10, size)
            self.assertIn("10/10 heroes recognized", session.status.line())

    def test_live_runs_on_the_default_layout_without_the_legacy_flag(self):
        import sys
        from unittest import mock

        from d2vc import cli

        class FakeBackend:
            window_found = True

            def __init__(self, *_):
                pass

            def latest(self):
                return None

            def stop(self):
                pass

        class FakeSender:
            def post(self, _):
                return True

        with mock.patch("d2vc.backend.WgcBackend", FakeBackend), mock.patch.object(cli, "_sender_from_env", return_value=(FakeSender(), "link")), mock.patch.object(cli, "load_catalog", return_value=CATALOG), mock.patch.object(cli.time, "sleep", side_effect=KeyboardInterrupt), mock.patch.object(cli, "DEFAULT_LAYOUT_PATH", cli.DEFAULT_LAYOUT_PATH.with_name("absent-layout.json")):
            self.assertEqual(cli.main(["live"]), 0)  # not 3: nothing refuses an uncalibrated run
        self.assertIsNotNone(sys)


class GsiCfgTests(unittest.TestCase):
    CFG = '"D2KIRO"\n{\n    "uri"           "https://d2kiro-test.up.railway.app/api/live/gsi/' + "L" * 43 + '"\n    "auth"\n    {\n        "token"         "' + "ab" * 32 + '"\n    }\n}\n'

    def test_reads_origin_live_id_and_token_from_the_installed_cfg(self):
        from d2vc.gsicfg import parse_cfg

        link = parse_cfg(self.CFG)
        self.assertEqual((link.base_url, link.live_id, link.token), ("https://d2kiro-test.up.railway.app", "L" * 43, "ab" * 32))

    def test_http_or_malformed_cfg_is_not_used(self):
        from d2vc.gsicfg import parse_cfg

        self.assertIsNone(parse_cfg(self.CFG.replace("https://", "http://")))
        self.assertIsNone(parse_cfg(self.CFG.replace("ab" * 32, "zz")))

    def test_link_sender_posts_to_the_visual_path_and_never_the_frame(self):
        from d2vc.transport import LinkSender

        sender = LinkSender("https://x.example", "L" * 43, "ab" * 32)
        self.assertEqual(sender.url, "https://x.example/api/live/visual/" + "L" * 43)
        with self.assertRaises(PrivacyViolation):
            sender.post({"schema": "draft-event/v1", "frame": b"raw"})


if __name__ == "__main__":
    unittest.main()
