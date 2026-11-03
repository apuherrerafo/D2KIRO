"""Evidence tools: inline fixtures only (no real GSI, no real frames, no network)."""
from __future__ import annotations

import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import ban_frames  # noqa: E402
import collect  # noqa: E402
import minimap_timeline  # noqa: E402
import post_match_oracle  # noqa: E402
from common import iso, redact_payload  # noqa: E402

T0 = dt.datetime(2026, 10, 15, 3, 0, 0, tzinfo=dt.timezone.utc)
STEAMID, ACCOUNT, PERSONA = "76561198999999999", "1038734271", "Jugador Secreto"
NAMES = {1: "npc_dota_hero_antimage", 2: "npc_dota_hero_axe", 3: "npc_dota_hero_bane", 4: "npc_dota_hero_bloodseeker", 5: "npc_dota_hero_crystal_maiden",
         6: "npc_dota_hero_drow_ranger", 7: "npc_dota_hero_earthshaker", 8: "npc_dota_hero_juggernaut", 9: "npc_dota_hero_mirana", 10: "npc_dota_hero_morphling", 11: "npc_dota_hero_nevermore"}
ALLY = [1, 2, 3, 4, 5]  # we are radiant (team 2)
ENEMY = [6, 7, 8, 9, 10]


def at(seconds: float) -> str:
    return iso(T0 + dt.timedelta(seconds=seconds))


def gsi(seq: int, seconds: float, state: str, units: list[tuple[int, int, float]], own_hero: int = 0, match: str = "9100000001") -> dict:
    """Unredacted, as an OLD Companion wrote it (ids + coordinates): the tools must never let them through."""
    minimap = {f"o{i}": {"unitname": NAMES[hero], "team": team, "xpos": x, "ypos": -x, "yaw": 3, "image": "minimap_herocircle"} for i, (hero, team, x) in enumerate(units)}
    minimap["o99"] = {"unitname": "npc_dota_creep_goodguys_melee", "team": 2, "xpos": 5, "ypos": 5}
    return {
        "seq": seq, "receivedAt": at(seconds), "gameState": state, "phase": "X",
        "payload": {
            "map": {"matchid": match, "game_state": state},
            "player": {"steamid": STEAMID, "accountid": ACCOUNT, "name": PERSONA, "team_name": "radiant"},
            "hero": {"id": own_hero, "name": NAMES.get(own_hero, ""), "xpos": 9876.5},
            "minimap": minimap,
            "previously": {"player": {"name": PERSONA, "steamid": STEAMID}},
        },
    }


def draft_lines() -> list[dict]:
    hs, st, pg, mt = "DOTA_GAMERULES_STATE_HERO_SELECTION", "DOTA_GAMERULES_STATE_STRATEGY_TIME", "DOTA_GAMERULES_STATE_PRE_GAME", "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"
    rows = [gsi(1, 0, hs, [])]
    rows.append(gsi(2, 30, hs, [(1, 2, 0)], own_hero=1))  # our own hero, 30 s in, at no position
    rows.append(gsi(3, 50, hs, [(1, 2, 0), (2, 2, 0)], own_hero=1))
    rows.append(gsi(4, 90, st, [(h, 2, 0) for h in ALLY], own_hero=1))
    rows.append(gsi(5, 130, pg, [(h, 2, 77) for h in ALLY] + [(6, 3, 88)], own_hero=1))
    rows.append(gsi(6, 220, mt, [(h, 2, 77) for h in ALLY] + [(h, 3, 88) for h in ENEMY], own_hero=1))
    return rows


def visual(kind: str, seconds: float, **fields) -> dict:
    return {"t": at(seconds), "kind": kind, **fields}


def epoch_records(picks: list[tuple[str, int, int, float]], reverts: list[tuple[str, int, int, float]] = ()) -> list[dict]:
    rows = [visual("draft_open", -1, epoch=1)]
    rows += [visual("pick", s, side=side, slot=slot, heroId=hero, confidence=0.9) for side, slot, hero, s in picks]
    rows += [visual("revert", s, side=side, slot=slot, heroId=hero, confidence=1.0) for side, slot, hero, s in reverts]
    rows.append(visual("draft_closed", 125, phase="ended"))
    return sorted(rows, key=lambda r: r["t"])


def opendota(radiant: list[int], dire: list[int], bans: list[int] | None) -> dict:
    players = [{"player_slot": i, "hero_id": h, "account_id": int(ACCOUNT), "personaname": PERSONA} for i, h in enumerate(radiant)]
    players += [{"player_slot": 128 + i, "hero_id": h, "account_id": 1, "personaname": "otro"} for i, h in enumerate(dire)]
    picks_bans = None if bans is None else [{"is_pick": False, "hero_id": h, "team": 0, "order": 10 + i} for i, h in enumerate(bans)]
    return {"match_id": 9100000001, "players": players, "picks_bans": picks_bans}


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


class RedactionTests(unittest.TestCase):
    def test_no_identity_and_no_coordinate_survives(self):
        payload = gsi(1, 0, "DOTA_GAMERULES_STATE_HERO_SELECTION", [(1, 2, 1500.5)], own_hero=1)["payload"]
        payload["player"]["team2"] = {"player0": {"name": "x", "steamid": STEAMID, "accountid": ACCOUNT}}
        text = json.dumps(redact_payload(payload))
        for secret in (STEAMID, ACCOUNT, PERSONA, "1500.5", "9876", '"x"'):
            self.assertNotIn(secret, text)
        self.assertNotRegex(text, r'"(xpos|ypos|yaw)"')
        clean = redact_payload(payload)
        self.assertEqual(clean["minimap"]["o0"]["hasXpos"], True)
        self.assertEqual(clean["hero"]["name"], "npc_dota_hero_antimage")  # a hero's name is not a player's name


class MinimapTimelineTests(unittest.TestCase):
    def report(self, records: list[dict] | None = None):
        lines = [{**row, "_match": "9100000001"} for row in draft_lines()]
        return minimap_timeline.build(lines, records or [], NAMES)

    def test_per_phase_allies_enemies_and_first_seen(self):
        report, _ = self.report()
        hs, st, pg, mt = (report["phases"][p] for p in ("HERO_SELECTION", "STRATEGY_TIME", "PRE_GAME", "MATCH"))
        self.assertEqual(report["ownTeam"], "radiant")
        self.assertEqual((hs["ALLY_UNIQUE_HEROES"], hs["ENEMY_UNIQUE_HEROES"]), (2, 0))
        self.assertEqual((st["ALLY_UNIQUE_HEROES"], st["ENEMY_UNIQUE_HEROES"]), (5, 0))
        self.assertEqual((pg["ALLY_UNIQUE_HEROES"], pg["ENEMY_UNIQUE_HEROES"]), (5, 1))
        self.assertEqual((mt["ALLY_UNIQUE_HEROES"], mt["ENEMY_UNIQUE_HEROES"]), (5, 5))
        axe = next(r for r in hs["FIRST_SEEN_TIME_PER_HERO"] if r["hero"] == "axe")
        self.assertEqual(axe["secondsIntoPhase"], 50.0)
        self.assertFalse(axe["hasXposAtFirstSight"])  # hero selection: an icon with no position

    def test_first_sight_is_placed_against_the_lock(self):
        report, _ = self.report([visual("pick", 45, side="radiant", slot=1, heroId=2, confidence=0.9)])
        axe = next(r for r in report["phases"]["HERO_SELECTION"]["FIRST_SEEN_TIME_PER_HERO"] if r["hero"] == "axe")
        self.assertEqual((axe["lockSource"], axe["secondsAfterLock"]), ("visual", 5.0))
        am = next(r for r in report["phases"]["HERO_SELECTION"]["FIRST_SEEN_TIME_PER_HERO"] if r["hero"] == "antimage")
        self.assertEqual(am["lockSource"], "gsi_own_hero")

    def test_the_timeline_holds_exactly_the_five_fields(self):
        _, timeline = self.report()
        self.assertTrue(timeline)
        self.assertEqual({key for row in timeline for key in row}, {"t", "phase", "unitname", "team", "hasXpos"})
        self.assertNotIn("creep", json.dumps(timeline))  # heroes only

    def test_reads_the_latest_drafted_match_once_even_if_both_stores_hold_a_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            diag = Path(tmp)
            rows = draft_lines()
            write_jsonl(diag / "gsi-draft-run-001.jsonl", rows[:5])
            write_jsonl(diag / "gsi-raw-run-000.jsonl", rows[3:] + [gsi(9, 999, "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", [], match="9000000000")])
            lines = minimap_timeline.gsi_lines(diag)
            self.assertEqual([r["seq"] for r in lines], [1, 2, 3, 4, 5, 6])


class OracleTests(unittest.TestCase):
    truth = post_match_oracle.reduce_truth(opendota(ALLY, ENEMY, [11]))

    def test_truth_keeps_no_identity(self):
        text = json.dumps(self.truth)
        for secret in (ACCOUNT, PERSONA, "otro", "account_id", "personaname"):
            self.assertNotIn(secret, text)
        self.assertEqual(self.truth["picks"]["dire"], {0: 6, 1: 7, 2: 8, 3: 9, 4: 10})

    def test_ten_of_ten_and_no_false_pick_passes(self):
        picks = [("radiant", i, h, 10 + i) for i, h in enumerate(ALLY)] + [("dire", i, h, 20 + i) for i, h in enumerate(ENEMY)]
        report = post_match_oracle.oracle("9100000001", self.truth, [], epoch_records(picks), NAMES)
        self.assertEqual((report["picks"]["captured"], report["picks"]["correct"], report["picks"]["falseConfirmed"]), (10, 10, 0))
        self.assertEqual(report["picks"]["verdict"], "PASS")
        self.assertEqual(report["bans"]["status"], "AVAILABLE")

    def test_a_reverted_wrong_pick_still_counts_as_false_confirmed(self):
        picks = [("radiant", i, h, 10 + i) for i, h in enumerate(ALLY)] + [("dire", i, h, 20 + i) for i, h in enumerate(ENEMY[:4])]
        picks.append(("dire", 4, 11, 30))  # wrong hero confirmed ...
        report = post_match_oracle.oracle("9100000001", self.truth, [], epoch_records(picks, reverts=[("dire", 4, 11, 31)]), NAMES)
        p = report["picks"]
        self.assertEqual((p["expected"], p["captured"], p["correct"], p["missed"], p["falseConfirmed"]), (10, 9, 9, 1, 1))
        self.assertEqual(p["verdict"], "FAIL")
        self.assertEqual(report["humanCapture"], "UNVALIDATED / NO-GO")
        self.assertEqual(p["missedHeroes"], [{"side": "dire", "truthSlot": 4, "hero": "morphling"}])

    def test_bans_without_structured_truth_are_unavailable_and_never_invented(self):
        truth = post_match_oracle.reduce_truth(opendota(ALLY, ENEMY, None))
        report = post_match_oracle.oracle("9100000001", truth, [], epoch_records([]), NAMES)
        self.assertEqual(report["bans"]["status"], "UNAVAILABLE")
        self.assertNotIn("truth", report["bans"])

    def test_no_truth_yet_is_said_plainly(self):
        report = post_match_oracle.oracle("9100000001", None, [], epoch_records([]), NAMES)
        self.assertEqual(report["picks"]["verdict"], "TRUTH_UNAVAILABLE")
        self.assertEqual(post_match_oracle.reduce_truth({"players": [{"player_slot": 0, "hero_id": 0}]}), None)

    def test_the_epoch_overlapping_the_match_draft_is_the_one_compared(self):
        old = [visual("draft_open", -900, epoch=1), visual("pick", -890, side="radiant", slot=0, heroId=11, confidence=0.9), visual("draft_closed", -800)]
        new = epoch_records([("radiant", 0, 1, 10)])
        lines = [{**row, "_match": "9100000001"} for row in draft_lines()]
        report = post_match_oracle.oracle("9100000001", self.truth, lines, old + new, NAMES)
        self.assertEqual(report["picks"]["falseConfirmed"], 0)
        self.assertEqual(report["picks"]["correct"], 1)


class BanFramesTests(unittest.TestCase):
    def test_something_that_appears_and_stays_is_located_flicker_is_not(self):
        frames = []
        for k in range(8):
            image = np.full((180, 320, 3), 30, np.uint8)
            if k >= 3:
                image[20:40, 200:236] = (200, 180, 40)  # a "resolved ban" portrait appears at frame 3 and stays
            if k % 2:
                image[120:150, 20:60] = 220  # a pulsing glow: changes every frame, never stays
            frames.append(image)
        _, boxes = ban_frames.change_map(frames)
        self.assertTrue(boxes)
        top = boxes[0]
        self.assertAlmostEqual(top["x"], 200 / 320, delta=0.03)
        self.assertAlmostEqual(top["y"], 20 / 180, delta=0.05)
        self.assertFalse(any(b["x"] < 0.25 and b["y"] > 0.6 for b in boxes))


class CollectTests(unittest.TestCase):
    def test_package_is_complete_redacted_and_outside_the_rotated_folders(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            diag, home, evidence = root / "Companion" / "diagnostics", root / "Visual", root / "Evidence"
            write_jsonl(diag / "gsi-draft-run-001.jsonl", draft_lines()[:5])
            write_jsonl(diag / "gsi-raw-run-000.jsonl", draft_lines()[5:])
            picks = [("radiant", i, h, 10 + i) for i, h in enumerate(ALLY)] + [("dire", i, h, 20 + i) for i, h in enumerate(ENEMY)]
            records = epoch_records(picks) + [visual("frame_saved", 1 + 2 * k, label="periodic", file=f"abcd1234-e001-full-{k + 1:03d}-periodic.png") for k in range(4)]
            write_jsonl(home / "diagnostics" / "visual-abcd1234-000.jsonl", records)
            (home / "frames").mkdir(parents=True)
            for k in range(4):
                cv2.imwrite(str(home / "frames" / f"abcd1234-e001-full-{k + 1:03d}-periodic.png"), np.full((90, 160, 3), 10 * k, np.uint8))
            cv2.imwrite(str(home / "frames" / "ffff0000-e001-full-armed.png"), np.zeros((9, 16, 3), np.uint8))  # another run: not ours
            truth = post_match_oracle.reduce_truth(opendota(ALLY, ENEMY, [11]))
            package = collect.collect(None, diag, home, evidence, truth, NAMES)
            manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["match"], "9100000001")
            self.assertEqual(manifest["gsiPhases"], ["HERO_SELECTION", "PRE_GAME", "STRATEGY_TIME"])
            self.assertEqual((manifest["visualStem"], manifest["framesCopied"]), ("abcd1234-e001", 4))
            self.assertEqual(manifest["picksVerdict"], "PASS")
            everything = "".join(p.read_text(encoding="utf-8") for p in package.rglob("*") if p.suffix in (".json", ".jsonl", ".txt"))
            for secret in (STEAMID, ACCOUNT, PERSONA, "9876"):
                self.assertNotIn(secret, everything)
            self.assertNotRegex(everything, r'"(xpos|ypos|yaw)"')
            self.assertTrue((package / "bans" / "ban-frames.json").exists())
            self.assertTrue(str(package).startswith(str(evidence)))


if __name__ == "__main__":
    unittest.main()
