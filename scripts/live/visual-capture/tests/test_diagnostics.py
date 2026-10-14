"""Local diagnostics + the supervised live loop. Synthetic frames, temp folders, no network, no real Dota art."""
from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from fixtures import fake_catalog  # noqa: F401  (sets sys.path for d2vc)
from d2vc import diagnostics as diag_module
from d2vc.bench import DEFAULT_THRESHOLDS
from d2vc.diagnostics import Diagnostics
from d2vc.emit import EnvelopeFactory
from d2vc.session import VisualSession
from d2vc.transport import DraftLifecycle
from test_visual_capture import CATALOG, CLOCK, LAYOUT, MATCHER, arm, feed, ghost, hero_slot, hover, lock, paste, screen

ALLOWED_REASONS = {"ok", "unoccupied", "hover", "ambiguous", "unreadable", "blank", "below_score", "below_margin"}
EPOCH_1, EPOCH_2 = DraftLifecycle("hero_selection", 1), DraftLifecycle("hero_selection", 2)


def read_records(directory: Path) -> list[dict]:
    rows: list[dict] = []
    for path in sorted(directory.glob("visual-*.jsonl")):
        rows += [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    return rows


def session_with(directory: Path) -> VisualSession:
    diagnostics = Diagnostics(directory / "diagnostics", "run1", CLOCK)
    session = VisualSession(MATCHER, LAYOUT, DEFAULT_THRESHOLDS, EnvelopeFactory("live-session-1", "run1", CLOCK), diagnostics=diagnostics)
    session.on_lifecycle(DraftLifecycle("hero_selection", 1))
    return session


def flagged(directory: Path) -> VisualSession:
    (directory / diag_module.SAVE_FRAMES_FLAG).write_text("", encoding="utf-8")
    return session_with(directory)


def pngs(directory: Path, pattern: str = "*.png") -> list[Path]:
    return sorted((directory / "frames").glob(pattern))


def play_draft(session, start_ms: float = 0.0, locks: int = 3) -> float:
    """arm on an empty bar, lock `locks` heroes one after the other (each held ~2 s), hold ~12 s of an unchanged bar."""
    now, _ = arm(session, start_ms=start_ms)
    frame = screen([None] * 5, [None] * 5)
    for i in range(locks):
        frame = lock(frame, "radiant", i, hero_slot(3 + i, "radiant", i))
        now, _ = feed(session, frame, now, 16)
    now, _ = feed(session, frame, now, 100)
    return now


class DiagnosticsTests(unittest.TestCase):
    def test_draft_frames_record_geometry_and_per_slot_reasons(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = session_with(Path(tmp))
            now, _ = arm(session)
            frame = lock(screen([None] * 5, [None] * 5), "radiant", 0, hero_slot(3, "radiant", 0))
            feed(session, frame, now, 12)
            records = read_records(Path(tmp) / "diagnostics")
            frames = [r for r in records if r["kind"] == "frame" and r["draftOpen"]]
            self.assertTrue(frames)
            last = frames[-1]
            self.assertEqual(last["frame"], [1920, 1080])
            self.assertEqual(last["layout"], "standard")
            self.assertEqual(len(last["slots"]), 10)
            for slot in last["slots"]:
                self.assertIn(slot["reason"], ALLOWED_REASONS)
                self.assertEqual(len(slot["rect"]), 4)
            lit = next(s for s in last["slots"] if s["side"] == "radiant" and s["i"] == 0)
            self.assertEqual(lit["state"], "hero")
            self.assertEqual(lit["cand"], 3)
            self.assertTrue(lit["dist"] >= lit["thr"])
            self.assertEqual(next(s for s in last["slots"] if s["side"] == "dire" and s["i"] == 0)["reason"], "unoccupied")
            # the lock evidence of 0.1.3: strip chroma, the decision value, the verdict and whether the card bar is there
            self.assertEqual(lit["lockstate"], "locked")
            self.assertGreaterEqual(lit["top"], 80)
            self.assertEqual(lit["chroma"], lit["top"])
            self.assertTrue(lit["bar_present"])
            idle = next(s for s in last["slots"] if s["side"] == "dire" and s["i"] == 0)
            self.assertEqual(idle["lockstate"], "empty")
            self.assertLess(idle["top"], 40)
            self.assertGreaterEqual(idle["bot"], 80)  # an unlocked card carries its bar at the bottom
            self.assertEqual(last["barsPresent"], 10)

    def test_lifecycle_and_window_transitions_are_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = session_with(Path(tmp))
            arm(session)
            session.on_lifecycle(DraftLifecycle("ended", 1))
            kinds = [r["kind"] for r in read_records(Path(tmp) / "diagnostics")]
            for expected in ("window_found", "draft_open", "draft_closed"):
                self.assertIn(expected, kinds)

    def test_records_carry_no_secret_or_identity_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = session_with(Path(tmp))
            now, _ = arm(session)
            feed(session, screen([None] * 5, [None] * 5), now, 4)
            text = "".join(p.read_text(encoding="utf-8") for p in (Path(tmp) / "diagnostics").glob("*.jsonl")).lower()
            for forbidden in ("token", "liveid", "live_id", "steam", "account", "password", "secret"):
                self.assertNotIn(forbidden, text)

    def test_raw_frames_are_not_saved_without_the_flag(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = session_with(Path(tmp))
            now, _ = arm(session)
            feed(session, screen([None] * 5, [None] * 5), now, 8)
            self.assertFalse((Path(tmp) / "frames").exists())

    def test_a_hover_is_recorded_as_a_hover_with_its_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = session_with(Path(tmp))
            now, _ = arm(session)
            feed(session, hover(screen([None] * 5, [None] * 5), "radiant", 2, ghost(4, "radiant", 2)), now, 12)
            last = [r for r in read_records(Path(tmp) / "diagnostics") if r["kind"] == "frame" and r["draftOpen"]][-1]
            slot = next(s for s in last["slots"] if s["side"] == "radiant" and s["i"] == 2)
            self.assertEqual((slot["lockstate"], slot["reason"], slot["state"]), ("hover", "hover", "empty"))
            self.assertLess(slot["top"], 40)

    def test_nothing_is_saved_without_the_flag_even_through_a_whole_draft(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = session_with(Path(tmp))
            now = play_draft(session)
            session.on_lifecycle(DraftLifecycle("ended", 1))
            session.process(screen([None] * 5, [None] * 5), now)
            self.assertFalse((Path(tmp) / "frames").exists())

    def test_strips_cover_rows_0_to_70_of_the_reference_scaled_to_the_viewport(self):
        for size, expected in (((1600, 900), (70, 1280)), ((1920, 1080), (84, 1536)), ((1280, 720), (56, 1024))):
            frame = np.zeros((size[1], size[0], 3), np.uint8)
            self.assertEqual(diag_module.strip_of(frame, LAYOUT).shape[:2], expected, size)
        letterboxed = np.zeros((1080, 2560, 3), np.uint8)  # pillar-boxed 21:9: the 16:9 viewport inside it
        self.assertEqual(diag_module.strip_of(letterboxed, LAYOUT).shape[:2], (84, 1536))

    def test_evidence_is_saved_across_the_whole_draft_and_stays_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = flagged(Path(tmp))
            now = play_draft(session, locks=3)
            strips = pngs(Path(tmp), "*-strip-*.png")
            fulls = pngs(Path(tmp), "*-full-*.png")
            reasons = {path.stem.rsplit("-", 1)[1] for path in strips}
            self.assertTrue({"health", "lock", "confirm"} <= reasons, reasons)  # saved at the events, not only at the start
            self.assertEqual({path.stem.split("-full-")[1] for path in fulls}, {"armed", "firstlock"})  # budget left for the rest
            self.assertLessEqual(len(fulls), diag_module.MAX_FULL_FRAMES)
            self.assertLessEqual(len(strips), diag_module.MAX_EVENT_STRIPS + diag_module.MAX_KEEPALIVE_STRIPS + diag_module.RING_STRIPS)
            self.assertTrue(all(path.stem.startswith("run1-e001-") for path in strips + fulls))
            one = np.asarray(__import__("cv2").imread(str(strips[0])))
            self.assertEqual(one.shape[:2], (84, 1536))  # rows 0-70 / x 160-1440 of 1600x900, at 1920x1080

    def test_a_ten_second_keepalive_is_saved_during_a_quiet_draft(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = flagged(Path(tmp))
            now, _ = arm(session)
            feed(session, screen([None] * 5, [None] * 5), now, 8 * 30)  # 30 s, nothing happens
            keepalives = [p for p in pngs(Path(tmp), "*-strip-*.png") if p.stem.endswith("keepalive")]
            self.assertGreaterEqual(len(keepalives), 2)
            self.assertLessEqual(len(keepalives), 4)

    def test_a_flush_on_close_keeps_the_last_strips_and_the_last_readable_frame(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = flagged(Path(tmp))
            now = play_draft(session)
            before = len(pngs(Path(tmp), "*-strip-*-tail.png"))
            self.assertEqual(before, 0)  # the ring lives in memory until the draft closes
            session.on_lifecycle(DraftLifecycle("ended", 1))
            tails = pngs(Path(tmp), "*-strip-*-tail.png")
            self.assertTrue(1 <= len(tails) <= diag_module.RING_STRIPS)
            self.assertEqual(len(pngs(Path(tmp), "*-full-lastreadable.png")), 1)
            self.assertEqual(pngs(Path(tmp), "*-full-closed.png"), [])
            session.process(screen([None] * 5, [None] * 5), now + 125)  # the first frame after the close
            session.process(screen([None] * 5, [None] * 5), now + 250)
            self.assertEqual(len(pngs(Path(tmp), "*-full-closed.png")), 1)  # exactly one
            self.assertEqual(len(pngs(Path(tmp), "*-full-*.png")), 4)  # armed, firstlock, lastreadable, closed: the maximum

    def test_the_budget_restarts_with_every_draft_epoch(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(diag_module, "MAX_EVENT_STRIPS", 3), mock.patch.object(diag_module, "MAX_KEEPALIVE_STRIPS", 1):
                session = flagged(Path(tmp))
                now = play_draft(session, locks=4)
                first = pngs(Path(tmp), "run1-e001-strip-*.png")
                self.assertLessEqual(len([p for p in first if not p.stem.endswith("tail")]), 3 + 1)  # the old process-wide budget was spent here
                session.on_lifecycle(DraftLifecycle("ended", 1))
                self.assertTrue(session.on_lifecycle(EPOCH_2))
                now = play_draft(session, start_ms=now + 5_000, locks=2)
                second = pngs(Path(tmp), "run1-e002-strip-*.png")
                self.assertTrue(second)  # a late draft still has evidence
                self.assertTrue({p.stem.split("-full-")[1] for p in pngs(Path(tmp), "run1-e002-full-*.png")} >= {"armed", "firstlock"})
                self.assertEqual(len(pngs(Path(tmp), "run1-e001-full-*.png")), 3)  # armed, firstlock, lastreadable

    def test_a_new_epoch_without_a_close_still_keeps_the_old_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = flagged(Path(tmp))
            now = play_draft(session)
            self.assertTrue(session.on_lifecycle(EPOCH_2))  # GSI started another draft: the old one is flushed
            self.assertEqual(len(pngs(Path(tmp), "run1-e001-full-lastreadable.png")), 1)

    def test_pruning_keeps_the_frames_folder_bounded_oldest_draft_epoch_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            frames = Path(tmp) / "frames"
            frames.mkdir()
            now = time.time()

            def make(name: str, age_s: float, size: int = 1000) -> Path:
                path = frames / name
                path.write_bytes(b"x" * size)
                os.utime(path, (now - age_s, now - age_s))
                return path

            legacy = [make("aaaa1111-000-raw.png", 5000), make("aaaa1111-000-layout.png", 5000)]  # 0.1.2 pairs: one group per run
            old = [make("bbbb2222-e001-strip-000-lock.png", 4000), make("bbbb2222-e001-full-armed.png", 4000)]
            newer = [make("bbbb2222-e002-strip-000-lock.png", 3000), make("bbbb2222-e002-full-armed.png", 3000)]
            unrelated = make("notes.png", 9000)
            current = [make("run1-e003-strip-000-lock.png", 10), make("run1-e003-full-armed.png", 10)]
            diagnostics = Diagnostics(Path(tmp) / "diagnostics", "run1", CLOCK)
            diagnostics.begin_epoch(3)
            with mock.patch.object(diag_module, "MAX_FRAMES_BYTES", 4500):
                diagnostics._prune_frames()
            left = {p.name for p in frames.glob("*.png")}
            self.assertEqual(sum(p.stat().st_size for p in frames.glob("*.png") if p.name != "notes.png"), 4000)
            self.assertTrue(all(not p.exists() for p in legacy + old))  # the oldest epochs went first, whole
            self.assertTrue(all(p.exists() for p in newer + current))
            self.assertTrue(unrelated.exists())  # unrelated files are never touched
            with mock.patch.object(diag_module, "MAX_FRAMES_BYTES", 1):  # even an absurd budget never deletes the running epoch
                diagnostics._prune_frames()
            self.assertTrue(all(p.exists() for p in current))
            self.assertTrue(all(not p.exists() for p in newer))
            self.assertIn("notes.png", left)

    def test_older_evidence_is_pruned_as_the_running_draft_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            frames = Path(tmp) / "frames"
            frames.mkdir()
            old = frames / "dead0000-e001-full-armed.png"
            old.write_bytes(b"x" * 300_000)
            os.utime(old, (time.time() - 9_000, time.time() - 9_000))
            with mock.patch.object(diag_module, "MAX_FRAMES_BYTES", 450_000):
                session = flagged(Path(tmp))
                play_draft(session, locks=3)
            self.assertFalse(old.exists())  # the previous draft went, the running one is intact
            self.assertTrue(pngs(Path(tmp), "run1-e001-full-armed.png"))

    def test_files_rotate_and_total_size_is_capped(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "diagnostics"
            with mock.patch.object(diag_module, "MAX_FILE_BYTES", 400), mock.patch.object(diag_module, "MAX_TOTAL_BYTES", 1500):
                diagnostics = Diagnostics(directory, "run1", CLOCK)
                for i in range(200):
                    diagnostics.event("tick", n=i, pad="x" * 40)
            files = list(directory.glob("visual-*.jsonl"))
            self.assertGreater(len(files), 1)
            self.assertLessEqual(sum(p.stat().st_size for p in files), 1500 + 400)

    def test_an_unwritable_folder_silences_diagnostics_never_the_helper(self):
        with tempfile.TemporaryDirectory() as tmp:
            blocker = Path(tmp) / "blocked"
            blocker.write_text("a file where a folder should be", encoding="utf-8")
            diagnostics = Diagnostics(blocker / "diagnostics", "run1", CLOCK)
            diagnostics.event("start")  # must not raise


class LiveLoopTests(unittest.TestCase):
    """cmd_live must wait, not die: no credentials yet, no Dota window yet, a missing catalog is the only exit."""

    def run_loop(self, tmp: str, *, sender_side_effect, backend_side_effect, iterations: int = 6):
        from d2vc import cli

        args = argparse.Namespace(layout=None, window="Dota 2", fps=1000.0)
        sleeps = {"n": 0}

        def fake_sleep(_seconds: float) -> None:
            sleeps["n"] += 1
            if sleeps["n"] > iterations:
                raise KeyboardInterrupt

        sender = mock.Mock()
        sender.url = "http://127.0.0.1:53120/relay/api/live/visual/companion"
        sender.lifecycle = None
        sender.post.return_value = True
        sender_calls = {"n": 0}

        def sender_from_env():
            sender_calls["n"] += 1
            return sender_side_effect(sender_calls["n"], sender)

        with mock.patch.dict("os.environ", {"D2KIRO_VISUAL_DIAG_DIR": str(Path(tmp) / "diag")}), \
            mock.patch.object(cli, "load_catalog", return_value=CATALOG), \
            mock.patch.object(cli, "_sender_from_env", side_effect=sender_from_env), \
            mock.patch.object(cli.time, "sleep", side_effect=fake_sleep), \
            mock.patch("d2vc.backend.WgcBackend", side_effect=backend_side_effect):
            code = cli.cmd_live(args)
        return code, read_records(Path(tmp) / "diag"), sender_calls["n"]

    def test_waits_for_credentials_instead_of_exiting(self):
        def late_credentials(call, sender):
            if call < 3:
                raise KeyError("a D2KIRO GSI cfg")
            return sender, "link"

        with tempfile.TemporaryDirectory() as tmp:
            code, records, calls = self.run_loop(tmp, sender_side_effect=late_credentials, backend_side_effect=OSError("no window"))
            self.assertEqual(code, 0)
            self.assertEqual(calls, 3)
            seen = [r["kind"] for r in records if r["kind"] in ("waiting_credentials", "credentials")]
            self.assertEqual(seen, ["waiting_credentials", "waiting_credentials", "credentials"])

    def test_no_dota_window_is_a_wait_not_a_crash(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, records, _ = self.run_loop(tmp, sender_side_effect=lambda call, sender: (sender, "link"), backend_side_effect=OSError("Dota 2 window not found"))
            self.assertEqual(code, 0)
            self.assertIn("waiting_window", [r["kind"] for r in records])

    def test_first_run_downloads_the_catalog_and_an_offline_start_retries(self):
        from d2vc import cli

        attempts = {"n": 0}

        def flaky_fetch(_directory):
            attempts["n"] += 1
            if attempts["n"] == 1:
                raise OSError("offline")
            return 127

        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict("os.environ", {"D2KIRO_VISUAL_DIAG_DIR": str(Path(tmp) / "diag"), "D2KIRO_VISUAL_HOME": tmp}),             mock.patch.object(cli, "catalog_ready", return_value=False),             mock.patch.object(cli, "fetch_catalog", side_effect=flaky_fetch),             mock.patch.object(cli, "load_catalog", return_value=CATALOG),             mock.patch.object(cli, "_sender_from_env", side_effect=KeyError("no cfg")),             mock.patch.object(cli.time, "sleep", side_effect=[None, KeyboardInterrupt()]):
            code = cli.cmd_live(argparse.Namespace(layout=None, window="Dota 2", fps=8.0))
            kinds = [r["kind"] for r in read_records(Path(tmp) / "diag")]
        self.assertEqual(code, 0)
        self.assertEqual(attempts["n"], 2)
        self.assertEqual(kinds.count("fetching_catalog"), 2)
        self.assertIn("error", kinds)
        self.assertIn("catalog", kinds)


if __name__ == "__main__":
    unittest.main()
