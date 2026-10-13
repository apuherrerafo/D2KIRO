"""Part A: objective quality of the A / B / C candidates against LIVE, as the browser displays them.
usage: python -I analyze_fmt.py
Candidate frames come from the lab's own paintFrame at the Hero coach canvas size (276 px = DPR 1, 552 px = DPR 2); LIVE frames are the same stage
rendered natively at that size at the same times. L30 / L24 (lossless atlas through the same pipeline) isolate codec loss from resolution loss."""
import sys, json, numpy as np, cv2
sys.path.insert(0, __file__.replace("\\", "/").rsplit("/", 1)[0])
from lib_p2 import *

PACKS = ["A", "B", "C", "X", "Y", "webp", "L30", "L24"]
FPS = {"B": 24, "L24": 24}
CLIPS = {"idle": "idle", "trans": "trans"}


VSL = "--vsl" in sys.argv   # codec-only: reference = the lossless atlas through the same browser pipeline (same resolution, same fps)


def ref_dir(pack, side, clip):
    if VSL:
        return f"{S}/ev/{'L24' if FPS.get(pack, 30) == 24 else 'L30'}/{side}/{clip}"
    return f"{S}/refd{1 if side == 276 else 2}{'b' if FPS.get(pack, 30) == 24 else ''}/{clip}"


def src_dir(pack, clip):
    return f"{S}/src{FPS.get(pack, 30)}/{clip}"


seg_cache = {}


def segs(pack, clip, side):
    k = (FPS.get(pack, 30), clip, side)
    if k not in seg_cache:
        seg_cache[k] = [{n: to_side(m, side) for n, m in segment(f).items()} for f in load(src_dir(pack, clip))]
    return seg_cache[k]


def agg(xs, how="mean"):
    xs = [x for x in xs if x is not None and np.isfinite(x)]
    if not xs:
        return None
    return round(float({"mean": np.mean, "min": np.min, "max": np.max, "p95": lambda v: np.percentile(v, 95)}[how](xs)), 4)


def frame_pair(c, r, sg, bgname):
    bg = BG[bgname]
    C, R = comp(c, bg), comp(r, bg)
    lc, lr = luma(C), luma(R)
    sup = dil((c[..., 3] > 0) | (r[..., 3] > 0), 3)
    mse = float(((C - R) ** 2).mean(axis=2)[sup].mean())
    out = dict(mse=mse, psnr=psnr(mse), ssim=ssim(lc, lr, sup))
    # displayed sharpness: gradient energy / laplacian variance inside the coach, candidate over LIVE
    inner = dil(r[..., 3] > 8, 2)
    gr, gc = grad(lr)[inner].mean(), grad(lc)[inner].mean()
    out["sharp_grad"] = float(gc / gr)
    lv_r, lv_c = lapvar(lr, inner), lapvar(lc, inner)
    out["sharp_lap"] = float(lv_c / lv_r) if lv_r > 0 else None
    # alpha edge quality
    ar, ac = r[..., 3].astype(np.float32), c[..., 3].astype(np.float32)
    band = dil(((ar >= 8) & (ar <= 247)) | ((ac >= 8) & (ac <= 247)), 1)
    d = np.abs(ac - ar)
    out["alpha_edge_mae"] = float(d[band].mean()) if band.any() else 0.0
    out["alpha_halo_pct"] = float((d[band] > 32).mean() * 100) if band.any() else 0.0
    out["edge_luma_bias"] = float((lc - lr)[band].mean()) if band.any() else 0.0     # signed: <0 = dark fringe, >0 = light halo
    out["edge_luma_abs"] = float(np.abs(lc - lr)[band].mean()) if band.any() else 0.0
    # visor + eyes
    vb = dil(sg["visor_box"], 1)
    if vb.any():
        out["visor_psnr"] = psnr(float(((C - R) ** 2).mean(axis=2)[vb].mean()))
        out["visor_ssim"] = ssim(lc, lr, vb)
        out["visor_sharp"] = float(grad(lc)[vb].mean() / grad(lr)[vb].mean())
    if sg["eyes"].any():
        out["eye_peak_ratio"] = float(lc[sg["eyes"]].max() / max(lr[sg["eyes"]].max(), 1e-3))
        out["eye_area_ratio"] = float((lc[dil(sg["eyes"], 1)] > 200).sum() / max((lr[dil(sg["eyes"], 1)] > 200).sum(), 1))
    # floating pieces (the ring): readability = region fidelity + sharpness + piece count / smallest piece kept
    pm = dil(sg["pieces"], 2)
    if pm.any():
        out["pieces_psnr"] = psnr(float(((C - R) ** 2).mean(axis=2)[pm].mean()))
        out["pieces_ssim"] = ssim(lc, lr, pm)
        out["pieces_sharp"] = float(grad(lc)[pm].mean() / grad(lr)[pm].mean())
        side = r.shape[0]
        minA = max(6, int(14 * (side / 340) ** 2))
        pr, pc = piece_stats(r[..., 3], sg["body"], minA), piece_stats(c[..., 3], sg["body"], minA)
        out["pieces_count_ref"], out["pieces_count_cand"] = len(pr), len(pc)
        if pr and pc:
            out["pieces_area_ratio"] = float(sum(p[2] for p in pc) / sum(p[2] for p in pr))
    return out, lc, lr, sup


def run_pair(pack, side, clip):
    cand = load(f"{S}/ev/{pack}/{side}/{clip}")
    ref = load(ref_dir(pack, side, clip))
    assert len(cand) == len(ref), (pack, side, clip, len(cand), len(ref))
    sg = segs(pack, clip, side)
    res = {}
    for bgname in ("dark", "light"):
        per, LC, LR, SUP = [], [], [], []
        for i in range(len(cand)):
            m, lc, lr, sup = frame_pair(cand[i], ref[i], sg[i], bgname)
            per.append(m)
            LC.append(lc)
            LR.append(lr)
            SUP.append(sup)
        keys = sorted({k for m in per for k in m})
        r = {k: agg([m.get(k) for m in per]) for k in keys}
        r["psnr_min"] = agg([m["psnr"] for m in per], "min")
        r["ssim_min"] = agg([m["ssim"] for m in per], "min")
        r["alpha_edge_mae_p95"] = agg([m["alpha_edge_mae"] for m in per], "p95")
        r["alpha_halo_pct_max"] = agg([m["alpha_halo_pct"] for m in per], "max")
        # temporal behaviour: how much of the frame-to-frame change is the codec, and shimmer where LIVE is static
        resid, motion, shimmer, moving_psnr, moving_resid = [], [], [], [], []
        mses = [m["mse"] for m in per]
        for i in range(1, len(cand)):
            dr, dc = LR[i] - LR[i - 1], LC[i] - LC[i - 1]
            sup = SUP[i] & SUP[i - 1]
            resid.append(float(np.abs(dc - dr)[sup].mean()))
            motion.append(float(np.abs(dr)[sup].mean()))
            static = sup & (np.abs(dr) < 0.75)
            shimmer.append(float(np.abs(dc)[static].mean()) if static.any() else None)
            mv = sup & (np.abs(dr) > 4)
            if mv.sum() > 50:
                moving_resid.append(float(np.abs(dc - dr)[mv].mean()))
                C, R = comp(cand[i], BG[bgname]), comp(ref[i], BG[bgname])
                moving_psnr.append(psnr(float(((C - R) ** 2).mean(axis=2)[mv].mean())))
        r["temporal_residual"] = agg(resid)
        r["ref_motion"] = agg(motion)
        r["temporal_residual_over_motion"] = round(r["temporal_residual"] / max(r["ref_motion"], 1e-6), 3)
        r["static_shimmer"] = agg(shimmer)
        r["moving_region_psnr"] = agg(moving_psnr)
        r["moving_region_residual"] = agg(moving_resid)
        r["error_pumping_cov"] = round(float(np.std(mses) / max(np.mean(mses), 1e-9)), 3)       # frame-to-frame swing of the codec error
        r["frames"] = len(cand)
        res[bgname] = r
    return res


if __name__ == "__main__":
    results = {}
    for pack in (["A", "B", "C", "X", "Y", "webp"] if VSL else PACKS):
        results[pack] = {}
        for side in (276, 552):
            results[pack][str(side)] = {}
            for clip in ("idle", "trans"):
                results[pack][str(side)][clip] = run_pair(pack, side, clip)
                print(pack, side, clip, "ssim", results[pack][str(side)][clip]["dark"]["ssim"], "psnr", round(results[pack][str(side)][clip]["dark"]["psnr"], 2), flush=True)
    json.dump(results, open(f"{OUT}/format-metrics-codec-only.json" if VSL else f"{OUT}/format-metrics.json", "w"), indent=1)
