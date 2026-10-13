"""Objective metrics + contact sheets for CURRENT / LIVE / MOTION V2. usage: python -I analyze_v2.py <frames-dir>
Metric functions are the SAME code as docs/coach-motion-audit/tools (lib_an.py + analyze.py), loaded unmodified, so numbers are comparable."""
import sys, os, json, glob
AUD = "D:/JULIO/apuherrerafoprojects/dota2coach-wt/landing-v2-integration/docs/coach-motion-audit/tools"
sys.path.insert(0, AUD)
from lib_an import *            # np, cv2, Image, ImageDraw, analyze_frame, diffs, track_pieces, FONT, HALF
_src = open(AUD + "/analyze.py", encoding="utf8").read()
exec(_src[_src.index("def segments"):_src.index("def save_raw")], globals())   # segments, rng, path, window_metrics, pick, sheet
FR = sys.argv[1]
V2 = "D:/JULIO/apuherrerafoprojects/dota2coach-wt/landing-v2-integration/docs/coach-motion-v2"
SRC = V2 + "/src-frames-384"
os.makedirs(V2 + "/raw", exist_ok=True)
PANELS = [("current", "current"), ("live", "live"), ("v2", "motion-v2")]


def frame_times(cap):
    f = cap["frames"]
    off = min(x["recv"] - x["ts"] * 1000 for x in f)
    return np.array([x["ts"] * 1000 + off for x in f]), off


def crops_for(dirp, n, rect):
    cx, cy = rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2
    x0, y0 = int(round(cx - HALF)), int(round(cy - HALF))
    out = []
    for i in range(n):
        im = cv2.imread(f"{dirp}/{i:04d}.png", cv2.IMREAD_COLOR)
        out.append(im[y0:y0 + 2 * HALF, x0:x0 + 2 * HALF].copy())
    return out


def build(crops, t):
    per = [analyze_frame(c) for c in crops]
    return dict(t=np.array(t), per=per, df=diffs(crops), pt=track_pieces(per))


def resampled30(res, crops, t0, t1):
    """nearest captured frame to every 33.33 ms tick of [t0, t1]: the same grid the atlas is authored on (apples-to-apples step statistics)"""
    ticks = np.arange(t0, t1 + 1e-6, 1000 / 30)
    idx = [int(np.argmin(np.abs(res["t"] - x))) for x in ticks]
    steps = [float(np.abs(crops[idx[i]].astype(np.int16) - crops[idx[i - 1]].astype(np.int16)).mean()) for i in range(1, len(idx))]
    exact = [bool(not (crops[idx[i]].astype(np.int16) - crops[idx[i - 1]].astype(np.int16)).any()) for i in range(1, len(idx))]
    ok = [res["per"][i] for i in idx if res["per"][i]]
    return dict(ticks=len(idx), distinct=1 + sum(1 for e in exact if not e), duplicate_pct=round(100 * sum(exact) / len(exact), 1), median_step_mad=round(float(np.median(steps)), 3),
                max_step_mad=round(max(steps), 3), sum_step_mad=round(sum(steps), 3), centroid_path_px=path([p["cx"] for p in ok], [p["cy"] for p in ok]),
                body_diameter_range_px=round(max(p["bdiam"] for p in ok) - min(p["bdiam"] for p in ok), 2))


OFFS_IDLE = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000]
OFFS_TR = [-100, 0, 100, 200, 300, 400, 500, 650, 800, 1000, 1250]
out = {}
idle = json.load(open(f"{FR}/cap-idle.json"))
tr = json.load(open(f"{FR}/cap-trans.json"))
ti, offi = frame_times(idle)
tt, offt = frame_times(tr)
out["capture"] = dict(meta=idle["meta"], idle_frames=len(ti), trans_frames=len(tt), idle_clock_offset_ms=round(offi, 1), trans_clock_offset_ms=round(offt, 1),
                      idle_capture_fps=round((len(ti) - 1) / ((ti[-1] - ti[0]) / 1000), 1), trans_capture_fps=round((len(tt) - 1) / ((tt[-1] - tt[0]) / 1000), 1))
T = {k: None for k, _ in PANELS}
for l in tr["log"]:
    if l.get("state") == "analyzing" and l["panel"] in T and T[l["panel"]] is None:
        T[l["panel"]] = l["t"]
out["transition_T_ms_after_click"] = {k: (None if v is None else v - tr["t_click"]) for k, v in T.items()}
t_idle0 = idle["t_click_done"] + 20
res_all = {}
for key, name in PANELS:
    K = {}
    # ---------------- idle: 2.0 s after the restart click
    icr = crops_for(f"{FR}/idle", len(ti), idle["rects"][key])
    ires = build(icr, ti)
    K["idle_2s"] = window_metrics(ires, icr, t_idle0, t_idle0 + 2000, idle["raf"])
    K["idle_2s_resampled_30fps"] = resampled30(ires, icr, t_idle0, t_idle0 + 2000 - 1000 / 30)
    picks = pick(ires, t_idle0, OFFS_IDLE)
    sheet(f"{V2}/{name}-idle.png", icr, picks, [f"{o}ms (f{i}, d{d:+.0f})" for (o, i, d) in picks], 5)
    d = f"{V2}/raw/{name}-idle"
    os.makedirs(d, exist_ok=True)
    for (o, i, dl) in picks:
        Image.fromarray(cv2.cvtColor(icr[i], cv2.COLOR_BGR2RGB)).save(f"{d}/crop_{o:+05d}ms_f{i:04d}.png")
    # ---------------- WATCHING -> ANALYZING
    tcr = crops_for(f"{FR}/trans", len(tt), tr["rects"][key])
    tres = build(tcr, tt)
    Tk = T[key]
    picks = pick(tres, Tk, OFFS_TR)
    sheet(f"{V2}/{name}-watch-analyze.png", tcr, picks, [f"{o:+d}ms (f{i}, d{dl:+.0f})" for (o, i, dl) in picks], 5)
    d = f"{V2}/raw/{name}-watch-analyze"
    os.makedirs(d, exist_ok=True)
    for (o, i, dl) in picks:
        Image.fromarray(cv2.cvtColor(tcr[i], cv2.COLOR_BGR2RGB)).save(f"{d}/crop_{o:+05d}ms_f{i:04d}.png")
    K["watch_analyze"] = dict(window_minus100_to_plus1000=window_metrics(tres, tcr, Tk - 100, Tk + 1000, tr["raf"]), window_0_to_plus500=window_metrics(tres, tcr, Tk, Tk + 500, tr["raf"]),
                              window_0_to_plus1300=window_metrics(tres, tcr, Tk, Tk + 1300, tr["raf"]),
                              picked=[dict(offset_ms=o, frame=i, actual_delta_ms=round(dl, 1)) for (o, i, dl) in picks])
    K["watch_analyze"]["resampled_30fps_0_to_1300"] = resampled30(tres, tcr, Tk, Tk + 1300 - 1000 / 30)
    pre = [tres["df"][i]["mad"] for i in range(len(tres["t"])) if Tk - 600 <= tres["t"][i] < Tk and tres["df"][i]]
    thr = max(0.05, 3 * float(np.percentile(pre, 95))) if pre else 0.05
    on = next((float(tres["t"][i] - Tk) for i in range(len(tres["t"])) if tres["t"][i] >= Tk and tres["df"][i] and tres["df"][i]["mad"] > thr), None)
    K["watch_analyze"]["first_visible_change_ms_after_T"] = None if on is None else round(on, 1)
    K["watch_analyze"]["onset_threshold_mad"] = round(thr, 3)
    # time for the crop to cover 90 % of its travel between the -100 ms frame and the +1000 ms frame (the audit's progress definition)
    idx = [i for i in range(len(tres["t"])) if Tk - 100 <= tres["t"][i] <= Tk + 1000]
    a, b = tcr[idx[0]].astype(np.int16), tcr[idx[-1]].astype(np.int16)
    prog = []
    for i in idx:
        ds = float(np.abs(tcr[i].astype(np.int16) - a).mean())
        de = float(np.abs(tcr[i].astype(np.int16) - b).mean())
        prog.append(ds / (ds + de) if ds + de else 0)
    t90 = next((float(tres["t"][i] - Tk) for i, pr in zip(idx, prog) if pr >= 0.9), None)
    K["watch_analyze"]["time_to_90pct_travel_ms_after_T"] = None if t90 is None else round(t90, 1)
    res_all[key] = K
out["on_screen"] = res_all

# ---------------- source-frame metrics for MOTION V2 (the atlas content itself, 30 fps as authored)
bg = np.array(cv2.imread(f"{FR}/idle/0000.png")[5, 5], dtype=np.float32)   # page background (BGR), sampled from a captured frame


def comp(path, scale=243 / 384):
    im = Image.open(path).convert("RGBA")
    s = int(round(384 * scale))
    im = im.resize((s, s), Image.LANCZOS)
    base = Image.new("RGBA", (2 * HALF, 2 * HALF), tuple(int(v) for v in (bg[2], bg[1], bg[0])) + (255,))
    base.alpha_composite(im, ((2 * HALF - s) // 2, (2 * HALF - s) // 2))
    return cv2.cvtColor(np.array(base.convert("RGB")), cv2.COLOR_RGB2BGR)


srcm = {}
src = {}
for c in ("WATCHING_IDLE", "WATCHING_TO_ANALYZING", "_IDLE_EXTRA"):
    src[c] = [comp(f) for f in sorted(glob.glob(f"{SRC}/{c}/f*.png"))]
for c, cr in src.items():
    if c == "_IDLE_EXTRA":
        continue
    res = build(cr, [i * 1000 / 30 for i in range(len(cr))])
    m = window_metrics(res, cr, 0, 1e9, [])
    steps = [float(np.abs(cr[i].astype(np.int16) - cr[i - 1].astype(np.int16)).mean()) for i in range(1, len(cr))]
    m["authored_fps"] = 30
    m["clip_duration_ms"] = round(len(cr) * 1000 / 30, 1)
    m["frames"] = len(cr)
    m["median_step_mad"] = round(float(np.median(steps)), 3)
    srcm[c] = m
    if c == "WATCHING_TO_ANALYZING":
        base_step = srcm["WATCHING_IDLE"]["median_step_mad"]
        m["first_visible_change_ms"] = next((round(i * 1000 / 30, 1) for i, s in enumerate(steps, 1) if s > max(0.05, 3 * base_step)), None)
        m["step_mad_series"] = [round(s, 3) for s in steps]
# loop seam and idle->transition pop (source frames)
idle_f, tr_f, extra = src["WATCHING_IDLE"], src["WATCHING_TO_ANALYZING"], src["_IDLE_EXTRA"][0]


def mad(a, b):
    return round(float(np.abs(a.astype(np.int16) - b.astype(np.int16)).mean()), 3)


pa = [analyze_frame(f) for f in idle_f]
pe = analyze_frame(extra)
p0 = analyze_frame(tr_f[0])


def cen(p):
    return (p["cx"], p["cy"])


def dist(a, b):
    return round(float(np.hypot(a[0] - b[0], a[1] - b[1])), 2)


steps_idle = [mad(idle_f[i], idle_f[i - 1]) for i in range(1, len(idle_f))]
pops = [mad(f, tr_f[0]) for f in idle_f]
out["seams"] = dict(
    idle_median_step_mad=round(float(np.median(steps_idle)), 3), idle_max_step_mad=max(steps_idle),
    idle_wrap_seam_mad_frame59_to_frame0=mad(idle_f[-1], idle_f[0]), idle_natural_next_step_mad_frame59_to_clock_continuation=mad(idle_f[-1], extra),
    idle_wrap_seam_vs_median_step_ratio=round(mad(idle_f[-1], idle_f[0]) / float(np.median(steps_idle)), 1),
    idle_pingpong_turn_step_mad=mad(idle_f[-1], idle_f[-2]),
    idle_end_to_transition_frame0_mad=mad(extra, tr_f[0]),
    idle_k_to_transition_frame0_mad=dict(max=max(pops), mean=round(float(np.mean(pops)), 3), at_frame59=pops[-1], at_frame0=pops[0]),
    centroid_pop_px_if_transition_fires_at_idle_frame=dict(max=max(dist(cen(p), cen(p0)) for p in pa if p), at_frame59=dist(cen(pa[-1]), cen(p0)), natural_continuation=dist(cen(pe), cen(p0))),
    idle_wrap_centroid_jump_px=dist(cen(pa[-1]), cen(pa[0])))
out["source_frames_motion_v2"] = srcm
json.dump(out, open(f"{V2}/frame-metrics.json", "w"), indent=1, default=float)
print("done")
