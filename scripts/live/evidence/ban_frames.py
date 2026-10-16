"""Offline ban-region investigation (after the match, on the saved HUMAN frames). Not a ban matcher.

    python -I ban_frames.py <evidence package dir>      (or --frames <dir> --stem <run>-e<NNN> --out <dir>)

1. Index: every saved full frame of the draft epoch with its wall-clock time and the GSI phase at that moment
   (HERO_SELECTION / STRATEGY_TIME), so the ban phase can be looked at frame by frame.
2. Change map over the first 90 s (the ban phase): pixels that CHANGED between consecutive periodic frames and then
   STAYED put -- where something appeared and became static (a resolved ban, a portrait, a banner). Written as a
   heatmap PNG plus the largest regions as boxes normalized to the 16:9 viewport, for a human to inspect next to the
   frames. Whether the hero catalog can identify those portraits is the NEXT step, decided on this evidence.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import PHASE_OF_STATE, parse_time, read_jsonl  # noqa: E402

CHANGE_LEVEL = 24  # gray levels: a real change, not compression noise
EARLY_S = 90.0
MAX_BOXES = 12


def index_frames(frames_dir: Path, stem: str, visual_records: list[dict], gsi: list[dict]) -> list[dict]:
    times = {r["file"]: r["t"] for r in visual_records if r.get("kind") == "frame_saved" and isinstance(r.get("file"), str) and isinstance(r.get("t"), str)}
    states = sorted(((parse_time(r["receivedAt"]), PHASE_OF_STATE.get(str(r.get("gameState")), "OTHER")) for r in gsi if isinstance(r.get("receivedAt"), str)), key=lambda x: x[0])
    rows = []
    for path in sorted(frames_dir.glob(f"{stem}-full-*.png")):
        label = path.stem.split("-full-")[1]
        at = times.get(path.name)
        phase = None
        if at is not None and states:
            moment = parse_time(at)
            earlier = [p for t, p in states if t <= moment]
            phase = earlier[-1] if earlier else states[0][1]
        rows.append({"file": path.name, "label": label.split("-")[-1], "t": at, "gsiPhase": phase})
    return sorted(rows, key=lambda r: (r["t"] or "", r["file"]))


def change_map(images: list[np.ndarray]) -> tuple[np.ndarray, list[dict]]:
    """Appeared-and-stayed map over consecutive frames (same size). -> (heatmap uint8, boxes in viewport fractions)."""
    if len(images) < 3:
        return np.zeros((1, 1), np.uint8), []
    grays = [cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (5, 5), 0).astype(np.int16) for img in images]
    height, width = grays[0].shape
    score = np.zeros((height, width), np.float32)
    for k in range(1, len(grays) - 1):
        changed = np.abs(grays[k] - grays[k - 1]) > CHANGE_LEVEL
        stayed = np.ones_like(changed)
        for later in grays[k + 1:]:
            stayed &= np.abs(later - grays[k]) <= CHANGE_LEVEL
        score += (changed & stayed).astype(np.float32)
    heat = np.clip(score * (255.0 / max(1.0, score.max())), 0, 255).astype(np.uint8)
    mask = cv2.morphologyEx((heat > 0).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    boxes = []
    for i in range(1, count):
        x, y, w, h, area = (int(v) for v in stats[i])
        if area < 0.0002 * height * width:
            continue
        boxes.append({"x": round(x / width, 4), "y": round(y / height, 4), "w": round(w / width, 4), "h": round(h / height, 4), "area": area})
    boxes.sort(key=lambda b: -b["area"])
    return heat, boxes[:MAX_BOXES]


def investigate(frames_dir: Path, stem: str, visual_records: list[dict], gsi: list[dict], out: Path) -> dict:
    index = index_frames(frames_dir, stem, visual_records, gsi)
    timed = [row for row in index if row["label"] in ("periodic", "armed") and row["t"]]
    early: list[np.ndarray] = []
    if timed:
        start = parse_time(timed[0]["t"])
        for row in timed:
            if (parse_time(row["t"]) - start).total_seconds() <= EARLY_S:
                image = cv2.imread(str(frames_dir / row["file"]), cv2.IMREAD_COLOR)
                if image is not None and (not early or image.shape == early[0].shape):
                    early.append(image)
    heat, boxes = change_map(early)
    out.mkdir(parents=True, exist_ok=True)
    if len(early) >= 3:
        cv2.imwrite(str(out / "ban-phase-change-heatmap.png"), cv2.applyColorMap(heat, cv2.COLORMAP_INFERNO))
    report = {"schema": "d2kiro-ban-frames/v1", "stem": stem, "frames": index, "earlyFramesUsed": len(early), "appearedAndStayedRegions": boxes}
    (out / "ban-frames.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("package", type=Path, nargs="?")
    parser.add_argument("--frames", type=Path)
    parser.add_argument("--stem")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    if args.package:
        manifest = json.loads((args.package / "manifest.json").read_text(encoding="utf-8"))
        frames, stem, out = args.package / "frames", manifest["visualStem"], args.package / "bans"
        records = list(read_jsonl([args.package / "visual" / "visual-records.jsonl"]))
        gsi = list(read_jsonl(sorted((args.package / "gsi").glob("*.jsonl"))))
    else:
        frames, stem, out, records, gsi = args.frames, args.stem, args.out, [], []
    if not frames or not stem or not out:
        parser.error("a package dir, or --frames --stem --out")
    report = investigate(frames, stem, records, gsi, out)
    print(f"{len(report['frames'])} full frames indexed, {report['earlyFramesUsed']} used for the ban-phase change map, {len(report['appearedAndStayedRegions'])} candidate regions -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
