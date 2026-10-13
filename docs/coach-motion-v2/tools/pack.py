"""Pack the source PNG frames into grid atlases (+ manifest). usage: python -I pack.py <src_px> <out_px> <quality> <outdir> [webp|avif]
Frames are cropped to ONE shared box (union alpha bbox of every clip) so all clips draw at the same place/scale."""
import sys, os, json, glob, math, numpy as np
from PIL import Image
src_px, out_px, q, outdir = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
FMT = sys.argv[5] if len(sys.argv) > 5 else "webp"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS = {"WATCHING_IDLE": dict(fps=30, loop="pingpong"), "WATCHING_TO_ANALYZING": dict(fps=30, loop="once")}
meta = json.load(open(f"{ROOT}/src-frames-{src_px}/capture-meta.json"))
files = {c: sorted(glob.glob(f"{ROOT}/src-frames-{src_px}/{c}/f*.png")) for c in CLIPS}
# shared crop (source px), pad 2, even size
u = None
for c, fs in files.items():
    for f in fs:
        m = np.array(Image.open(f).convert("RGBA"))[..., 3] > 8
        u = m if u is None else (u | m)
ys, xs = np.nonzero(u); pad = 2
x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad); x1, y1 = min(src_px, xs.max() + 1 + pad), min(src_px, ys.max() + 1 + pad)
scale = out_px / src_px
cw, ch = int(round((x1 - x0) * scale)), int(round((y1 - y0) * scale))
os.makedirs(outdir, exist_ok=True)
man = dict(version=1, source="live Gold Master (HeroCoachStage, lite) fixed-step capture", srcPx=src_px, framePx=out_px, crop=dict(x=int(x0), y=int(y0), w=int(x1 - x0), h=int(y1 - y0)),
           cell=dict(w=cw, h=ch), format=FMT, quality=q, clips={})
tot = dict(raw_png=0, atlas_png=0, atlas_final=0)
for c, spec in CLIPS.items():
    fs = files[c]; n = len(fs); cols = math.ceil(math.sqrt(n * ch / cw)); rows = math.ceil(n / cols)
    atlas = Image.new("RGBA", (cols * cw, rows * ch), (0, 0, 0, 0))
    for i, f in enumerate(fs):
        im = Image.open(f).convert("RGBA").crop((x0, y0, x1, y1))
        if scale != 1: im = im.resize((cw, ch), Image.LANCZOS)
        atlas.paste(im, ((i % cols) * cw, (i // cols) * ch))
        tot["raw_png"] += os.path.getsize(f)
    name = f"{c.lower().replace('_', '-')}"
    if FMT == "avif": atlas.save(f"{outdir}/{name}.avif", "AVIF", quality=q, speed=6)
    else: atlas.save(f"{outdir}/{name}.webp", "WEBP", quality=q, alpha_quality=q, method=6)
    atlas.save(f"{outdir}/{name}.png.tmp", "PNG", optimize=True)
    tot["atlas_png"] += os.path.getsize(f"{outdir}/{name}.png.tmp"); os.remove(f"{outdir}/{name}.png.tmp")
    w = os.path.getsize(f"{outdir}/{name}.{FMT}"); tot["atlas_final"] += w
    man["clips"][c] = dict(file=f"{name}.{FMT}", frames=n, fps=spec["fps"], cols=cols, rows=rows, loop=spec["loop"], atlas=dict(w=cols * cw, h=rows * ch), bytes=w)
json.dump(man, open(f"{outdir}/manifest.json", "w"), indent=1)
print(json.dumps(dict(src=src_px, out=out_px, q=q, cell=[cw, ch], **tot, per_clip={k: (v["atlas"], v["bytes"]) for k, v in man["clips"].items()})))
