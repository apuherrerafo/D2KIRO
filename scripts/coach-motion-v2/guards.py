"""Quality guards on the Coach Motion V2 production SOURCE frames (capture.mjs output) and, with --pack, on the DECODED AVIF pack. GRAPH-DRIVEN: every loop and every edge of graph.json is checked,
nothing here names a clip.
usage: python -I scripts/coach-motion-v2/guards.py --frames <dir>/<px> [--pack apps/web/public/coach-motion-v2/prod/<px>] [--graph graph.json] --out report.json   (exit 1 when a guard fails)

Frame distance = mean absolute difference over the composited frames (dark and light backdrop averaged), 0..255 scale, plus the share of visibly changed pixels.
  per LOOP   frame count == graph; HELD: longest run with no visible change (< FROZEN_PX changed pixels) < 15 frames (500 ms); LOOP SEAM: last -> first step vs the loop's largest ordinary step;
             FORWARD: not a ping-pong (mirror score >= MIN_FORWARD_SCORE);
             BLINK: when the graph declares `blinks`, the authored poses hold that many real blinks
  per EDGE   head frame 0 == the SOURCE loop frame of its phase (exact); head count / grid == the edge's stride; every head has the edge's headFrames; head last -> tail first
             (seam_verdict: STANDARD or DECAY mode, see below) and tail last -> destination loop frame `enterFrame` vs the ordinary steps; the entry continuity budget
             (maxStepFrames == floor(stride / 2)); the tail is not frozen
  per PACK   decoded AVIF vs source: PSNR and codec flicker, per loop of the graph

HEAD -> TAIL SEAM. STANDARD (the default): the step head[-1] -> tail[0] <= 1.25 x max(the tail's largest step, the source loop's largest ordinary step).
That rule compares the cut with the steps after it, so a cut that lands inside one continuous deceleration always looks "too big" (the next step is smaller by
construction). DECAY mode accepts such a cut, and ONLY such a cut: every rule of DECAY_RULES must hold, otherwise the STANDARD verdict stands (it is never relaxed):
  decelerating   boundary <= before                      keepsDecaying  after <= boundary and after2 <= after       noAbruptStop  boundary / before and after / boundary >= 0.5
  direction      mean optical-flow cosine >= 0.95 between before / boundary and boundary / after (an undefined direction fails)
  visorSign      visor yaw / pitch velocity keeps its sign across the seam (velocities under 1e-3 rad/frame have no sign)
  visor, eyes, ring   the pose step at the seam <= the largest step of that channel elsewhere in the head + tail
  noPop          neither seam frame is a one-frame detour: (step in + step out) / skip distance at head[-1] and at tail[0] <= the largest of the two frames on either side
"""
import argparse, glob, json, math, os, sys
import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script directory from sys.path
import pack_manifest as pm

FROZEN_PX = 12
MAX_HELD_FRAMES = 15
MIN_FORWARD_SCORE = 0.35
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


def ping_pong_score(fr):
    """Mean distance between frame k and frame N-1-k over mean distance between frame k and frame k + N/2: a ping-pong clip is its own mirror image (score ~ 0), a forward loop is not."""
    n = len(fr)
    mirror = np.mean([dist(fr[k], fr[n - 1 - k])[0] for k in range(1, n // 2)])
    half = np.mean([dist(fr[k], fr[(k + n // 2) % n])[0] for k in range(0, n // 2)])
    return float(mirror / max(half, 1e-9))


def count_blinks(eye):
    return sum(1 for i, v in enumerate(eye) if v < 0.9 and (i == 0 or eye[i - 1] >= 0.9))


# ------------------------------------------------------------------ head -> tail seam: STANDARD rule, DECAY mode
STANDARD_SEAM_FACTOR = 1.25
DECAY_MIN_RATIO = 0.5
DECAY_MIN_FLOW_COS = 0.95
VISOR_VEL_EPS = 1e-3
POSE_CHANNELS = (("visor", ("yaw", "pitch")), ("eyes", ("eyeOpen", "eyeX", "eyeZ")), ("ring", ("shardSpin", "shardRadius")))
DECAY_RULES = ("decelerating", "keepsDecaying", "noAbruptStop", "direction", "visorSign", "visor", "eyes", "ring", "noPop")


def angle(d):
    return (d + math.pi) % (2 * math.pi) - math.pi


def pose_delta(a, b, keys):
    """Largest absolute change of the named pose channels (the ring spin is an angle: 2 pi is the same picture)."""
    return max(abs(angle(b[k] - a[k])) if k == "shardSpin" else abs(b[k] - a[k]) for k in keys)


def mean_flow(a, b):
    """Mean dense optical flow (px/frame) over the pixels that are foreground in either frame (dark backdrop, Farneback)."""
    ga, gb = (cv2.cvtColor(np.clip(comp(x)[0], 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY) for x in (a, b))
    f = cv2.calcOpticalFlowFarneback(ga, gb, None, 0.5, 4, 21, 5, 7, 1.5, 0)
    m = (a[..., 3] > 40) | (b[..., 3] > 40)
    return f[m].mean(axis=0) if m.any() else np.zeros(2, np.float32)


def cosine(u, v):
    nu, nv = float(np.linalg.norm(u)), float(np.linalg.norm(v))
    return float(np.dot(u, v) / (nu * nv)) if nu > 1e-3 and nv > 1e-3 else None


def seam_verdict(head, tail, limit, poses=None):
    """Verdict on the cut head[-1] -> tail[0]. `limit` is the STANDARD rule's ordinary step (the threshold is limit x 1.25); `poses()` returns (head poses, tail poses)
    and is only called when the STANDARD rule fails. mode: STANDARD (accepted by the default rule), DECAY (accepted as one continuous deceleration), FAIL."""
    seq = head + tail
    b = len(head) - 1  # step index of the cut
    boundary = dist(seq[b], seq[b + 1])[0]
    out = dict(boundary=boundary, standardLimit=limit * STANDARD_SEAM_FACTOR)
    if boundary <= limit * STANDARD_SEAM_FACTOR:
        out["mode"] = "STANDARD"
        return out
    out["mode"] = "FAIL"
    if b < 3 or len(tail) < 4 or poses is None:
        out["decay"] = "not applicable (needs 4 head frames, 4 tail frames and the authored poses)"
        return out
    s = {i: dist(seq[i], seq[i + 1])[0] for i in range(b - 3, b + 4)}
    before, after, after2 = s[b - 1], s[b + 1], s[b + 2]
    detour = {i: (s[i - 1] + s[i]) / max(dist(seq[i - 1], seq[i + 1])[0], 1e-9) for i in range(b - 2, b + 4)}
    flows = {i: mean_flow(seq[i], seq[i + 1]) for i in (b - 1, b, b + 1)}
    cos = [cosine(flows[b - 1], flows[b]), cosine(flows[b], flows[b + 1])]
    hp, tp = poses()
    ps = hp + tp
    vel = {k: [ps[i + 1][k] - ps[i][k] for i in (b - 1, b, b + 1)] for k in ("yaw", "pitch")}
    flips = [k for k, v in vel.items() if any(abs(x) > VISOR_VEL_EPS and abs(y) > VISOR_VEL_EPS and (x > 0) != (y > 0) for x, y in zip(v, v[1:]))]
    pose = {}
    for name, keys in POSE_CHANNELS:
        st = [pose_delta(ps[i], ps[i + 1], keys) for i in range(len(ps) - 1)]
        pose[name] = dict(seam=st[b], internalMax=max(x for i, x in enumerate(st) if i != b))
    pop = dict(seam=max(detour[b], detour[b + 1]), neighbours=max(detour[b - 2], detour[b - 1], detour[b + 2], detour[b + 3]))
    rules = dict(
        decelerating=boundary <= before,
        keepsDecaying=after <= boundary and after2 <= after,
        noAbruptStop=boundary / before >= DECAY_MIN_RATIO and after / boundary >= DECAY_MIN_RATIO,
        direction=all(c is not None and c >= DECAY_MIN_FLOW_COS for c in cos),
        visorSign=not flips,
        visor=pose["visor"]["seam"] <= pose["visor"]["internalMax"],
        eyes=pose["eyes"]["seam"] <= pose["eyes"]["internalMax"],
        ring=pose["ring"]["seam"] <= pose["ring"]["internalMax"],
        noPop=pop["seam"] <= pop["neighbours"],
    )
    out["decay"] = dict(
        steps=dict(before=before, boundary=boundary, after=after, after2=after2), ratios=dict(boundaryOverBefore=boundary / before, afterOverBoundary=after / boundary),
        flowCos=cos, visorVelocity=vel, visorSignFlips=flips, pose=pose, detour=pop, rules=rules, broken=[r for r in DECAY_RULES if not rules[r]],
    )
    if all(rules.values()):
        out["mode"] = "DECAY"
    return out


def run(frames, graph, pack=None):
    """Returns (report, failures). `frames` is the capture folder of one resolution."""
    cache = {}

    def read(d):
        return [np.array(Image.open(f).convert("RGBA")) for f in sorted(glob.glob(f"{frames}/{d}/f*.png"))]

    def load(d):
        """Loops and tails are read many times: cached. Heads are read once each and NOT cached (a full grid is ~2 GB of decoded frames)."""
        if d not in cache:
            cache[d] = read(d)
        return cache[d]

    def poses(d):
        return json.load(open(f"{frames}/{d}/poses.json"))

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
        r = dict(frames=len(fr), step=stats(st), frozenFramesMax=frozen, frozenMsMax=round(frozen * 1000 / 30), seam=dict(mad=seam[0], changedPx=seam[1]), seamOverMaxStep=seam[0] / max(ordinary[lid], 1e-9), pingPongScore=ping_pong_score(fr))
        if len(fr) != l["frames"]:
            fail(f"loop {lid}: {len(fr)} frames, graph says {l['frames']}")
        if frozen >= MAX_HELD_FRAMES:
            fail(f"loop {lid}: held {frozen} frames without visible change (limit {MAX_HELD_FRAMES - 1})")
        if seam[0] > ordinary[lid]:
            fail(f"loop {lid}: loop seam {seam[0]:.2f} exceeds its largest ordinary step {ordinary[lid]:.2f}")
        if r["pingPongScore"] < MIN_FORWARD_SCORE:
            fail(f"loop {lid}: plays like a ping-pong, not a forward loop (mirror score {r['pingPongScore']:.2f} < {MIN_FORWARD_SCORE})")
        if "blinks" in l:
            eye = [p["eyeOpen"] for p in poses(l["dir"])]
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
        exact, h2t, verdicts = [], [], []
        for p, d in zip(phases, pm.head_dir_names(graph, e)):
            head = read(d)
            if len(head) != en["headFrames"]:
                fail(f"edge {e['id']}: {d} has {len(head)} frames, expected {en['headFrames']}")
            exact.append(dist(head[0], src_fr[p])[0])
            v = seam_verdict(head, tail, limit_head, lambda d=d: (poses(d), poses(e["tail"]["dir"])))
            h2t.append(v["boundary"])
            verdicts.append(dict(phase=p, **v))
        modes = {m: [v["phase"] for v in verdicts if v["mode"] == m] for m in ("STANDARD", "DECAY", "FAIL")}
        decay = [v for v in verdicts if "decay" in v and isinstance(v["decay"], dict)]
        t2l = dist(tail[-1], dst_fr[e["tail"]["enterFrame"]])[0]
        r = dict(
            heads=len(phases), stride=en["stride"], headFrames=en["headFrames"], tailFrames=len(tail), strategy=en["strategy"], maxStepFrames=en["maxStepFrames"],
            headFrame0VsSource=dict(maxMad=max(exact)),
            headToTailSeam=dict(
                maxMad=max(h2t), medianMad=float(np.median(h2t)), limit=limit_head, standardLimit=limit_head * STANDARD_SEAM_FACTOR,
                modes={m: len(ph) for m, ph in modes.items()}, failingPhases=modes["FAIL"],
                decay=None if not decay else dict(
                    phases=[v["phase"] for v in decay],
                    minBoundaryOverBefore=min(v["decay"]["ratios"]["boundaryOverBefore"] for v in decay), minAfterOverBoundary=min(v["decay"]["ratios"]["afterOverBoundary"] for v in decay),
                    minFlowCos=min(c if c is not None else -2 for v in decay for c in v["decay"]["flowCos"]),
                    maxPoseSeamOverInternal={k: max(v["decay"]["pose"][k]["seam"] / max(v["decay"]["pose"][k]["internalMax"], 1e-12) for v in decay) for k, _ in POSE_CHANNELS},
                    maxDetourOverNeighbours=max(v["decay"]["detour"]["seam"] / v["decay"]["detour"]["neighbours"] for v in decay),
                    brokenRules=sorted({r for v in decay for r in v["decay"]["broken"]}),
                    canonical=decay[len(decay) // 2],
                ),
            ),
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
        if modes["FAIL"]:
            worst = max((v for v in verdicts if v["mode"] == "FAIL"), key=lambda v: v["boundary"])
            why = worst["decay"] if isinstance(worst.get("decay"), str) else "decay rules broken: " + ", ".join(worst["decay"]["broken"])
            fail(f"edge {e['id']}: head -> tail seam {worst['boundary']:.2f} exceeds {limit_head * STANDARD_SEAM_FACTOR:.2f} and is not a continuous deceleration at {len(modes['FAIL'])} head(s) (phase {worst['phase']}: {why})")
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
