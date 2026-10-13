"""phase-entry-{0,50,80}.png + on-screen boundary metrics from the entry lab (real player, DPR 1 canvas, 276 px).
usage: python -I compose_entry.py
Each row = one strategy: previous idle frame | first frame of the next clip | amplified |difference| . The bridge row is built from the lossless source frames."""
import json, sys, numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, __file__.replace("\\", "/").rsplit("/", 1)[0])
from lib_p2 import S, OUT, BG, load, comp, luma

FONT = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 17)
BIG = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 20)
meta = json.load(open(f"{S}/entry/A/meta.json"))
cont = json.load(open(f"{OUT}/continuity-metrics.json"))
BGD = BG["dark"]
STRATS = [("canonical", "CANONICAL (first prototype)"), ("nearest", "NEAREST entry head, stride 6"), ("wait", "WAIT for entry head, stride 6"), ("bridge", "B · pose bridge (6 frames)")]


def crop(im):      # the coach lives in the middle of the 276 px canvas
    return im[10:266, 10:266]


def centroid(rgba):
    a = rgba[..., 3].astype(np.float32) / 255
    ys, xs = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    return float((a * xs).sum() / a.sum()), float((a * ys).sum() / a.sum())


def onscreen(pct, strat):
    r = meta["runs"][f"{strat}-{pct}"]
    fs = load(f"{S}/entry/A/{strat}-{pct}")
    b = r["boundary"]
    prev, first = fs[b - 1], fs[b]
    C0, C1 = comp(prev, BGD), comp(first, BGD)
    cx0, cy0 = centroid(prev)
    cx1, cy1 = centroid(first)
    ts = [f["t"] for f in r["frames"]]
    gaps = [round(ts[i + 1] - ts[i], 1) for i in range(len(ts) - 1)]
    nat = [float(np.abs(comp(fs[i], BGD) - comp(fs[i - 1], BGD)).mean()) for i in range(1, b)]
    return prev, first, C0, C1, dict(
        clips_around_boundary=[f"{f['clip']}:{f['frame']}" for f in r["frames"][max(0, b - 2):b + 3]], plan=r["plan"], shown=r["shown"],
        mad_prev_to_first=round(float(np.abs(C0 - C1).mean()), 3), centroid_jump_px=round(float(np.hypot(cx0 - cx1, cy0 - cy1)), 3),
        natural_idle_step_mad_same_run=round(float(np.mean(nat)), 3) if nat else None,
        frame_gap_ms_max=max(gaps[: b + 3]) if gaps else None, frame_gap_ms_at_boundary=gaps[b - 1] if b - 1 < len(gaps) else None)


def heat(a, b):
    d = np.abs(luma(a) - luma(b))
    v = np.clip(d * 12, 0, 255).astype(np.uint8)       # x12 amplification: 21 luma levels saturate
    out = np.zeros(v.shape + (3,), np.uint8)
    out[..., 0] = v
    out[..., 1] = (v * 0.55).astype(np.uint8)
    return out


results = {}
for pct, frame in (("0", 0), ("50", 30), ("80", 48)):
    rows = []
    for strat, title in STRATS:
        if strat == "bridge":
            seq = load(f"{S}/src30/idle")
            br = load(f"{S}/bridge{frame:02d}")
            sm = lambda x: np.array(Image.fromarray(x, "RGBA").resize((276, 276), Image.LANCZOS))
            prev, first = sm(seq[frame]), sm(br[1])
            C0, C1 = comp(prev, BGD), comp(first, BGD)
            m = dict(mad_prev_to_first=round(float(np.abs(C0 - C1).mean()), 3), note="source frames (not played through the lab); latency +200 ms, max per-frame step %.2f MAD" % cont["bridge"][f"phase_{frame}"]["max_step_mad"])
        else:
            prev, first, C0, C1, m = onscreen(pct, strat)
        results[f"{strat}-{pct}"] = m
        rows.append((title, C0, C1, heat(C0, C1), m))
    W, H = 3 * 256 + 4 * 12, len(rows) * (256 + 44) + 40
    out = Image.new("RGB", (W, H), (20, 18, 16))
    d = ImageDraw.Draw(out)
    d.text((12, 8), f"Idle phase {pct}% (frame {frame}): previous idle | first next-clip frame | diff x12", fill=(235, 235, 235), font=BIG)
    y = 40
    for title, C0, C1, hm, m in rows:
        extra = "" if "plan" not in m else f" · entry phase {m['plan']['phase']}, wait {m['plan']['wait']} fr"
        d.text((12, y), f"{title}{extra} · MAD {m['mad_prev_to_first']}" + (f" · centroid {m['centroid_jump_px']} px" if "centroid_jump_px" in m else ""), fill=(255, 210, 90), font=FONT)
        for i, im in enumerate((C0, C1, hm)):
            a = np.clip(im, 0, 255).astype(np.uint8)
            out.paste(Image.fromarray(crop(a)), (12 + i * (256 + 12), y + 24))
        y += 256 + 44
    out.save(f"{OUT}/phase-entry-{pct}.png", optimize=True)
    print(pct, out.size)
cont["on_screen_lab_boundaries"] = results
cont["loader_model_lab"] = meta["memory"]
json.dump(cont, open(f"{OUT}/continuity-metrics.json", "w"), indent=1, default=float)
for k, v in results.items():
    print(k, {a: b for a, b in v.items() if a != "clips_around_boundary"})
