"""GSI minimap spike (LOCAL ONLY, never forwarded): which heroes does `minimap` reveal, in which phase, and when?

    python -I minimap_timeline.py [--match <id>] [--out <dir>] [--diag <companion diagnostics dir>]

Reads the Companion's local raw GSI (`gsi-draft-*.jsonl` = every payload loading -> pre-game, plus `gsi-raw-*.jsonl`
for the match) and answers, per phase (HERO_SELECTION, STRATEGY_TIME, PRE_GAME, and MATCH for comparison):
  ALLY_UNIQUE_HEROES / ENEMY_UNIQUE_HEROES / FIRST_SEEN_TIME_PER_HERO
plus, when the visual helper's diagnostics are available, how the first sighting relates to the hero's LOCK (the visual
confirmation, or GSI's own hero for ours). The timeline it writes holds exactly: timestamp, phase, unitname, team,
hasXpos -- never a coordinate, never an identity. Nothing here feeds the product.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import PHASE_OF_STATE, SIDE_OF_TEAM, TEAM_OF_NAME, companion_diag_dir, iso, load_hero_names, parse_time, read_jsonl, short, visual_home  # noqa: E402

REPORT_PHASES = ("HERO_SELECTION", "STRATEGY_TIME", "PRE_GAME", "MATCH")


def _has_position(obj: dict) -> bool:
    if "hasXpos" in obj:
        return bool(obj["hasXpos"])
    value = obj.get("xpos")
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value != 0


def hero_units(payload: dict) -> list[tuple[str, int | None, bool]]:
    """(unitname, team, hasXpos) for every HERO icon on the minimap. Coordinates are read as a boolean and dropped."""
    minimap = payload.get("minimap")
    if not isinstance(minimap, dict):
        return []
    out = []
    for obj in minimap.values():
        if not isinstance(obj, dict):
            continue
        unit = obj.get("unitname")
        if not isinstance(unit, str) or not unit.startswith("npc_dota_hero_"):
            continue
        team = obj.get("team") if isinstance(obj.get("team"), int) and obj.get("team") in (2, 3) else None
        out.append((unit, team, _has_position(obj)))
    return out


def gsi_lines(diag: Path, match: str | None = None) -> list[dict]:
    """Every GSI line of one match (the latest one with a draft window when `match` is None), oldest first, deduplicated
    (a draft-window line is also in the rolling raw when it was sampled)."""
    files = sorted(diag.glob("gsi-draft-*.jsonl")) + sorted(diag.glob("gsi-raw-*.jsonl"))
    rows: dict[tuple, dict] = {}
    for row in read_jsonl(files):
        payload = row.get("payload")
        if not isinstance(payload, dict) or not isinstance(row.get("receivedAt"), str):
            continue
        game_map = payload.get("map") if isinstance(payload.get("map"), dict) else {}
        row_match = str(game_map.get("matchid")) if game_map.get("matchid") not in (None, "", "0") else None
        rows[(row["receivedAt"], row.get("seq"))] = {**row, "_match": row_match}
    ordered = sorted(rows.values(), key=lambda r: parse_time(r["receivedAt"]))
    if match is None:
        drafted = [r["_match"] for r in ordered if r["_match"] and PHASE_OF_STATE.get(str(r.get("gameState"))) == "HERO_SELECTION"]
        match = drafted[-1] if drafted else None
    if match is None:
        return []
    return [r for r in ordered if r["_match"] == match]


def own_team(lines: list[dict]) -> int | None:
    for row in lines:
        player = row["payload"].get("player")
        if isinstance(player, dict) and player.get("team_name") in TEAM_OF_NAME:
            return TEAM_OF_NAME[player["team_name"]]
    for row in lines:  # our own hero's icon carries our team
        hero = row["payload"].get("hero")
        if isinstance(hero, dict) and isinstance(hero.get("name"), str):
            for unit, team, _ in hero_units(row["payload"]):
                if unit == hero["name"] and team is not None:
                    return team
    return None


def lock_times(lines: list[dict], visual_records: list[dict], hero_names: dict[int, str]) -> dict[str, dict]:
    """hero internal name -> {"at": first lock time, "source": visual|gsi_own_hero}."""
    out: dict[str, dict] = {}
    for row in lines:
        hero = row["payload"].get("hero")
        if isinstance(hero, dict) and isinstance(hero.get("name"), str) and hero["name"].startswith("npc_dota_hero_") and isinstance(hero.get("id"), int) and hero["id"] > 0:
            out.setdefault(hero["name"], {"at": parse_time(row["receivedAt"]), "source": "gsi_own_hero"})
    for record in visual_records:
        if record.get("kind") == "pick" and isinstance(record.get("heroId"), int) and isinstance(record.get("t"), str):
            name = hero_names.get(record["heroId"])
            if name and (name not in out or parse_time(record["t"]) < out[name]["at"]):
                out[name] = {"at": parse_time(record["t"]), "source": "visual", "side": record.get("side")}
    return out


def build(lines: list[dict], visual_records: list[dict] | None = None, hero_names: dict[int, str] | None = None) -> tuple[dict, list[dict]]:
    """-> (report, redacted timeline rows). Pure."""
    ours = own_team(lines)
    locks = lock_times(lines, visual_records or [], hero_names or {})
    phases: dict[str, dict] = {}
    seen: dict[str, dict[str, dict]] = defaultdict(dict)
    timeline: list[dict] = []
    last_state: dict[tuple[str, str], tuple] = {}
    for row in lines:
        phase = PHASE_OF_STATE.get(str(row.get("gameState")), "OTHER")
        at = parse_time(row["receivedAt"])
        info = phases.setdefault(phase, {"posts": 0, "postsWithHeroIcons": 0, "firstAt": at, "lastAt": at})
        info["posts"] += 1
        info["lastAt"] = at
        units = hero_units(row["payload"])
        if units:
            info["postsWithHeroIcons"] += 1
        for unit, team, has_xpos in units:
            if unit not in seen[phase]:
                seen[phase][unit] = {"team": team, "at": at, "hasXpos": has_xpos}
            key = (phase, unit)
            if last_state.get(key) != (team, has_xpos):
                last_state[key] = (team, has_xpos)
                timeline.append({"t": iso(at), "phase": phase, "unitname": unit, "team": team, "hasXpos": has_xpos})
    report: dict = {"schema": "d2kiro-minimap-spike/v1", "match": lines[0]["_match"] if lines else None, "ownTeam": SIDE_OF_TEAM.get(ours) if ours else None, "phases": {}}
    for phase in REPORT_PHASES:
        info = phases.get(phase)
        if info is None:
            report["phases"][phase] = {"observed": False}
            continue
        heroes = seen.get(phase, {})

        def side(team: int | None) -> str:
            if team is None or ours is None:
                return "unknown"
            return "ally" if team == ours else "enemy"

        rows = []
        for unit, first in sorted(heroes.items(), key=lambda item: item[1]["at"]):
            lock = locks.get(unit)
            rows.append({
                "hero": short(unit),
                "side": side(first["team"]),
                "firstSeenAt": iso(first["at"]),
                "secondsIntoPhase": round((first["at"] - info["firstAt"]).total_seconds(), 2),
                "hasXposAtFirstSight": first["hasXpos"],
                "lockedAt": iso(lock["at"]) if lock else None,
                "lockSource": lock["source"] if lock else None,
                "secondsAfterLock": round((first["at"] - lock["at"]).total_seconds(), 2) if lock else None,
            })
        report["phases"][phase] = {
            "observed": True,
            "posts": info["posts"],
            "postsWithHeroIcons": info["postsWithHeroIcons"],
            "firstAt": iso(info["firstAt"]),
            "lastAt": iso(info["lastAt"]),
            "ALLY_UNIQUE_HEROES": sum(1 for r in rows if r["side"] == "ally"),
            "ENEMY_UNIQUE_HEROES": sum(1 for r in rows if r["side"] == "enemy"),
            "UNKNOWN_SIDE_HEROES": sum(1 for r in rows if r["side"] == "unknown"),
            "FIRST_SEEN_TIME_PER_HERO": rows,
        }
    return report, timeline


def to_text(report: dict) -> str:
    lines = [f"MINIMAP SPIKE  match={report['match']}  ownTeam={report['ownTeam']}  (local only, not forwarded, not used by the product)"]
    for phase in REPORT_PHASES:
        info = report["phases"][phase]
        if not info.get("observed"):
            lines.append(f"\n{phase}: NO GSI LINES (not observed)")
            continue
        lines.append(f"\n{phase}: posts={info['posts']} withHeroIcons={info['postsWithHeroIcons']}")
        lines.append(f"  ALLY_UNIQUE_HEROES: {info['ALLY_UNIQUE_HEROES']}")
        lines.append(f"  ENEMY_UNIQUE_HEROES: {info['ENEMY_UNIQUE_HEROES']}")
        if info["UNKNOWN_SIDE_HEROES"]:
            lines.append(f"  UNKNOWN_SIDE_HEROES: {info['UNKNOWN_SIDE_HEROES']}")
        lines.append("  FIRST_SEEN_TIME_PER_HERO:")
        for row in info["FIRST_SEEN_TIME_PER_HERO"]:
            lock = "lock unknown" if row["lockedAt"] is None else f"{row['secondsAfterLock']:+.1f}s vs lock ({row['lockSource']})"
            lines.append(f"    {row['hero']:<22} {row['side']:<7} +{row['secondsIntoPhase']:.1f}s into phase   {lock}   hasXpos={row['hasXposAtFirstSight']}")
    return "\n".join(lines)


def visual_records(home: Path) -> list[dict]:
    return list(read_jsonl(sorted((home / "diagnostics").glob("visual-*.jsonl"))))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--match")
    parser.add_argument("--diag", type=Path, default=None)
    parser.add_argument("--visual-home", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)
    lines = gsi_lines(args.diag or companion_diag_dir(), args.match)
    if not lines:
        print("no GSI lines for that match (no draft window kept yet?)", file=sys.stderr)
        return 2
    report, timeline = build(lines, visual_records(args.visual_home or visual_home()), load_hero_names())
    print(to_text(report))
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "minimap-report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
        (args.out / "minimap-report.txt").write_text(to_text(report), encoding="utf-8")
        with (args.out / "minimap-timeline.jsonl").open("w", encoding="utf-8") as handle:
            for row in timeline:
                handle.write(json.dumps(row, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
