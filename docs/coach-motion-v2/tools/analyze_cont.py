"""Part B: idle -> transition boundary continuity, on the lossless Gold Master source frames (what the packs are cut from), at the Hero display scale.
usage: python -I analyze_cont.py
Boundary = previous displayed idle frame -> first frame of the next clip. Metrics: composite MAD, silhouette centroid jump, visor offset jump (+ eye offset),
floating-piece (ring) jump. All in display px of a 243 px coach (276 css px slot x 0.88 watching scale), the same scale and analysis code as the earlier audit."""
import sys, json, glob, numpy as np, cv2
sys.path.insert(0, "D:/JULIO/apuherrerafoprojects/dota2coach-wt/landing-v2-integration/docs/coach-motion-audit/tools")
sys.path.insert(0, __file__.replace("\\", "/").rsplit("/", 1)[0])
from lib_an import analyze_frame, HALF
from lib_p2 import S, OUT, load, BG
from PIL import Image

SCALE = 243 / 384
BGC = tuple(int(v) for v in BG["dark"])


def disp(rgba):
    """384 px RGBA source -> 340 px BGR crop with the coach at display scale on the dark stage background (same recipe as analyze_v2.py)"""
    im = Image.fromarray(rgba, "RGBA").resize((int(round(384 * SCALE)),) * 2, Image.LANCZOS)
    base = Image.new("RGBA", (2 * HALF, 2 * HALF), BGC + (255,))
    off = (2 * HALF - im.size[0]) // 2
    base.alpha_composite(im, (off, off))
    return cv2.cvtColor(np.array(base.convert("RGB")), cv2.COLOR_RGB2BGR)


class Frames:
    """lazy per-frame image + descriptor cache"""
    def __init__(self, rgba):
        self.rgba, self.img, self.desc = rgba, {}, {}

    def im(self, i):
        if i not in self.img:
            self.img[i] = disp(self.rgba[i])
        return self.img[i]

    def d(self, i):
        if i not in self.desc:
            self.desc[i] = analyze_frame(self.im(i))
        return self.desc[i]


def pair(fa, i, fb, j):
    """jump metrics between frame i of `fa` and frame j of `fb`"""
    a, b = fa.d(i), fb.d(j)
    mad = float(np.abs(fa.im(i).astype(np.int16) - fb.im(j).astype(np.int16)).mean())
    out = dict(mad=mad, centroid_px=float(np.hypot(a["cx"] - b["cx"], a["cy"] - b["cy"])))
    if a["visor"] and b["visor"]:
        out["visor_px"] = float(np.hypot(a["visor"]["dx"] - b["visor"]["dx"], a["visor"]["dy"] - b["visor"]["dy"]))
        if a["visor"]["eye_dx"] is not None and b["visor"]["eye_dx"] is not None:
            out["eye_px"] = float(np.hypot(a["visor"]["eye_dx"] - b["visor"]["eye_dx"], (a["visor"]["eye_dy"] or 0) - (b["visor"]["eye_dy"] or 0)))
    # ring: greedy nearest-neighbour match of the floating pieces, mean displacement, plus the shift of the group centroid
    used, disp_ = set(), []
    for (x, y, _) in a["pieces"]:
        best = None
        for k, (x2, y2, _) in enumerate(b["pieces"]):
            if k in used:
                continue
            dd = np.hypot(x2 - x, y2 - y)
            if dd < 30 and (best is None or dd < best[0]):
                best = (dd, k)
        if best:
            used.add(best[1])
            disp_.append(best[0])
    out["ring_px"] = float(np.mean(disp_)) if disp_ else None
    if a["pcx"] is not None and b["pcx"] is not None:
        out["ring_centroid_px"] = float(np.hypot(a["pcx"] - b["pcx"], a["pcy"] - b["pcy"]))
    return out


def stats(rows, key):
    v = [r[key] for r in rows if r.get(key) is not None]
    return None if not v else dict(mean=round(float(np.mean(v)), 3), p95=round(float(np.percentile(v, 95)), 3), max=round(float(np.max(v)), 3))


KEYS = ["mad", "centroid_px", "visor_px", "eye_px", "ring_px", "ring_centroid_px"]


def summarize(rows):
    return {k: stats(rows, k) for k in KEYS}


if __name__ == "__main__":
    idle = Frames(load(f"{S}/src30/idle"))
    canon = Frames(load(f"{S}/src30/trans"))
    # one list: idle frames 0..59 then the canonical transition (its frame 0 is idle phase 60)
    seq = Frames(load(f"{S}/src30/idle") + load(f"{S}/src30/trans"))
    N = 60
    idle_at = lambda p: (seq, p)               # idle phase p (0..60; 60 = canonical frame 0)
    out = {"note": "display px of a 243 px coach; boundary = previous displayed idle frame -> first frame of the next clip"}

    # ---- noise floor: the natural step of the idle itself
    nat = [pair(seq, i, seq, i + 1) for i in range(N - 1)]
    out["natural_idle_step"] = summarize(nat)
    out["natural_idle_step_pingpong_turn"] = pair(seq, N - 1, seq, N - 2)
    out["idle_wrap_seam_frame59_to_frame0"] = pair(seq, N - 1, seq, 0)

    # ---- the cue itself (Live-faithful, same for every strategy): first steps of the canonical transition
    out["cue_step_canonical_frames_0_to_6"] = [round(pair(seq, N + i, seq, N + i + 1)["mad"], 2) for i in range(6)]

    # ---- the three requested entry phases, all strategies
    def boundary(strategy, d, stride, dir_=1):
        nxt = min(N, max(0, d + dir_))
        phases = list(range(0, N, stride)) + [N]
        if strategy == "canonical":
            p, wait = N, 0
        elif strategy == "nearest":
            p, wait = min(phases, key=lambda q: (abs(q - nxt), -q)), 0
        elif strategy == "wait":
            if dir_ == 1:
                p = next((q for q in phases if q >= nxt), N)
                wait = p - nxt
            else:
                p = next((q for q in reversed(phases) if q <= nxt), 0)
                wait = nxt - p
        # the screen shows idle frames until the switch, then the entry's first frame = idle pose of phase p
        last_idle = d + dir_ * wait
        return dict(strategy=strategy, shown=d, entry_phase=p, wait_frames=wait, latency_ms=round(wait * 1000 / 30, 1), **pair(seq, min(max(last_idle, 0), N - 1), seq, p))

    phases_test = {"phase_0": 0, "phase_50": 30, "phase_80": 48}
    out["entry_tests"] = {}
    for name, d in phases_test.items():
        rows = {"canonical": boundary("canonical", d, 6), "nearest_stride6": boundary("nearest", d, 6), "wait_stride6": boundary("wait", d, 6),
                "nearest_stride12": boundary("nearest", d, 12), "wait_stride12": boundary("wait", d, 12)}
        # an off-grid phase next to each requested one (the grid points above are the best case for an entry grid)
        off = d + 3
        rows["off_grid_%d_nearest_stride6" % off] = boundary("nearest", off, 6)
        rows["off_grid_%d_wait_stride6" % off] = boundary("wait", off, 6)
        out["entry_tests"][name] = dict(idle_frame=d, results=rows)

    # ---- B: pose-space bridge (real renders of interpolated poses), 6 frames, then the canonical transition from its frame 0
    out["bridge"] = {}
    for k in (0, 30, 48):
        br = Frames(load(f"{S}/bridge{k:02d}"))      # frame 0 = idle(k), frames 1..6 -> canonical start
        steps = [pair(br, i, br, i + 1) for i in range(6)]
        out["bridge"][f"phase_{k}"] = dict(
            boundary_idle_to_bridge1=pair(seq, k, br, 1), step_mad_series=[round(s["mad"], 2) for s in steps], max_step_mad=round(max(s["mad"] for s in steps), 2),
            max_ring_step_px=round(max((s["ring_px"] or 0) for s in steps), 2), max_centroid_step_px=round(max(s["centroid_px"] for s in steps), 2),
            bridge_end_vs_canonical_frame0=pair(br, 6, seq, N), latency_ms=round(6 * 1000 / 30, 1))

    # ---- all-phase sweep: both travel directions, strategies and strides
    sweep = {}
    for strategy, strides in (("canonical", [6]), ("nearest", [4, 6, 10, 12, 15, 20, 30]), ("wait", [4, 6, 10, 12, 15, 20, 30])):
        for stride in strides:
            rows = [boundary(strategy, d, stride, dr) for d in range(0, N) for dr in (1, -1) if 0 <= d + dr <= N]
            sweep[f"{strategy}_stride{stride}" if strategy != "canonical" else "canonical"] = dict(
                heads=(len(range(0, N, stride)) + 1) if strategy != "canonical" else 0, n=len(rows), **summarize(rows),
                wait_frames_mean=round(float(np.mean([r["wait_frames"] for r in rows])), 2), wait_frames_max=max(r["wait_frames"] for r in rows), latency_ms_max=max(r["latency_ms"] for r in rows))
            print(strategy, stride, sweep[list(sweep)[-1]]["mad"], flush=True)
    out["sweep_all_idle_phases"] = sweep

    # ---- head -> canonical tail splice (rebased heads vs the canonical transition), and the exit mismatch of un-rebased full variants
    hv = {j: Frames(load(f"{S}/hvar{j:02d}")) for j in range(0, 60, 6)}
    vv = {j: Frames(load(f"{S}/var{j:02d}")) for j in range(0, 60, 6)}
    splice = {}
    for M in (1, 2, 3, 4, 6, 8):
        rows = [pair(hv[j], M, canon, M) for j in hv]
        splice[f"M{M}"] = dict(mad=stats(rows, "mad"), centroid_px=stats(rows, "centroid_px"), ring_px=stats(rows, "ring_px"), canonical_step_mad_at_M=round(pair(canon, M, canon, M + 1)["mad"], 2))
    out["head_splice_error_vs_canonical"] = splice
    out["exit_mismatch_last_frame_vs_canonical"] = dict(
        rebased_heads=stats([pair(hv[j], 38, canon, 38) for j in hv], "mad"), full_variants_not_rebased=stats([pair(vv[j], 38, canon, 38) for j in vv], "mad"),
        full_variants_not_rebased_ring_px=stats([pair(vv[j], 38, canon, 38) for j in vv], "ring_px"))
    json.dump(out, open(f"{OUT}/continuity-metrics.json", "w"), indent=1, default=float)
    print("done")
