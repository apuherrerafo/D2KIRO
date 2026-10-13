"""Coach Motion V2 CALIBRATION encoder: the real-render calibration subset (calibration.json) -> chunked AVIF atlases + a small calibration manifest + measured bytes.
usage: node scripts/coach-motion-v2/calibration-set.mjs --json <set.json>
       python -I scripts/coach-motion-v2/calibrate.py --frames <dir>/<px> --set <set.json> --px 384 --out apps/web/public/coach-motion-v2/calibration/384 [--quality 35] [--speed 4]

NOT a production pack: heads are a few representative phases, the manifest is not the player's, nothing here is shipped or verified by verify-assets.
The ENCODING is the production encoder's (same Pillow / libavif pins, 4:2:0 full range, alpha bleed pre-pass, 14-frame chunks, 4 columns, quality 35 / speed 4), so the bytes are the
bytes production would spend. The crop box is the union of the calibration frames AND the committed production crop (a pack's crop only ever grows), so the cell is comparable.
Refuses a chunk wider or taller than MAX_ATLAS_PX like encode.py does."""
import argparse, glob, json, math, os, sys, time
from importlib.metadata import version

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script directory from sys.path
import pack_manifest as pm
import numpy as np, cv2, PIL
from PIL import Image, features

CHUNK_FRAMES, COLS, PAD = 14, 4, 2
ap = argparse.ArgumentParser()
ap.add_argument("--frames", required=True)
ap.add_argument("--set", required=True)
ap.add_argument("--px", type=int, required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--quality", type=int, default=35)
ap.add_argument("--speed", type=int, default=4)
ap.add_argument("--codec", default="auto")
ap.add_argument("--subsampling", default="4:2:0")
ap.add_argument("--prod-manifest", default=os.path.join(pm.ROOT, "apps/web/public/coach-motion-v2/prod/%d/manifest.json"))
ap.add_argument("--allow-toolchain-drift", action="store_true")
args = ap.parse_args()


def check_toolchain():
    pins = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "toolchain.json")))
    have = {"python": ".".join(map(str, sys.version_info[:3])), "pillow": version("pillow"), "libavif": features.version("avif"), "numpy": version("numpy"), "opencv-python": version("opencv-python")}
    drift = {k: (have[k], pins[k]) for k in have if have[k] != pins[k]}
    if drift and not args.allow_toolchain_drift:
        raise SystemExit("toolchain differs from scripts/coach-motion-v2/toolchain.json (installed, pinned): " + json.dumps(drift))


def files(d):
    return sorted(glob.glob(f"{args.frames}/{d}/f*.png"))


def bleed(im, iters=10):  # identical to encode.py
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


even = lambda v: v + (v & 1)

check_toolchain()
cal = json.load(open(args.set, encoding="utf-8"))
# (clip id, frames folder, frames, kind, owner) of everything the calibration touches
clips = []
for l in cal["loops"]:
    clips.append((l["clip"], l["dir"], l["frames"], "loop", l["id"]))
for s in cal["scenarios"]:
    clips.append((s["tail"]["clip"], s["tail"]["dir"], s["tail"]["frames"], "tail", s["edge"]))
    for h in s["heads"]:
        clips.append((h["clip"], h["dir"], s["headFrames"], "head", s["edge"]))
for cid, d, n, _, _ in clips:
    have = len(files(d))
    if have != n:
        raise SystemExit(f"frames folder {d}: {have} frames, expected {n} (run capture.mjs --only $(node scripts/coach-motion-v2/calibration-set.mjs))")

u = None
for _, d, _, _, _ in clips:
    for f in files(d):
        m = np.array(Image.open(f).convert("RGBA"))[..., 3] > 8
        u = m if u is None else (u | m)
ys, xs = np.nonzero(u)
h, w = u.shape
x0, y0, x1, y1 = max(0, xs.min() - PAD), max(0, ys.min() - PAD), min(w, xs.max() + 1 + PAD), min(h, ys.max() + 1 + PAD)
own_box = dict(x=int(x0), y=int(y0), w=int(x1 - x0), h=int(y1 - y0))
prod = json.load(open(args.prod_manifest % args.px))["crop"]
x0, y0, x1, y1 = min(x0, prod["x"]), min(y0, prod["y"]), max(x1, prod["x"] + prod["w"]), max(y1, prod["y"] + prod["h"])
cw, ch = int(even(x1 - x0)), int(even(y1 - y0))
x0, y0, x1, y1 = int(x0), int(y0), int(x0) + cw, int(y0) + ch
os.makedirs(args.out, exist_ok=True)
out = {}
t_all = time.time()
for cid, d, n, kind, owner in clips:
    fs = files(d)
    chunks = []
    for ci in range(0, len(fs), CHUNK_FRAMES):
        part = fs[ci:ci + CHUNK_FRAMES]
        rows = math.ceil(len(part) / COLS)
        pm.check_atlas(cid, ci // CHUNK_FRAMES, COLS * cw, rows * ch)
        atlas = np.zeros((rows * ch, COLS * cw, 4), np.uint8)
        for i, f in enumerate(part):
            cell = np.array(Image.open(f).convert("RGBA"))[y0:y1, x0:x1]
            atlas[(i // COLS) * ch:(i // COLS + 1) * ch, (i % COLS) * cw:(i % COLS + 1) * cw] = bleed(cell)
        stem = f"{d}-{ci // CHUNK_FRAMES:02d}" if len(fs) > CHUNK_FRAMES else d
        tmp = f"{args.out}/{stem}.avif"
        Image.fromarray(atlas, "RGBA").save(tmp, "AVIF", quality=args.quality, speed=args.speed, subsampling=args.subsampling, codec=args.codec)
        sha = pm.sha256_file(tmp)
        name = pm.fingerprint_name(stem, sha)
        os.replace(tmp, f"{args.out}/{name}")
        chunks.append(dict(file=name, frames=len(part), rows=rows, w=COLS * cw, h=rows * ch, bytes=os.path.getsize(f"{args.out}/{name}"), sha256=sha))
    total = sum(c["bytes"] for c in chunks)
    out[cid] = dict(dir=d, kind=kind, owner=owner, frames=len(fs), chunks=chunks, bytes=total, bytesPerFrame=total / len(fs))
    print(f"{cid:18s} {kind:5s} {len(fs):4d} frames {len(chunks):2d} chunks {total:8d} bytes {total / len(fs):7.0f} B/frame", flush=True)

keep = {c["file"] for clip in out.values() for c in clip["chunks"]}
for stale in glob.glob(f"{args.out}/*.avif"):
    if os.path.basename(stale) not in keep:
        os.remove(stale)
manifest = dict(
    version="calibration-1",
    note="real-render calibration of the new semantic states: NOT a production pack",
    px=args.px,
    srcPx=args.px,
    fps=30,
    cols=COLS,
    chunkFrames=CHUNK_FRAMES,
    crop=dict(x=x0, y=y0, w=cw, h=ch),
    cell=dict(w=cw, h=ch),
    calibrationOwnCrop=own_box,
    productionCrop=prod,
    encoder=dict(format="avif", library=f"Pillow {PIL.__version__}", libavif=features.version("avif"), quality=args.quality, speed=args.speed, codec=args.codec, subsampling=args.subsampling, range="full", alphaBleed=True),
    loops={l["id"]: l["clip"] for l in cal["loops"]},
    scenarios=cal["scenarios"],
    clips=out,
)
json.dump(manifest, open(f"{args.out}/manifest.json", "w", newline="\n"), indent=1)
print(f"calibration pack {args.px}: {sum(c['bytes'] for c in out.values())} bytes, {sum(c['frames'] for c in out.values())} frames, cell {cw}x{ch} (own crop {own_box['w']}x{own_box['h']}), {time.time() - t_all:.0f}s")
