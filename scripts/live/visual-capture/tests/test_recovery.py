"""Recovery of a correct, stable LOCKED card that reads just under the normal threshold -- draft 0374e6d9 (2026-10-16).

Ground truth (scoreboard video): Radiant Ringmaster, Broodmother, Techies, Nature's Prophet, Lifestealer; Dire Jakiro,
Phantom Assassin, Vengeful Spirit, Mars, Lion. The matcher named two of them CORRECTLY and then threw them away:

    Dire card 1  Phantom Assassin (44)  score 0.634  margin 0.269   -> below min_score 0.68, static for 29 s
    Dire card 3  Mars (129)             score 0.675  margin 0.203   -> below min_score 0.68, static for 92 s

so those two locked cards sat "unread" and the whole draft stayed VISUAL_SLOTS_UNREAD (the Team Coach never opened).
The normal path (>= 0.68 / >= 0.15 / 3 frames / 350 ms) is NOT touched; a conservative recovery path confirms a locked card
only after a SECOND, slower proof. These tests pin the real numbers (the real matcher names the hero; `ScriptedMatcher` pins
the score / margin the live matcher produced on the real screen) and the guards that keep recovery from becoming a lower threshold.
Run: `python -m unittest discover -s scripts/live/visual-capture/tests -p "test_recovery.py" -v`."""
from __future__ import annotations

import datetime as dt
import unittest

import numpy as np

from fixtures import fake_portrait  # noqa: F401  (sets sys.path for d2vc)
from d2vc.bench import DEFAULT_THRESHOLDS
from d2vc.catalog import Catalog, Hero
from d2vc.emit import EnvelopeFactory
from d2vc.layout import default_layout
from d2vc.matcher import Matcher, MatchResult
from d2vc.scan import ScanResult, SlotReading
from d2vc.session import UNREAD_GRACE_MS, VisualSession
from d2vc.stability import RECOVERY_MIN_FRAMES, RECOVERY_MIN_MARGIN, RECOVERY_MIN_MS, RECOVERY_MIN_SCORE, StabilityFilter
from d2vc.synth import degrade, set_card_bar
from d2vc.transport import DraftLifecycle
from test_coverage_health import health_of
from test_visual_capture import jitter, slot_rect_px

LAYOUT = default_layout()
CLOCK = lambda: dt.datetime(2026, 10, 16, 4, 17, 6, tzinfo=dt.timezone.utc)  # noqa: E731
SIZE = (1600, 900)  # the real capture of 0374e6d9
STEP = 125  # the live loop runs at 8 fps

# hero ids as OpenDota numbers them (the real draft) + distractors
RINGMASTER, BROODMOTHER, TECHIES, NATURES_PROPHET, LIFESTEALER = 131, 61, 105, 53, 54
JAKIRO, PHANTOM_ASSASSIN, VENGEFUL_SPIRIT, MARS, LION = 64, 44, 20, 129, 26
DISTRACTORS = (1, 2, 3, 4, 5, 6)
TRUTH = {("radiant", RINGMASTER), ("radiant", BROODMOTHER), ("radiant", TECHIES), ("radiant", NATURES_PROPHET), ("radiant", LIFESTEALER), ("dire", JAKIRO), ("dire", PHANTOM_ASSASSIN), ("dire", VENGEFUL_SPIRIT), ("dire", MARS), ("dire", LION)}
IDS = [RINGMASTER, BROODMOTHER, TECHIES, NATURES_PROPHET, LIFESTEALER, JAKIRO, PHANTOM_ASSASSIN, VENGEFUL_SPIRIT, MARS, LION, *DISTRACTORS]
CATALOG = Catalog([Hero(i, f"npc_dota_hero_fake{i}", f"Fake {i}") for i in IDS], {i: fake_portrait(i) for i in IDS})

# What the live matcher really produced on the real screen (diagnostics 0374e6d9, static for the whole hold).
PA_READING = (0.634, 0.269)
MARS_READING = (0.675, 0.203)


class ScriptedMatcher(Matcher):
    """The REAL matcher names the hero on the pasted art; `script[hero] = (score, margin)` pins the numbers the live matcher gave."""

    def __init__(self, catalog: Catalog, script: dict[int, tuple[float, float]] | None = None) -> None:
        super().__init__(catalog)
        self.script = dict(script or {})

    def match(self, crop):  # noqa: ANN001
        real = super().match(crop)
        pinned = self.script.get(real.hero_id)
        if pinned is None:
            return real
        score, margin = pinned
        return MatchResult(real.hero_id, score, real.runner_up_id, score - margin, margin, real.top3)


SHARED = ScriptedMatcher(CATALOG)  # one matcher per process (its reference bank is the expensive part); tests set `.script`


def art(hero, side, index, seed=3):
    _, _, w, h = slot_rect_px(side, index, SIZE)
    return degrade(CATALOG.portraits[hero], np.random.default_rng(seed), slot_size=(w, h), severity=0.4)


def put(frame, side, index, hero, *, locked):
    """The card shows `hero`; locked -> the player-colour bar at the TOP, else (hover) the art dimmed like a real hover (occupancy
    distance 6-14 here, 3-12 in 0374e6d9) with the bar still at the BOTTOM (top-bar chroma ~21 against >= 103 for a lock)."""
    x0, y0, w, h = slot_rect_px(side, index, SIZE)
    image = art(hero, side, index)
    frame[y0 : y0 + h, x0 : x0 + w] = image if locked else np.clip(image.astype(np.float32) * 0.6 + 10, 0, 255).astype(np.uint8)
    set_card_bar(frame, LAYOUT, side, index, "top" if locked else "bottom")


def empty_bar():
    frame = np.zeros((SIZE[1], SIZE[0], 3), np.uint8) + np.linspace(18, 40, SIZE[1], dtype=np.float32)[:, None, None].astype(np.uint8)
    for side in ("radiant", "dire"):
        for index, _ in enumerate(LAYOUT.slots[side]):
            x0, y0, w, h = slot_rect_px(side, index, SIZE)
            frame[y0 : y0 + h, x0 : x0 + w] = (28, 26, 24)
            set_card_bar(frame, LAYOUT, side, index, "bottom")
    return frame


def board(locked=(), hover=()):
    """A frame: `locked` = [(side, index, hero)], `hover` = [(side, index, hero)]."""
    frame = empty_bar()
    for side, index, hero in locked:
        put(frame, side, index, hero, locked=True)
    for side, index, hero in hover:
        put(frame, side, index, hero, locked=False)
    return frame


class Clock:
    def __init__(self, session, now=0):
        self.session, self.now, self.sent = session, now, []
        self.seed = 0

    def hold(self, frame, ms):
        """Feed `frame` for `ms` at 8 fps; returns the envelopes it produced, each tagged with its time."""
        out = []
        for _ in range(int(round(ms / STEP))):
            self.seed += 1
            for envelope in self.session.process(jitter(frame, 500 + self.seed), self.now):
                out.append((self.now, envelope))
            self.now += STEP
        self.sent += out
        return out

    def picks(self):
        return [(e["payload"]["side"], e["payload"]["hero"]) for _, e in self.sent if e["payload"]["type"] == "hero_picked"]

    def reverts(self):
        return [e for _, e in self.sent if e["payload"]["type"] == "pick_reverted"]

    def health(self):
        return [(t, h) for t, e in self.sent for h in health_of([e])]


def armed(script=None):
    SHARED.script = dict(script or {})
    session = VisualSession(SHARED, LAYOUT, DEFAULT_THRESHOLDS, EnvelopeFactory("live-session-0374", "run1", CLOCK))
    session.on_lifecycle(DraftLifecycle("hero_selection", 1))
    clock = Clock(session)
    clock.hold(empty_bar(), 1500)
    assert session.status.armed, "baseline was not established"
    return clock


def pick_times(events, hero):
    return [t for t, e in events if e["payload"]["type"] == "hero_picked" and e["payload"]["hero"] == hero]


class RecoveryParametersTests(unittest.TestCase):
    def test_the_calibrated_numbers(self):
        # Floor 0.60 (< the lowest real correct locked reading, PA 0.634; above every ungated negative but the lock gate is the
        # real guard), margin = the NORMAL margin (never lowered), 1.0 s / 6 frames (> 2x the normal 350 ms, < UNREAD_GRACE_MS).
        self.assertEqual(RECOVERY_MIN_SCORE, 0.60)
        self.assertEqual(RECOVERY_MIN_MARGIN, DEFAULT_THRESHOLDS.min_margin)
        self.assertEqual(RECOVERY_MIN_MS, 1000.0)
        self.assertEqual(RECOVERY_MIN_FRAMES, 6)
        self.assertLess(RECOVERY_MIN_SCORE, DEFAULT_THRESHOLDS.min_score)
        self.assertLess(RECOVERY_MIN_MS, UNREAD_GRACE_MS)  # recovery lands BEFORE the helper would say "unread"
        self.assertEqual(DEFAULT_THRESHOLDS.min_score, 0.68)  # the normal threshold is untouched


def reading(side, index, hero, score, margin, *, reason="below_score", state="uncertain"):
    return SlotReading(side, index, state, hero if state == "hero" else None, score, margin, hero, 0.0, reason)


def scan_of(*readings):
    return ScanResult(tuple(r for r in readings if r.side == "radiant"), tuple(r for r in readings if r.side == "dire"), (), 0.0, SIZE)


class RecoveryFilterTests(unittest.TestCase):
    """The pure temporal filter: SlotReading in, VisualEvent out. No images."""

    def feed(self, stability, readings_per_frame, step=STEP, start=0):
        out = []
        for i, readings in enumerate(readings_per_frame):
            for event in stability.update(scan_of(*readings), start + i * step):
                out.append((start + i * step, event))
        return out

    def frames(self, ms, *readings, step=STEP):
        return [readings] * int(ms / step)

    def test_pa_634_269_recovers_after_the_window_not_before(self):
        events = self.feed(StabilityFilter(), self.frames(3000, reading("dire", 1, PHANTOM_ASSASSIN, *PA_READING)))
        self.assertEqual([(e.kind, e.side, e.hero_id) for _, e in events], [("pick", "dire", PHANTOM_ASSASSIN)])
        self.assertGreaterEqual(events[0][0], RECOVERY_MIN_MS)
        self.assertLess(events[0][0], RECOVERY_MIN_MS + 2 * STEP)
        self.assertAlmostEqual(events[0][1].confidence, 0.634, places=3)

    def test_mars_675_203_recovers(self):
        events = self.feed(StabilityFilter(), self.frames(3000, reading("dire", 3, MARS, *MARS_READING)))
        self.assertEqual([(e.kind, e.side, e.hero_id) for _, e in events], [("pick", "dire", MARS)])

    def test_emitted_once_even_if_it_stays_for_a_minute(self):
        events = self.feed(StabilityFilter(), self.frames(60_000, reading("dire", 3, MARS, *MARS_READING)))
        self.assertEqual(len(events), 1)

    def test_the_normal_path_is_not_delayed_by_recovery(self):
        events = self.feed(StabilityFilter(), self.frames(2000, reading("dire", 2, VENGEFUL_SPIRIT, 0.741, 0.303, state="hero", reason="ok")))
        self.assertEqual(len(events), 1)
        self.assertLess(events[0][0], 600)

    # ---- guards: each one is a thing recovery must NOT accept ---------------------------------------------------------
    def test_below_the_floor_is_not_recovered(self):
        for score in (0.599, 0.58, 0.549):
            events = self.feed(StabilityFilter(), self.frames(60_000, reading("dire", 1, PHANTOM_ASSASSIN, score, 0.269)))
            self.assertEqual(events, [], score)

    def test_a_low_margin_is_not_recovered(self):
        for margin in (0.149, 0.10, 0.04):
            events = self.feed(StabilityFilter(), self.frames(60_000, reading("dire", 1, PHANTOM_ASSASSIN, 0.634, margin)))
            self.assertEqual(events, [], margin)

    def test_a_score_above_the_floor_but_normal_margin_failure_is_not_recovered(self):
        # 0.70 / 0.10 is `below_margin` (the normal path already refused it for its MARGIN): recovery never relaxes the margin.
        events = self.feed(StabilityFilter(), self.frames(60_000, reading("dire", 1, PHANTOM_ASSASSIN, 0.70, 0.10, reason="below_margin")))
        self.assertEqual(events, [])

    def test_shorter_than_the_window_is_not_recovered(self):
        events = self.feed(StabilityFilter(), self.frames(RECOVERY_MIN_MS - 2 * STEP, reading("dire", 1, PHANTOM_ASSASSIN, *PA_READING)))
        self.assertEqual(events, [])

    def test_fewer_frames_than_the_minimum_is_not_recovered_even_over_a_long_time(self):
        stability = StabilityFilter()
        events = []
        for i in range(RECOVERY_MIN_FRAMES - 1):  # a stalled loop: five frames spread over 10 s
            events += stability.update(scan_of(reading("dire", 1, PHANTOM_ASSASSIN, *PA_READING)), i * 2000)
        self.assertEqual(events, [])

    def test_one_dip_under_the_floor_inside_the_window_restarts_it(self):
        good = reading("dire", 1, PHANTOM_ASSASSIN, *PA_READING)
        dip = reading("dire", 1, PHANTOM_ASSASSIN, 0.55, 0.269)  # the real transient on a locked card was one such sample
        frames = []
        for _ in range(6):  # 750 ms of good, a one-frame dip, repeated for 12 s: never a full unbroken window
            frames += [(good,)] * 7 + [(dip,)]
        events = self.feed(StabilityFilter(), frames * 12)
        self.assertEqual(events, [])

    def test_a_candidate_that_alternates_is_not_recovered(self):
        a = reading("dire", 1, PHANTOM_ASSASSIN, 0.634, 0.269)
        b = reading("dire", 1, MARS, 0.640, 0.270)
        frames = ([(a,)] * 3 + [(b,)] * 3) * 40  # swaps every 375 ms for 45 s
        self.assertEqual(self.feed(StabilityFilter(), frames), [])

    def test_the_candidate_changing_restarts_the_window(self):
        a = reading("dire", 1, PHANTOM_ASSASSIN, *PA_READING)
        b = reading("dire", 1, MARS, *MARS_READING)
        stability = StabilityFilter()
        events = self.feed(stability, [(a,)] * 7 + [(b,)] * 7)  # 875 ms each: neither completes the window
        self.assertEqual(events, [])

    def test_an_empty_or_unreadable_frame_resets_it(self):
        good = reading("dire", 1, PHANTOM_ASSASSIN, *PA_READING)
        gone = SlotReading("dire", 1, "empty", None, 0.0, 0.0, reason="unreadable")
        frames = ([(good,)] * 7 + [(gone,)]) * 12
        self.assertEqual(self.feed(StabilityFilter(), frames), [])

    def test_a_hero_already_confirmed_in_another_slot_is_not_recovered_into_a_second(self):
        normal = reading("radiant", 1, PHANTOM_ASSASSIN, 0.90, 0.40, state="hero", reason="ok")
        twin = reading("dire", 1, PHANTOM_ASSASSIN, *PA_READING)
        events = self.feed(StabilityFilter(), [(normal, twin)] * 60)
        self.assertEqual([(e.side, e.hero_id) for _, e in events], [("radiant", PHANTOM_ASSASSIN)])

    def test_two_slots_recovering_the_same_hero_at_once_confirm_neither(self):
        one = reading("radiant", 2, MARS, *MARS_READING)
        two = reading("dire", 3, MARS, *MARS_READING)
        self.assertEqual(self.feed(StabilityFilter(), [(one, two)] * 120), [])

    def test_a_slot_already_confirmed_is_never_overwritten_by_a_recovery_candidate(self):
        normal = reading("dire", 1, PHANTOM_ASSASSIN, 0.90, 0.40, state="hero", reason="ok")
        weak = reading("dire", 1, MARS, *MARS_READING)
        events = self.feed(StabilityFilter(), [(normal,)] * 10 + [(weak,)] * 80)
        self.assertEqual([(e.kind, e.hero_id) for _, e in events], [("pick", PHANTOM_ASSASSIN)])

    def test_recovery_can_be_switched_off(self):
        events = self.feed(StabilityFilter(recovery=None), self.frames(10_000, reading("dire", 1, PHANTOM_ASSASSIN, *PA_READING)))
        self.assertEqual(events, [])


class Regression0374e6d9Tests(unittest.TestCase):
    """The whole draft through a real VisualSession: real matcher on pasted art, the two real sub-threshold readings pinned."""

    SCRIPT = {PHANTOM_ASSASSIN: PA_READING, MARS: MARS_READING}

    def test_pa_is_recovered_from_634_269_without_ever_degrading(self):
        clock = armed(self.SCRIPT)
        clock.hold(board(hover=[("dire", 1, PHANTOM_ASSASSIN)]), 1500)
        locked_at = clock.now
        events = clock.hold(board(locked=[("dire", 1, PHANTOM_ASSASSIN)]), 4000)
        self.assertEqual(clock.picks(), [("dire", PHANTOM_ASSASSIN)])
        self.assertEqual(clock.reverts(), [])
        self.assertEqual(len(pick_times(events, PHANTOM_ASSASSIN)), 1)
        latency = pick_times(events, PHANTOM_ASSASSIN)[0] - locked_at
        self.assertGreaterEqual(latency, RECOVERY_MIN_MS)  # never earlier than the window ...
        self.assertLess(latency, UNREAD_GRACE_MS)  # ... and always before the helper would call the card unread
        self.assertNotIn(("degraded", "VISUAL_SLOTS_UNREAD"), [h for _, h in clock.health()])
        self.assertEqual(clock.session._last_health, ("ok", "VISUAL_OK"))

    def test_mars_is_recovered_from_675_203_and_stays_ok_for_a_long_hold(self):
        clock = armed(self.SCRIPT)
        clock.hold(board(locked=[("dire", 3, MARS)]), 20_000)  # it stayed locked and static for 92 s in the real draft
        self.assertEqual(clock.picks(), [("dire", MARS)])
        self.assertNotIn(("degraded", "VISUAL_SLOTS_UNREAD"), [h for _, h in clock.health()])
        self.assertEqual(clock.session._last_health, ("ok", "VISUAL_OK"))

    def test_the_whole_draft_ends_10_of_10_with_no_unread(self):
        clock = armed(self.SCRIPT)
        locked = []

        def reveal(*cards, ms=3000, hover_ms=1000):
            if hover_ms:
                clock.hold(board(locked=locked, hover=[(side, index, hero) for side, index, hero in cards]), hover_ms)
            locked.extend(cards)
            return clock.hold(board(locked=locked), ms)

        # the order the screen revealed them in the real draft
        reveal(("radiant", 1, BROODMOTHER))
        reveal(("radiant", 2, TECHIES), ("dire", 2, VENGEFUL_SPIRIT), ("dire", 3, MARS))
        reveal(("radiant", 0, RINGMASTER))
        reveal(("radiant", 4, LIFESTEALER))
        reveal(("dire", 0, JAKIRO), ("dire", 4, LION))
        reveal(("radiant", 3, NATURES_PROPHET))
        reveal(("dire", 1, PHANTOM_ASSASSIN), ms=4000)

        self.assertEqual(set(clock.picks()), TRUTH)
        self.assertEqual(len(clock.picks()), 10)
        self.assertEqual(clock.reverts(), [])
        self.assertEqual(clock.session.status.confirmed, 10)
        words = [h for _, h in clock.health()]
        self.assertNotIn(("degraded", "VISUAL_SLOTS_UNREAD"), words)
        self.assertEqual(clock.session._last_health, ("ok", "VISUAL_OK"))

    def test_heroes_that_were_already_correct_do_not_change(self):
        """Same draft with recovery OFF vs ON: every normally-read hero is emitted identically; only PA and Mars are added."""
        def run(recovery_on):
            clock = armed(self.SCRIPT)
            if not recovery_on:
                clock.session.stability = StabilityFilter(recovery=None)
            locked = [("radiant", 1, BROODMOTHER), ("radiant", 2, TECHIES), ("dire", 2, VENGEFUL_SPIRIT), ("dire", 3, MARS), ("radiant", 0, RINGMASTER), ("radiant", 4, LIFESTEALER), ("dire", 0, JAKIRO), ("dire", 4, LION), ("radiant", 3, NATURES_PROPHET), ("dire", 1, PHANTOM_ASSASSIN)]
            clock.hold(board(locked=locked), 8000)
            return clock.picks()

        legacy, current = run(False), run(True)
        self.assertEqual(set(legacy), TRUTH - {("dire", PHANTOM_ASSASSIN), ("dire", MARS)})  # what 0.1.3-rc1 did: 8 of 10
        self.assertTrue(set(legacy) <= set(current))
        self.assertEqual(set(current) - set(legacy), {("dire", PHANTOM_ASSASSIN), ("dire", MARS)})


class FalsePositiveGuardTests(unittest.TestCase):
    """Session level: the guards hold on real pixels too, and health stays honest when nothing is recovered."""

    def test_a_sub_threshold_unstable_candidate_is_not_accepted(self):
        clock = armed({PHANTOM_ASSASSIN: (0.634, 0.269)})
        frame = board(locked=[("dire", 1, PHANTOM_ASSASSIN)])
        for _ in range(8):  # holds 0.75 s then the score collapses (a transition frame), forever
            clock.hold(frame, 750)
            SHARED.script[PHANTOM_ASSASSIN] = (0.55, 0.269)
            clock.hold(frame, STEP)
            SHARED.script[PHANTOM_ASSASSIN] = PA_READING
        self.assertEqual(clock.picks(), [])

    def test_a_low_margin_candidate_is_not_accepted_and_the_draft_says_so(self):
        clock = armed({PHANTOM_ASSASSIN: (0.634, 0.149)})
        clock.hold(board(locked=[("dire", 1, PHANTOM_ASSASSIN)]), 6000)
        self.assertEqual(clock.picks(), [])
        self.assertEqual(clock.session._last_health, ("degraded", "VISUAL_SLOTS_UNREAD"))  # honest: a locked card nobody could read

    def test_below_the_floor_stays_unread(self):
        clock = armed({PHANTOM_ASSASSIN: (0.59, 0.269)})
        clock.hold(board(locked=[("dire", 1, PHANTOM_ASSASSIN)]), 6000)
        self.assertEqual(clock.picks(), [])
        self.assertEqual(clock.session._last_health, ("degraded", "VISUAL_SLOTS_UNREAD"))

    def test_a_candidate_that_alternates_between_heroes_is_not_accepted(self):
        clock = armed({PHANTOM_ASSASSIN: PA_READING, MARS: MARS_READING})
        a, b = board(locked=[("dire", 1, PHANTOM_ASSASSIN)]), board(locked=[("dire", 1, MARS)])
        for _ in range(12):
            clock.hold(a, 500)
            clock.hold(b, 500)
        self.assertEqual(clock.picks(), [])

    def test_a_duplicate_of_a_recovered_hero_in_another_slot_is_not_accepted(self):
        clock = armed({MARS: MARS_READING})
        clock.hold(board(locked=[("dire", 3, MARS)]), 3000)
        self.assertEqual(clock.picks(), [("dire", MARS)])  # recovered in d3 ...
        clock.hold(board(locked=[("dire", 3, MARS), ("radiant", 2, MARS)]), 8000)  # ... a second card that also reads Mars sub-threshold
        self.assertEqual(clock.picks(), [("dire", MARS)])

    def test_two_cards_that_both_look_like_the_same_sub_threshold_hero_confirm_neither(self):
        clock = armed({MARS: MARS_READING})
        clock.hold(board(locked=[("radiant", 2, MARS), ("dire", 3, MARS)]), 8000)
        self.assertEqual(clock.picks(), [])

    def test_a_transient_hover_is_never_confirmed_and_never_degrades(self):
        clock = armed({PHANTOM_ASSASSIN: PA_READING, MARS: MARS_READING})
        clock.hold(board(hover=[("dire", 1, PHANTOM_ASSASSIN), ("dire", 3, MARS), ("radiant", 2, MARS)]), 30_000)
        self.assertEqual(clock.picks(), [])
        self.assertNotIn(("degraded", "VISUAL_SLOTS_UNREAD"), [h for _, h in clock.health()])
        self.assertEqual(clock.session._last_health, ("ok", "VISUAL_OK"))

    def test_a_card_that_locks_and_is_gone_before_the_window_is_not_accepted(self):
        clock = armed({PHANTOM_ASSASSIN: PA_READING})
        for _ in range(6):
            clock.hold(board(locked=[("dire", 1, PHANTOM_ASSASSIN)]), 750)
            clock.hold(board(), 500)
        self.assertEqual(clock.picks(), [])


class HoverSemanticsTests(unittest.TestCase):
    """0374e6d9 under 0.1.2 went VISUAL_SLOTS_UNREAD 8.5 s after the draft opened -- before ANY hero was locked -- because
    a hovered (occupied, bar at the BOTTOM) card was matched like a pick and read as junk. A hover is not a lock."""

    def test_a_hovered_card_with_a_junk_reading_never_becomes_slots_unread(self):
        clock = armed()
        junk = board(hover=[("radiant", 2, DISTRACTORS[0]), ("radiant", 1, DISTRACTORS[1]), ("radiant", 3, DISTRACTORS[2])])
        clock.hold(junk, 40_000)  # the hover lasted 30-90 s in the real draft
        self.assertEqual(clock.picks(), [])
        self.assertNotIn(("degraded", "VISUAL_SLOTS_UNREAD"), [h for _, h in clock.health()])
        self.assertEqual(clock.session._last_health, ("ok", "VISUAL_OK"))
        self.assertEqual({k: v for k, v in clock.session.lock_states.items() if v != "empty"}, {("radiant", 1): "hover", ("radiant", 2): "hover", ("radiant", 3): "hover"})

    def test_hover_then_a_real_lock_goes_hover_ok_then_pick_ok(self):
        clock = armed()
        clock.hold(board(hover=[("radiant", 1, BROODMOTHER)]), 5000)
        self.assertEqual(clock.session._last_health, ("ok", "VISUAL_OK"))
        clock.hold(board(locked=[("radiant", 1, BROODMOTHER)]), 3000)
        self.assertEqual(clock.picks(), [("radiant", BROODMOTHER)])
        self.assertEqual(clock.session._last_health, ("ok", "VISUAL_OK"))

    def test_a_locked_card_nobody_can_name_still_degrades_after_the_grace(self):
        """Not weakened: a REAL lock (bar on top) whose art matches nothing is still `unread` after 1.5 s, recovery or not."""
        clock = armed()
        noise = board()
        x0, y0, w, h = slot_rect_px("radiant", 3, SIZE)
        noise[y0 : y0 + h, x0 : x0 + w] = np.random.default_rng(99).integers(0, 255, size=(h, w, 3), dtype=np.uint8)
        set_card_bar(noise, LAYOUT, "radiant", 3, "top")
        events = clock.hold(noise, 3000)
        self.assertEqual(clock.picks(), [])
        unread = [t for t, e in events if ("degraded", "VISUAL_SLOTS_UNREAD") in health_of([e])]
        self.assertTrue(unread)
        self.assertGreaterEqual(unread[0], UNREAD_GRACE_MS)


if __name__ == "__main__":
    unittest.main()
