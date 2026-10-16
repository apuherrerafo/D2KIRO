"""The incident recorder: frames from just before and after a failure survive, and nothing grows without a bound.

Draft 0374e6d9 (2026-10-16) lost its evidence because 0.1.2 spent its 30 frames before the failure. These tests pin the
contract of `d2vc/incidents.py` with a fake writer (no disk) and then run the real recovery scenario through a real
`VisualSession` + `Diagnostics` on a temp folder.
Run: `python -m unittest discover -s scripts/live/visual-capture/tests -p "test_incidents.py" -v`."""
from __future__ import annotations

import datetime as dt
import json
import tempfile
import sys
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from fixtures import fake_portrait  # noqa: F401  (sets sys.path for d2vc)
from d2vc import diagnostics as diag_module
from d2vc import incidents
from d2vc.diagnostics import Diagnostics
from d2vc.paths import runtime_version
from d2vc.incidents import MAX_INCIDENTS, PERSIST_MS, POST_FRAMES, PRE_FRAMES, SAMPLE_EVERY_MS, IncidentRecorder
from d2vc.bench import DEFAULT_THRESHOLDS
from d2vc.emit import EnvelopeFactory
from d2vc.session import VisualSession
from d2vc.transport import DraftLifecycle
from test_recovery import LAYOUT, MARS, MARS_READING, PA_READING, PHANTOM_ASSASSIN, SHARED, Clock, board, empty_bar

CLOCK = lambda: dt.datetime(2026, 10, 16, 4, 17, 6, tzinfo=dt.timezone.utc)  # noqa: E731
FRAME = np.zeros((4, 4, 3), np.uint8)


class Fake:
    """A writer + logger that remember, so the recorder is tested without a disk."""

    def __init__(self, size: int = 1000) -> None:
        self.size, self.files, self.events = size, [], []
        self.recorder = IncidentRecorder(self.write, self.log)
        self.recorder.begin("run1-e001")

    def write(self, name, frame):  # noqa: ANN001
        self.files.append(name)
        return self.size

    def log(self, kind, **fields):  # noqa: ANN003
        self.events.append((kind, fields))

    def kinds(self, name):
        return [fields for kind, fields in self.events if kind == name]

    def run(self, seconds, conditions, start=0.0):
        """Feed frames every 125 ms (8 fps) for `seconds`; `conditions` is a dict or a function of the time."""
        t = start
        while t < start + seconds * 1000:
            self.recorder.observe(t, FRAME, conditions(t) if callable(conditions) else conditions)
            t += 125
        return t


class RecorderTests(unittest.TestCase):
    def test_a_persistent_subthreshold_card_keeps_the_frames_before_the_frame_and_after(self):
        fake = Fake()
        fake.run(3, {})  # 3 s of a quiet draft fill the ring
        fake.run(6, {"subthreshold:dire1": PERSIST_MS}, start=3000)
        opened = fake.kinds("incident_open")
        self.assertEqual(len(opened), 1)
        self.assertEqual(opened[0]["kinds"], ["subthreshold"])
        self.assertEqual(opened[0]["pre"], PRE_FRAMES)
        roles = [name.rsplit("-", 1)[1].rstrip(".png") for name in fake.files]
        self.assertEqual([r.rstrip("0123456789") for r in roles], ["pre"] * PRE_FRAMES + ["at"] + ["post"] * POST_FRAMES)
        self.assertEqual(len(fake.kinds("incident_closed")), 1)

    def test_it_waits_for_the_persistence_window_so_a_transient_is_not_an_incident(self):
        fake = Fake()
        end = fake.run(PERSIST_MS / 1000 - 0.2, {"subthreshold:dire1": PERSIST_MS})
        self.assertEqual(fake.kinds("incident_open"), [])
        fake.run(2, {}, start=end)  # gone before the window: nothing was ever saved
        self.assertEqual(fake.files, [])

    def test_a_card_that_stays_unnamed_for_a_minute_is_one_incident_not_hundreds(self):
        fake = Fake()
        fake.run(60, {"subthreshold:dire3": PERSIST_MS})
        self.assertEqual(len(fake.kinds("incident_open")), 1)
        self.assertLessEqual(len(fake.files), PRE_FRAMES + 1 + POST_FRAMES)

    def test_the_episode_must_clear_before_it_fires_again(self):
        fake = Fake()
        t = fake.run(8, {"unread": 0.0})
        t = fake.run(2, {}, start=t)
        fake.run(8, {"unread": 0.0}, start=t)
        self.assertEqual(len(fake.kinds("incident_open")), 2)

    def test_a_second_condition_during_the_post_window_joins_instead_of_opening_another(self):
        fake = Fake()
        fake.run(1.5, {})
        fake.run(0.5, {"recovered:dire1": 0.0}, start=1500)
        fake.run(0.5, {"subthreshold:dire1": PERSIST_MS, "recovered:dire1": 0.0}, start=2000)
        self.assertEqual(len(fake.kinds("incident_open")), 1)
        fake.run(3, {"subthreshold:dire1": PERSIST_MS}, start=2500)
        self.assertEqual(len(fake.kinds("incident_open")), 1)
        self.assertLessEqual(len(fake.files), PRE_FRAMES + 1 + POST_FRAMES)

    def test_incidents_per_draft_are_capped(self):
        fake = Fake(size=10)
        t = 0.0
        for n in range(MAX_INCIDENTS + 6):
            t = fake.run(5, {f"reverted:r{n}": 0.0}, start=t)
            t = fake.run(1, {}, start=t)
        self.assertEqual(len(fake.kinds("incident_open")), MAX_INCIDENTS)
        self.assertEqual(len(fake.kinds("incident_budget_exhausted")), 1)
        self.assertLessEqual(len(fake.files), MAX_INCIDENTS * (PRE_FRAMES + 1 + POST_FRAMES))

    def test_the_byte_budget_per_draft_stops_new_incidents(self):
        fake = Fake(size=incidents.MAX_INCIDENT_BYTES)  # the first frame already spends the whole budget
        t = fake.run(4, {"unread": 0.0})
        t = fake.run(1, {}, start=t)
        fake.run(4, {"unread": 0.0}, start=t)
        self.assertEqual(len(fake.kinds("incident_open")), 1)
        self.assertEqual(len(fake.kinds("incident_budget_exhausted")), 1)

    def test_a_draft_that_ends_short_keeps_the_frames_that_led_to_the_end(self):
        fake = Fake()
        fake.run(4, {})
        fake.recorder.close(picks=7)
        opened = fake.kinds("incident_open")
        self.assertEqual([o["kinds"] for o in opened], [["short_end"]])
        self.assertEqual(len(fake.files), PRE_FRAMES)
        self.assertTrue(all("short_end-pre" in name for name in fake.files))

    def test_a_complete_draft_does_not_add_an_incident_at_the_end(self):
        fake = Fake()
        fake.run(4, {})
        fake.recorder.close(picks=10)
        self.assertEqual(fake.files, [])

    def test_the_budget_restarts_with_every_draft_epoch(self):
        fake = Fake()
        fake.run(3, {"unread": 0.0})
        fake.recorder.close(picks=10)
        fake.recorder.begin("run1-e002")
        fake.run(3, {"unread": 0.0})
        self.assertEqual(len(fake.kinds("incident_open")), 2)
        self.assertTrue(any("run1-e002-inc-01" in name for name in fake.files))

    def test_the_ring_is_bounded_in_memory(self):
        fake = Fake()
        fake.run(120, {})
        self.assertLessEqual(len(fake.recorder._ring), PRE_FRAMES)
        self.assertEqual(SAMPLE_EVERY_MS, 500.0)


def records(directory: Path) -> list[dict]:
    out = []
    for path in sorted((directory / "diagnostics").glob("visual-*.jsonl")):
        out += [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    return out


def real_session(tmp: str, flag: bool = True):
    directory = Path(tmp)
    if flag:
        (directory / diag_module.SAVE_FRAMES_FLAG).write_text("", encoding="utf-8")
    diagnostics = Diagnostics(directory / "diagnostics", "run1", CLOCK)
    SHARED.script = {PHANTOM_ASSASSIN: PA_READING, MARS: MARS_READING}
    session = VisualSession(SHARED, LAYOUT, DEFAULT_THRESHOLDS, EnvelopeFactory("live-session-0374", "run1", CLOCK), diagnostics=diagnostics)
    session.on_lifecycle(DraftLifecycle("hero_selection", 1))
    clock = Clock(session)
    clock.hold(empty_bar(), 1500)
    return session, clock, directory


class SessionIncidentTests(unittest.TestCase):
    def test_the_0374e6d9_recovery_leaves_frames_before_at_and_after_the_sub_threshold_card(self):
        with tempfile.TemporaryDirectory() as tmp:
            session, clock, directory = real_session(tmp)
            clock.hold(board(locked=[("dire", 1, PHANTOM_ASSASSIN)]), 8000)
            opened = [r for r in records(directory) if r["kind"] == "incident_open"]
            self.assertTrue(opened, "no incident was recorded for a card that sat under the threshold")
            self.assertIn("subthreshold", opened[0]["kinds"])
            names = sorted(p.name for p in (directory / "frames").glob("*-inc-*.png"))
            self.assertTrue(any("-pre" in n for n in names) and any("-at" in n for n in names) and any("-post" in n for n in names), names)
            self.assertLessEqual(len(names), MAX_INCIDENTS * (PRE_FRAMES + 1 + POST_FRAMES))
            self.assertTrue(any(r["kind"] == "pick" and r.get("recovered") for r in records(directory)))

    def test_recording_is_off_without_the_flag_and_helper_behaviour_is_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            session, clock, directory = real_session(tmp, flag=False)
            clock.hold(board(locked=[("dire", 1, PHANTOM_ASSASSIN)]), 8000)
            self.assertEqual(list((directory / "frames").glob("*")) if (directory / "frames").exists() else [], [])
            self.assertEqual(clock.picks(), [("dire", PHANTOM_ASSASSIN)])

    def test_a_draft_that_closes_with_fewer_than_ten_picks_is_marked_and_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            session, clock, directory = real_session(tmp)
            clock.hold(board(locked=[("dire", 3, MARS)]), 6000)
            session.on_lifecycle(DraftLifecycle("in_game", 1))
            ended = [r for r in records(directory) if r["kind"] == "draft_end"]
            self.assertEqual(len(ended), 1)
            self.assertEqual((ended[0]["picks"], ended[0]["short"]), (1, True))
            self.assertTrue(list((directory / "frames").glob("*-inc-*-short_end-pre*.png")))

    def test_nothing_identifying_enters_an_incident_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            session, clock, directory = real_session(tmp)
            clock.hold(board(locked=[("dire", 1, PHANTOM_ASSASSIN)]), 8000)
            text = json.dumps([r for r in records(directory) if str(r["kind"]).startswith("incident")])
            for forbidden in ("token", "steam", "account", "liveId", "name"):
                self.assertNotIn(forbidden.lower(), text.lower())


class RuntimeVersionTests(unittest.TestCase):
    """The helper states which build it is, from its own manifest, so a QA can prove WHICH runtime recorded the evidence."""

    def frozen_at(self, folder: str, manifest: str | None):
        if manifest is not None:
            (Path(folder) / "manifest.json").write_text(manifest, encoding="utf-8")
        return mock.patch.multiple(sys, frozen=True, executable=str(Path(folder) / "d2kiro-visual.exe"), create=True)

    def test_a_packaged_build_reports_the_version_in_its_manifest(self):
        with tempfile.TemporaryDirectory() as tmp, self.frozen_at(tmp, '{"name":"d2kiro-visual","version":"0.1.3-rc2"}'):
            self.assertEqual(runtime_version(), "0.1.3-rc2")

    def test_from_source_it_says_so(self):
        self.assertEqual(runtime_version(), "source")

    def test_a_missing_corrupt_or_odd_manifest_is_unknown_never_an_error(self):
        for manifest in (None, "{not json", '{"version": 3}', '{"version": "x y"}', "[]"):
            with tempfile.TemporaryDirectory() as tmp, self.frozen_at(tmp, manifest):
                self.assertEqual(runtime_version(), "unknown", manifest)


if __name__ == "__main__":
    unittest.main()
