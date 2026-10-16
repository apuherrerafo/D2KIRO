"""Freeze ONE match's evidence into a local package, outside every rotated / pruned folder, then run the reports.

    python -I collect.py [--match <id>] [--truth-file match.json | --no-network]

Package: %LOCALAPPDATA%/D2KIRO/Evidence/<match>/ (never uploaded, never pruned by the Companion or the helper)
  gsi/gsi-draft-<match>.jsonl      every GSI payload loading -> pre-game, REDACTED again on copy (no identity, no coordinate)
  visual/visual-records.jsonl      the visual helper's records around the draft (per-slot frames, picks, health, frames saved)
  frames/<stem>-*.png              the draft epoch's strips and full frames (the Player's own screen: stays on this PC)
  minimap/                         minimap spike report + redacted timeline (incl. MATCH, for comparison)
  oracle.json / oracle.txt         picks (and bans when the source has them) vs the post-match truth
  bans/                            ban-region investigation (index + appeared-and-stayed map of the ban phase)
  manifest.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ban_frames  # noqa: E402
import minimap_timeline  # noqa: E402
import post_match_oracle  # noqa: E402
from common import PHASE_OF_STATE, companion_diag_dir, evidence_root, iso, load_hero_names, parse_time, read_jsonl, redact_payload, visual_home  # noqa: E402

DRAFT_PHASES = {"LOADING", "HERO_SELECTION", "STRATEGY_TIME", "SHOWCASE", "PRE_GAME"}
MARGIN = timedelta(seconds=120)


def visual_stem(records: list[dict], visual_files: list[Path]) -> str | None:
    for record in records:
        name = record.get("file")
        if record.get("kind") in ("frame_saved", "strip_saved") and isinstance(name, str):
            for marker in ("-full-", "-strip-"):
                if marker in name:
                    return name.split(marker)[0]
    opened = [r for r in records if r.get("kind") == "draft_open" and isinstance(r.get("epoch"), int)]
    if opened and visual_files:
        run = visual_files[-1].name.split("-")[1]
        return f"{run}-e{opened[-1]['epoch']:03d}"
    return None


def collect(match: str | None, diag: Path, home: Path, root: Path, truth: dict | None | str, names: dict[int, str] | None = None) -> Path:
    """`truth`: a reduced truth dict, None (unavailable), or "fetch" (OpenDota). `names`: hero id -> internal name."""
    lines = minimap_timeline.gsi_lines(diag, match)
    if not lines:
        raise SystemExit("no GSI draft window for that match on this PC")
    match = lines[0]["_match"]
    draft = [r for r in lines if PHASE_OF_STATE.get(str(r.get("gameState"))) in DRAFT_PHASES]
    start = parse_time((draft or lines)[0]["receivedAt"]) - MARGIN
    end = parse_time((draft or lines)[-1]["receivedAt"]) + MARGIN
    package = root / str(match)
    if package.exists():
        package = root / f"{match}-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    (package / "gsi").mkdir(parents=True)
    with (package / "gsi" / f"gsi-draft-{match}.jsonl").open("w", encoding="utf-8") as handle:
        for row in draft:
            clean = {key: value for key, value in row.items() if key != "_match"}
            clean["payload"] = redact_payload(clean.get("payload"))
            handle.write(json.dumps(clean, separators=(",", ":")) + "\n")

    visual_files = sorted((home / "diagnostics").glob("visual-*.jsonl"))
    records = [r for r in read_jsonl(visual_files) if isinstance(r.get("t"), str) and start <= parse_time(r["t"]) <= end]
    (package / "visual").mkdir()
    with (package / "visual" / "visual-records.jsonl").open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, separators=(",", ":")) + "\n")

    stem = visual_stem(records, visual_files)
    copied = 0
    if stem:
        (package / "frames").mkdir()
        for frame in sorted((home / "frames").glob(f"{stem}-*.png")):
            shutil.copy2(frame, package / "frames" / frame.name)
            copied += 1

    names = names if names is not None else load_hero_names()
    report, timeline = minimap_timeline.build(lines, records, names)
    (package / "minimap").mkdir()
    (package / "minimap" / "minimap-report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    (package / "minimap" / "minimap-report.txt").write_text(minimap_timeline.to_text(report), encoding="utf-8")
    with (package / "minimap" / "minimap-timeline.jsonl").open("w", encoding="utf-8") as handle:
        for row in timeline:
            handle.write(json.dumps(row, separators=(",", ":")) + "\n")

    if truth == "fetch":
        truth = post_match_oracle.fetch_truth(str(match))
    result = post_match_oracle.oracle(str(match), truth if isinstance(truth, dict) else None, lines, records, names)
    (package / "oracle.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    (package / "oracle.txt").write_text(post_match_oracle.to_text(result), encoding="utf-8")

    bans = ban_frames.investigate(package / "frames", stem, records, draft, package / "bans") if stem and copied else None
    manifest = {
        "schema": "d2kiro-evidence-package/v1",
        "match": match,
        "createdAt": iso(dt.datetime.now(dt.timezone.utc)),
        "draftWindow": [iso(start + MARGIN), iso(end - MARGIN)],
        "gsiDraftLines": len(draft),
        "gsiPhases": sorted({PHASE_OF_STATE.get(str(r.get("gameState")), "OTHER") for r in draft}),
        "visualRecords": len(records),
        "visualStem": stem,
        "framesCopied": copied,
        "banRegions": None if bans is None else len(bans["appearedAndStayedRegions"]),
        "picksVerdict": result["picks"].get("verdict"),
        "bansStatus": result["bans"]["status"],
    }
    (package / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return package


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--match")
    parser.add_argument("--truth-file", type=Path)
    parser.add_argument("--no-network", action="store_true", help="skip the OpenDota truth (the oracle says TRUTH_UNAVAILABLE)")
    args = parser.parse_args(argv)
    truth: dict | None | str = "fetch"
    if args.truth_file:
        truth = post_match_oracle.reduce_truth(json.loads(args.truth_file.read_text(encoding="utf-8")))
    elif args.no_network:
        truth = None
    package = collect(args.match, companion_diag_dir(), visual_home(), evidence_root(), truth)
    print(f"evidence package: {package}")
    print((package / "minimap" / "minimap-report.txt").read_text(encoding="utf-8"))
    print((package / "oracle.txt").read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
