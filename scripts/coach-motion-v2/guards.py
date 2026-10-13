"""Quality guards on the Coach Motion V2 production SOURCE frames (capture.mjs output) and, with --pack, on the DECODED AVIF pack.
usage: python -I scripts/coach-motion-v2/guards.py --frames <dir>/<px> [--pack apps/web/public/coach-motion-v2/prod/<px>] --out report.json

Frame distance = mean absolute difference over the composited frames (dark and light backdrop averaged), 0..255 scale, plus the share of visibly changed pixels.
  HELD       longest run of consecutive frames with no visible change (< FROZEN_PX changed pixels) must be < 15 frames (500 ms)
  LOOP SEAM  last -> first step of each loop vs the largest ordinary step of that loop
  BLINK      WATCHING must hold a real blink (min eyeOpen of the authored poses < 0.4) and the pixels must show it
  TRANSITION head frame 0 == WATCHING frame of its phase (exact), head last -> tail first and tail last -> ANALYZING first vs ordinary steps
"""
import argparse, glob, json, os
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--frames", required=True)
ap.add_argument("--pack")
ap.add_argument("--out", required=True)
args = ap.parse_args()
FROZEN_PX = 12
BGS = [np.array((11, 11, 16), np.float32), np.array((245, 245, 248), np.float32)]


def comp(a):
    al = a[..., 3:4].astype(np.float32) / 255
    return [a[..., :3].astype(np.float32) * al + b * (1 - al) for b in BGS]


def load(clip):
    return [np.array(Image.open(f).convert("RGBA")) for f in sorted(glob.glob(f"{args.frames}/{clip}/f*.png"))]


def dist(a, b):
    ca, cb = comp(a), comp(b)
    d = [np.abs(x - y).sum(axis=2) for x, y in zip(ca, cb)]
    mad = float(np.mean([x.mean() for x in d]))
    changed = int(max((x > 6).sum() for x in d))
    return mad, changed


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


report = {}
watch, analyze, tail = load("watching"), load("analyzing"), load("tail")
for name, fr in (("watching", watch), ("analyzing", analyze)):
    st = steps(fr)
    seam = dist(fr[-1], fr[0])
    report[name] = dict(frames=len(fr), step=stats(st), frozenFramesMax=longest_frozen(st), frozenMsMax=round(longest_frozen(st) * 1000 / 30), seam=dict(mad=seam[0], changedPx=seam[1]), seamOverMaxStep=seam[0] / max(s[0] for s in st))

poses = json.load(open(f"{args.frames}/watching/poses.json"))
eye = [p["eyeOpen"] for p in poses]
blinks = sum(1 for i, v in enumerate(eye) if v < 0.9 and (i == 0 or eye[i - 1] >= 0.9))
# pixel evidence of the blink: the frame-to-frame change in the visor area peaks at the blink
report["watching"]["blink"] = dict(count=blinks, minEyeOpen=min(eye), atFrames=[i for i, v in enumerate(eye) if v < 0.5])

heads = sorted(glob.glob(f"{args.frames}/head-*"))
phases = [int(os.path.basename(h)[5:]) for h in heads]
tail_steps = steps(tail)
an_steps = steps(analyze)
exact, h2t, ordinary = [], [], max(s[0] for s in tail_steps)
for p in phases:
    head = load(f"head-{p:03d}")
    exact.append(dist(head[0], watch[p])[0])
    h2t.append(dist(head[-1], tail[0])[0])
    hs = steps(head)
report["transition"] = dict(
    heads=len(phases),
    headFrame0VsWatching=dict(maxMad=max(exact)),
    headToTailSeam=dict(maxMad=max(h2t), medianMad=float(np.median(h2t)), ordinaryMaxTailStep=ordinary),
    tailToAnalyzingSeam=dict(mad=dist(tail[-1], analyze[0])[0], ordinaryMaxAnalyzingStep=max(s[0] for s in an_steps)),
    tailFrozenFramesMax=longest_frozen(tail_steps),
    entrySeamNearest=dict(note="a cue shown at loop frame s starts the head of the nearest phase to s+1: the visible step is the pose distance of <= 3 watching frames", maxWatchingStep3=max(dist(watch[i], watch[(i + 3) % len(watch)])[0] for i in range(0, len(watch), 7))),
)

if args.pack:
    # decoded AVIF vs source: PSNR and codec flicker (frame-to-frame change of the coding error), per clip
    m = json.load(open(f"{args.pack}/manifest.json"))
    cw, ch, cols = m["cell"]["w"], m["cell"]["h"], m["cols"]
    x0, y0 = m["crop"]["x"], m["crop"]["y"]
    out = {}
    for clip, src in (("WATCHING_LOOP", watch), ("ANALYZING_LOOP", analyze)):
        errs, psn, n = [], [], 0
        for c in m["clips"][clip]["chunks"]:
            atlas = np.array(Image.open(f"{args.pack}/{c['file']}").convert("RGBA"))
            for i in range(c["frames"]):
                d = atlas[(i // cols) * ch:(i // cols + 1) * ch, (i % cols) * cw:(i % cols + 1) * cw]
                full = np.zeros_like(src[n])
                full[y0:y0 + ch, x0:x0 + cw] = d
                a, b = comp(src[n])[0], comp(full)[0]
                mse = float(((a - b) ** 2).mean())
                psn.append(99 if mse == 0 else 10 * np.log10(255 ** 2 / mse))
                errs.append(b - a)
                n += 1
        e = np.stack(errs)
        vis = src[0][..., 3] > 0
        flick = np.abs(np.diff(e, axis=0)).mean(axis=(0, 3))[vis].mean()
        out[clip] = dict(frames=n, psnrMean=float(np.mean(psn)), psnrMin=float(np.min(psn)), codecFlicker=float(flick), bytes=sum(c["bytes"] for c in m["clips"][clip]["chunks"]))
    report["decoded"] = out

json.dump(report, open(args.out, "w"), indent=1)
print(json.dumps(report, indent=1)[:4000])
