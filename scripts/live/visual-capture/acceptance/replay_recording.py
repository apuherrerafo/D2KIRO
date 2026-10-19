"""Offline replay of a LIVE recording (`<run>.jsonl` + `frames/*.png`, written by diagnostics.py) through the real VisualSession.
NOT a unit test, NOT CI: the frames are the Player's own screenshots and never leave the machine.

    python -I acceptance/replay_recording.py [--recording DIR ...] [--mode observed|hold|both] [--json OUT]

`DIR` holds one `*.jsonl` and `frames/`. Default: every `artifacts/*-live-*` next to this package. Exit code 0 only if every check holds.

It is an ADAPTER: it only builds a time-ordered timeline from the recording and feeds the unchanged pipeline
(`VisualSession.process` per frame, `VisualSession.on_lifecycle` per observed GSI event, `corpus_acceptance.play` per tick).

What the recording really contains -- and what the report never hides:
  real frame          a `frame_saved` PNG, replayed once at its OBSERVED timestamp (ms since the run's first line, deltas preserved).
                      The recorder saves only a handful of frames (periodic / lock / unread / tail), NOT every captured frame.
  synthetic_repeat    ONLY in `--mode hold`: the previous real frame re-fed every STEP_MS while the screen is assumed unchanged
                      (the same assumption as corpus_acceptance's REPS), never across the next real frame, lifecycle event or capture
                      discontinuity, never longer than HOLD_CAP_MS. Anything it confirms is flagged: it exists only because of the assumption.
  lifecycle_observed  `server_seen` / `draft_open` / `draft_closed`: the server's own GSI word, replayed through `on_lifecycle`.
  recorded_rc2_output `pick` / `revert` / `ban` / `health` / `draft_end` / `frame` rows: what RC2 said WHEN IT RAN. NOT ground truth:
                      they are only compared against the replay as a consistency report (a regression signal, never an accuracy claim).
  context             window / capture / geometry / strip / credentials rows: not replayed, listed as unverified.
Saved PNGs are already the cropped Dota content (diagnostics records the frame AFTER the one crop), so they replay with the offline
(legacy) geometry; the recorded geometry rows are NOT re-applied (a second crop would cut the image) and a mid-run geometry change
therefore cannot be reproduced.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import cv2  # noqa: E402

from corpus_acceptance import LAYOUT, STEP_MS, THRESHOLDS, play  # noqa: E402
from d2vc.catalog import load_catalog, resolve_catalog_dir  # noqa: E402
from d2vc.emit import EnvelopeFactory  # noqa: E402
from d2vc.layout import load_layout  # noqa: E402
from d2vc.matcher import Matcher  # noqa: E402
from d2vc.session import VisualSession  # noqa: E402
from d2vc.transport import DraftLifecycle  # noqa: E402

HOLD_CAP_MS = 2_000.0  # one real frame stands for at most 2 s of an unchanged screen (corpus_acceptance: 8 x 250 ms)
MAX_PNG_BYTES = 64 * 1024 * 1024
SAFE_PNG = re.compile(r"[A-Za-z0-9._-]+\.png")
LIFECYCLE_KINDS = {"server_seen", "draft_open", "draft_closed"}
RECORDED_KINDS = {"pick", "revert", "ban", "health", "draft_end", "frame"}
BARRIER_KINDS = {"capture_lost", "capture_resumed", "no_window", "window_found", "geometry", "geometry_unresolved"}  # the screen may have changed
CONTEXT_KINDS = BARRIER_KINDS | {"start", "catalog", "credentials", "backend_started", "waiting_window", "waiting_credentials", "fetching_catalog", "error"}
PICK_OUTPUTS = {"hero_picked", "pick_reverted", "hero_banned"}


@dataclass(frozen=True)
class Item:
    kind: str  # frame | lifecycle | recorded | barrier
    t_ms: float
    line: int
    data: dict


@dataclass
class Timeline:
    name: str
    t0: dt.datetime
    frames_dir: Path
    items: list[Item] = field(default_factory=list)
    kinds: Counter = field(default_factory=Counter)
    unverified: Counter = field(default_factory=Counter)  # reason -> n
    examples: dict[str, list[str]] = field(default_factory=dict)
    _seen: set = field(default_factory=set)

    def flag(self, reason: str, line: int, detail: str = "") -> None:
        if (reason, line) in self._seen:  # a replay pass may meet the same row again: count it once
            return
        self._seen.add((reason, line))
        self.unverified[reason] += 1
        samples = self.examples.setdefault(reason, [])
        if len(samples) < 3:
            samples.append(f"line {line}: {detail}".strip())


def _parse_time(value: object) -> dt.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def find_jsonl(directory: Path) -> Path:
    found = sorted(directory.glob("*.jsonl"))
    if len(found) != 1:
        raise SystemExit(f"{directory}: expected exactly one *.jsonl, found {len(found)}")
    return found[0]


def load_timeline(directory: Path) -> Timeline:
    """Recording -> time-ordered `Item`s. Every row is external input: validated here, never trusted."""
    jsonl = find_jsonl(directory)
    rows: list[tuple[int, dict, dt.datetime]] = []
    timeline = Timeline(directory.name, dt.datetime.fromtimestamp(0, dt.timezone.utc), directory / "frames")
    for number, text in enumerate(jsonl.read_text(encoding="utf-8").splitlines(), 1):
        try:
            row = json.loads(text)
        except json.JSONDecodeError:
            timeline.flag("malformed_line", number)
            continue
        stamp = _parse_time(row.get("t")) if isinstance(row, dict) else None
        if stamp is None or not isinstance(row.get("kind"), str):
            timeline.flag("bad_row_or_timestamp", number)
            continue
        rows.append((number, row, stamp))
    if not rows:
        raise SystemExit(f"{jsonl}: no readable rows")
    timeline.t0 = rows[0][2]
    previous = 0.0
    for number, row, stamp in rows:
        kind = row["kind"]
        timeline.kinds[kind] += 1
        t_ms = (stamp - timeline.t0).total_seconds() * 1000.0
        if t_ms < previous:
            timeline.flag("time_regression_clamped", number, f"{kind} {previous - t_ms:.0f} ms back")
            t_ms = previous
        previous = t_ms
        item = _classify(timeline, kind, row, number, t_ms)
        if item is not None:
            timeline.items.append(item)
    return timeline


def _classify(timeline: Timeline, kind: str, row: dict, number: int, t_ms: float) -> Item | None:
    if kind == "frame_saved":
        name, label = row.get("file"), row.get("label")
        if not isinstance(name, str) or not SAFE_PNG.fullmatch(name) or not isinstance(label, str):
            timeline.flag("frame_saved_bad_fields", number, repr(name)[:60])
            return None
        path = timeline.frames_dir / name
        if not path.is_file():
            timeline.flag("png_missing_pruned_by_recorder", number, name)  # the runtime prunes frames/ to 64 MB: older epochs lose their PNGs
            return None
        if path.stat().st_size > MAX_PNG_BYTES:
            timeline.flag("png_oversized", number, name)
            return None
        return Item("frame", t_ms, number, {"file": name, "label": label})
    if kind in LIFECYCLE_KINDS:
        phase, epoch = row.get("phase"), row.get("epoch")
        valid = (kind == "draft_open" and isinstance(epoch, int) and not isinstance(epoch, bool)) or (kind != "draft_open" and isinstance(phase, str) and len(phase) <= 32)
        if not valid:
            timeline.flag("lifecycle_bad_fields", number, kind)
            return None
        return Item("lifecycle", t_ms, number, {"kind": kind, "phase": phase, "epoch": epoch})
    if kind in RECORDED_KINDS:
        return Item("recorded", t_ms, number, {"kind": kind, "side": row.get("side"), "heroId": row.get("heroId"), "status": row.get("status"), "detail": row.get("detail")})
    if kind == "strip_saved":
        timeline.flag("strip_not_a_full_frame", number)
        return None
    if kind in CONTEXT_KINDS:
        timeline.flag("context_not_replayed", number, kind)
        return Item("barrier", t_ms, number, {"kind": kind}) if kind in BARRIER_KINDS else None
    timeline.flag("unknown_kind", number, kind)
    return None


def unreferenced_pngs(timeline: Timeline) -> list[str]:
    """Full-frame PNGs on disk that no `frame_saved` row names: they have no observed timestamp, so they cannot be replayed."""
    named = {item.data["file"] for item in timeline.items if item.kind == "frame"}
    return sorted(p.name for p in timeline.frames_dir.glob("*.png") if "-strip-" not in p.name and p.name not in named)


class _Clock:
    def __init__(self, t0: dt.datetime) -> None:
        self.t0, self.now = t0, t0

    def set(self, t_ms: float) -> None:
        self.now = self.t0 + dt.timedelta(milliseconds=t_ms)

    def __call__(self) -> dt.datetime:
        return self.now


def _net(rows: list[tuple[str, str, int]]) -> list[list]:
    """(op, side, hero) in order -> the net set of facts standing at the end, sorted."""
    standing: set[tuple[str, int]] = set()
    for op, side, hero in rows:
        (standing.add if op == "add" else standing.discard)((side, hero))
    return sorted([side, hero] for side, hero in standing)


def _collapse(sequence: list[tuple]) -> list[list]:
    out: list[list] = []
    for item in sequence:
        if not out or out[-1] != list(item):
            out.append(list(item))
    return out


def evaluate_checks(ticks: list[dict], outputs: list[dict], opens: list[int], net_by_epoch: dict, time_regressions: int = 0) -> list[dict]:
    """Invariants that need NO ground truth: they hold or fail on the replay alone."""
    checks: list[dict] = []

    def check(name: str, ok: bool, detail: str) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})

    check("REAL_FRAMES_REPLAYED", any(t["origin"] == "real" for t in ticks), f"{sum(t['origin'] == 'real' for t in ticks)} real frames")
    # load_timeline clamps a backwards source timestamp, so the ticks alone always look monotonic: the regressions it clamped are counted here.
    check("TIME_MONOTONIC", not time_regressions and all(a["t_ms"] <= b["t_ms"] for a, b in zip(ticks, ticks[1:])), f"{len(ticks)} ticks in non-decreasing observed time, {time_regressions} source timestamp regression(s) clamped by the loader")
    early = [o for o in outputs if o["type"] in PICK_OUTPUTS and not o["draftOpen"]]
    check("EVENT_ORDER no draft fact outside an open draft", not early, f"{len(early)} facts emitted while the draft was closed")
    check("EVENT_ORDER lifecycle epochs strictly increase", all(a < b for a, b in zip(opens, opens[1:])), f"opens {opens}")
    over = {epoch: facts for epoch, facts in net_by_epoch.items() if sum(1 for s, _ in facts if s == "radiant") > 5 or sum(1 for s, _ in facts if s == "dire") > 5 or len({h for s, h in facts if s != "ban"}) != len([1 for s, _ in facts if s != "ban"])}
    check("NET_PICKS <= 5 per side, no hero twice", not over, f"epochs violating: {sorted(over)}")
    return checks


def replay(timeline: Timeline, matcher: Matcher, layout, thresholds, *, mode: str, step_ms: float = STEP_MS, hold_cap_ms: float = HOLD_CAP_MS, names: dict | None = None) -> dict:
    """One pass over the timeline. `mode`: "observed" (real frames only) | "hold" (+ flagged synthetic repeats)."""
    names = names or {}
    clock = _Clock(timeline.t0)
    session = VisualSession(matcher, layout, thresholds, EnvelopeFactory("replay", "replay", clock))
    ticks: list[dict] = []
    outputs: list[dict] = []
    opens: list[int] = []
    epoch: int | None = None
    replay_ops: dict = {}  # epoch -> [(op, side, hero)]
    recorded_ops: dict = {}
    replay_health: dict = {}  # epoch -> [(status, detail)]
    recorded_health: dict = {}
    real_by_epoch: Counter = Counter()

    def tick(origin: str, item: Item, image, t_ms: float) -> None:
        clock.set(t_ms)
        _, log = play(session, [((origin, item.data["file"]), image)], t0=t_ms, reps=1)
        real_by_epoch[epoch] += origin == "real"
        ticks.append({"t_ms": round(t_ms, 3), "origin": origin, "file": item.data["file"], "label": item.data["label"], "emitted": len(log)})
        for _tag, t, typ, first, second in log:
            row = {"t_ms": round(t, 3), "origin": origin, "file": item.data["file"], "epoch": epoch, "draftOpen": session.status.draft_open, "type": "capture_health" if typ == "health" else typ}
            if typ == "health":
                row.update(status=first, detail=second)
                if session.status.draft_open:
                    replay_health.setdefault(epoch, []).append((first, second))
            else:
                row.update(side=first, hero=second, heroName=names.get(second))
                bucket = replay_ops.setdefault(epoch, [])
                bucket.append(("add" if typ != "pick_reverted" else "del", "ban" if typ == "hero_banned" else first, second))
            outputs.append(row)

    items = timeline.items
    for index, item in enumerate(items):
        if item.kind == "lifecycle":
            clock.set(item.t_ms)
            kind = item.data["kind"]
            if kind == "draft_open":
                session.on_lifecycle(DraftLifecycle("hero_selection", item.data["epoch"]))
                epoch = item.data["epoch"]
                opens.append(epoch)
            else:
                phase = item.data["phase"]
                if epoch is None and phase == "hero_selection":
                    timeline.flag("lifecycle_orphan_no_epoch", item.line, kind)  # only a draft_open row carries an epoch: never invent one
                    continue
                session.on_lifecycle(DraftLifecycle(phase, epoch if epoch is not None else 0))  # a non-drafting phase ignores the epoch
                if kind == "draft_closed":
                    epoch = None
        elif item.kind == "recorded":
            data = item.data
            if data["kind"] in ("pick", "revert", "ban") and isinstance(data["heroId"], int):
                side = "ban" if data["kind"] == "ban" else data["side"]
                recorded_ops.setdefault(epoch, []).append(("del" if data["kind"] == "revert" else "add", side, data["heroId"]))
            elif data["kind"] == "health" and epoch is not None:
                recorded_health.setdefault(epoch, []).append((data["status"], data["detail"]))
        elif item.kind == "frame":
            image = cv2.imread(str(timeline.frames_dir / item.data["file"]), cv2.IMREAD_COLOR)
            if image is None or image.ndim != 3 or min(image.shape[:2]) < 100:
                timeline.flag("png_unreadable", item.line, item.data["file"])
                continue
            tick("real", item, image, item.t_ms)
            if mode != "hold" or not session.status.draft_open:
                continue
            boundary = next((nxt for nxt in items[index + 1 :] if nxt.kind in ("frame", "lifecycle", "barrier")), None)
            if boundary is None:
                continue  # unknown how long the screen stayed: no repeats
            t = item.t_ms + step_ms
            while t < boundary.t_ms and t - item.t_ms <= hold_cap_ms:
                tick("synthetic_repeat", item, image, t)
                t += step_ms

    net_replay = {str(k): _net(v) for k, v in replay_ops.items()}
    net_recorded = {str(k): _net(v) for k, v in recorded_ops.items()}
    comparison = {}
    for key in sorted(set(net_replay) | set(net_recorded)):
        rep, rec = {tuple(x) for x in net_replay.get(key, [])}, {tuple(x) for x in net_recorded.get(key, [])}
        comparison[key] = {"real_frames_replayed": real_by_epoch.get(None if key == "None" else int(key), 0), "matched": sorted(map(list, rep & rec)), "only_recorded_rc2": sorted(map(list, rec - rep)), "only_replayed": sorted(map(list, rep - rec))}
    picks = [o for o in outputs if o["type"] == "hero_picked"]
    replayable = [e for e in set(replay_health) | set(recorded_health) if e is not None and real_by_epoch.get(e, 0) > 0]  # an epoch whose PNGs were pruned has nothing to compare
    health_replay = [list(x) for e in sorted(replayable) for x in _collapse(replay_health.get(e, []))]
    health_recorded = [list(x) for e in sorted(replayable) for x in _collapse(recorded_health.get(e, []))]
    core = {
        "mode": mode, "stepMs": float(step_ms) if mode == "hold" else None, "holdCapMs": float(hold_cap_ms) if mode == "hold" else None,
        "ticks": {"real": sum(t["origin"] == "real" for t in ticks), "synthetic_repeat": sum(t["origin"] == "synthetic_repeat" for t in ticks)},
        "picks": [{k: p[k] for k in ("t_ms", "origin", "epoch", "side", "hero", "heroName", "file")} for p in picks],
        "picks_only_on_synthetic_repeat": sum(p["origin"] == "synthetic_repeat" for p in picks),
        "outputs": outputs, "tickLog": ticks,
        "health": {"epochs_compared": sorted(replayable), "replay": health_replay, "recorded_rc2": health_recorded, "same_sequence": health_replay == health_recorded},
        "consistency_vs_recorded_rc2_output__NOT_GROUND_TRUTH": comparison,
        "checks": evaluate_checks(ticks, outputs, opens, {k: [tuple(x) for x in v] for k, v in net_replay.items()}, timeline.unverified["time_regression_clamped"]),
    }
    core["digest"] = hashlib.sha256(json.dumps(core, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return core


def run_recording(directory: Path, matcher: Matcher, layout, thresholds, *, modes: tuple[str, ...], step_ms: float, hold_cap_ms: float, names: dict | None = None, determinism: bool = True) -> dict:
    timeline = load_timeline(directory)
    report: dict = {
        "recording": timeline.name,
        "rows": dict(sorted(timeline.kinds.items())),
        "classification": {
            "real_frames": sum(i.kind == "frame" for i in timeline.items),
            "lifecycle_observed": sum(i.kind == "lifecycle" for i in timeline.items),
            "recorded_rc2_output_not_truth": sum(i.kind == "recorded" for i in timeline.items),
        },
        "unreferenced_full_frames": unreferenced_pngs(timeline),
        "modes": {},
    }
    for mode in modes:
        first = replay(timeline, matcher, layout, thresholds, mode=mode, step_ms=step_ms, hold_cap_ms=hold_cap_ms, names=names)
        if determinism:
            second = replay(timeline, matcher, layout, thresholds, mode=mode, step_ms=step_ms, hold_cap_ms=hold_cap_ms, names=names)
            first["checks"].append({"name": "DETERMINISM two replays byte-identical", "pass": first["digest"] == second["digest"], "detail": first["digest"][:16]})
        report["modes"][mode] = first
    report["unverified"] = {"counts": dict(sorted(timeline.unverified.items())), "examples": timeline.examples}
    report["pass"] = all(c["pass"] for m in report["modes"].values() for c in m["checks"])
    return report


def print_report(report: dict) -> None:
    print(f"\n== {report['recording']}")
    print(f"   real frames {report['classification']['real_frames']}, lifecycle {report['classification']['lifecycle_observed']}, recorded RC2 rows (NOT truth) {report['classification']['recorded_rc2_output_not_truth']}, unreferenced full frames {len(report['unreferenced_full_frames'])}")
    print(f"   unverified: {report['unverified']['counts']}")
    for mode, result in report["modes"].items():
        print(f"   -- mode {mode}: {result['ticks']['real']} real + {result['ticks']['synthetic_repeat']} synthetic ticks, {len(result['picks'])} picks ({result['picks_only_on_synthetic_repeat']} only thanks to synthetic repeats)")
        for pick in result["picks"]:
            print(f"      t={pick['t_ms'] / 1000:8.2f}s {pick['origin']:16s} epoch {pick['epoch']} {pick['side']:7s} {pick['heroName'] or pick['hero']}")
        for key, cmp in result["consistency_vs_recorded_rc2_output__NOT_GROUND_TRUTH"].items():
            note = "" if cmp["real_frames_replayed"] else "  (no replayable frame in this epoch: NOT a divergence)"
            print(f"      vs recorded RC2 output (consistency only) epoch {key}: {cmp['real_frames_replayed']} real frames, matched {len(cmp['matched'])}, only recorded {len(cmp['only_recorded_rc2'])}, only replayed {len(cmp['only_replayed'])}{note}")
        print(f"      health sequence vs recorded, epochs {result['health']['epochs_compared']} (informational: depends on how sparsely the recorder saved frames): same={result['health']['same_sequence']}")
        for check in result["checks"]:
            print(f"      {'PASS' if check['pass'] else 'FAIL'}  {check['name']}: {check['detail']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--recording", action="append", help="recording directory (jsonl + frames/); repeatable")
    parser.add_argument("--mode", choices=("observed", "hold", "both"), default="both")
    parser.add_argument("--step-ms", type=float, default=STEP_MS)
    parser.add_argument("--hold-cap-ms", type=float, default=HOLD_CAP_MS)
    parser.add_argument("--layout", help="calibrated layout.json (default: the built-in layout the live helper uses without local/layout.json)")
    parser.add_argument("--json", help="write the full report here (keep it outside tracked paths)")
    args = parser.parse_args(argv)
    directories = [Path(p) for p in args.recording] if args.recording else sorted((HERE.parent / "artifacts").glob("*-live-*"))
    if not directories:
        raise SystemExit("no recording: pass --recording DIR")
    catalog = load_catalog(resolve_catalog_dir())
    layout = load_layout(Path(args.layout)) if args.layout else LAYOUT
    names = {hero.id: hero.localized_name for hero in catalog.heroes}
    modes = ("observed", "hold") if args.mode == "both" else (args.mode,)
    reports = [run_recording(d, Matcher(catalog), layout, THRESHOLDS, modes=modes, step_ms=args.step_ms, hold_cap_ms=args.hold_cap_ms, names=names) for d in directories]
    for report in reports:
        print_report(report)
    ok = all(r["pass"] for r in reports)
    print(f"\n{'ALL CHECKS PASS' if ok else 'CHECKS FAILED'} ({len(reports)} recordings)")
    if args.json:
        Path(args.json).write_text(json.dumps(reports, indent=1, default=float), encoding="utf-8")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
