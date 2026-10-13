"""Quality guards on the Coach Motion V2 production SOURCE frames (capture.mjs output) and, with --pack, on the DECODED AVIF pack. GRAPH-DRIVEN: every loop and every edge of graph.json is checked,
nothing here names a clip.
usage: python -I scripts/coach-motion-v2/guards.py --frames <dir>/<px> [--pack apps/web/public/coach-motion-v2/prod/<px>] [--graph graph.json] --out report.json   (exit 1 when a guard fails)

Frame distance = mean absolute difference over the composited frames (dark and light backdrop averaged), 0..255 scale, plus the share of visibly changed pixels.
  per LOOP   frame count == graph; HELD: longest run with no visible change (< FROZEN_PX changed pixels) < 15 frames (500 ms); LOOP SEAM: last -> first step vs the loop's largest ordinary step;
             BLINK: when the graph declares `blinks`, the authored poses hold that many real blinks
  per EDGE   head frame 0 == the SOURCE loop frame of its phase (exact); head count / grid == the edge's stride; every head has the edge's headFrames; head last -> tail first and
             tail last -> destination loop frame `enterFrame` vs the ordinary steps; the entry continuity budget (maxStepFrames == floor(stride / 2)); the tail is not frozen
  per PACK   decoded AVIF vs source: PSNR and codec flicker, per loop of the graph
"""
import argparse, glob, json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script directory from sys.path
import pack_manifest as pm

FROZEN_PX = 12
MAX_HELD_FRAMES = 15
BGS = [np.array((11, 11, 16), np.float32), np.array((245, 245, 248), np.float32)]


def comp(a):
    al = a[..., 3:4].astype(np.float32) / 255
    return [a[..., :3].astype(np.float32) * al + b * (1 - al) for b in BGS]


def dist(a, b):
    ca, cb = comp(a), comp(b)
    d = [np.abs(x - y).sum(axis=2) for x, y in zip(ca, cb)]
    return float(np.mean([x.mean() for x in d])), int(max((x > 6).sum() for x in d))


def steps(fr):
    return [dist(fr[i], fr[i + 1]) for i in range(len(fr) - 1)]


def longest_frozen(st):
    run = best = 0
    for _, ch in st:
        run = run + 1 if ch < FROZEN_PX else 0
        best = max(best, run)
    return best


def stats(st):
    m = [s[0] for s in st]
    return dict(median=float(np.median(m)), p95=float(np.percentile(m, 95)), max=float(max(m)))


def count_blinks(eye):
    return sum(1 for i, v in enumerate(eye) if v < 0.9 and (i == 0 or eye[i - 1] >= 0.9))


def run(frames, graph, pack=None):
    """Returns (report, failures). `frames` is the capture folder of one resolution."""
    cache = {}

    def load(d):
        if d not in cache:
            cache[d] = [np.array(Image.open(f).convert("RGBA")) for f in sorted(glob.glob(f"{frames}/{d}/f*.png"))]
        return cache[d]

    report, fails = {"loops": {}, "edges": {}}, []
    fail = fails.append
    pm.validate_graph(graph)
    pm.check_frames(graph, frames)
    ordinary = {}
    for lid, l in graph["loops"].items():
        fr = load(l["dir"])
        st = steps(fr)
        seam = dist(fr[-1], fr[0])
        frozen = longest_frozen(st)
        ordinary[lid] = max(s[0] for s in st)
        r = dict(frames=len(fr), step=stats(st), frozenFramesMax=frozen, frozenMsMax=round(frozen * 1000 / 30), seam=dict(mad=seam[0], changedPx=seam[1]), seamOverMaxStep=seam[0] / max(ordinary[lid], 1e-9))
        if len(fr) != l["frames"]:
            fail(f"loop {lid}: {len(fr)} frames, graph says {l['frames']}")
        if frozen >= MAX_HELD_FRAMES:
            fail(f"loop {lid}: held {frozen} frames without visible change (limit {MAX_HELD_FRAMES - 1})")
        if seam[0] > ordinary[lid]:
            fail(f"loop {lid}: loop seam {seam[0]:.2f} exceeds its largest ordinary step {ordinary[lid]:.2f}")
        if "blinks" in l:
            poses = json.load(open(f"{frames}/{l['dir']}/poses.json"))
            eye = [p["eyeOpen"] for p in poses]
            r["blink"] = dict(count=count_blinks(eye), declared=l["blinks"], minEyeOpen=min(eye), atFrames=[i for i, v in enumerate(eye) if v < 0.5])
            if r["blink"]["count"] != l["blinks"]:
                fail(f"loop {lid}: {r['blink']['count']} blinks in the authored poses, graph declares {l['blinks']}")
            if l["blinks"] and min(eye) >= 0.4:
                fail(f"loop {lid}: the blink is too shallow to read (min eyeOpen {min(eye):.2f})")
        report["loops"][lid] = r

    for e in graph["edges"]:
        src, dst, en = graph["loops"][e["from"]], graph["loops"][e["to"]], e["entry"]
        src_fr, dst_fr, tail = load(src["dir"]), load(dst["dir"]), load(e["tail"]["dir"])
        tail_st = steps(tail)
        # a seam is judged against the ordinary step of the clips it joins
        limit_head = max(max(s[0] for s in tail_st), ordinary[e["from"]])
        limit_tail = max(max(s[0] for s in tail_st), ordinary[e["to"]])
        phases = pm.head_phases(src["frames"], en["stride"])
        exact, h2t = [], []
        for p, d in zip(phases, pm.head_dir_names(graph, e)):
            head = load(d)
            if len(head) != en["headFrames"]:
                fail(f"edge {e['id']}: {d} has {len(head)} frames, expected {en['headFrames']}")
            exact.append(dist(head[0], src_fr[p])[0])
            h2t.append(dist(head[-1], tail[0])[0])
        t2l = dist(tail[-1], dst_fr[e["tail"]["enterFrame"]])[0]
        r = dict(
            heads=len(phases), stride=en["stride"], headFrames=en["headFrames"], tailFrames=len(tail), strategy=en["strategy"], maxStepFrames=en["maxStepFrames"],
            headFrame0VsSource=dict(maxMad=max(exact)),
            headToTailSeam=dict(maxMad=max(h2t), medianMad=float(np.median(h2t)), limit=limit_head),
            tailToDestinationSeam=dict(mad=t2l, limit=limit_tail),
            tailFrozenFramesMax=longest_frozen(tail_st),
            entrySeamNearest=dict(note="a request shown at source frame f starts the head of the nearest phase to f+1: the visible step is the pose distance of <= maxStepFrames source frames", maxSourceStepAtBudget=max(dist(src_fr[i], src_fr[(i + en["maxStepFrames"]) % len(src_fr)])[0] for i in range(0, len(src_fr), max(1, en["stride"])))),
        )
        if len(tail) != e["tail"]["frames"]:
            fail(f"edge {e['id']}: tail has {len(tail)} frames, graph says {e['tail']['frames']}")
        if en["maxStepFrames"] != en["stride"] // 2 or en["stride"] > src["strideLimit"]:
            fail(f"edge {e['id']}: stride {en['stride']} / maxStepFrames {en['maxStepFrames']} break the continuity budget (strideLimit {src['strideLimit']})")
        if max(exact) > 1e-6:
            fail(f"edge {e['id']}: a head's frame 0 differs from its source-loop phase (max {max(exact):.4f})")
        if max(h2t) > limit_head * 1.25:
            fail(f"edge {e['id']}: head -> tail seam {max(h2t):.2f} exceeds {limit_head * 1.25:.2f}")
        if t2l > limit_tail * 1.5:
            fail(f"edge {e['id']}: tail -> {e['to']} seam {t2l:.2f} exceeds {limit_tail * 1.5:.2f}")
        if r["tailFrozenFramesMax"] >= MAX_HELD_FRAMES:
            fail(f"edge {e['id']}: the tail holds {r['tailFrozenFramesMax']} frames without visible change")
        report["edges"][e["id"]] = r

    if pack:
        m = json.load(open(f"{pack}/manifest.json"))
        cw, ch, cols = m["cell"]["w"], m["cell"]["h"], m["cols"]
        x0, y0 = m["crop"]["x"], m["crop"]["y"]
        out = {}
        for cid, d, loop in pm.clip_plan(graph):
            if not loop:
                continue  # codec fidelity is judged on the loops; heads / tails use the same renderer and encoder
            src = load(d)
            errs, psn, n = [], [], 0
            for c in m["clips"][cid]["chunks"]:
                atlas = np.array(Image.open(f"{pack}/{c['file']}").convert("RGBA"))
                for i in range(c["frames"]):
                    cell = atlas[(i // cols) * ch:(i // cols + 1) * ch, (i % cols) * cw:(i % cols + 1) * cw]
                    full = np.zeros_like(src[n])
                    full[y0:y0 + ch, x0:x0 + cw] = cell
                    a, b = comp(src[n])[0], comp(full)[0]
                    mse = float(((a - b) ** 2).mean())
                    psn.append(99 if mse == 0 else 10 * np.log10(255 ** 2 / mse))
                    errs.append(b - a)
                    n += 1
            vis = src[0][..., 3] > 0
            flick = np.abs(np.diff(np.stack(errs), axis=0)).mean(axis=(0, 3))[vis].mean()
            out[cid] = dict(frames=n, psnrMean=float(np.mean(psn)), psnrMin=float(np.min(psn)), codecFlicker=float(flick), bytes=sum(c["bytes"] for c in m["clips"][cid]["chunks"]))
        report["decoded"] = out
    report["failures"] = fails
    return report, fails


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True)
    ap.add_argument("--pack")
    ap.add_argument("--graph", default=pm.GRAPH_FILE)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    rep, fl = run(args.frames, pm.load_graph(args.graph), args.pack)
    json.dump(rep, open(args.out, "w"), indent=1)
    print(json.dumps(rep, indent=1)[:4000])
    if fl:
        print("\nGUARD FAILURES:\n  - " + "\n  - ".join(fl))
        sys.exit(1)
