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
from d2vc.matcher import MatchResult, Matcher, confident
from d2vc.scan import scan_frame
from d2vc.session import VisualSession
from d2vc.stability import StabilityFilter
from d2vc.synth import blank_slot, compose_screen, degrade
from d2vc.transport import DraftLifecycle, Outbox

CATALOG = fake_catalog()
MATCHER = Matcher(CATALOG)
LAYOUT = default_layout()
CLOCK = lambda: dt.datetime(2026, 10, 4, 12, 0, 0, tzinfo=dt.timezone.utc)  # noqa: E731


def screen(radiant, dire, *, size=(1920, 1080), seed=1):
    return compose_screen(CATALOG, LAYOUT, size[0], size[1], radiant=radiant, dire=dire, seed=seed, with_grid=False)


def new_session(lifecycle=DraftLifecycle("hero_selection", 1)):
    """A helper INSIDE hero selection by default (GSI said so); pass a non-draft lifecycle or None for menu/lobby."""
    session = VisualSession(MATCHER, LAYOUT, DEFAULT_THRESHOLDS, EnvelopeFactory("live-session-1", "run1", CLOCK))
    session.on_lifecycle(lifecycle)
    return session


def jitter(frame, seed, amplitude=2):
    """Sensor/compression noise: the same empty screen never repeats pixel for pixel."""
    noise = np.random.default_rng(seed).integers(-amplitude, amplitude + 1, size=frame.shape)
    return np.clip(frame.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def arm(session, size=(1920, 1080), start_ms=0, frames=10, step_ms=125):
    """The helper runs BEFORE the queue: feed an empty hero-selection bar until the baseline is trusted."""
    base = screen([None] * 5, [None] * 5, size=size)
    sent = []
    for i in range(frames):
        sent += session.process(jitter(base, i), start_ms + i * step_ms)
    assert session.status.armed, "baseline was not established"
    return start_ms + frames * step_ms, sent


def feed(session, frame, start_ms, frames, step_ms=125, noise=True):
    sent = []
    for i in range(frames):
        sent += session.process(jitter(frame, 100 + i) if noise else frame, start_ms + i * step_ms)
    return start_ms + frames * step_ms, sent


def slot_rect_px(side, index, size=(1920, 1080)):
    vx, vy, vw, vh = viewport(size[0], size[1], LAYOUT.aspect)
    rect = LAYOUT.slots[side][index]
    return vx + int(rect.x * vw), vy + int(rect.y * vh), max(2, int(rect.w * vw)), max(2, int(rect.h * vh))


def paste(frame, side, index, image, size=(1920, 1080)):
    x0, y0, w, h = slot_rect_px(side, index, size)
    out = frame.copy()
    out[y0 : y0 + h, x0 : x0 + w] = image[:h, :w] if image.shape[:2] == (h, w) else __import__("cv2").resize(image, (w, h))
    return out


def ghost(hero, side="radiant", index=0, size=(1920, 1080)):
    """Empty-slot ART that the matcher reads as `hero` (dim, portrait-like texture): the real false-positive."""
    _, _, w, h = slot_rect_px(side, index, size)
    art = degrade(CATALOG.portraits[hero], np.random.default_rng(hero), slot_size=(w, h), severity=0.2)
    return np.clip(art.astype(np.float32) * 0.3 + 22, 0, 255).astype(np.uint8)


def ghost_screen(ghost_heroes, size=(1920, 1080)):
    """10 EMPTY slots, each drawn with art that resembles some hero."""
    frame = screen([None] * 5, [None] * 5, size=size)
    for i, hero in enumerate(ghost_heroes):
        side, index = ("radiant", i) if i < 5 else ("dire", i - 5)
        frame = paste(frame, side, index, ghost(hero, side, index, size), size)
    return frame


def hero_slot(hero, side, index, size=(1920, 1080), seed=3):
    _, _, w, h = slot_rect_px(side, index, size)
    return degrade(CATALOG.portraits[hero], np.random.default_rng(seed), slot_size=(w, h), severity=0.4)


def picks(envelopes):
    return [(e["payload"]["type"], e["payload"].get("side"), e["payload"].get("hero")) for e in envelopes if e["payload"]["type"] != "capture_health"]


class MatcherTests(unittest.TestCase):
    def test_real_1600x900_slot_geometry_matches_the_measured_rows(self):
        layout = default_layout()
        # These are the measured first card positions, not the old profile-chrome crops (72 / 1000).
        self.assertEqual(round(layout.slots["radiant"][0].x * 1600), 177)
        self.assertEqual(round(layout.slots["dire"][0].x * 1600), 914)
        self.assertEqual(
            [round(slot.x * 1600) for slot in layout.slots["radiant"]],
            [177, 278, 379, 480, 581],
        )
        self.assertEqual(
            [round(slot.x * 1600) for slot in layout.slots["dire"]],
            [914, 1015, 1118, 1220, 1322],
        )

    def test_phantom_assassin_boundary_uses_068_without_weakening_margin(self):
        self.assertEqual(DEFAULT_THRESHOLDS.min_score, 0.68)
        self.assertEqual(DEFAULT_THRESHOLDS.min_margin, 0.15)
        boundary = MatchResult(44, 0.68, 1, 0.53, 0.15, ((44, 0.68), (1, 0.53)))
        self.assertTrue(confident(boundary, DEFAULT_THRESHOLDS))
        self.assertFalse(confident(MatchResult(44, 0.6799, 1, 0.53, 0.15, ((44, 0.6799), (1, 0.53))), DEFAULT_THRESHOLDS))
        self.assertFalse(confident(MatchResult(44, 0.681, 1, 0.532, 0.149, ((44, 0.681), (1, 0.532))), DEFAULT_THRESHOLDS))

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
        t0, _ = arm(session)
        frame = screen([1, 2, None, None, None], [11, None, None, None, None])
        sent = []
        for t in range(10):
            sent += session.process(frame, t0 + t * 125)
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
        t0, armed_out = arm(session, size=(2560, 1440))
        outbox.submit(armed_out)
        frame = screen([1, 2, None, None, None], [11, None, None, None, None], size=(2560, 1440))
        for t in range(10):
            outbox.submit(session.process(frame, t0 + t * 125))
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
        t0, _ = arm(session)
        frame = screen([1, None, None, None, None], [None] * 5)
        for t in range(8):
            session.process(frame, t0 + t * 125)
        self.assertEqual(session.tick_no_frame(t0 + 1_500, True), [])  # a short gap is not a loss
        lost = session.tick_no_frame(t0 + 5_000, False)
        self.assertEqual([(e["payload"]["type"], e["payload"]["status"], e["payload"]["detail"]) for e in lost], [("capture_health", "lost", "VISUAL_CAPTURE_LOST")])
        self.assertEqual(picks(lost), [])
        self.assertEqual(session.tick_no_frame(t0 + 6_000, False), [])  # reported once, not spammed
        self.assertFalse(session.status.window_found)
        recovered = session.process(frame, t0 + 7_000)
        self.assertEqual(recovered[0]["payload"]["status"], "ok")

    def test_never_seen_window_reports_degraded(self):
        session = new_session()
        out = session.tick_no_frame(5_000, False)
        self.assertEqual(out[0]["payload"]["detail"], "VISUAL_NO_WINDOW")
        self.assertEqual(picks(out), [])

    def test_status_line_is_plain_language(self):
        session = new_session()
        t0, _ = arm(session)
        feed(session, screen([1, None, None, None, None], [None] * 5), t0, 6)
        line = session.status.line()
        self.assertIn("Visual capture", line)
        self.assertIn("Dota window found", line)
        self.assertIn("/10 heroes recognized", line)
        for jargon in ("score", "layout", "provisional", " ms", "confidence"):
            self.assertNotIn(jargon, line.lower())

    def test_status_line_waits_then_looks_for_window(self):
        session = new_session(DraftLifecycle("waiting", 0))
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
            t0, _ = arm(session, size=size)
            out: list[dict] = []
            for n in range(1, 11):  # picks land one at a time, as in a real draft
                frame = screen(radiant[: min(n, 5)] + [None] * (5 - min(n, 5)), dire[: max(0, n - 5)] + [None] * (5 - max(0, n - 5)), size=size)
                for step in range(4):
                    out += session.process(frame, t0 + (n * 4 + step) * 150)
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


class OccupancyGateRegressionTests(unittest.TestCase):
    """REAL bug: before anyone picked, 5/10 heroes were 'recognized' on empty slots. The matcher alone cannot
    tell an empty slot from an occupied one; the occupancy gate (own empty baseline) must."""

    GHOSTS = [4, 8, 12, 16, 20, 5, 9, 13, 17, 21]

    def test_fixture_reproduces_the_bug_matcher_alone_names_heroes_on_empty_slots(self):
        scan = scan_frame(ghost_screen(self.GHOSTS), LAYOUT, MATCHER, DEFAULT_THRESHOLDS)  # no gate
        self.assertGreaterEqual(scan.recognized, 5)

    def test_1_empty_baseline_emits_zero_picks_forever_even_when_the_matcher_would_fire(self):
        session = new_session()
        frame = ghost_screen(self.GHOSTS)
        t, sent = feed(session, frame, 0, 12)  # arming on the empty bar
        t, more = feed(session, frame, t, 60)  # ~7 s of an unchanged empty bar
        self.assertEqual(picks(sent + more), [])
        self.assertEqual(session.status.recognized, 0)
        self.assertEqual(session.status.confirmed, 0)
        self.assertTrue(session.status.armed)

    def test_2_one_slot_changes_to_a_known_hero_exactly_one_pick(self):
        session = new_session()
        base = ghost_screen(self.GHOSTS)
        t, _ = feed(session, base, 0, 12)
        _, sent = feed(session, paste(base, "radiant", 2, hero_slot(7, "radiant", 2)), t, 12)
        self.assertEqual(picks(sent), [("hero_picked", "radiant", 7)])
        self.assertEqual(session.status.confirmed, 1)

    def test_3_unchanged_empty_slots_stay_zero_while_a_neighbour_is_picked(self):
        session = new_session()
        base = ghost_screen(self.GHOSTS)
        t, _ = feed(session, base, 0, 12)
        _, sent = feed(session, paste(base, "dire", 4, hero_slot(3, "dire", 4)), t, 40)
        self.assertEqual(picks(sent), [("hero_picked", "dire", 3)])
        self.assertEqual(session.status.recognized, 1)

    def test_4_noisy_glowing_empty_slot_is_not_occupied(self):
        session = new_session()
        base = ghost_screen(self.GHOSTS)
        t, _ = feed(session, base, 0, 12)
        x0, y0, w, h = slot_rect_px("radiant", 1)
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        radial = np.exp(-(((xs - w / 2) / (w / 2)) ** 2 + ((ys - h / 2) / (h / 2)) ** 2))
        sent = []
        for i in range(60):  # the "your turn" pulse: brightness breathes 0..45 gray levels over the slot
            glow = (22.0 + 22.0 * np.sin(i / 4.0)) * radial
            frame = base.copy()
            region = frame[y0 : y0 + h, x0 : x0 + w].astype(np.float32) + glow[:, :, None]
            frame[y0 : y0 + h, x0 : x0 + w] = np.clip(region, 0, 255).astype(np.uint8)
            sent += session.process(jitter(frame, 500 + i, 3), t + i * 125)
        self.assertEqual(picks(sent), [])
        self.assertEqual(session.status.recognized, 0)

    def test_5_stable_hero_is_one_fact(self):
        session = new_session()
        base = ghost_screen(self.GHOSTS)
        t, _ = feed(session, base, 0, 12)
        _, sent = feed(session, paste(base, "radiant", 0, hero_slot(11, "radiant", 0)), t, 80)
        self.assertEqual(picks(sent), [("hero_picked", "radiant", 11)])

    def test_6_hero_changes_before_lock_reverts_old_then_picks_new(self):
        import cv2

        session = new_session()
        base = ghost_screen(self.GHOSTS)
        t, _ = feed(session, base, 0, 12)
        t, first = feed(session, paste(base, "radiant", 0, hero_slot(11, "radiant", 0)), t, 10)
        blend = cv2.addWeighted(hero_slot(11, "radiant", 0), 0.5, hero_slot(15, "radiant", 0), 0.5, 0)
        t, transition = feed(session, paste(base, "radiant", 0, blend), t, 6)  # animation half-way: nothing new
        t, second = feed(session, paste(base, "radiant", 0, hero_slot(15, "radiant", 0, seed=4)), t, 10)
        self.assertEqual(picks(first), [("hero_picked", "radiant", 11)])
        self.assertEqual(picks(transition), [])
        self.assertEqual(picks(second), [("pick_reverted", "radiant", 11), ("hero_picked", "radiant", 15)])

    def test_7_blank_or_unreadable_frames_invent_nothing_and_do_not_arm(self):
        session = new_session()
        black = np.zeros((1080, 1920, 3), np.uint8)
        _, sent = feed(session, black, 0, 30, noise=False)
        self.assertEqual(picks(sent), [])
        self.assertFalse(session.status.armed)  # a black frame is no baseline
        t, _ = feed(session, ghost_screen(self.GHOSTS), 4_000, 12)
        self.assertTrue(session.status.armed)
        _, after = feed(session, black, t, 20, noise=False)  # alt-tab / overlay mid-draft
        self.assertEqual(picks(after), [])
        self.assertTrue(session.status.armed)  # unreadable frames neither arm nor disarm

    def test_8_draft_restart_resets_the_baseline(self):
        session = new_session()
        base = ghost_screen(self.GHOSTS)
        with_hero = paste(base, "radiant", 0, hero_slot(11, "radiant", 0))
        t, _ = feed(session, base, 0, 12)
        t, first = feed(session, with_hero, t, 12)
        self.assertEqual(picks(first), [("hero_picked", "radiant", 11)])
        session.rearm()  # explicit: new draft
        self.assertFalse(session.status.armed)
        self.assertEqual(session.status.confirmed, 0)
        t, immediate = feed(session, base, t, 12)  # fresh empty bar -> fresh baseline
        t, again = feed(session, with_hero, t, 12)
        self.assertEqual(picks(immediate), [])
        self.assertEqual(picks(again), [("hero_picked", "radiant", 11)])  # same hero, same slot: a NEW draft's fact

    def test_8b_gsi_closes_before_a_wholesale_menu_change(self):
        session = new_session()
        menu = screen([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])  # a different screen entirely, full of portrait-like art
        t, _ = arm(session)  # helper started on an EMPTY bar...
        self.assertTrue(session.on_lifecycle(DraftLifecycle("ended", 1)))
        _, sent = feed(session, menu, t, 30)  # GSI, not portrait count, owns the lifecycle boundary
        self.assertEqual(picks(sent), [])
        self.assertFalse(session.status.armed)

    def test_8b_bot_lobby_can_reveal_a_full_roster_in_one_frame(self):
        session = new_session()
        roster = screen([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])
        t, _ = arm(session)
        _, sent = feed(session, roster, t, 12)
        self.assertEqual(len(picks(sent)), 10)
        self.assertEqual(session.status.confirmed, 10)

    def test_8c_late_start_on_an_already_filled_bar_fails_closed(self):
        session = new_session()
        filled = screen([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])
        t, sent = feed(session, filled, 0, 40)
        self.assertEqual(picks(sent), [])  # picks already on screen when we started: never reported, never invented
        self.assertEqual(session.status.confirmed, 0)

    def test_9_the_helper_emits_one_claim_per_hero_however_many_frames_show_it(self):
        # GSI/visual dedupe of the player's own hero lives engine-side (apps/engine/src/live/live-visual.test.ts).
        session = new_session()
        base = ghost_screen(self.GHOSTS)
        t, _ = feed(session, base, 0, 12)
        _, sent = feed(session, paste(base, "radiant", 0, hero_slot(11, "radiant", 0)), t, 100)
        self.assertEqual(len([e for e in sent if e["payload"]["type"] == "hero_picked"]), 1)

    def test_10_no_position_is_inferred_from_the_screen_slot(self):
        session = new_session()
        base = ghost_screen(self.GHOSTS)
        t, _ = feed(session, base, 0, 12)
        _, sent = feed(session, paste(base, "radiant", 4, hero_slot(11, "radiant", 4)), t, 12)
        facts = [e for e in sent if e["payload"]["type"] == "hero_picked"]
        self.assertEqual(len(facts), 1)
        self.assertEqual(set(facts[0]["payload"]), {"type", "hero", "side"})
        for key in facts[0]["payload"]:
            self.assertNotIn("position", key.lower())
            self.assertNotIn("slot", key.lower())

    def test_noisy_baseline_is_not_trusted(self):
        session = new_session()
        base = ghost_screen(self.GHOSTS)
        rng = np.random.default_rng(1)
        for i in range(40):  # the bar keeps changing heavily: no trustworthy empty baseline
            frame = np.clip(base.astype(np.int16) + rng.integers(-60, 61, size=base.shape), 0, 255).astype(np.uint8)
            session.process(frame, i * 125)
        self.assertFalse(session.status.armed)


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

    def test_with_d2kiro_companion_it_posts_to_the_local_relay_with_the_local_token(self):
        from d2vc.gsicfg import parse_cfg
        from d2vc.transport import LinkSender

        companion = self.CFG.replace("https://d2kiro-test.up.railway.app/api/live/gsi/" + "L" * 43, "http://127.0.0.1:53120/gsi")
        link = parse_cfg(companion)
        self.assertEqual((link.base_url, link.live_id, link.token), ("http://127.0.0.1:53120/relay", "companion", "ab" * 32))
        self.assertEqual(LinkSender(link.base_url, link.live_id, link.token).url, "http://127.0.0.1:53120/relay/api/live/visual/companion")
        # Only the Companion's exact loopback shape: any other http URI is still refused.
        self.assertIsNone(parse_cfg(companion.replace("127.0.0.1", "evil.example")))
        self.assertIsNone(parse_cfg(companion.replace("/gsi", "/other")))

    def test_link_sender_posts_to_the_visual_path_and_never_the_frame(self):
        from d2vc.transport import LinkSender

        sender = LinkSender("https://x.example", "L" * 43, "ab" * 32)
        self.assertEqual(sender.url, "https://x.example/api/live/visual/" + "L" * 43)
        with self.assertRaises(PrivacyViolation):
            sender.post({"schema": "draft-event/v1", "frame": b"raw"})


WAITING = DraftLifecycle("waiting", 0)
DRAFT_1 = DraftLifecycle("hero_selection", 1)
ENDED_1 = DraftLifecycle("ended", 1)
DRAFT_2 = DraftLifecycle("hero_selection", 2)
GHOSTS = OccupancyGateRegressionTests.GHOSTS


def lobby_screen():
    """Menu / lobby / matchmaking / in-match bar: a different screen, full of portrait-like art the matcher would name."""
    return screen([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])


def heartbeats(envelopes):
    return [e for e in envelopes if e["payload"]["type"] == "capture_health"]


class AutoArmTests(unittest.TestCase):
    """The helper is started BEFORE the queue and the Player never touches it again. GSI (through the server's
    answer to each visual POST) is the only thing that opens a draft: the helper re-arms by itself on each new
    hero-selection screen, takes its empty baseline THERE, and states nothing outside a draft."""

    def enter_draft(self, session, t, lifecycle=DRAFT_1):
        self.assertTrue(session.on_lifecycle(lifecycle))  # a draft boundary: the caller drops queued facts
        self.assertFalse(session.status.armed)  # nothing carried over: a fresh baseline is required
        t, sent = feed(session, ghost_screen(GHOSTS), t, 12)  # the real, empty hero-selection bar
        self.assertTrue(session.status.armed)
        return t, sent

    def test_helper_running_in_lobby_before_queue_is_closed_and_keeps_asking(self):
        session = new_session(WAITING)
        t, sent = feed(session, lobby_screen(), 0, 80)  # 10 s in the menu / lobby / matchmaking
        self.assertEqual(picks(sent), [])
        self.assertFalse(session.status.draft_open)
        self.assertFalse(session.status.armed)
        self.assertFalse(session.gate.armed)  # NO lobby baseline exists to contaminate the draft
        self.assertEqual(len(session.gate._buffer), 0)
        self.assertGreaterEqual(len(heartbeats(sent)), 9)  # ~1/s: each one asks the server "draft yet?"
        self.assertIn("waiting for hero selection", session.status.line())

    def test_lobby_to_hero_selection_rearms_automatically_on_the_real_screen(self):
        session = new_session(WAITING)
        t, _ = feed(session, lobby_screen(), 0, 40)
        self.assertFalse(session.on_lifecycle(WAITING))  # still the lobby: nothing to do
        t, _ = self.enter_draft(session, t)
        self.assertTrue(session.status.draft_open)
        # The lifecycle, not a burst of changing portraits, closes the draft before the menu is read.
        self.assertTrue(session.on_lifecycle(ENDED_1))
        _, back = feed(session, lobby_screen(), t, 30)
        self.assertEqual(picks(back), [])

    def test_zero_of_ten_before_the_first_real_pick_then_exactly_one(self):
        session = new_session(WAITING)
        t, _ = feed(session, lobby_screen(), 0, 24)
        t, _ = self.enter_draft(session, t)
        t, idle = feed(session, ghost_screen(GHOSTS), t, 56)  # ~7 s of ban phase on an empty bar
        self.assertEqual(picks(idle), [])
        self.assertEqual(session.status.confirmed, 0)
        self.assertIn("0/10 heroes recognized", session.status.line())
        _, first = feed(session, paste(ghost_screen(GHOSTS), "radiant", 2, hero_slot(7, "radiant", 2)), t, 12)
        self.assertEqual(picks(first), [("hero_picked", "radiant", 7)])
        self.assertEqual(session.status.confirmed, 1)
        self.assertIn("1/10 heroes recognized", session.status.line())

    def test_visual_facts_before_the_draft_starts_are_never_emitted(self):
        for lifecycle in (WAITING, ENDED_1, None):  # lobby, after a match, server not answering (fail closed)
            session = new_session(lifecycle)
            base = ghost_screen(GHOSTS)
            t, sent = feed(session, base, 0, 12)
            _, more = feed(session, paste(base, "radiant", 0, hero_slot(11, "radiant", 0)), t, 40)
            self.assertEqual(picks(sent + more), [], lifecycle)
            self.assertEqual(session.status.confirmed, 0, lifecycle)
            self.assertFalse(session.status.armed, lifecycle)
        self.assertIn("connecting to D2KIRO", _windowed(new_session(None)).status.line())

    def test_no_stale_candidate_survives_the_automatic_rearm(self):
        session = new_session(WAITING)
        t, _ = self.enter_draft(session, 0)
        with_hero = paste(ghost_screen(GHOSTS), "radiant", 0, hero_slot(11, "radiant", 0))
        t, half = feed(session, with_hero, t, 2)  # a candidate: seen, not yet confirmed
        self.assertEqual(picks(half), [])
        self.assertTrue(session.stability.tracks)
        # The draft is abandoned and a new one starts (new epoch) -- the Player never touches the helper.
        self.assertTrue(session.on_lifecycle(DRAFT_2))
        self.assertEqual(session.stability.tracks, {})
        self.assertEqual(session._first_seen_ms, {})
        self.assertFalse(session.status.armed)
        self.assertEqual(session.status.confirmed, 0)
        t, _ = feed(session, ghost_screen(GHOSTS), t, 12)  # the new draft's empty bar
        self.assertTrue(session.status.armed)
        self.assertEqual([(k, tr.candidate, tr.confirmed) for k, tr in session.stability.tracks.items() if tr.candidate is not None or tr.confirmed is not None], [])
        _, again = feed(session, with_hero, t, 2)  # the same 2 frames again: the old ones do not count
        self.assertEqual(picks(again), [])
        # Queued facts of the old draft are dropped at the boundary; health stays.
        factory = EnvelopeFactory("s", "r", CLOCK)
        outbox = Outbox(type("Down", (), {"post": lambda self, _: False})())
        from d2vc.stability import VisualEvent

        outbox.submit([factory.from_event(VisualEvent("pick", "radiant", 11, 0.9, 0)), factory.health("ok", "VISUAL_OK")])
        outbox.discard_facts()
        self.assertEqual([e["payload"]["type"] for e in outbox.pending], ["capture_health"])

    def test_the_same_draft_answered_again_never_rearms_mid_draft(self):
        session = new_session(WAITING)
        t, _ = self.enter_draft(session, 0)
        t, first = feed(session, paste(ghost_screen(GHOSTS), "radiant", 2, hero_slot(7, "radiant", 2)), t, 12)
        self.assertEqual(picks(first), [("hero_picked", "radiant", 7)])
        for _ in range(20):  # every heartbeat's answer repeats the same draft
            self.assertFalse(session.on_lifecycle(DRAFT_1))
        self.assertFalse(session.on_lifecycle(None))  # a dropped request does not close the draft either
        self.assertTrue(session.status.armed)
        self.assertEqual(session.status.confirmed, 1)

    def test_second_game_without_restarting_the_helper(self):
        session = new_session(WAITING)
        t, _ = feed(session, lobby_screen(), 0, 24)
        t, _ = self.enter_draft(session, t, DRAFT_1)
        t, game1 = feed(session, paste(ghost_screen(GHOSTS), "radiant", 2, hero_slot(7, "radiant", 2)), t, 12)
        self.assertEqual(picks(game1), [("hero_picked", "radiant", 7)])
        self.assertTrue(session.on_lifecycle(ENDED_1))  # GSI: into the match
        self.assertFalse(session.status.draft_open)
        t, match = feed(session, lobby_screen(), t, 80)  # 10 s of the in-match top bar, then the menu
        self.assertEqual(picks(match), [])
        self.assertEqual(session.status.confirmed, 0)
        self.assertFalse(session.on_lifecycle(ENDED_1))
        t, _ = self.enter_draft(session, t, DRAFT_2)  # next queue, same helper process
        t, idle = feed(session, ghost_screen(GHOSTS), t, 24)
        self.assertEqual(picks(idle), [])
        self.assertIn("0/10 heroes recognized", session.status.line())
        _, game2 = feed(session, paste(ghost_screen(GHOSTS), "radiant", 2, hero_slot(7, "radiant", 2)), t, 12)
        self.assertEqual(picks(game2), [("hero_picked", "radiant", 7)])  # same hero, same slot: game 2's own fact
        self.assertEqual(session.status.confirmed, 1)

    def test_lifecycle_answer_is_validated(self):
        from d2vc.transport import lifecycle_of

        ack = {"schema": "live-visual-ack/v1", "draftPhase": "hero_selection", "draftEpoch": 3}
        self.assertEqual(lifecycle_of(ack), DraftLifecycle("hero_selection", 3))
        self.assertEqual(lifecycle_of({"accepted": True, "ack": ack}), DraftLifecycle("hero_selection", 3))  # local engine
        for bad in (None, "", [], {}, {**ack, "schema": "x"}, {**ack, "draftPhase": "picking"}, {**ack, "draftEpoch": -1}, {**ack, "draftEpoch": True}, {**ack, "draftEpoch": "3"}):
            self.assertIsNone(lifecycle_of(bad), bad)


def _windowed(session):
    session.process(ghost_screen(GHOSTS), 0)
    return session


class LiveLoopAutoArmTests(unittest.TestCase):
    """`python -m d2vc live` end to end (fake window, fake clock, fake server): started in the lobby, two games,
    zero Player actions. The server's lifecycle answers are the only input besides the frames."""

    def test_two_games_from_one_helper_start(self):
        from unittest import mock

        from d2vc import cli

        ghost = ghost_screen(GHOSTS)
        pick7 = paste(ghost, "radiant", 2, hero_slot(7, "radiant", 2))
        pick7_3 = paste(pick7, "dire", 4, hero_slot(3, "dire", 4))
        segments = [  # (steps at 8 fps, frame, what the server (GSI) says)
            (40, lobby_screen(), WAITING),  # helper started before the queue
            (32, ghost, DRAFT_1),  # hero selection: bans, empty bar
            (24, pick7, DRAFT_1),
            (64, lobby_screen(), ENDED_1),  # the match
            (24, lobby_screen(), ENDED_1),  # back in the menu, queue again
            (32, ghost, DRAFT_2),
            (24, pick7, DRAFT_2),
            (24, pick7_3, DRAFT_2),
        ]
        script = [(jitter(frame, i), lifecycle) for steps, frame, lifecycle in segments for i in range(steps)]
        state = {"step": 0}
        wire: list[tuple[DraftLifecycle, dict]] = []  # envelopes accepted by the GSI-authoritative server
        rejected_facts: list[dict] = []

        class FakeBackend:
            window_found = True

            def __init__(self, *_):
                pass

            def latest(self):
                return script[state["step"]][0]

            def stop(self):
                pass

        class FakeServer:
            lifecycle = None

            def post(self, envelope):
                server_says = script[state["step"]][1]
                if envelope["payload"]["type"] == "capture_health" or server_says.drafting:
                    wire.append((server_says, envelope))
                else:
                    # The real engine returns the lifecycle ACK but declines visual facts once GSI ended the draft.
                    rejected_facts.append(envelope)
                self.lifecycle = server_says
                return True

        def sleep(_):
            state["step"] += 1
            if state["step"] >= len(script):
                raise KeyboardInterrupt

        with mock.patch("d2vc.backend.WgcBackend", FakeBackend), mock.patch.object(cli, "_sender_from_env", return_value=(FakeServer(), "link")), mock.patch.object(cli, "load_catalog", return_value=CATALOG), mock.patch.object(cli.time, "sleep", side_effect=sleep), mock.patch.object(cli.time, "monotonic", side_effect=lambda: state["step"] * 0.125), mock.patch.object(cli, "DEFAULT_LAYOUT_PATH", cli.DEFAULT_LAYOUT_PATH.with_name("absent-layout.json")), mock.patch("builtins.print"):
            self.assertEqual(cli.main(["live"]), 0)

        facts = [(said, e) for said, e in wire if e["payload"]["type"] != "capture_health"]
        self.assertEqual(picks([e for _, e in facts]), [("hero_picked", "radiant", 7), ("hero_picked", "radiant", 7), ("hero_picked", "dire", 3)])
        self.assertTrue(all(said.drafting for said, _ in facts))  # not one fact while GSI said lobby / match
        self.assertEqual([said.epoch for said, _ in facts], [1, 2, 2])  # one pick in game 1, two in game 2
        self.assertGreaterEqual(sum(1 for said, _ in wire if said == WAITING), 4)  # 5 s in the lobby: it kept asking
        self.assertTrue(all(envelope["payload"]["type"] != "capture_health" for envelope in rejected_facts))


if __name__ == "__main__":
    unittest.main()
