"""Offline acceptance of the visual runtime on the saved REAL corpus (1600x900, Spanish UI). NOT a unit test, NOT CI:
the frames are the Player's own screenshots and never leave the machine.

    python -I acceptance/corpus_acceptance.py [--corpus DIR] [--json OUT]

`DIR` holds `frames/<session>-<nnn>-raw.png` (default: %LOCALAPPDATA%/D2KIRO/VisualCorpus, else .../Visual). Keep a copy
OUTSIDE `Visual/frames`: with `save-frames.flag` on, the runtime prunes that folder to 64 MB.
Exit code 0 only if every gate holds. Gates (all run through the real d2vc code):
  LOCK GATE      every locked cell has a top-bar chroma >= 80; no draft / non-draft negative does
  MATCHER        human + bot locked cells: correct hero, 0 wrong, bot min score >= 0.68 and min margin >= 0.30
  NEGATIVES      empty / ghost / hover / overlay / non-draft cells: 0 heroes accepted by the live pipeline (lock-gated)
  SESSION REPLAY every draft epoch through a VisualSession: each locked card of `truth.json` picked once, 0 wrong picks
  HEALTH         no SLOTS_UNREAD on hover, OK on a stable empty bar, locked-unread degrades, black / partial frames never OK,
                 an already-locked card at arming never OK and never a pick
  SHIFT          +-1 px: no mislabel; up to 3 px: unread / ambiguous is acceptable, a false hero or a false lock is not
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from d2vc.catalog import load_catalog, resolve_catalog_dir  # noqa: E402
from d2vc.emit import EnvelopeFactory  # noqa: E402
from d2vc.layout import default_layout  # noqa: E402
from d2vc.lockstate import LOCK_CHROMA, card_chrome  # noqa: E402
from d2vc.matcher import Matcher, Thresholds, confident  # noqa: E402
from d2vc.scan import scan_frame, slot_crops  # noqa: E402
from d2vc.session import UNREAD_GRACE_MS, VisualSession  # noqa: E402
from d2vc.transport import DraftLifecycle  # noqa: E402
from labels import EPOCHS, SESSION_FRAMES, SLOTS, kind, label  # noqa: E402

THRESHOLDS = Thresholds(0.68, 0.15)
LAYOUT = default_layout()
KEYS = {slot: ("radiant" if slot[0] == "r" else "dire", int(slot[1])) for slot in SLOTS}
CLOCK = lambda: dt.datetime(2026, 10, 14, tzinfo=dt.timezone.utc)  # noqa: E731
STEP_MS, REPS = 250, 8  # every real frame stands for 2 s of an unchanged screen


def corpus_dir(argument: str | None) -> Path:
    local = Path(os.environ.get("LOCALAPPDATA", ".")) / "D2KIRO"
    for candidate in ([Path(argument)] if argument else [local / "VisualCorpus", local / "Visual"]):
        if (candidate / "frames").is_dir():
            return candidate / "frames"
    raise SystemExit("no corpus: pass --corpus DIR (with frames/<session>-<nnn>-raw.png)")


class Corpus:
    def __init__(self, frames: Path) -> None:
        self.frames, self._cache = frames, {}

    def frame(self, session: str, n: int) -> np.ndarray:
        key = (session, n)
        if key not in self._cache:
            image = cv2.imread(str(self.frames / f"{session}-{n:03d}-raw.png"), cv2.IMREAD_COLOR)
            if image is None:
                raise SystemExit(f"missing frame {session}-{n:03d}")
            self._cache[key] = image
        return self._cache[key]


def shifted(image: np.ndarray, dy: int, dx: int) -> np.ndarray:
    matrix = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(image, matrix, (image.shape[1], image.shape[0]), borderMode=cv2.BORDER_REPLICATE)


def play(session: VisualSession, frames, t0: float = 0.0, reps: int = REPS, after=None):
    """frames: [(tag, image)] -> (end time, log of (tag, t_ms, kind, a, b)). Each frame repeats `reps` times, 250 ms apart;
    `after(tag, session)` is called once the frame's repetitions are done."""
    t, log = t0, []
    for tag, image in frames:
        for _ in range(reps):
            for envelope in session.process(image, t):
                payload = envelope["payload"]
                if payload["type"] == "capture_health":
                    log.append((tag, t, "health", payload["status"], payload["detail"]))
                else:
                    log.append((tag, t, payload["type"], payload.get("side"), payload.get("hero")))
            t += STEP_MS
        if after is not None:
            after(tag, session)
    return t, log


def new_session(matcher: Matcher) -> VisualSession:
    session = VisualSession(matcher, LAYOUT, THRESHOLDS, EnvelopeFactory("live", "run", CLOCK))
    session.on_lifecycle(DraftLifecycle("hero_selection", 1))
    return session


def run(corpus: Corpus, catalog, json_out: str | None) -> int:
    dual, plain = Matcher(catalog), Matcher(catalog, banner_bank=False)
    truth = {(r["session"], r["epoch"], r["slot"]): r["hero"] for r in json.loads((HERE / "truth.json").read_text(encoding="utf-8"))}
    names = {hero.id: hero.localized_name for hero in catalog.heroes}
    report: dict[str, object] = {}
    gates: list[tuple[str, bool, str]] = []

    def gate(name: str, ok: bool, detail: str) -> None:
        gates.append((name, bool(ok), detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")

    # ---- every cell: chroma lock gate + matcher -------------------------------------------------------------------
    cells = []
    for session, frames in SESSION_FRAMES.items():
        for n in frames:
            image = corpus.frame(session, n)
            chrome, crops = card_chrome(image, LAYOUT), slot_crops(image, LAYOUT)
            for slot, key in KEYS.items():
                cls = label(session, n, slot)
                if cls == "T":
                    continue
                cells.append({"session": session, "n": n, "slot": slot, "kind": kind(session, n), "cls": cls, "top": chrome[key].top, "bot": chrome[key].bottom, "crop": crops[key]})
    by_cls = Counter(c["cls"] for c in cells)
    locked = [c for c in cells if c["cls"] == "L"]
    draft_neg = [c for c in cells if c["cls"] in ("E", "G", "O")]
    nondraft = [c for c in cells if c["cls"] == "N"]
    report["cells"] = dict(by_cls)
    gate("LOCK GATE locked detected", all(c["top"] >= LOCK_CHROMA for c in locked), f"{sum(c['top'] >= LOCK_CHROMA for c in locked)}/{len(locked)} (min top-bar chroma {min(c['top'] for c in locked):.1f})")
    gate("LOCK GATE false locks (draft negatives)", not any(c["top"] >= LOCK_CHROMA for c in draft_neg), f"{sum(c['top'] >= LOCK_CHROMA for c in draft_neg)}/{len(draft_neg)} (max chroma {max(c['top'] for c in draft_neg):.1f})")
    gate("LOCK GATE false locks (non-draft)", not any(c["top"] >= LOCK_CHROMA for c in nondraft), f"{sum(c['top'] >= LOCK_CHROMA for c in nondraft)}/{len(nondraft)} (max chroma {max(c['top'] for c in nondraft):.1f})")

    results: dict[str, dict] = {}
    for name, matcher in (("dual", dual), ("plain", plain)):
        stats = {"human": Counter(), "bot": Counter()}
        scores = {"human": [], "bot": []}
        margins = {"human": [], "bot": []}
        for c in locked:
            want = truth[(c["session"], c["kind"], c["slot"])]
            result = matcher.match(c["crop"])
            accepted = confident(result, THRESHOLDS)
            stats[c["kind"]]["cells"] += 1
            if accepted and result.hero_id == want:
                stats[c["kind"]]["correct"] += 1
            elif accepted:
                stats[c["kind"]]["wrong"] += 1
                print(f"   WRONG {name} {c['session']}-{c['n']:03d} {c['slot']}: {names.get(result.hero_id)} instead of {names.get(want)}")
            if result.hero_id == want:
                scores[c["kind"]].append(result.score)
                margins[c["kind"]].append(result.margin)
        results[name] = {k: dict(v) | {"min_score": min(scores[k]), "min_margin": min(margins[k])} for k, v in stats.items()}
    report["matcher"] = results
    d = results["dual"]
    gate("MATCHER HUMAN (dual bank)", d["human"].get("correct") == d["human"]["cells"] and not d["human"].get("wrong"), f"{d['human'].get('correct', 0)}/{d['human']['cells']} correct, {d['human'].get('wrong', 0)} wrong (min score {d['human']['min_score']:.3f}, min margin {d['human']['min_margin']:.3f})")
    gate("MATCHER BOT (dual bank)", d["bot"].get("correct") == d["bot"]["cells"] and not d["bot"].get("wrong"), f"{d['bot'].get('correct', 0)}/{d['bot']['cells']} correct, {d['bot'].get('wrong', 0)} wrong")
    gate("BOT min score / margin", d["bot"]["min_score"] >= 0.68 and d["bot"]["min_margin"] >= 0.30, f"min score {d['bot']['min_score']:.3f} (>= 0.68), min margin {d['bot']['min_margin']:.3f} (>= 0.30)")
    p = results["plain"]
    print(f"   (0.1.2 plain bank for reference: human {p['human'].get('correct', 0)}/{p['human']['cells']}, bot {p['bot'].get('correct', 0)}/{p['bot']['cells']})")

    # ---- negatives: what the LIVE pipeline (lock-gated) would accept, and what an UNGATED matcher would ---------------
    negatives = draft_neg + nondraft
    ungated = [c for c in negatives if confident(dual.match(c["crop"]), THRESHOLDS)]
    gated = [c for c in negatives if c["top"] >= LOCK_CHROMA and confident(dual.match(c["crop"]), THRESHOLDS)]
    gate("NEGATIVES accepted heroes (lock-gated pipeline)", not gated, f"{len(gated)}/{len(negatives)} (empty {sum(c['cls'] == 'E' for c in negatives)}, ghost {sum(c['cls'] == 'G' for c in negatives)}, overlay {sum(c['cls'] == 'O' for c in negatives)}, non-draft {len(nondraft)})")
    print(f"   (an UNGATED matcher would accept {len(ungated)}/{len(negatives)}: the lock gate is what keeps hover out)")
    report["ungated_negative_accepts"] = len(ungated)

    # ---- session replay ---------------------------------------------------------------------------------------------
    emitted_all, correct_total, wrong_total, lock_ok, lock_total = 0, 0, 0, 0, 0
    epoch_health: list[tuple[str, str, set, int]] = []
    for session_id, epoch_kind, frames in EPOCHS:
        session = new_session(dual)
        states_by_frame: dict[int, dict] = {}
        t, log = play(session, [(n, corpus.frame(session_id, n)) for n in frames], reps=REPS, after=lambda n, s: states_by_frame.__setitem__(n, dict(s.lock_states)))
        want = {(("radiant" if slot[0] == "r" else "dire"), hero) for (s, k, slot), hero in truth.items() if s == session_id and k == epoch_kind}
        picked = {(side, hero) for _, _, typ, side, hero in log if typ == "hero_picked"}
        reverted = {(side, hero) for _, _, typ, side, hero in log if typ == "pick_reverted"}
        wrong = picked - want
        correct_total += len(picked & want)
        wrong_total += len(wrong) + len(reverted)
        emitted_all += len(picked)
        print(f"   replay {session_id} {epoch_kind}: {len(picked & want)}/{len(want)} picks, wrong {sorted(wrong)}, reverts {sorted(reverted)}")
        epoch_health.append((session_id, epoch_kind, {(e[3], e[4]) for e in log if e[2] == "health"}, sum(any(v == "ambiguous" for v in st.values()) for st in states_by_frame.values())))
        for n in frames:  # the real pipeline's lock verdict (chroma + occupancy) after each frame's last repetition
            for slot, key in KEYS.items():
                cls = label(session_id, n, slot)
                if cls in ("T", "N"):
                    continue
                lock_total += 1
                lock_ok += (states_by_frame[n][key] == "locked") == (cls == "L")
    report["replay"] = {"correct": correct_total, "wrong": wrong_total, "emitted": emitted_all}
    expected = len(truth)
    gate("SESSION REPLAY picks", correct_total == expected and wrong_total == 0 and emitted_all == expected, f"{correct_total}/{expected} correct picks over the 4 sessions, {wrong_total} wrong (d0 of the 0.1.2 human draft is not among them: its late pixels were never saved)")
    gate("LOCK STATE (chroma + occupancy) vs labels", lock_ok == lock_total, f"{lock_ok}/{lock_total} cells agree (locked <=> label L), armed on each epoch's first frame")

    # ---- health -----------------------------------------------------------------------------------------------------
    bad_epochs = [(s, k) for s, k, words, amb in epoch_health if ("degraded", "VISUAL_SLOTS_UNREAD") in words or amb]
    sent_words = sorted({w for _, _, ws, _ in epoch_health for w in ws})
    gate("HEALTH real epochs: hover / overlay / lock never degrade", not bad_epochs, f"{len(epoch_health)} real draft epochs: only {sent_words} ever sent, 0 ambiguous frames" if not bad_epochs else f"degraded in {bad_epochs}")
    def health(log):
        return [(e[1], e[3], e[4]) for e in log if e[2] == "health"]

    session = new_session(dual)
    _, log = play(session, [(0, corpus.frame("65964acb", 0))], reps=12)
    gate("HEALTH stable empty bar => OK", ("ok", "VISUAL_OK") in [(s, d_) for _, s, d_ in health(log)], f"{health(log)[-1][1:]} after arming on a real empty human bar")

    session = new_session(dual)
    _, log = play(session, [(n, corpus.frame("824903f3", n)) for n in range(13, 18)], reps=REPS)  # own hover on r2 (+ r4 at 17), nobody locked yet
    states = {(s, d_) for _, s, d_ in health(log)}
    gate("HEALTH hover => no SLOTS_UNREAD, no pick", ("degraded", "VISUAL_SLOTS_UNREAD") not in states and session._last_health == ("ok", "VISUAL_OK") and session.status.confirmed == 0 and not [e for e in log if e[2] == "hero_picked"], f"own hover on r2 for {5 * REPS * STEP_MS / 1000:.0f} s: {sorted(states)}, picks {session.status.confirmed}")

    # locked-unread: a locked card whose art the matcher cannot name
    base_frame = corpus.frame("824903f3", 29).copy()
    key = KEYS["r3"]
    crop_box = [int(v) for v in (LAYOUT.slots["radiant"][3].x * 1600, LAYOUT.slots["radiant"][3].y * 900, LAYOUT.slots["radiant"][3].w * 1600, LAYOUT.slots["radiant"][3].h * 900)]
    x0, y0, w, h = crop_box
    unread = base_frame.copy()
    unread[y0:y0 + h, x0:x0 + w] = np.random.default_rng(3).integers(0, 255, size=(h, w, 3), dtype=np.uint8)
    session = new_session(dual)
    t, _ = play(session, [(13, corpus.frame("824903f3", 13))], reps=REPS)
    began = t
    t, log = play(session, [(29, unread)], t0=t, reps=int(UNREAD_GRACE_MS / STEP_MS) + 8)
    degraded = [e for e in health(log) if e[1:] == ("degraded", "VISUAL_SLOTS_UNREAD")]
    gate("HEALTH locked unread => SLOTS_UNREAD after 1.5 s", bool(degraded) and degraded[0][0] - began >= UNREAD_GRACE_MS and key not in session.stability.confirmed(), f"first SLOTS_UNREAD {(degraded[0][0] - began) / 1000:.2f} s after the card locked, no hero for r3" if degraded else "never degraded")

    # black / partial / menu frames after a good read: no fresh OK, degrade after 1.5 s
    for name, bad in (("black", np.zeros_like(base_frame)), ("partial", np.where(np.arange(1600)[None, :, None] < 800, base_frame, 0).astype(np.uint8)), ("menu", corpus.frame("824903f3", 11))):
        session = new_session(dual)
        t, log = play(session, [(n, corpus.frame("824903f3", n)) for n in range(13, 30)], reps=4)
        assert session._last_health == ("ok", "VISUAL_OK"), session._last_health
        began = t
        t, log = play(session, [(name, bad)], t0=t, reps=int(20_000 / STEP_MS))
        fresh_ok = [e for e in health(log) if e[1:] == ("ok", "VISUAL_OK")]
        degraded = [e for e in health(log) if e[1] == "degraded"]
        first_bad = degraded[0][0] - began if degraded else float("inf")
        gate(f"HEALTH {name} frame => no fresh OK", not fresh_ok and UNREAD_GRACE_MS <= first_bad <= UNREAD_GRACE_MS + STEP_MS, f"fresh OKs {len(fresh_ok)}, degraded after {first_bad / 1000:.2f} s, then {health(log)[-1][1:]}")

    # helper starts on an already-filled bar
    session = new_session(dual)
    _, log = play(session, [(29, corpus.frame("65964acb", 29))], reps=16)
    status_words = {(s, d_) for _, s, d_ in health(log)}
    gate("HEALTH already-locked card at arming => never OK, no pick", ("ok", "VISUAL_OK") not in status_words and ("degraded", "VISUAL_SLOTS_UNREAD") in status_words and session.status.confirmed == 0, f"{sorted(status_words)}, picks {session.status.confirmed}")

    # ---- shift ------------------------------------------------------------------------------------------------------
    print("   shift (dy, dx): locked detected | correct / unread / WRONG hero | false locks on negatives")
    shift_ok = True
    for dy, dx in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (3, 0), (-3, 0), (0, 2), (0, -2), (0, 3), (0, -3)]:
        det = good = unread_ = wrong_ = falselock = 0
        for c in cells:
            if c["cls"] in ("T",):
                continue
            image = shifted(corpus.frame(c["session"], c["n"]), dy, dx)
            top = card_chrome(image, LAYOUT)[KEYS[c["slot"]]].top
            if c["cls"] == "L":
                det += top >= LOCK_CHROMA
                result = dual.match(slot_crops(image, LAYOUT)[KEYS[c["slot"]]])
                want = truth[(c["session"], c["kind"], c["slot"])]
                if confident(result, THRESHOLDS):
                    good += result.hero_id == want
                    wrong_ += result.hero_id != want
                else:
                    unread_ += 1
            else:
                falselock += top >= LOCK_CHROMA
        verdict = wrong_ == 0 and falselock == 0
        shift_ok &= verdict
        print(f"   ({dy:+d},{dx:+d}): {det}/{len(locked)} | {good} / {unread_} / {wrong_} | {falselock}  {'ok' if verdict else 'FAIL'}")
    gate("SHIFT", shift_ok, "+-3 px: unread / ambiguous is acceptable; a wrong hero or a false lock is not")

    failed = [g for g in gates if not g[1]]
    print(f"\n{len(gates) - len(failed)}/{len(gates)} gates pass")
    if json_out:
        Path(json_out).write_text(json.dumps({"gates": [{"name": n, "pass": ok, "detail": d_} for n, ok, d_ in gates], **report}, indent=1, default=float), encoding="utf-8")
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--corpus")
    parser.add_argument("--json")
    args = parser.parse_args()
    catalog = load_catalog(resolve_catalog_dir())
    return run(Corpus(corpus_dir(args.corpus)), catalog, args.json)


if __name__ == "__main__":
    raise SystemExit(main())
