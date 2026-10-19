"""Content-rect geometry (RC2): ONE visual pipeline for windowed / borderless / fullscreen.

The captured WGC frame is the whole window surface; Dota renders into a rectangle INSIDE it. The session crops to that
content rect once and everything downstream is unchanged. Live fails closed when the window metrics cannot be trusted;
offline (no HWND) keeps the legacy centred viewport. Frames are synthetic; nothing here touches Dota, the network or `local/`.
"""
from __future__ import annotations

import unittest
from unittest import mock

import cv2
import numpy as np

from fixtures import fake_catalog  # noqa: F401  (sets sys.path for d2vc)
from d2vc import cli
from d2vc.bench import DEFAULT_THRESHOLDS
from d2vc.emit import EnvelopeFactory
from d2vc.geometry import LEGACY, UNRESOLVED, WINDOW, ContentRect, Geometry, WindowMetrics, crop_to_content, resolve_content
from d2vc.layout import viewport
from d2vc.lockstate import bars_verified, card_chrome
from d2vc.session import VisualSession
from d2vc.synth import compose_screen, set_card_bar
from d2vc.transport import DraftLifecycle
from test_visual_capture import CATALOG, CLOCK, DRAFT_1, LAYOUT, MATCHER, jitter, picks

RADIANT = [4, 8, 12, 16, 20]
DIRE = [5, 9, 13, 17, 21]
CHROME_GREY = (52, 50, 48)  # window decoration / padding around the content: desaturated, like a title bar


def content_screen(radiant, dire, size=(1600, 900), seed=1):
    return compose_screen(CATALOG, LAYOUT, size[0], size[1], radiant=radiant, dire=dire, seed=seed, with_grid=False)


def bar_only_screen(radiant, dire, size=(1600, 900)):
    """Grey scene, grey card art, only the player-colour bars carry chroma -- as on a real card, where the bar (not the
    portrait) is the lock signal. Isolates the geometry question: is the bar strip where the viewport thinks it is?"""
    frame = content_screen(radiant, dire, size)
    grey = cv2.cvtColor(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    for side, heroes in (("radiant", radiant), ("dire", dire)):
        for index, hero in enumerate(heroes):
            if hero is not None:
                set_card_bar(grey, LAYOUT, side, index, "top")
    return grey


def embed(content, outer, offset):
    """The captured surface: `content` drawn at `offset` inside an `outer` (w, h) frame of window decoration."""
    frame = np.empty((outer[1], outer[0], 3), np.uint8)
    frame[:] = CHROME_GREY
    h, w = content.shape[:2]
    frame[offset[1] : offset[1] + h, offset[0] : offset[0] + w] = content
    return frame


def metrics_for(outer, content_rect, *, hwnd=7, screen_at=(100, 50)):
    """What the OS reports when the captured surface is `outer` and Dota renders at `content_rect` = (x, y, w, h) inside it."""
    x, y, w, h = content_rect
    left, top = screen_at
    return WindowMetrics(hwnd, (left + x, top + y), (w, h), (left, top, left + outer[0], top + outer[1]))


def new_session():
    session = VisualSession(MATCHER, LAYOUT, DEFAULT_THRESHOLDS, EnvelopeFactory("live-session-1", "run1", CLOCK))
    session.on_lifecycle(DRAFT_1)
    return session


def feed(session, frame, geometry, start_ms, frames, step_ms=125):
    sent = []
    for i in range(frames):
        sent += session.process(jitter(frame, 100 + i), start_ms + i * step_ms, geometry)
    return start_ms + frames * step_ms, sent


def arm(session, empty, geometry, start_ms=0):
    t, sent = feed(session, empty, geometry, start_ms, 10)
    return t, sent


def health(envelopes):
    return [(e["payload"]["status"], e["payload"]["detail"]) for e in envelopes if e["payload"]["type"] == "capture_health"]


class ConfirmedBorderlessRegression(unittest.TestCase):
    """The case that was observed: WGC frame 1609x932, Dota drawn at 0,0,1600,900 (this test's content, NOT a rule)."""

    OUTER, CONTENT = (1609, 932), (0, 0, 1600, 900)

    def setUp(self):
        self.locked = embed(content_screen(RADIANT, DIRE), self.OUTER, (0, 0))
        self.bars_frame = embed(bar_only_screen(RADIANT, DIRE), self.OUTER, (0, 0))
        self.metrics = metrics_for(self.OUTER, self.CONTENT)

    def bars(self, frame):
        return sum(1 for card in card_chrome(frame, LAYOUT).values() if card.bar_present)

    def test_legacy_viewport_reproduces_the_geometry_failure(self):
        self.assertEqual(viewport(*self.OUTER, LAYOUT.aspect), (0, 13, 1609, 905))
        self.assertEqual(self.bars(self.bars_frame), 0)  # 0/10: the viewport is 13 px low and 9 px wide
        self.assertFalse(bars_verified(card_chrome(self.bars_frame, LAYOUT)))

    def test_resolved_content_crop_restores_the_topbar_geometry(self):
        geometry = resolve_content(self.OUTER, self.metrics)
        self.assertEqual((geometry.source, geometry.content), (WINDOW, ContentRect(0, 0, 1600, 900)))
        cropped = crop_to_content(self.bars_frame, geometry)
        self.assertEqual(cropped.shape[:2], (900, 1600))
        self.assertEqual(self.bars(cropped), 10)  # 10/10
        self.assertTrue(bars_verified(card_chrome(cropped, LAYOUT)))

    def test_session_reads_ten_heroes_with_the_content_rect_and_none_without(self):
        empty = embed(content_screen([None] * 5, [None] * 5), self.OUTER, (0, 0))
        geometry = resolve_content(self.OUTER, self.metrics)
        session = new_session()
        t, _ = arm(session, empty, geometry)
        _, sent = feed(session, self.locked, geometry, t, 8)
        self.assertEqual(len([e for e in sent if e["payload"]["type"] == "hero_picked"]), 10)
        self.assertEqual(session.status.confirmed, 10)
        legacy = new_session()  # same frames, offline contract: the guessed viewport is off the cards
        t, armed = arm(legacy, empty, None)
        _, sent = feed(legacy, self.locked, None, t, 8)
        self.assertLess(legacy.status.confirmed, 10)
        self.assertNotIn(("ok", "VISUAL_OK"), health(armed + sent))  # it never vouches for a draft it cannot read


class FullFrameContent(unittest.TestCase):
    def test_frame_equal_to_content_is_not_cropped(self):
        size = (1920, 1080)
        frame = content_screen(RADIANT, DIRE, size)
        geometry = resolve_content(size, metrics_for(size, (0, 0, *size)))
        self.assertEqual(geometry.content, ContentRect(0, 0, 1920, 1080))
        self.assertIs(crop_to_content(frame, geometry), frame)  # no copy, no crop

    def test_downstream_behaviour_is_the_same_as_offline(self):
        size = (1920, 1080)
        empty, locked = content_screen([None] * 5, [None] * 5, size), content_screen(RADIANT, DIRE, size)
        results = []
        for geometry in (resolve_content(size, metrics_for(size, (0, 0, *size))), None):
            session = new_session()
            t, _ = arm(session, empty, geometry)
            _, sent = feed(session, locked, geometry, t, 8)
            results.append(picks(sent))
        self.assertEqual(len(results[0]), 10)
        self.assertEqual(results[0], results[1])


class OffsetClientContent(unittest.TestCase):
    def test_crop_recovers_the_normalized_topbar_geometry(self):
        outer, rect = (1936, 1119), (8, 31, 1920, 1080)  # a windowed frame: side borders + title bar
        content = content_screen(RADIANT, DIRE, (1920, 1080))
        frame = embed(content, outer, (8, 31))
        geometry = resolve_content(outer, metrics_for(outer, rect))
        self.assertEqual(geometry.content, ContentRect(8, 31, 1920, 1080))
        cropped = crop_to_content(frame, geometry)
        self.assertTrue(np.array_equal(cropped, content))
        self.assertTrue(bars_verified(card_chrome(cropped, LAYOUT)))
        self.assertFalse(bars_verified(card_chrome(frame, LAYOUT)))  # without the crop the topbar is mislocated

    def test_session_reads_heroes_at_an_offset(self):
        outer, rect = (1936, 1119), (8, 31, 1920, 1080)
        geometry = resolve_content(outer, metrics_for(outer, rect))
        empty = embed(content_screen([None] * 5, [None] * 5, (1920, 1080)), outer, (8, 31))
        locked = embed(content_screen(RADIANT, DIRE, (1920, 1080)), outer, (8, 31))
        session = new_session()
        t, _ = arm(session, empty, geometry)
        _, sent = feed(session, locked, geometry, t, 8)
        self.assertEqual(len(picks(sent)), 10)


class InvalidMetricsFailClosed(unittest.TestCase):
    OUTER = (1609, 932)

    def good(self, **change):
        base = dict(hwnd=7, client_origin=(100, 50), client_size=(1600, 900), frame_bounds=(100, 50, 1709, 982), minimized=False)
        return WindowMetrics(**{**base, **change})

    def test_each_contradiction_is_unresolved_with_its_reason(self):
        cases = {
            "metrics_unavailable": None,
            "window_minimized": self.good(minimized=True),
            "client_empty": self.good(client_size=(0, 0)),
            "frame_bounds_empty": self.good(frame_bounds=(100, 50, 100, 50)),
            "frame_size_mismatch": self.good(frame_bounds=(100, 50, 1700, 960)),  # resized after the frame was captured
            "content_outside_frame": self.good(client_origin=(92, 50)),  # client starts left of the captured surface
            "content_too_small": self.good(client_size=(300, 200)),
        }
        for reason, metrics in cases.items():
            geometry = resolve_content(self.OUTER, metrics)
            self.assertEqual((geometry.source, geometry.content, geometry.reason), (UNRESOLVED, None, reason), reason)
            self.assertFalse(geometry.usable)

    def test_client_larger_than_the_frame_is_unresolved(self):
        geometry = resolve_content(self.OUTER, self.good(client_size=(1700, 900)))
        self.assertEqual(geometry.reason, "content_outside_frame")

    def test_unresolved_live_frames_emit_no_pick_and_degrade_after_the_grace(self):
        empty = embed(content_screen([None] * 5, [None] * 5), self.OUTER, (0, 0))
        locked = embed(content_screen(RADIANT, DIRE), self.OUTER, (0, 0))
        bad = resolve_content(self.OUTER, self.good(frame_bounds=(100, 50, 1700, 960)))
        session = new_session()
        t, sent = arm(session, empty, bad)
        _, more = feed(session, locked, bad, t, 24)  # 3 s of picks on a frame whose geometry is contradictory
        self.assertEqual(picks(sent + more), [])
        self.assertFalse(session.status.armed)  # nothing was baselined from a guessed viewport
        self.assertEqual(session.status.confirmed, 0)
        self.assertEqual(health(sent + more)[0], ("degraded", "VISUAL_LAYOUT_UNVERIFIED"))
        self.assertNotIn(("ok", "VISUAL_OK"), health(sent + more))

    def test_a_transient_unresolved_frame_keeps_the_known_good_baseline(self):
        empty = embed(content_screen([None] * 5, [None] * 5), self.OUTER, (0, 0))
        locked = embed(content_screen(RADIANT, DIRE), self.OUTER, (0, 0))
        good = resolve_content(self.OUTER, self.good(client_size=(1600, 900)))
        bad = resolve_content(self.OUTER, None)
        session = new_session()
        t, _ = arm(session, empty, good)
        self.assertTrue(session.status.armed)
        t, blip = feed(session, locked, bad, t, 3)  # 0.375 s < grace: silent, nothing read
        self.assertEqual((picks(blip), health(blip)), ([], []))
        self.assertTrue(session.status.armed)  # not reset
        _, sent = feed(session, locked, good, t, 8)
        self.assertEqual(len(picks(sent)), 10)

    def test_recovery_after_a_persistent_failure_speaks_again(self):
        empty = embed(content_screen([None] * 5, [None] * 5), self.OUTER, (0, 0))
        good = resolve_content(self.OUTER, self.good())
        bad = resolve_content(self.OUTER, None)
        session = new_session()
        t, _ = arm(session, empty, good)
        t, down = feed(session, empty, bad, t, 16)  # 2 s
        self.assertEqual(health(down), [("degraded", "VISUAL_LAYOUT_UNVERIFIED")])
        _, up = feed(session, empty, good, t, 4)
        self.assertEqual(health(up), [("ok", "VISUAL_OK")])

    def test_live_loop_without_metrics_reads_nothing(self):
        locked = embed(content_screen(RADIANT, DIRE), self.OUTER, (0, 0))
        empty = embed(content_screen([None] * 5, [None] * 5), self.OUTER, (0, 0))
        for metrics, expect_picks in ((self.good(), 10), (None, 0)):
            wire = self.run_live(empty, locked, metrics)
            self.assertEqual(len([e for e in wire if e["payload"]["type"] == "hero_picked"]), expect_picks, metrics)
            if metrics is None:
                self.assertEqual(health(wire)[-1], ("degraded", "VISUAL_LAYOUT_UNVERIFIED"))

    def run_live(self, empty, locked, metrics):
        script = [jitter(empty, i) for i in range(40)] + [jitter(locked, 100 + i) for i in range(40)]
        state = {"step": 0}
        wire: list[dict] = []

        class FakeBackend:
            window_found = True

            def __init__(self, *_):
                pass

            def latest_capture(self):
                return script[state["step"]], metrics

            def stop(self):
                pass

        class FakeServer:
            lifecycle = DRAFT_1

            def post(self, envelope):
                wire.append(envelope)
                return True

        def sleep(_):
            state["step"] += 1
            if state["step"] >= len(script):
                raise KeyboardInterrupt

        with mock.patch("d2vc.backend.WgcBackend", FakeBackend), mock.patch.object(cli, "_sender_from_env", return_value=(FakeServer(), "link")), mock.patch.object(cli, "load_catalog", return_value=CATALOG), mock.patch.object(cli.time, "sleep", side_effect=sleep), mock.patch.object(cli.time, "monotonic", side_effect=lambda: state["step"] * 0.125), mock.patch.object(cli, "DEFAULT_LAYOUT_PATH", cli.DEFAULT_LAYOUT_PATH.with_name("absent-layout.json")), mock.patch("builtins.print"):
            self.assertEqual(cli.main(["live"]), 0)
        return wire


class SessionRearm(unittest.TestCase):
    OUTER = (1609, 932)

    def armed_session(self, content_at, hwnd=7):
        empty = embed(content_screen([None] * 5, [None] * 5), self.OUTER, content_at)
        geometry = resolve_content(self.OUTER, metrics_for(self.OUTER, (*content_at, 1600, 900), hwnd=hwnd))
        session = new_session()
        t, _ = arm(session, empty, geometry)
        self.assertTrue(session.status.armed)
        return session, empty, geometry, t

    def test_same_geometry_keeps_the_baseline(self):
        session, empty, geometry, t = self.armed_session((0, 0))
        feed(session, empty, geometry, t, 2)
        self.assertTrue(session.status.armed)

    def test_same_frame_size_different_content_rect_rearms(self):
        session, empty, _, t = self.armed_session((0, 0))
        moved = embed(content_screen([None] * 5, [None] * 5), self.OUTER, (9, 32))
        geometry = resolve_content(self.OUTER, metrics_for(self.OUTER, (9, 32, 1600, 900)))
        session.process(jitter(moved, 1), t, geometry)
        self.assertFalse(session.status.armed)  # the old baseline is gone; a new one must be taken
        self.assertEqual(session.stability.confirmed(), {})
        feed(session, moved, geometry, t + 125, 10)
        self.assertTrue(session.status.armed)

    def test_a_new_capture_hwnd_rearms(self):
        session, empty, _, t = self.armed_session((0, 0), hwnd=7)
        other = resolve_content(self.OUTER, metrics_for(self.OUTER, (0, 0, 1600, 900), hwnd=8))
        session.process(jitter(empty, 1), t, other)
        self.assertFalse(session.status.armed)

    def test_a_different_outer_frame_rearms(self):
        session, empty, _, t = self.armed_session((0, 0))
        outer = (1700, 960)
        geometry = resolve_content(outer, metrics_for(outer, (0, 0, 1600, 900)))
        session.process(jitter(embed(content_screen([None] * 5, [None] * 5), outer, (0, 0)), 1), t, geometry)
        self.assertFalse(session.status.armed)


class OfflineContract(unittest.TestCase):
    def test_legacy_geometry_is_the_default_and_keeps_the_centred_viewport(self):
        self.assertEqual(Geometry.legacy().source, LEGACY)
        self.assertTrue(Geometry.legacy().usable)
        frame = content_screen(RADIANT, DIRE, (1920, 1080))
        self.assertIs(crop_to_content(frame, Geometry.legacy()), frame)
        self.assertEqual(viewport(2560, 1080), (320, 0, 1920, 1080))  # the pillarbox maths is untouched

    def test_no_metrics_means_offline_in_the_session_and_unresolved_in_resolve(self):
        size = (1920, 1080)
        empty, locked = content_screen([None] * 5, [None] * 5, size), content_screen(RADIANT, DIRE, size)
        session = new_session()
        t, _ = arm(session, empty, None)
        _, sent = feed(session, locked, None, t, 8)
        self.assertEqual(len(picks(sent)), 10)
        self.assertEqual(resolve_content(size, None).source, UNRESOLVED)  # a live caller can never fall into the offline path by omission


if __name__ == "__main__":
    unittest.main()
