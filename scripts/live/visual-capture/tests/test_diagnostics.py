"""Local diagnostics + the supervised live loop. Synthetic frames, temp folders, no network, no real Dota art."""
from __future__ import annotations

import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fixtures import fake_catalog  # noqa: F401  (sets sys.path for d2vc)
from d2vc import diagnostics as diag_module
from d2vc.bench import DEFAULT_THRESHOLDS
from d2vc.diagnostics import Diagnostics
from d2vc.emit import EnvelopeFactory
from d2vc.session import VisualSession
from d2vc.transport import DraftLifecycle
from test_visual_capture import CATALOG, CLOCK, LAYOUT, MATCHER, arm, feed, hero_slot, paste, screen

ALLOWED_REASONS = {"ok", "unoccupied", "blank", "below_score", "below_margin"}


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


class DiagnosticsTests(unittest.TestCase):
    def test_draft_frames_record_geometry_and_per_slot_reasons(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = session_with(Path(tmp))
            now, _ = arm(session)
            frame = paste(screen([None] * 5, [None] * 5), "radiant", 0, hero_slot(3, "radiant", 0))
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

    def test_frames_are_saved_locally_only_with_the_flag_and_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / diag_module.SAVE_FRAMES_FLAG).write_text("", encoding="utf-8")
            session = session_with(Path(tmp))
            with mock.patch.object(diag_module, "MAX_FRAMES", 2), mock.patch.object(diag_module, "FRAME_SAVE_EVERY_MS", 0.0):
                arm(session, frames=12)
            self.assertEqual(len(list((Path(tmp) / "frames").glob("*-raw.png"))), 2)
            self.assertEqual(len(list((Path(tmp) / "frames").glob("*-layout.png"))), 2)

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
