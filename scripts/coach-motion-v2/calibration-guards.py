"""Real-render guards on the CALIBRATION set (capture.mjs --only $(calibration-set.mjs) output). Reuses guards.py's frame metrics; judges only the new semantic states and the four canonical transitions.
usage: python -I scripts/coach-motion-v2/calibration-guards.py --frames <dir>/<px> --set <set.json> [--pack <calibration pack dir>] --out report.json     (exit 1 when a guard fails)

LOOPS (all four loops are measured, only the new pointing / confirming gate):
  forward loop (not ping-pong), held <= 14 frames, loop seam <= the loop's largest ordinary step, declared blinks present, pose seam (visor / eyes / ring) vs the largest ordinary pose step
TRANSITIONS (canonical head of each scenario, plus every other representative head for the max-step numbers):
  sequence = source loop up to the head phase, head, tail, destination loop from enterFrame.
  measured: source final step (the ordinary step into the head's phase), transition first step, max single-frame step of head+tail, visor / eye / ring-piece pose jumps, destination seam
  gate: head 0 == source frame of its phase (exact), head -> tail seam (guards.seam_verdict: STANDARD or DECAY mode, reported per head), tail -> destination seam vs the ordinary steps
"""
import argparse, glob, json, math, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script directory from sys.path
import guards as g

TAU = 2 * math.pi
VISOR = ("yaw", "pitch")
EYES = ("eyeOpen", "eyeX", "eyeZ")
RING = ("shardSpin", "shardRadius")
GATED_LOOPS = ("pointing", "confirming")


def angle(d):
    return (d + math.pi) % TAU - math.pi


def pose_step(a, b, keys):
    """Largest absolute change of the named pose channels between two poses (the ring spin is an angle: 2 pi is the same picture)."""
    return max(abs(angle(b[k] - a[k])) if k == "shardSpin" else abs(b[k] - a[k]) for k in keys)


def load_dir(frames, d):
    return [np.array(Image.open(f).convert("RGBA")) for f in sorted(glob.glob(f"{frames}/{d}/f*.png"))]


def poses_of(frames, d):
    return json.load(open(f"{frames}/{d}/poses.json"))


def seq_pose_steps(poses, keys):
    return [pose_step(poses[i], poses[i + 1], keys) for i in range(len(poses) - 1)]


def run(frames, cal, pack=None):
    report, fails = {"loops": {}, "transitions": {}}, []
    fail = fails.append
    loops = {l["id"]: l for l in cal["loops"]}
    fr = {i: load_dir(frames, l["dir"]) for i, l in loops.items()}
    ps = {i: poses_of(frames, l["dir"]) for i, l in loops.items()}
    ordinary, pose_ordinary = {}, {}
    for lid, l in loops.items():
        st = g.steps(fr[lid])
        seam = g.dist(fr[lid][-1], fr[lid][0])
        ordinary[lid] = max(s[0] for s in st)
        frozen = g.longest_frozen(st)
        pose_ordinary[lid] = {k: max(seq_pose_steps(ps[lid], keys)) for k, keys in (("visor", VISOR), ("eyes", EYES), ("ring", RING))}
        wrap = {k: pose_step(ps[lid][-1], ps[lid][0], keys) for k, keys in (("visor", VISOR), ("eyes", EYES), ("ring", RING))}
        eye = [p["eyeOpen"] for p in ps[lid]]
        r = dict(
            frames=len(fr[lid]), step=g.stats(st), frozenFramesMax=frozen, seam=dict(mad=seam[0], changedPx=seam[1]), seamOverMaxStep=seam[0] / max(ordinary[lid], 1e-9),
            pingPongScore=g.ping_pong_score(fr[lid]), poseOrdinaryMaxStep=pose_ordinary[lid], poseSeam=wrap,
            blink=dict(count=g.count_blinks(eye), declared=l.get("blinks"), minEyeOpen=min(eye), atFrames=[i for i, v in enumerate(eye) if v < 0.5]),
            blinkDetail=dict(eyeOpenAtWrap=[eye[-1], eye[0]]),
        )
        report["loops"][lid] = r
        if lid not in GATED_LOOPS:
            continue
        if len(fr[lid]) != l["frames"]:
            fail(f"loop {lid}: {len(fr[lid])} frames, graph says {l['frames']}")
        if frozen >= g.MAX_HELD_FRAMES:
            fail(f"loop {lid}: held {frozen} frames without visible change")
        if seam[0] > ordinary[lid]:
            fail(f"loop {lid}: loop seam {seam[0]:.2f} exceeds its largest ordinary step {ordinary[lid]:.2f}")
        if r["pingPongScore"] < g.MIN_FORWARD_SCORE:
            fail(f"loop {lid}: looks like a ping-pong (mirror score {r['pingPongScore']:.2f})")
        for k in ("visor", "eyes", "ring"):
            if wrap[k] > pose_ordinary[lid][k] * 1.0001 + 1e-9:
                fail(f"loop {lid}: pose seam {k} {wrap[k]:.4f} exceeds the loop's largest ordinary {k} step {pose_ordinary[lid][k]:.4f}")
        if l.get("blinks") is not None and r["blink"]["count"] != l["blinks"]:
            fail(f"loop {lid}: {r['blink']['count']} blinks in the authored poses, graph declares {l['blinks']}")
        if l.get("blinks") and min(eye) >= 0.4:
            fail(f"loop {lid}: the blink is too shallow to read (min eyeOpen {min(eye):.2f})")

    for s in cal["scenarios"]:
        src, dst = fr[s["from"]], fr[s["to"]]
        src_p, dst_p = ps[s["from"]], ps[s["to"]]
        tail, tail_p = load_dir(frames, s["tail"]["dir"]), poses_of(frames, s["tail"]["dir"])
        enter = s["tail"]["enterFrame"]
        tail_st = g.steps(tail)
        per_head = []
        for h in s["heads"]:
            hf, hp = load_dir(frames, h["dir"]), poses_of(frames, h["dir"])
            p = h["phase"]
            seq_f = hf + tail
            seq_p = hp + tail_p
            st = g.steps(seq_f)
            head0 = g.dist(hf[0], src[p])[0]
            pose0 = max(abs(hp[0][k] - src_p[p][k]) for k in hp[0])
            src_final = g.dist(src[p - 1], src[p])[0] if p > 0 else g.dist(src[-1], src[0])[0]
            first = g.dist(hf[0], hf[1])[0]
            h2t = g.dist(hf[-1], tail[0])[0]
            seam_dest = g.dist(tail[-1], dst[enter])[0]
            jumps = {k: max(seq_pose_steps(seq_p, keys)) for k, keys in (("visor", VISOR), ("eyes", EYES), ("ring", RING))}
            dest_jump = {k: pose_step(tail_p[-1], dst_p[enter], keys) for k, keys in (("visor", VISOR), ("eyes", EYES), ("ring", RING))}
            seq_steps = [x[0] for x in st]
            b = len(hf) - 1  # index of the head -> tail step
            decay = dict(before=seq_steps[b - 1], boundary=seq_steps[b], after=seq_steps[b + 1], monotone=seq_steps[b - 1] >= seq_steps[b] >= seq_steps[b + 1])
            verdict = g.seam_verdict(hf, tail, max(max(x[0] for x in tail_st), ordinary[s["from"]]), lambda hp=hp: (hp, tail_p))
            row = dict(
                phase=p, canonical=p == s["canonicalHead"], headFrame0VsSource=head0, headFrame0PoseDiff=pose0, sourceFinalStep=src_final, transitionFirstStep=first, headToTailSeam=h2t,
                headToTailMode=verdict["mode"], headToTailVerdict=verdict, boundaryDecay=decay, maxSingleFrameStep=max(x[0] for x in st), maxStepAt=int(np.argmax([x[0] for x in st])), poseMaxStep=jumps, tailToDestinationSeam=seam_dest, destinationPoseJump=dest_jump,
            )
            per_head.append(row)
            if head0 > 1e-6 or pose0 > 1e-9:
                fail(f"{s['edge']} head {p}: frame 0 differs from the source loop phase (image {head0:.4f}, pose {pose0:.2e})")
            if verdict["mode"] == "FAIL":
                why = verdict["decay"] if isinstance(verdict.get("decay"), str) else ", ".join(verdict["decay"]["broken"])
                fail(f"{s['edge']} head {p}: head -> tail seam {h2t:.2f} exceeds {verdict['standardLimit']:.2f} and is not a continuous deceleration ({why})")
            if seam_dest > max(max(x[0] for x in tail_st), ordinary[s["to"]]) * 1.5:
                fail(f"{s['edge']} head {p}: tail -> {s['to']} seam {seam_dest:.2f} too large")

        report["transitions"][s["edge"]] = dict(
            label=s["label"], canonicalHead=s["canonicalHead"], ordinaryMaxStep=dict(source=ordinary[s["from"]], destination=ordinary[s["to"]]), tailFrozenFramesMax=g.longest_frozen(tail_st),
            tailStep=g.stats(tail_st), heads=per_head, canonical=next(r for r in per_head if r["canonical"]),
        )
        if g.longest_frozen(tail_st) >= g.MAX_HELD_FRAMES:
            fail(f"{s['edge']}: the tail holds {g.longest_frozen(tail_st)} frames without visible change")

    if pack:
        m = json.load(open(f"{pack}/manifest.json"))
        cw, ch, cols = m["cell"]["w"], m["cell"]["h"], m["cols"]
        x0, y0 = m["crop"]["x"], m["crop"]["y"]
        dec = {}
        for cid, c in m["clips"].items():
            src_f = load_dir(frames, c["dir"])
            errs, psn, n = [], [], 0
            for ch_ in c["chunks"]:
                atlas = np.array(Image.open(f"{pack}/{ch_['file']}").convert("RGBA"))
                for i in range(ch_["frames"]):
                    cell = atlas[(i // cols) * ch:(i // cols + 1) * ch, (i % cols) * cw:(i % cols + 1) * cw]
                    full = np.zeros_like(src_f[n])
                    full[y0:y0 + ch, x0:x0 + cw] = cell
                    a, b = g.comp(src_f[n])[0], g.comp(full)[0]
                    mse = float(((a - b) ** 2).mean())
                    psn.append(99 if mse == 0 else 10 * np.log10(255 ** 2 / mse))
                    errs.append(b - a)
                    n += 1
            flick = float(np.abs(np.diff(np.stack(errs), axis=0)).mean(axis=(0, 3)).mean()) if len(errs) > 1 else 0.0
            dec[cid] = dict(frames=n, psnrMean=float(np.mean(psn)), psnrMin=float(np.min(psn)), codecFlicker=flick, bytes=c["bytes"])
        report["decoded"] = dec
    report["failures"] = fails
    return report, fails


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True)
    ap.add_argument("--set", required=True)
    ap.add_argument("--pack")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rep, fl = run(a.frames, json.load(open(a.set, encoding="utf-8")), a.pack)
    json.dump(rep, open(a.out, "w"), indent=1)
    for lid, r in rep["loops"].items():
        print(f"loop {lid}: seam {r['seam']['mad']:.2f} (max step {r['step']['max']:.2f}, ratio {r['seamOverMaxStep']:.2f}) frozen {r['frozenFramesMax']} pingpong {r['pingPongScore']:.2f} blinks {r['blink']['count']} poseSeam {r['poseSeam']}")
    for eid, t in rep["transitions"].items():
        c = t["canonical"]
        print(f"{eid}: head -> tail modes " + ", ".join(f"{r['phase']}={r['headToTailMode']}" for r in t["heads"]))
        print(f"{eid}: canonical head {c['phase']} srcFinal {c['sourceFinalStep']:.2f} first {c['transitionFirstStep']:.2f} max {c['maxSingleFrameStep']:.2f}@{c['maxStepAt']} destSeam {c['tailToDestinationSeam']:.2f} (ordinary src/dst {t['ordinaryMaxStep']['source']:.2f}/{t['ordinaryMaxStep']['destination']:.2f})")
    if fl:
        print("\nGUARD FAILURES:\n  - " + "\n  - ".join(fl))
        sys.exit(1)
