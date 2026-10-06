"""`python -m d2vc <command>` -- the visual capture lab and the live loop.

  fetch                         one-time: download the hero portrait catalog (dev step, network)
  lab <screenshot...>           screenshot(s) -> Radiant / Dire / Bans with confidence (derived data only)
  bench                         offline benchmark on synthetic degradations
  calibrate <screenshot>        one-time layout calibration from a REAL hero-selection screenshot
  synth <out.png>               write a synthetic hero-selection frame (pipeline demo, NOT real Dota)
  live                          start BEFORE queueing; arms itself on each hero selection (GSI), sends allowlisted facts
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import uuid
from pathlib import Path

import cv2

from .bench import DEFAULT_THRESHOLDS, run_bench
from .catalog import LOCAL, Catalog, fetch_catalog, load_catalog
from .layout import default_layout, load_layout, save_layout
from .matcher import Matcher
from .scan import ScanResult, scan_frame

DEFAULT_LAYOUT_PATH = LOCAL / "layout.json"


def _layout(path: str | None):
    if path:
        return load_layout(Path(path))
    if DEFAULT_LAYOUT_PATH.exists():
        return load_layout(DEFAULT_LAYOUT_PATH)
    return default_layout()


def _name(catalog: Catalog, hero_id: int | None) -> str:
    return "-" if hero_id is None else f"{catalog.name_of(hero_id)} (#{hero_id})"


def format_scan(scan: ScanResult, catalog: Catalog, layout_status: str) -> str:
    lines = [f"layout: {layout_status}   frame: {scan.frame_size[0]}x{scan.frame_size[1]}   {scan.elapsed_ms:.1f} ms"]
    for title, readings in (("Radiant", scan.radiant), ("Dire", scan.dire), ("Bans", scan.bans)):
        if title == "Bans" and not readings:
            lines.append("Bans: (no ban region in this layout -- not verified, nothing invented)")
            continue
        lines.append(f"{title}:")
        for reading in readings:
            if reading.state == "hero":
                lines.append(f"  slot {reading.index + 1} -> {_name(catalog, reading.hero_id)}   score {reading.score:.2f}  margin {reading.margin:.2f}")
            elif reading.state == "uncertain":
                lines.append(f"  slot {reading.index + 1} -> ?  (uncertain: score {reading.score:.2f}, margin {reading.margin:.2f}; nothing emitted)")
            else:
                lines.append(f"  slot {reading.index + 1} -> (empty)")
    return "\n".join(lines)


def scan_json(scan: ScanResult) -> dict:
    return {
        "frame": list(scan.frame_size),
        "elapsedMs": round(scan.elapsed_ms, 2),
        **{
            key: [{"slot": r.index + 1, "state": r.state, "heroId": r.hero_id, "score": round(r.score, 3), "margin": round(r.margin, 3)} for r in readings]
            for key, readings in (("radiant", scan.radiant), ("dire", scan.dire), ("bans", scan.bans))
        },
    }


def cmd_fetch(_: argparse.Namespace) -> int:
    print(f"stored {fetch_catalog()} hero portraits in {LOCAL}")
    return 0


def cmd_lab(args: argparse.Namespace) -> int:
    catalog = load_catalog()
    matcher = Matcher(catalog)
    layout = _layout(args.layout)
    status = 0
    for path in args.screenshot:
        frame = cv2.imread(path, cv2.IMREAD_COLOR)
        if frame is None:
            print(f"{path}: cannot read image", file=sys.stderr)
            status = 1
            continue
        scan = scan_frame(frame, layout, matcher, DEFAULT_THRESHOLDS)
        if args.json:
            print(json.dumps({"file": Path(path).name, **scan_json(scan)}))
        else:
            print(f"== {Path(path).name}")
            print(format_scan(scan, catalog, layout.status))
        if args.debug_dir:
            from .calibrate import draw_preview

            Path(args.debug_dir).mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(Path(args.debug_dir) / f"{Path(path).stem}.layout.png"), draw_preview(frame, layout))
    return status


def cmd_bench(args: argparse.Namespace) -> int:
    catalog = load_catalog()
    started = time.perf_counter()
    matcher = Matcher(catalog)
    build_ms = (time.perf_counter() - started) * 1000
    report = run_bench(catalog, matcher, per_hero=args.per_hero, severity=args.severity)
    print(json.dumps({"heroes": len(catalog.heroes), "matcherBuildMs": round(build_ms), "thresholds": vars(DEFAULT_THRESHOLDS) if hasattr(DEFAULT_THRESHOLDS, "__dict__") else str(DEFAULT_THRESHOLDS), **report.__dict__}, indent=1, default=float))
    return 0


def cmd_calibrate(args: argparse.Namespace) -> int:
    from .calibrate import calibrate, draw_preview

    catalog = load_catalog()
    frame = cv2.imread(args.screenshot, cv2.IMREAD_COLOR)
    if frame is None:
        print("cannot read image", file=sys.stderr)
        return 1
    layout, hits, verdict = calibrate(frame, catalog, args.left_side)
    print(f"hits: {len(hits)}   verdict: {verdict}")
    if layout is None:
        return 2
    save_layout(layout, Path(args.out))
    preview = Path(args.out).with_suffix(".preview.png")
    cv2.imwrite(str(preview), draw_preview(frame, layout))
    print(f"layout written to {args.out}\nINSPECT {preview} before trusting it (boxes must sit on the 5+5 hero slots).")
    return 0


def cmd_synth(args: argparse.Namespace) -> int:
    from .synth import compose_screen

    catalog = load_catalog()
    ids = list(catalog.portraits)
    frame = compose_screen(catalog, _layout(args.layout), args.width, args.height, radiant=[ids[3], ids[14], ids[25], None, None], dire=[ids[36], ids[47], None, None, None], seed=args.seed)
    cv2.imwrite(args.out, frame)
    print(f"wrote SYNTHETIC frame {args.out} ({args.width}x{args.height})")
    return 0


def _sender_from_env():
    from .transport import LinkSender, LocalSender

    local_engine = os.environ.get("D2KIRO_LOCAL_ENGINE_URL")
    if local_engine:
        return LocalSender(local_engine, os.environ["D2KIRO_CAPTURE_TOKEN"]), os.environ.get("D2KIRO_SESSION_ID", "")
    if "D2KIRO_LINK_TOKEN" in os.environ:
        return LinkSender(os.environ["D2KIRO_BASE_URL"], os.environ["D2KIRO_LIVE_ID"], os.environ["D2KIRO_LINK_TOKEN"]), "link"
    from .gsicfg import load_link

    link = load_link()  # the GSI cfg the Player already installed: same origin, live id and token
    if link is None:
        raise KeyError("a D2KIRO GSI cfg (install it from the site first) or D2KIRO_LINK_TOKEN")
    return LinkSender(link.base_url, link.live_id, link.token), "link"


def cmd_live(args: argparse.Namespace) -> int:
    from .backend import WgcBackend
    from .emit import EnvelopeFactory
    from .session import VisualSession
    from .transport import Outbox

    layout = _layout(args.layout)  # a calibrated local/layout.json if present, else the built-in 16:9 default
    try:
        sender, session_id = _sender_from_env()
    except KeyError as missing:
        print(f"missing environment variable {missing} (see README)", file=sys.stderr)
        return 3
    catalog = load_catalog()
    session = VisualSession(
        Matcher(catalog),
        layout,
        DEFAULT_THRESHOLDS,
        EnvelopeFactory(session_id=session_id or "link", run_id=uuid.uuid4().hex[:8], clock=lambda: dt.datetime.now(dt.timezone.utc)),
    )
    outbox = Outbox(sender)
    backend = WgcBackend(args.window)
    interval = 1.0 / args.fps
    last_print = 0.0
    try:
        while True:
            now_ms = time.monotonic() * 1000
            frame = backend.latest()
            envelopes = session.process(frame, now_ms) if frame is not None else session.tick_no_frame(now_ms, backend.window_found)
            outbox.submit(envelopes)
            if session.on_lifecycle(outbox.lifecycle):  # GSI started / ended a draft: re-arm by itself
                outbox.discard_facts()
            if now_ms - last_print > 1000:
                print("\r" + session.status.line(), end="", flush=True)
                last_print = now_ms
            time.sleep(interval)
    except KeyboardInterrupt:
        print()
        return 0
    finally:
        backend.stop()


def main(argv: list[str] | None = None) -> int:
    # The status line uses "●"; a default Windows console (cp1252) would crash the live loop on it.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(prog="d2vc", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("fetch").set_defaults(run=cmd_fetch)
    lab = sub.add_parser("lab")
    lab.add_argument("screenshot", nargs="+")
    lab.add_argument("--layout")
    lab.add_argument("--json", action="store_true")
    lab.add_argument("--debug-dir", help="write the layout boxes drawn over each screenshot (stays local)")
    lab.set_defaults(run=cmd_lab)
    bench = sub.add_parser("bench")
    bench.add_argument("--per-hero", type=int, default=6)
    bench.add_argument("--severity", type=float, default=1.0)
    bench.set_defaults(run=cmd_bench)
    cal = sub.add_parser("calibrate")
    cal.add_argument("screenshot")
    cal.add_argument("--out", default=str(DEFAULT_LAYOUT_PATH))
    cal.add_argument("--left-side", choices=("radiant", "dire"), default="radiant")
    cal.set_defaults(run=cmd_calibrate)
    synth = sub.add_parser("synth")
    synth.add_argument("out")
    synth.add_argument("--width", type=int, default=1920)
    synth.add_argument("--height", type=int, default=1080)
    synth.add_argument("--seed", type=int, default=1)
    synth.add_argument("--layout")
    synth.set_defaults(run=cmd_synth)
    live = sub.add_parser("live")
    live.add_argument("--layout")
    live.add_argument("--window", default="Dota 2")
    live.add_argument("--fps", type=float, default=8.0)
    live.add_argument("--allow-provisional-layout", action="store_true", help=argparse.SUPPRESS)  # legacy no-op: the default layout is always allowed
    live.set_defaults(run=cmd_live)
    args = parser.parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    raise SystemExit(main())
