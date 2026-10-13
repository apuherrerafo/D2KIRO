"""Production-format packs for the Coach Motion V2 study.
usage: python -I pack2.py <p2 frames dir> <public out root> [--ablate]
Builds three candidates from the SAME Gold Master source frames (no re-pose, no re-light, no colour change):
  A  384 px  30 fps  AVIF q45        B  384 px  24 fps  AVIF q30        C  256 px  30 fps  AVIF q40
Every candidate holds WATCHING_IDLE + WATCHING_TO_ANALYZING (+ the phase-entry heads/tail for the 30 fps ones).
One shared crop box (union alpha bbox of every captured frame, pad 2) so all clips of all packs draw at the same place/scale.
Encoder pre-pass (visible pixels untouched): RGB of fully transparent pixels is bled from the nearest visible colour, so chroma
subsampling / DCT blocks do not drag the black the WebGL read-back leaves under alpha 0 into the silhouette edge."""
import sys, os, json, glob, math, io, time, numpy as np, cv2
from PIL import Image

P2, OUT = sys.argv[1], sys.argv[2]
ABLATE = "--ablate" in sys.argv
SRC_PX, PAD = 384, 2
ENTRY_STRIDE, HEAD_FRAMES = 6, 4      # entry heads at idle phases 0,6,..,54,60 ; frames 0..4 of the rebased transition (frame 0 = the pure idle pose of that phase); splice error vs the canonical tail <= 0.6 MAD
FORMATS = {
    "A": dict(px=384, fps=30, q=45, src="src30"),
    "B": dict(px=384, fps=24, q=30, src="src24"),
    "C": dict(px=256, fps=30, q=40, src="src30"),
    # encoder-flag ablations of A (measured, not proposed as candidates): X = 4:4:4 chroma at q40, Y = A without the alpha-0 colour bleed
    "X": dict(px=384, fps=30, q=40, src="src30", sub="4:4:4", ablation=True),
    "Y": dict(px=384, fps=30, q=45, src="src30", bleed=False, ablation=True),
    # lossless references through the same browser pipeline: candidate-vs-L isolates codec loss from resolution loss
    "L30": dict(px=384, fps=30, q=100, src="src30", bleed=False, ablation=True, lossless=True),
    "L24": dict(px=384, fps=24, q=100, src="src24", bleed=False, ablation=True, lossless=True),
}


def frames(d):
    return sorted(glob.glob(f"{P2}/{d}/f*.png"))


def union_box():
    u = None
    dirs = ["src30/idle", "src30/trans", "src24/idle", "src24/trans"] + [os.path.relpath(p, P2).replace("\\", "/") for p in sorted(glob.glob(f"{P2}/hvar*"))]
    for d in dirs:
        for f in frames(d):
            m = np.array(Image.open(f).convert("RGBA"))[..., 3] > 8
            u = m if u is None else (u | m)
    ys, xs = np.nonzero(u)
    return max(0, xs.min() - PAD), max(0, ys.min() - PAD), min(SRC_PX, xs.max() + 1 + PAD), min(SRC_PX, ys.max() + 1 + PAD)


def bleed(im, iters=10):
    """RGB under alpha 0 <- nearest visible colour (alpha and visible RGB are untouched)."""
    rgb = im[..., :3].astype(np.float32)
    known = (im[..., 3] > 0).astype(np.float32)
    for _ in range(iters):
        k = known[..., None]
        s = cv2.blur(rgb * k, (3, 3)) * 9
        c = cv2.blur(known, (3, 3)) * 9
        new = (c > 0) & (known == 0)
        rgb[new] = s[new] / c[new][:, None]
        known = np.where(new, 1.0, known).astype(np.float32)
    rest = known == 0
    if rest.any() and (known > 0).any():
        rgb[rest] = rgb[known > 0].mean(axis=0)
    out = im.copy()
    out[..., :3] = np.clip(rgb + 0.5, 0, 255).astype(np.uint8)
    return out


def even(v):
    return v + (v & 1)


def make_atlas(files, box, out_px, do_bleed=True):
    x0, y0, x1, y1 = box
    scale = out_px / SRC_PX
    cw, ch = even(int(round((x1 - x0) * scale))), even(int(round((y1 - y0) * scale)))
    n = len(files)
    cols = math.ceil(math.sqrt(n * ch / cw))
    rows = math.ceil(n / cols)
    atlas = np.zeros((rows * ch, cols * cw, 4), np.uint8)
    side = int(round(SRC_PX * scale))
    sx0, sy0 = int(round(x0 * scale)), int(round(y0 * scale))
    for i, f in enumerate(files):
        a = np.array(Image.open(f).convert("RGBA")).astype(np.float32)
        if scale != 1:   # premultiplied Lanczos resample: no dark fringe from the black the read-back leaves under alpha 0
            a[..., :3] *= a[..., 3:4] / 255
            r = np.stack([np.array(Image.fromarray(a[..., c]).resize((side, side), Image.LANCZOS)) for c in range(4)], axis=-1).astype(np.float32)
            al = r[..., 3:4]
            r[..., :3] = np.where(al > 0, np.minimum(r[..., :3] * 255 / np.maximum(al, 1), 255), 0)
            a = r
        cell = np.clip(a[sy0:sy0 + ch, sx0:sx0 + cw] + 0.5, 0, 255).astype(np.uint8)
        if do_bleed:
            cell = bleed(cell)
        atlas[(i // cols) * ch:(i // cols + 1) * ch, (i % cols) * cw:(i % cols + 1) * cw] = cell
    return Image.fromarray(atlas, "RGBA"), dict(cols=cols, rows=rows, cw=cw, ch=ch, w=cols * cw, h=rows * ch, crop=dict(x=sx0 / scale, y=sy0 / scale, w=cw / scale, h=ch / scale))


def save_avif(atlas, path, q, subsampling="4:2:0", speed=4):
    t = time.time()
    if path.endswith(".webp"):
        atlas.save(path, "WEBP", lossless=True, quality=100, method=4)
    else:
        atlas.save(path, "AVIF", quality=q, speed=speed, subsampling=subsampling)
    return os.path.getsize(path), time.time() - t


box = union_box()
x0, y0, x1, y1 = box
report = dict(shared_crop_src_px=dict(x=int(x0), y=int(y0), w=int(x1 - x0), h=int(y1 - y0)), formats={})
for fid, F in FORMATS.items():
    d = f"{OUT}/{fid}"
    os.makedirs(d, exist_ok=True)
    sub, do_bleed = F.get("sub", "4:2:0"), F.get("bleed", True)
    man = dict(version=2, source="live Gold Master (HeroCoachStage, lite) fixed-step capture", srcPx=SRC_PX, framePx=F["px"], format="webp-lossless" if F.get("lossless") else "avif", quality=F["q"], subsampling=sub, bleed=do_bleed,
               crop=None, cell=None, clips={})
    clips = {"WATCHING_IDLE": (frames(f"{F['src']}/idle"), "pingpong"), "WATCHING_TO_ANALYZING": (frames(f"{F['src']}/trans"), "once")}
    if F["fps"] == 30 and not F.get("ablation"):
        for j in range(0, 60, ENTRY_STRIDE):
            clips[f"ENTRY_HEAD_{j:02d}"] = (frames(f"hvar{j:02d}")[:1 + HEAD_FRAMES], "once")
        clips["ENTRY_HEAD_60"] = (frames("src30/trans")[:1 + HEAD_FRAMES], "once")   # phase 60 = the canonical transition's own start
        clips["WATCHING_TO_ANALYZING_TAIL"] = (frames("src30/trans")[1 + HEAD_FRAMES:], "once")
    tot = 0
    for cid, (fs, loop) in clips.items():
        atlas, g = make_atlas(fs, box, F["px"], do_bleed)
        name = cid.lower().replace("_", "-")
        ext = "webp" if F.get("lossless") else "avif"
        size, secs = save_avif(atlas, f"{d}/{name}.{ext}", F["q"], sub)
        tot += size
        man["cell"] = dict(w=g["cw"], h=g["ch"])
        man["crop"] = g["crop"]   # source-px box the cell really covers (cell size is rounded up to even, so this is exact)
        man["clips"][cid] = dict(file=f"{name}.{ext}", frames=len(fs), fps=F["fps"], cols=g["cols"], rows=g["rows"], loop=loop, atlas=dict(w=g["w"], h=g["h"]), bytes=size)
        print(fid, cid, len(fs), "frames", size, "bytes", f"{secs:.1f}s", flush=True)
    json.dump(man, open(f"{d}/manifest.json", "w"), indent=1)
    report["formats"][fid] = dict(**F, cell=man["cell"], total_bytes=tot, clips={k: dict(frames=v["frames"], bytes=v["bytes"], atlas=v["atlas"]) for k, v in man["clips"].items()})

if ABLATE:   # encoder-flag ablation on clip A (reported, not shipped)
    ab = {}
    for name, (sub, bl, q) in {"A_as_specified": ("4:2:0", True, 45), "A_no_bleed": ("4:2:0", False, 45), "A_444_q40": ("4:4:4", True, 40), "A_444_q45": ("4:4:4", True, 45)}.items():
        tot = 0
        for cid, d in (("idle", "src30/idle"), ("trans", "src30/trans")):
            atlas, g = make_atlas(frames(d), box, 384, do_bleed=bl)
            s, _ = save_avif(atlas, f"{P2}/_ablate_{name}_{cid}.avif", q, sub)
            tot += s
        ab[name] = tot
    report["ablation_bytes"] = ab
json.dump(report, open(f"{P2}/pack-report.json", "w"), indent=1)
print(json.dumps({k: v["total_bytes"] for k, v in report["formats"].items()}))
