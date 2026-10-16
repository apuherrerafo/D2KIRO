"""Post-match oracle (LOCAL, READ-ONLY): what the visual helper confirmed vs the match's final truth.

    python -I post_match_oracle.py [--match <id>] [--truth-file match.json] [--out <dir>]

Truth comes from the project's existing post-match source, OpenDota `GET /matches/<id>` (public, no key; 429 ->
1 s / 4 s / 16 s). Only `players[].hero_id`, `players[].player_slot` and `picks_bans` are kept -- account ids and names
in that response are dropped on read and never written. Bans: reported only if the source really carries All Pick ban
truth (`picks_bans` entries with `is_pick == false`); otherwise BANS = UNAVAILABLE and the saved human frames are the
evidence. Nothing is ever fabricated, nothing is sent anywhere but that one GET.

The helper's side of the comparison comes from its local diagnostics (`pick` / `revert` events of the draft epoch that
overlaps the match's hero selection). Status words follow the release rule: a run PASSES only at 10/10 correct and
0 false confirmed -- and one human run is evidence, not a release decision.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import PHASE_OF_STATE, companion_diag_dir, iso, load_hero_names, parse_time, read_jsonl, short, visual_home  # noqa: E402
from minimap_timeline import gsi_lines  # noqa: E402

OPENDOTA = "https://api.opendota.com/api/matches/{}"
RETRY_S = (1, 4, 16)


def fetch_truth(match: str) -> dict | None:
    """OpenDota's match, reduced to the fields this oracle needs. None if it is not there (yet)."""
    if not match.isdigit():
        raise ValueError("match id must be digits")
    request = urllib.request.Request(OPENDOTA.format(match), headers={"user-agent": "d2kiro-post-match-oracle"})
    for attempt, wait in enumerate((0, *RETRY_S)):
        if wait:
            time.sleep(wait)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return reduce_truth(json.loads(response.read(4 * 1024 * 1024)))
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < len(RETRY_S):
                continue
            if error.code == 404:
                return None
            raise
    return None


def reduce_truth(match: object) -> dict | None:
    """The match JSON -> {"picks": {"radiant": {slot: hero}, "dire": {...}}, "bans": [...] | None}. Identity never kept."""
    if not isinstance(match, dict) or not isinstance(match.get("players"), list):
        return None
    picks: dict[str, dict[int, int]] = {"radiant": {}, "dire": {}}
    for player in match["players"]:
        if not isinstance(player, dict):
            continue
        slot, hero = player.get("player_slot"), player.get("hero_id")
        if not isinstance(slot, int) or not isinstance(hero, int) or hero <= 0:
            continue
        picks["dire" if slot >= 128 else "radiant"][slot & 0x7F] = hero
    bans = None
    raw = match.get("picks_bans")
    if isinstance(raw, list):
        listed = [{"heroId": b["hero_id"], "side": "dire" if b.get("team") == 1 else "radiant", "order": b.get("order")} for b in raw if isinstance(b, dict) and b.get("is_pick") is False and isinstance(b.get("hero_id"), int)]
        bans = listed or None
    if sum(len(side) for side in picks.values()) == 0:
        return None
    return {"picks": picks, "bans": bans}


def draft_epoch_records(records: list[dict], window: tuple | None) -> list[dict]:
    """The visual records of the draft epoch overlapping `window` (GSI hero selection .. strategy time), else the last
    epoch that confirmed anything."""
    epochs: list[list[dict]] = []
    current: list[dict] | None = None
    for record in sorted((r for r in records if isinstance(r.get("t"), str)), key=lambda r: parse_time(r["t"])):
        if record.get("kind") == "draft_open":
            current = [record]
            epochs.append(current)
        elif current is not None:
            current.append(record)
            if record.get("kind") == "draft_closed":
                current = None
    if window is not None:
        start, end = window
        for epoch in reversed(epochs):
            began = parse_time(epoch[0]["t"])
            closed = parse_time(epoch[-1]["t"])
            if began <= end and closed >= start:
                return epoch
    with_picks = [epoch for epoch in epochs if any(r.get("kind") == "pick" for r in epoch)]
    return with_picks[-1] if with_picks else []


def captured(epoch: list[dict]) -> tuple[dict[tuple[str, int], int], list[tuple[str, int, int]]]:
    """(final slot -> hero after every pick/revert, every hero ever confirmed)."""
    final: dict[tuple[str, int], int] = {}
    ever: list[tuple[str, int, int]] = []
    for record in epoch:
        side, slot, hero = record.get("side"), record.get("slot"), record.get("heroId")
        if side not in ("radiant", "dire") or not isinstance(slot, int) or not isinstance(hero, int):
            continue
        if record.get("kind") == "pick":
            final[(side, slot)] = hero
            ever.append((side, slot, hero))
        elif record.get("kind") == "revert" and final.get((side, slot)) == hero:
            del final[(side, slot)]
    return final, ever


def compare(truth: dict, final: dict[tuple[str, int], int], ever: list[tuple[str, int, int]], names: dict[int, str]) -> dict:
    def name(hero: int) -> str:
        return short(names.get(hero, f"hero#{hero}"))

    truth_sets = {side: set(slots.values()) for side, slots in truth["picks"].items()}
    expected = sum(len(s) for s in truth_sets.values())
    correct = [(side, slot, hero) for (side, slot), hero in sorted(final.items()) if hero in truth_sets[side]]
    wrong_final = [(side, slot, hero) for (side, slot), hero in sorted(final.items()) if hero not in truth_sets[side]]
    false_confirmed = sorted({(side, hero) for side, _, hero in ever if hero not in truth_sets[side]})
    got = {side: {hero for (s, _), hero in final.items() if s == side} for side in ("radiant", "dire")}
    missed = [(side, slot, hero) for side, slots in truth["picks"].items() for slot, hero in sorted(slots.items()) if hero not in got[side]]
    slot_agree = sum(1 for (side, slot), hero in final.items() if truth["picks"][side].get(slot) == hero)
    passed = len(correct) == expected == 10 and not false_confirmed
    return {
        "expected": expected,
        "captured": len(final),
        "correct": len(correct),
        "missed": len(missed),
        "falseConfirmed": len(false_confirmed),
        "slotOrderAgreement": slot_agree,
        "verdict": "PASS" if passed else "FAIL",
        "truth": {side: [{"slot": slot, "hero": name(hero)} for slot, hero in sorted(slots.items())] for side, slots in truth["picks"].items()},
        "capturedFinal": [{"side": side, "slot": slot, "hero": name(hero), "correct": hero in truth_sets[side]} for (side, slot), hero in sorted(final.items())],
        "missedHeroes": [{"side": side, "truthSlot": slot, "hero": name(hero)} for side, slot, hero in missed],
        "falseConfirmedHeroes": [{"side": side, "hero": name(hero)} for side, hero in false_confirmed],
        "wrongAtEnd": [{"side": side, "slot": slot, "hero": name(hero)} for side, slot, hero in wrong_final],
    }


def oracle(match: str | None, truth: dict | None, lines: list[dict], records: list[dict], names: dict[int, str]) -> dict:
    draft = [r for r in lines if PHASE_OF_STATE.get(str(r.get("gameState"))) in ("HERO_SELECTION", "STRATEGY_TIME")]
    window = (parse_time(draft[0]["receivedAt"]), parse_time(draft[-1]["receivedAt"])) if draft else None
    epoch = draft_epoch_records(records, window)
    final, ever = captured(epoch)
    report: dict = {
        "schema": "d2kiro-post-match-oracle/v1",
        "match": match,
        "draftWindow": None if window is None else [iso(window[0]), iso(window[1])],
        "visualEpoch": None if not epoch else epoch[0].get("epoch"),
        "visualPickEvents": sum(1 for r in epoch if r.get("kind") == "pick"),
        "visualRevertEvents": sum(1 for r in epoch if r.get("kind") == "revert"),
    }
    if truth is None:
        report["picks"] = {"verdict": "TRUTH_UNAVAILABLE", "note": "the post-match source has no player heroes for this match (yet): run again later"}
        report["bans"] = {"status": "UNAVAILABLE"}
        report["humanCapture"] = "UNVALIDATED / NO-GO"
        return report
    report["picks"] = compare(truth, final, ever, names)
    if truth.get("bans"):
        report["bans"] = {"status": "AVAILABLE", "truth": [{"side": b["side"], "hero": short(names.get(b["heroId"], f"hero#{b['heroId']}")), "order": b["order"]} for b in truth["bans"]], "captured": "NOT_IMPLEMENTED (no ban matcher in this RC)"}
    else:
        report["bans"] = {"status": "UNAVAILABLE", "note": "the post-match source carries no All Pick ban truth: use the saved human frames (ban_frames.py)"}
    report["humanCapture"] = "PASS for this run (10/10 correct, 0 false confirmed) -- evidence, not a release decision" if report["picks"]["verdict"] == "PASS" else "UNVALIDATED / NO-GO"
    return report


def to_text(report: dict) -> str:
    out = [f"POST-MATCH ORACLE  match={report['match']}  visual epoch={report['visualEpoch']}  draft window={report['draftWindow']}"]
    picks = report["picks"]
    if picks["verdict"] == "TRUTH_UNAVAILABLE":
        out.append(f"PICKS: TRUTH_UNAVAILABLE -- {picks['note']}")
    else:
        out += [
            "PICKS:",
            f"  expected {picks['expected']}",
            f"  captured {picks['captured']}",
            f"  correct {picks['correct']}",
            f"  missed {picks['missed']}",
            f"  false confirmed {picks['falseConfirmed']}",
            f"  (screen slot == player slot for {picks['slotOrderAgreement']} of the captured)",
        ]
        for row in picks["capturedFinal"]:
            out.append(f"    {row['side']:<7} slot {row['slot']}  {row['hero']:<22} {'OK' if row['correct'] else 'WRONG'}")
        for row in picks["missedHeroes"]:
            out.append(f"    MISSED  {row['side']:<7} {row['hero']}")
        for row in picks["falseConfirmedHeroes"]:
            out.append(f"    FALSE CONFIRMED  {row['side']:<7} {row['hero']}")
        out.append(f"  verdict: {picks['verdict']}")
    bans = report["bans"]
    out.append(f"BANS: {bans['status']}" + (f" -- {bans.get('note')}" if bans.get("note") else ""))
    for row in bans.get("truth", []):
        out.append(f"    {row['side']:<7} {row['hero']}")
    out.append(f"HUMAN RANKED CAPTURE: {report['humanCapture']}")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--match")
    parser.add_argument("--truth-file", type=Path, help="an OpenDota /matches/<id> JSON saved earlier (no network)")
    parser.add_argument("--diag", type=Path, default=None)
    parser.add_argument("--visual-home", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)
    lines = gsi_lines(args.diag or companion_diag_dir(), args.match)
    match = args.match or (lines[0]["_match"] if lines else None)
    if args.truth_file:
        truth = reduce_truth(json.loads(args.truth_file.read_text(encoding="utf-8")))
    elif match:
        truth = fetch_truth(match)
    else:
        print("no match id: pass --match", file=sys.stderr)
        return 2
    records = list(read_jsonl(sorted(((args.visual_home or visual_home()) / "diagnostics").glob("visual-*.jsonl"))))
    report = oracle(match, truth, lines, records, load_hero_names())
    print(to_text(report))
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "oracle.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
        (args.out / "oracle.txt").write_text(to_text(report), encoding="utf-8")
    return 0 if report["picks"].get("verdict") == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
