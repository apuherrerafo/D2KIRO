"""24 vs 30 fps against Live, temporal part only (lossless source frames, so codec noise is excluded).
usage: python -I analyze_fps.py
Simulates a 60 Hz display driven by the player's deterministic clock: at vblank k (t = k/60 s) the screen shows clip frame floor(t * fps) and the truth is Live at t
(captured at 60 fps from the same stage). Errors are in display px of a 243 px coach and as composite MAD."""
import sys, json, numpy as np
sys.path.insert(0, __file__.replace("\\", "/").rsplit("/", 1)[0])
from analyze_cont import Frames, pair
from lib_p2 import S, OUT, load

truth = {"idle": Frames(load(f"{S}/ref60/idle")), "trans": Frames(load(f"{S}/ref60/trans"))}
clips = {30: {"idle": Frames(load(f"{S}/src30/idle")), "trans": Frames(load(f"{S}/src30/trans"))}, 24: {"idle": Frames(load(f"{S}/src24/idle")), "trans": Frames(load(f"{S}/src24/trans"))},
         60: truth}
FPS_N = {30: {"idle": 60, "trans": 39}, 24: {"idle": 48, "trans": 31}, 60: {"idle": 120, "trans": 78}}


def sim(fps, kind, t0=0.0, t1=None):
    n = FPS_N[fps][kind]
    dur = n / fps if kind == "idle" else (n - 1) / fps
    t1 = dur if t1 is None else t1
    rows, shown, holds, last, run = [], [], [], None, 0
    for k in range(int(round(t0 * 60)), int(round(t1 * 60))):
        t = k / 60
        f = min(int(np.floor(t * fps + 1e-9)), n - 1)
        tr = min(int(round(t * 60)), FPS_N[60][kind] - 1)
        rows.append(pair(clips[fps][kind], f, truth[kind], tr))
        shown.append(f)
        if f != last:
            if last is not None:
                holds.append(run)
            run, last = 1, f
        else:
            run += 1
    return rows, holds


def agg(rows, key):
    v = [r[key] for r in rows if r.get(key) is not None]
    return dict(mean=round(float(np.mean(v)), 3), p95=round(float(np.percentile(v, 95)), 3), max=round(float(np.max(v)), 3)) if v else None


out = {"display": "60 Hz sample-and-hold, error vs Live at the same instant; px = display px of a 243 px coach"}
for fps in (30, 24):
    out[f"{fps}fps"] = {}
    for label, kind, a, b in (("idle_2s", "idle", 0.0, None), ("transition_0_to_0.33s_fast_part", "trans", 0.0, 0.333), ("transition_0.33_to_1.25s", "trans", 0.333, 1.25), ("transition_full", "trans", 0.0, 1.25)):
        rows, holds = sim(fps, kind, a, b)
        out[f"{fps}fps"][label] = dict(mad=agg(rows, "mad"), centroid_px=agg(rows, "centroid_px"), ring_group_centroid_px=agg(rows, "ring_centroid_px"), visor_px=agg(rows, "visor_px"), eye_px=agg(rows, "eye_px"),
                                       hold_vblanks_pattern=sorted(set(holds)))
# speed of the thing being sampled: how far Live itself moves per 60 Hz vblank (the quantity that sample-and-hold turns into error)
steps = [pair(truth["trans"], i, truth["trans"], i + 1) for i in range(0, 20)]
out["live_motion_per_vblank_first_20_vblanks_transition"] = dict(mad=[round(s["mad"], 2) for s in steps], ring_centroid_px=[round(s["ring_centroid_px"] or 0, 2) for s in steps], centroid_px=[round(s["centroid_px"], 2) for s in steps])
idle_steps = [pair(truth["idle"], i, truth["idle"], i + 1) for i in range(0, 118)]
out["live_motion_per_vblank_idle"] = dict(mad=agg(idle_steps, "mad"), centroid_px=agg(idle_steps, "centroid_px"), ring_px=agg(idle_steps, "ring_px"))
json.dump(out, open(f"{OUT}/fps-temporal-fidelity.json", "w"), indent=1, default=float)
for k in ("30fps", "24fps"):
    for lab, v in out[k].items():
        print(k, lab, "mad", v["mad"], "centroid", v["centroid_px"], "ringC", v["ring_group_centroid_px"], "holds", v["hold_vblanks_pattern"])
