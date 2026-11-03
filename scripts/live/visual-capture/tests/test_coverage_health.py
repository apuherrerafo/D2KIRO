"""The helper must PROVE it read the draft before it vouches for it -- and must never vouch for what it cannot see.

Model (0.1.3): a card's player-colour bar says LOCKED (top) or not (bottom). Hover never becomes a pick and never
degrades health; an empty or hover-only draft is a perfectly readable draft (VISUAL_OK, zero picks); a locked card the
matcher cannot name degrades the health after the grace period; an unreadable / black / partial frame never produces a
fresh OK (the previous word is retained for at most UNREAD_GRACE_MS, then LAYOUT_UNVERIFIED)."""
from __future__ import annotations

import unittest

import numpy as np

from fixtures import fake_catalog  # noqa: F401  (sets sys.path for d2vc)
from d2vc.bench import DEFAULT_THRESHOLDS
from d2vc.emit import HEALTH_DETAILS, EnvelopeFactory
from d2vc.session import HEARTBEAT_EVERY_MS, UNREAD_GRACE_MS, VisualSession
from d2vc.synth import set_card_bar
from test_visual_capture import CLOCK, LAYOUT, MATCHER, arm, feed, ghost, hero_slot, hover, jitter, lock, new_session, paste, picks, screen, slot_rect_px

OK = ("ok", "VISUAL_OK")
UNREAD = ("degraded", "VISUAL_SLOTS_UNREAD")
UNVERIFIED = ("degraded", "VISUAL_LAYOUT_UNVERIFIED")
STEP = 125


def health_of(envelopes):
    return [(e["payload"]["status"], e["payload"]["detail"]) for e in envelopes if e["payload"]["type"] == "capture_health"]


def timeline(session, frame, start_ms, frames, noise=True, step=STEP):
    """(time, envelope) for every envelope the frames produce."""
    out = []
    for i in range(frames):
        image = jitter(frame, 700 + i) if noise else frame
        for envelope in session.process(image, start_ms + i * step):
            out.append((start_ms + i * step, envelope))
    return start_ms + frames * step, out


def health_times(events, word):
    return [t for t, e in events if e["payload"]["type"] == "capture_health" and (e["payload"]["status"], e["payload"]["detail"]) == word]


def envelopes(events):
    return [e for _, e in events]


def empty():
    return screen([None] * 5, [None] * 5)


def noise_art(side, index, size=(1920, 1080)):
    """Art that is NOT any catalog hero: a locked card the matcher cannot name."""
    _, _, w, h = slot_rect_px(side, index, size)
    return np.random.default_rng(99).integers(0, 255, size=(h, w, 3), dtype=np.uint8)


def settled_ok_session():
    """Armed on an empty bar, one hero locked and confirmed, health OK. Returns (session, now_ms, frame)."""
    s = new_session()
    now, _ = arm(s)
    frame = lock(empty(), "radiant", 0, hero_slot(3, "radiant", 0))
    now, sent = feed(s, frame, now, 20)
    assert s._last_health == OK and UNREAD not in health_of(sent), (s._last_health, health_of(sent))
    return s, now, frame


class CoverageHealthTests(unittest.TestCase):
    def test_new_detail_is_allowlisted(self):
        self.assertIn("VISUAL_SLOTS_UNREAD", HEALTH_DETAILS)

    def test_before_the_baseline_exists_it_does_not_vouch(self):
        """At the opening of a draft the helper says nothing while its baseline arms (the server keeps its previous word)
        -- never OK. A re-arm that is NOT a fresh draft (geometry change) still degrades at once."""
        s = new_session()
        self.assertEqual(health_of(s.process(empty(), 0)), [])
        s.rearm()  # e.g. a frame-size change inside the draft: not a fresh empty bar
        self.assertEqual(health_of(s.process(empty(), 125)), [UNVERIFIED])

    def test_hero_selection_opens_ok_with_no_unverified_blip(self):
        """EMPTY_DRAFT_COACH_TEST: GSI opens hero selection -> the helper's first word in this draft is VISUAL_OK, within the
        grace, so the server never flips the Team Coach to "incomplete" on an empty draft."""
        s = new_session()
        _, events = timeline(s, empty(), 0, int(4_000 / STEP))
        words = health_of(envelopes(events))
        self.assertEqual(words[0], OK)
        self.assertNotIn(UNVERIFIED, words)
        self.assertNotIn(UNREAD, words)
        self.assertLess(health_times(events, OK)[0], UNREAD_GRACE_MS)  # armed (~0.9 s) before the grace ran out

    def test_hover_from_the_opening_never_blocks(self):
        """HOVER_DOES_NOT_BLOCK: own + teammate + enemy hovers from the first frame of the draft: OK, zero picks."""
        s = new_session()
        frame = hover(empty(), "radiant", 2, hero_slot(7, "radiant", 2))
        frame = paste(frame, "dire", 1, ghost(9, "dire", 1))
        now, events = timeline(s, empty(), 0, 10)
        _, more = timeline(s, frame, now, int(8_000 / STEP))
        words = health_of(envelopes(events + more))
        self.assertEqual(words[0], OK)
        self.assertEqual(set(words), {OK})
        self.assertEqual(picks(envelopes(events + more)), [])

    def test_an_unreadable_opening_stays_silent_then_degrades_never_ok(self):
        s = new_session()
        black = np.zeros((1080, 1920, 3), np.uint8)
        _, events = timeline(s, black, 0, int(4_000 / STEP), noise=False)
        self.assertEqual(health_times(events, OK), [])
        degraded = health_times(events, UNVERIFIED)
        self.assertTrue(degraded)
        self.assertGreaterEqual(degraded[0], UNREAD_GRACE_MS)
        self.assertLessEqual(degraded[0], UNREAD_GRACE_MS + STEP)

    def test_a_lock_the_helper_cannot_name_from_the_opening_blocks(self):
        """LOCKED_UNREAD_BLOCKS: the bar armed empty, then a locked card the matcher cannot name -> SLOTS_UNREAD after the
        grace, and no pick. (The engine turns SLOTS_UNREAD into a hard recommendation block.)"""
        s = new_session()
        now, _ = timeline(s, empty(), 0, 12)
        began = now
        now, events = timeline(s, lock(empty(), "dire", 0, noise_art("dire", 0)), now, int(3_000 / STEP))
        unread = health_times(events, UNREAD)
        self.assertTrue(unread)
        self.assertLessEqual(unread[0] - began, UNREAD_GRACE_MS + STEP)
        self.assertEqual(health_of(envelopes(events))[-1], UNREAD)
        self.assertEqual(picks(envelopes(events)), [])

    def test_stable_empty_draft_is_ok(self):
        """Zero picks is a readable draft: the Team Coach may recommend from the first moment of hero selection."""
        s = new_session()
        now, sent = arm(s)
        _, more = feed(s, empty(), now, 40)
        words = health_of(sent + more)
        self.assertEqual(LAYOUT.status, "standard")  # the built-in layout is not inherently unverified any more
        self.assertEqual(words[-1], OK)
        self.assertNotIn(UNREAD, words)
        self.assertEqual(picks(sent + more), [])

    def test_hover_is_no_pick_and_keeps_the_health_ok(self):
        s = new_session()
        now, _ = arm(s)
        frame = hover(empty(), "radiant", 2, hero_slot(7, "radiant", 2))  # a clear portrait, but the bar is still at the bottom
        frame = paste(frame, "radiant", 0, ghost(4, "radiant", 0))
        frame = paste(frame, "dire", 1, ghost(9, "dire", 1))
        now, sent = feed(s, frame, now, 80)  # 10 s of own + teammate hover
        self.assertEqual(picks(sent), [])
        self.assertEqual(s.status.confirmed, 0)
        self.assertEqual(s._last_health, OK)
        self.assertEqual(health_of(sent)[-1], OK)  # the 5 s heartbeat re-sends it while the frames keep reading
        self.assertNotIn(UNREAD, health_of(sent))
        self.assertEqual(s.lock_states[("radiant", 2)], "hover")
        self.assertTrue(all(state != "locked" for state in s.lock_states.values()))

    def test_locked_and_readable_is_confirmed_and_ok(self):
        s = new_session()
        now, _ = arm(s)
        frame = lock(empty(), "radiant", 0, hero_slot(3, "radiant", 0))
        _, events = timeline(s, frame, now, 30)
        self.assertEqual(picks(envelopes(events)), [("hero_picked", "radiant", 3)])
        self.assertEqual(s._last_health, OK)  # the word is only re-sent on a change or the 5 s heartbeat
        self.assertNotIn(UNREAD, health_of(envelopes(events)))
        self.assertEqual(s.lock_states[("radiant", 0)], "locked")

    def test_hero_confirmation_follows_the_lock_quickly(self):
        s = new_session()
        now, _ = arm(s)
        locked_at = now
        _, events = timeline(s, lock(empty(), "dire", 3, hero_slot(11, "dire", 3)), now, 20)
        (when,) = [t for t, e in events if e["payload"]["type"] == "hero_picked"]
        self.assertLess(when - locked_at, 600)  # three frames spanning >= 350 ms, never earlier than that
        self.assertGreaterEqual(when - locked_at, 350)

    def test_lock_transition_hover_then_locked(self):
        """Hover (no pick) -> the bar moves to the top (lock) -> exactly one pick, after the lock and not before."""
        s = new_session()
        now, _ = arm(s)
        art = hero_slot(7, "radiant", 2)
        now, during_hover = timeline(s, hover(empty(), "radiant", 2, art), now, 16)
        self.assertEqual(picks(envelopes(during_hover)), [])
        lock_at = now
        now, after = timeline(s, lock(empty(), "radiant", 2, art), now, 16)
        events = [(t, e) for t, e in after if e["payload"]["type"] == "hero_picked"]
        self.assertEqual([(e["payload"]["side"], e["payload"]["hero"]) for _, e in events], [("radiant", 7)])
        self.assertGreaterEqual(events[0][0], lock_at + 350)
        self.assertEqual(s._last_health, OK)
        self.assertNotIn(UNREAD, health_of(envelopes(after)))

    def test_no_false_revert_from_hover(self):
        """A confirmed pick whose card later shows hover-like chrome (bar at the bottom) is never reverted, nor re-picked."""
        s, now, frame = settled_ok_session()
        hover_frame = hover(empty(), "radiant", 0, ghost(9, "radiant", 0))  # different art, bar at the bottom
        now, away = timeline(s, hover_frame, now, 40)
        self.assertEqual([e for e in envelopes(away) if e["payload"]["type"] in ("pick_reverted", "hero_picked")], [])
        self.assertEqual(s.stability.confirmed()[("radiant", 0)], 3)
        now, back = timeline(s, frame, now, 30)  # the same lock again: no duplicate claim
        self.assertEqual([e for e in envelopes(back) if e["payload"]["type"] in ("pick_reverted", "hero_picked")], [])

    def test_a_locked_card_it_cannot_read_withdraws_the_vouch_after_the_grace_period(self):
        s, now, good = settled_ok_session()
        unread = lock(good, "dire", 0, noise_art("dire", 0))
        began = now
        now, events = timeline(s, unread, now, int(UNREAD_GRACE_MS / STEP) + 10)
        self.assertEqual(health_of(envelopes(events))[-1], UNREAD)
        first_unread = health_times(events, UNREAD)[0]
        self.assertGreaterEqual(first_unread - began, UNREAD_GRACE_MS)  # not before the grace
        self.assertLessEqual(first_unread - began, UNREAD_GRACE_MS + STEP)
        self.assertNotIn(("dire", 0), s.stability.confirmed())
        self.assertEqual(picks(envelopes(events)), [])

    def test_a_locked_card_that_reads_within_the_grace_never_degrades(self):
        s = new_session()
        now, _ = arm(s)
        _, events = timeline(s, lock(empty(), "radiant", 1, hero_slot(5, "radiant", 1)), now, 24)
        self.assertNotIn(UNREAD, health_of(envelopes(events)))
        self.assertNotIn(UNVERIFIED, health_of(envelopes(events)))

    def test_ambiguous_chrome_degrades_after_the_grace_never_picks(self):
        """A bar half-way between the thresholds (neither clearly locked nor clearly not) is ambiguous, not a hero."""
        s, now, good = settled_ok_session()
        dim = good.copy()
        x0, y0, w, h = slot_rect_px("dire", 2)
        dim[0:6, x0 : x0 + w] = (90, 90, 150)  # chroma 60: in [40, 80)
        dim = paste(dim, "dire", 2, hero_slot(8, "dire", 2))
        now, events = timeline(s, dim, now, int(UNREAD_GRACE_MS / STEP) + 10)
        self.assertEqual(s.lock_states[("dire", 2)], "ambiguous")
        self.assertEqual(health_of(envelopes(events))[-1], UNREAD)
        self.assertEqual(picks(envelopes(events)), [])

    def test_the_helper_started_on_an_already_locked_card_fails_closed(self):
        """Baselined with a card already locked: it is never occupied, so it never reaches the matcher -- and the helper
        says so (SLOTS_UNREAD) instead of vouching for a draft with a pick it does not know."""
        s = new_session()
        frame = lock(empty(), "dire", 0, hero_slot(11, "dire", 0))
        now, sent = feed(s, frame, 0, 16)
        self.assertTrue(s.status.armed)
        now, more = feed(s, frame, now, 24)
        words = health_of(sent + more)
        self.assertEqual(picks(sent + more), [])
        self.assertEqual(words[-1], UNREAD)
        self.assertNotIn(OK, words)
        self.assertEqual(s.lock_states[("dire", 0)], "ambiguous")

    def test_a_black_frame_never_produces_a_fresh_ok(self):
        s, now, _ = settled_ok_session()
        black = np.zeros((1080, 1920, 3), np.uint8)
        began = now
        now, events = timeline(s, black, now, int(20_000 / STEP), noise=False)  # 20 s: longer than the engine's 15 s staleness
        self.assertEqual(health_times(events, OK), [])
        degraded = health_times(events, UNVERIFIED)
        self.assertTrue(degraded)
        self.assertGreaterEqual(degraded[0] - began, UNREAD_GRACE_MS)  # the previous word is retained for the grace...
        self.assertLessEqual(degraded[0] - began, UNREAD_GRACE_MS + STEP)  # ...and no longer: no stale OK at the engine
        self.assertEqual(picks(envelopes(events)), [])
        self.assertEqual(s.stability.confirmed()[("radiant", 0)], 3)  # an unreadable frame never reverts a pick

    def test_a_partial_frame_never_produces_a_fresh_ok(self):
        """Readable crops but the bar is gone from most cards (alt-tab overlay, transition, half-drawn screen)."""
        s, now, good = settled_ok_session()
        partial = good.copy()
        for i in range(5):
            set_card_bar(partial, LAYOUT, "dire", i, None)  # 5 cards lose their bar -> 5/10 < 9
        began = now
        now, events = timeline(s, partial, now, int(20_000 / STEP))
        self.assertEqual(health_times(events, OK), [])
        degraded = health_times(events, UNVERIFIED)
        self.assertTrue(degraded)
        self.assertLessEqual(degraded[0] - began, UNREAD_GRACE_MS + STEP)

    def test_a_half_black_frame_never_produces_a_fresh_ok(self):
        s, now, good = settled_ok_session()
        half = good.copy()
        half[:, 960:] = 0
        now, events = timeline(s, half, now, int(10_000 / STEP), noise=False)
        self.assertEqual(health_times(events, OK), [])
        self.assertTrue(health_times(events, UNVERIFIED))

    def test_one_missing_bar_still_counts_as_verified(self):
        """Bars on 9 of 10 cards verify the frame (a single card can be covered by a tooltip)."""
        s, now, good = settled_ok_session()
        nine = good.copy()
        set_card_bar(nine, LAYOUT, "dire", 4, None)
        _, events = timeline(s, nine, now, 24)
        self.assertEqual(health_times(events, UNVERIFIED), [])

    def test_a_reading_frame_after_the_gap_vouches_again(self):
        s, now, good = settled_ok_session()
        now, _ = timeline(s, np.zeros((1080, 1920, 3), np.uint8), now, 40, noise=False)
        now, back = timeline(s, good, now, 20)
        self.assertEqual(health_of(envelopes(back))[-1], OK)  # degraded before, so the recovery is a change and is sent

    def test_the_heartbeat_never_repeats_a_retained_ok(self):
        """Even when the 5 s heartbeat falls inside an unreadable stretch, what it sends is the honest word."""
        s, now, _ = settled_ok_session()
        _, events = timeline(s, np.zeros((1080, 1920, 3), np.uint8), now, int((HEARTBEAT_EVERY_MS * 3) / STEP), noise=False)
        self.assertEqual(health_times(events, OK), [])

    def test_resuming_after_a_capture_loss_inside_a_draft_never_sends_a_blind_ok(self):
        s, now, good = settled_ok_session()
        self.assertEqual(s.tick_no_frame(now + 5_000, False)[0]["payload"]["detail"], "VISUAL_CAPTURE_LOST")
        for frame in (good, np.zeros((1080, 1920, 3), np.uint8)):  # the screen came back readable, or still black
            s2, now2, good2 = settled_ok_session()
            s2.tick_no_frame(now2 + 5_000, False)
            _, events = timeline(s2, frame, now2 + 6_000, 4, noise=False)
            self.assertEqual(health_times(events, OK), [])
            self.assertEqual(health_of(envelopes(events))[0], UNVERIFIED)  # the very first word is the honest one

    def test_outside_a_draft_the_lifecycle_probe_stays_ok(self):
        s = VisualSession(MATCHER, LAYOUT, DEFAULT_THRESHOLDS, EnvelopeFactory("live-session-1", "run1", CLOCK))
        sent = s.process(empty(), 0)
        self.assertEqual(health_of(sent), [OK])


if __name__ == "__main__":
    unittest.main()
