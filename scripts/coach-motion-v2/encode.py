"""Coach Motion V2 production pack encoder: Gold Master source frames (capture.mjs) -> chunked AVIF atlases + manifest.
usage: python -I scripts/coach-motion-v2/encode.py --frames <dir>/<px> --px 384 --out apps/web/public/coach-motion-v2/prod/384 [--quality 33] [--speed 4] [--codec auto]

Pinned (see docs/coach-motion-v2/PRODUCTION_PIPELINE.md): Pillow 12.3.0 + libavif 1.4.2 (bundled), 4:2:0, full range, alpha kept, quality / speed / codec as the CLI defaults below.
Atlas rules: one atlas = one chunk = at most CHUNK_FRAMES (14 = 0.47 s @ 30 fps; 252 = 18 x 14 and 210 = 15 x 14, so both loops split into equal chunks) consecutive frames of one clip, COLS columns, cell = the shared crop box
(union alpha bbox over EVERY frame of the pack, pad 2, even size), so a decoded chunk is <= 2048 px on both sides at 512 and ~1.4k at 384.
Encoder pre-pass: RGB under alpha 0 is bled from the nearest visible colour (visible pixels and alpha untouched) so chroma subsampling does not drag the
black the WebGL read-back leaves under alpha 0 into the silhouette edge."""
import argparse, glob, hashlib, json, math, os, time
import numpy as np, cv2, PIL
from PIL import Image, features

CHUNK_FRAMES, COLS, PAD, HEAD_STRIDE = 14, 4, 2, 6
ap = argparse.ArgumentParser()
ap.add_argument("--frames", required=True)
ap.add_argument("--px", type=int, required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--quality", type=int, default=33)
ap.add_argument("--speed", type=int, default=4)
ap.add_argument("--codec", default="auto")
ap.add_argument("--subsampling", default="4:2:0")
args = ap.parse_args()


def clip_dirs():
    out = {"WATCHING_LOOP": "watching", "ANALYZING_LOOP": "analyzing", "TRANSITION_TAIL": "tail"}
    for d in sorted(glob.glob(f"{args.frames}/head-*")):
        out["ENTRY_HEAD_" + os.path.basename(d)[5:]] = os.path.basename(d)
    return out


def files(d):
    return sorted(glob.glob(f"{args.frames}/{d}/f*.png"))


def union_box(dirs):
    u = None
    for d in dirs:
        for f in files(d):
            m = np.array(Image.open(f).convert("RGBA"))[..., 3] > 8
            u = m if u is None else (u | m)
    ys, xs = np.nonzero(u)
    h, w = u.shape
    return max(0, xs.min() - PAD), max(0, ys.min() - PAD), min(w, xs.max() + 1 + PAD), min(h, ys.max() + 1 + PAD)


def bleed(im, iters=10):
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


dirs = clip_dirs()
x0, y0, x1, y1 = (int(v) for v in union_box(dirs.values()))
cw, ch = int(even(x1 - x0)), int(even(y1 - y0))
x1, y1 = x0 + cw, y0 + ch
os.makedirs(args.out, exist_ok=True)
clips, total = {}, 0
t_all = time.time()
for cid, d in dirs.items():
    fs = files(d)
    loop = cid.endswith("_LOOP")
    chunks = []
    for ci in range(0, len(fs), CHUNK_FRAMES):
        part = fs[ci:ci + CHUNK_FRAMES]
        rows = math.ceil(len(part) / COLS)
        atlas = np.zeros((rows * ch, COLS * cw, 4), np.uint8)
        for i, f in enumerate(part):
            cell = np.array(Image.open(f).convert("RGBA"))[y0:y1, x0:x1]
            atlas[(i // COLS) * ch:(i // COLS + 1) * ch, (i % COLS) * cw:(i % COLS + 1) * cw] = bleed(cell)
        name = f"{d}-{ci // CHUNK_FRAMES:02d}.avif" if len(fs) > CHUNK_FRAMES else f"{d}.avif"
        path = f"{args.out}/{name}"
        Image.fromarray(atlas, "RGBA").save(path, "AVIF", quality=args.quality, speed=args.speed, subsampling=args.subsampling, codec=args.codec)
        size = os.path.getsize(path)
        total += size
        chunks.append(dict(file=name, frames=len(part), rows=rows, w=COLS * cw, h=rows * ch, bytes=size, sha256=hashlib.sha256(open(path, "rb").read()).hexdigest()))
    clips[cid] = dict(frames=len(fs), loop=loop, chunks=chunks)
    print(cid, len(fs), "frames", len(chunks), "chunks", sum(c["bytes"] for c in chunks), "bytes", flush=True)

manifest = dict(
    version=3,
    pack=str(args.px),
    source="live Gold Master (HeroCoachStage, lite) · authored loop poses (features/coach-motion/loop-pose.ts) · 120 Hz fixed-step sim sampled at 30 fps",
    srcPx=args.px,
    fps=30,
    crop=dict(x=int(x0), y=int(y0), w=int(cw), h=int(ch)),
    cell=dict(w=int(cw), h=int(ch)),
    chunkFrames=CHUNK_FRAMES,
    cols=COLS,
    headStride=HEAD_STRIDE,
    encoder=dict(format="avif", library=f"Pillow {PIL.__version__}", libavif=features.version("avif"), quality=args.quality, speed=args.speed, codec=args.codec, subsampling=args.subsampling, range="full", alphaBleed=True),
    totalBytes=total,
    clips=clips,
)
json.dump(manifest, open(f"{args.out}/manifest.json", "w"), indent=1)
print(f"pack {args.px}: {total} bytes, cell {cw}x{ch}, {time.time() - t_all:.0f}s")
