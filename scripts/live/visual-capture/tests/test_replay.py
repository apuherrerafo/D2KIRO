"""Offline recording replay (acceptance/replay_recording.py). Run: `python -m unittest discover -s scripts/live/visual-capture/tests -p "test_replay.py" -v`.

Self-contained: a generated catalog, generated frames and a recording written to a temp dir. It never opens `artifacts/` (the
Player's real recordings): same rule as every other acceptance test.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from fixtures import fake_catalog  # noqa: F401  (sets sys.path for d2vc)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "acceptance"))

import replay_recording as rr  # noqa: E402
from d2vc.layout import default_layout  # noqa: E402
from d2vc.matcher import Matcher  # noqa: E402
from d2vc.synth import compose_screen  # noqa: E402

CATALOG = fake_catalog()
MATCHER = Matcher(CATALOG)
LAYOUT = default_layout()
SIZE = (1280, 720)


def stamp(ms: int) -> str:
    seconds, millis = divmod(ms, 1000)
    return f"2026-10-19T02:00:{seconds:02d}.{millis:03d}Z"


def jitter(frame, seed):
    noise = np.random.default_rng(seed).integers(-2, 3, size=frame.shape)
    return np.clip(frame.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def screen(radiant, seed=1):
    return compose_screen(CATALOG, LAYOUT, SIZE[0], SIZE[1], radiant=radiant, dire=[None] * 5, seed=seed, with_grid=False)


class Recording:
    """Builds `<dir>/run.jsonl` + `<dir>/frames/*.png` the way diagnostics.py writes them."""

    def __init__(self, root: Path) -> None:
        self.dir, self.rows, self.count = root, [], 0
        (root / "frames").mkdir()

    def row(self, ms: int, kind: str, **fields) -> None:
        self.rows.append({"t": stamp(ms), "kind": kind, **fields})

    def frame(self, ms: int, image, label: str = "periodic") -> str:
        self.count += 1
        name = f"run-e001-full-{self.count:03d}-{label}.png"
        cv2.imwrite(str(self.dir / "frames" / name), image)
        self.row(ms, "frame_saved", label=label, file=name)
        return name

    def empty_run(self, start_ms: int, frames: int = 10, step: int = 125) -> int:
        base = screen([None] * 5)
        for i in range(frames):
            self.frame(start_ms + i * step, jitter(base, i))
        return start_ms + frames * step

    def write(self, extra_lines: list[str] | None = None) -> Path:
        lines = [json.dumps(r) for r in self.rows] + (extra_lines or [])
        (self.dir / "run.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
        return self.dir


class ReplayTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="d2vc-replay-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def recording(self) -> Recording:
        root = self.tmp / f"rec{len(list(self.tmp.iterdir()))}"
        root.mkdir()
        rec = Recording(root)
        rec.row(0, "start")
        rec.row(10, "server_seen", phase="waiting")
        rec.row(100, "draft_open", epoch=1)
        return rec

    def run_modes(self, directory: Path, modes=("observed", "hold"), determinism=False) -> dict:
        return rr.run_recording(directory, MATCHER, LAYOUT, rr.THRESHOLDS, modes=modes, step_ms=250.0, hold_cap_ms=rr.HOLD_CAP_MS, determinism=determinism)

    def locked_run(self, rec: Recording, start_ms: int, frames: int = 6, step: int = 125) -> int:
        locked = screen([1, None, None, None, None])
        for i in range(frames):
            rec.frame(start_ms + i * step, jitter(locked, 50 + i), "lock")
        return start_ms + frames * step

    def test_observed_replay_picks_on_real_frames_with_observed_timestamps(self) -> None:
        rec = self.recording()
        t = rec.empty_run(200)
        self.locked_run(rec, t)
        report = self.run_modes(rec.write(), modes=("observed",))
        observed = report["modes"]["observed"]
        self.assertEqual([(p["side"], p["hero"], p["origin"]) for p in observed["picks"]], [("radiant", 1, "real")])
        self.assertEqual(observed["ticks"]["synthetic_repeat"], 0)
        ticks = [tick["t_ms"] for tick in observed["tickLog"]]
        self.assertEqual(ticks[:3], [200.0, 325.0, 450.0])  # deltas from the run's first row, preserved exactly
        self.assertTrue(report["pass"], [c for c in observed["checks"] if not c["pass"]])

    def test_synthetic_repeat_is_flagged_and_never_replaces_real_frames(self) -> None:
        rec = self.recording()
        t = rec.empty_run(200)
        locked = screen([1, None, None, None, None])
        rec.frame(t, jitter(locked, 7), "lock")  # ONE real locked frame...
        rec.row(t + 3000, "draft_closed", phase="ended")  # ...then nothing is known for 3 s
        report = self.run_modes(rec.write())
        self.assertEqual(report["modes"]["observed"]["picks"], [])  # one real frame confirms nothing: the temporal gate is untouched
        held = report["modes"]["hold"]
        self.assertEqual([(p["hero"], p["origin"]) for p in held["picks"]], [(1, "synthetic_repeat")])
        self.assertEqual(held["picks_only_on_synthetic_repeat"], 1)
        self.assertEqual(held["ticks"]["real"], report["modes"]["observed"]["ticks"]["real"])
        repeats = [tick for tick in held["tickLog"] if tick["origin"] == "synthetic_repeat"]
        self.assertTrue(all(t <= tick["t_ms"] <= t + rr.HOLD_CAP_MS for tick in repeats))

    def test_hold_never_crosses_a_capture_discontinuity(self) -> None:
        rec = self.recording()
        t = rec.empty_run(200)
        rec.frame(t, jitter(screen([1, None, None, None, None]), 7), "lock")
        rec.row(t + 300, "capture_lost")  # the screen may have changed: the repeats must stop here
        rec.row(t + 3000, "draft_closed", phase="ended")
        held = self.run_modes(rec.write())["modes"]["hold"]
        repeats = [tick for tick in held["tickLog"] if tick["origin"] == "synthetic_repeat"]
        self.assertEqual([tick["t_ms"] - t for tick in repeats], [250.0])
        self.assertEqual(held["picks"], [])

    def test_recorded_rc2_picks_are_never_the_truth(self) -> None:
        rec = self.recording()
        t = rec.empty_run(200)
        end = self.locked_run(rec, t)
        clean = self.run_modes(rec.write(), modes=("observed",))
        rec.row(end, "pick", side="radiant", slot=0, heroId=2, confidence=0.99)  # RC2 once said hero 2 -- the pixels say hero 1
        wrong = self.run_modes(rec.write(), modes=("observed",))
        a, b = clean["modes"]["observed"], wrong["modes"]["observed"]
        self.assertEqual(a["outputs"], b["outputs"])  # the replay does not read RC2's own picks at all
        self.assertEqual([p["hero"] for p in b["picks"]], [1])
        comparison = b["consistency_vs_recorded_rc2_output__NOT_GROUND_TRUTH"]["1"]
        self.assertEqual(comparison["only_recorded_rc2"], [["radiant", 2]])
        self.assertEqual(comparison["only_replayed"], [["radiant", 1]])
        self.assertTrue(wrong["pass"])  # a disagreement with RC2's old output is a report line, not a verdict

    def test_nothing_is_picked_outside_an_open_draft(self) -> None:
        rec = self.recording()
        t = rec.empty_run(200)
        rec.row(t, "draft_closed", phase="ended")
        self.locked_run(rec, t + 50)  # locked cards on screen AFTER the draft closed (e.g. the 'tail' frames)
        report = self.run_modes(rec.write())
        for mode in report["modes"].values():
            self.assertEqual(mode["picks"], [])
            self.assertTrue(all(o["type"] == "capture_health" for o in mode["outputs"]))

    def test_unverified_rows_are_classified_never_replayed(self) -> None:
        rec = self.recording()
        t = rec.empty_run(200)
        rec.row(t, "strip_saved", n=1, reason="keepalive")
        rec.row(t + 10, "frame_saved", label="periodic", file="run-e001-full-099-periodic.png")  # file pruned away
        rec.row(t + 20, "frame_saved", label="periodic", file="../secret.png")  # traversal attempt
        rec.row(t + 30, "mystery_kind")
        rec.row(t + 40, "capture_lost")
        rec.row(t + 5, "draft_end", picks=0, short=True)  # time goes backwards
        shutil.copy(rec.dir / "frames" / "run-e001-full-001-periodic.png", rec.dir / "frames" / "orphan-full.png")
        directory = rec.write(extra_lines=["{not json", json.dumps({"t": "yesterday", "kind": "pick"})])
        timeline = rr.load_timeline(directory)
        counts = timeline.unverified
        self.assertEqual(counts["strip_not_a_full_frame"], 1)
        self.assertEqual(counts["png_missing_pruned_by_recorder"], 1)
        self.assertEqual(counts["frame_saved_bad_fields"], 1)
        self.assertEqual(counts["unknown_kind"], 1)
        self.assertEqual(counts["context_not_replayed"], 2)  # the fixture's own `start` row + capture_lost
        self.assertEqual(counts["malformed_line"], 1)
        self.assertEqual(counts["bad_row_or_timestamp"], 1)
        self.assertEqual(counts["time_regression_clamped"], 1)
        self.assertEqual(sum(i.kind == "frame" for i in timeline.items), 10)  # only the real PNGs became frames
        self.assertEqual(rr.unreferenced_pngs(timeline), ["orphan-full.png"])
        times = [i.t_ms for i in timeline.items]
        self.assertEqual(times, sorted(times))

    def test_two_replays_are_byte_identical(self) -> None:
        rec = self.recording()
        t = rec.empty_run(200)
        self.locked_run(rec, t)
        report = self.run_modes(rec.write(), determinism=True)
        for mode in report["modes"].values():
            determinism = [c for c in mode["checks"] if c["name"].startswith("DETERMINISM")]
            self.assertEqual([c["pass"] for c in determinism], [True])
        self.assertEqual(rr.replay(rr.load_timeline(rec.dir), MATCHER, LAYOUT, rr.THRESHOLDS, mode="hold")["digest"], report["modes"]["hold"]["digest"])

    def test_checks_fail_red_on_violations(self) -> None:
        def names(ticks, outputs, opens, nets):
            return {c["name"]: c["pass"] for c in rr.evaluate_checks(ticks, outputs, opens, nets)}

        good_tick = [{"t_ms": 0.0, "origin": "real"}, {"t_ms": 1.0, "origin": "real"}]
        self.assertTrue(all(names(good_tick, [], [1, 2], {}).values()))
        backwards = names([{"t_ms": 5.0, "origin": "real"}, {"t_ms": 1.0, "origin": "real"}], [], [1], {})
        self.assertFalse(backwards["TIME_MONOTONIC"])
        early = names(good_tick, [{"type": "hero_picked", "draftOpen": False}], [1], {})
        self.assertFalse(early["EVENT_ORDER no draft fact outside an open draft"])
        self.assertFalse(names(good_tick, [], [2, 1], {})["EVENT_ORDER lifecycle epochs strictly increase"])
        six = {"1": [("radiant", h) for h in range(1, 7)]}
        self.assertFalse(names(good_tick, [], [1], six)["NET_PICKS <= 5 per side, no hero twice"])
        twice = {"1": [("radiant", 1), ("dire", 1)]}
        self.assertFalse(names(good_tick, [], [1], twice)["NET_PICKS <= 5 per side, no hero twice"])
        self.assertFalse(names([], [], [], {})["REAL_FRAMES_REPLAYED"])

    def test_source_time_regression_fails_even_though_ticks_are_clamped(self) -> None:
        rec = self.recording()
        t = rec.empty_run(200)
        end = self.locked_run(rec, t)
        rec.row(end - 600, "draft_end", picks=0, short=True)  # recorded 600 ms BEFORE the previous row: the clock went backwards
        report = self.run_modes(rec.write(), modes=("observed",))
        observed = report["modes"]["observed"]
        ticks = [tick["t_ms"] for tick in observed["tickLog"]]
        self.assertEqual(ticks, sorted(ticks))  # load_timeline clamped it, so the tick list alone looks monotonic...
        monotonic = [c for c in observed["checks"] if c["name"] == "TIME_MONOTONIC"][0]
        self.assertFalse(monotonic["pass"], monotonic)  # ...and must NOT hide the regression
        self.assertIn("1 source timestamp regression", monotonic["detail"])
        self.assertFalse(report["pass"])

    def test_evaluate_checks_counts_source_regressions(self) -> None:
        ticks = [{"t_ms": 0.0, "origin": "real"}, {"t_ms": 1.0, "origin": "real"}]
        self.assertTrue({c["name"]: c["pass"] for c in rr.evaluate_checks(ticks, [], [1], {}, time_regressions=0)}["TIME_MONOTONIC"])
        self.assertFalse({c["name"]: c["pass"] for c in rr.evaluate_checks(ticks, [], [1], {}, time_regressions=1)}["TIME_MONOTONIC"])

    def test_orphan_server_seen_in_hero_selection_does_not_invent_an_epoch(self) -> None:
        root = self.tmp / "orphan"
        root.mkdir()
        rec = Recording(root)
        rec.row(0, "start")
        rec.row(10, "server_seen", phase="hero_selection")  # no draft_open row follows: the replay has no epoch to open
        t = rec.empty_run(200)
        self.locked_run(rec, t)
        report = self.run_modes(rec.write(), modes=("observed", "hold"))
        for mode in report["modes"].values():
            self.assertEqual(mode["picks"], [])  # before the fix: a phantom epoch-0 draft opened and picked hero 1 with epoch None
            self.assertTrue(all(o["epoch"] is not None or not o["draftOpen"] for o in mode["outputs"]))
        self.assertEqual(report["unverified"]["counts"]["lifecycle_orphan_no_epoch"], 1)  # reported, not silently dropped

    def test_server_seen_in_hero_selection_before_draft_open_is_still_accepted(self) -> None:
        root = self.tmp / "legit"
        root.mkdir()
        rec = Recording(root)
        rec.row(0, "start")
        rec.row(10, "server_seen", phase="hero_selection")  # the helper started mid-draft: the server's first word, then its epoch
        rec.row(11, "draft_open", epoch=1)
        t = rec.empty_run(200)
        self.locked_run(rec, t)
        observed = self.run_modes(rec.write(), modes=("observed",))["modes"]["observed"]
        self.assertEqual([(p["epoch"], p["hero"]) for p in observed["picks"]], [(1, 1)])


if __name__ == "__main__":
    unittest.main()
