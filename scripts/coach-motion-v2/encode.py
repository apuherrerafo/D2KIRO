"""Coach Motion V2 production pack encoder: Gold Master source frames (capture.mjs) -> chunked, content-addressed AVIF atlases + manifest (v4).
usage: python -I scripts/coach-motion-v2/encode.py --frames <dir>/<px> --px 384 --out apps/web/public/coach-motion-v2/prod/384 [--quality 35] [--speed 4] [--codec auto]
       [--graph scripts/coach-motion-v2/graph.json] [--cols-for CLIP=N ...] [--allow-toolchain-drift]

Pinned (scripts/coach-motion-v2/toolchain.json, requirements.txt): Pillow 12.3.0 + libavif 1.4.2 (bundled), numpy, opencv; 4:2:0, full range, alpha kept; quality / speed / codec as the CLI defaults below.
The clips, loops and edges to pack come from graph.json (copied into the manifest); every frames folder it names must exist under --frames with the frame count the graph says, and nothing else under --frames is read.
Atlas rules: one atlas = one chunk = at most CHUNK_FRAMES (14 = 0.47 s @ 30 fps; 252 = 18 x 14 and 210 = 15 x 14, so both loops split into equal chunks) consecutive frames of one clip, COLS columns
(per clip with --cols-for), cell = the shared crop box (union alpha bbox over EVERY frame of the pack, pad 2, even size). A chunk wider or taller than MAX_ATLAS_PX (2048) aborts the run.
Chunk files are named `<stem>.<sha256[:12]>.avif` (immutable URLs) and stale *.avif files of the pack folder are removed at the end.
Encoder pre-pass: RGB under alpha 0 is bled from the nearest visible colour (visible pixels and alpha untouched) so chroma subsampling does not drag the
black the WebGL read-back leaves under alpha 0 into the silhouette edge."""
import argparse, glob, json, math, os, sys, time
from importlib.metadata import version

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script directory from sys.path
import pack_manifest as pm
import numpy as np, cv2, PIL
from PIL import Image, features

CHUNK_FRAMES, COLS, PAD = 14, 4, 2
ap = argparse.ArgumentParser()
ap.add_argument("--frames", required=True)
ap.add_argument("--px", type=int, required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--quality", type=int, default=35)
ap.add_argument("--speed", type=int, default=4)
ap.add_argument("--codec", default="auto")
ap.add_argument("--subsampling", default="4:2:0")
ap.add_argument("--graph", default=pm.GRAPH_FILE)
ap.add_argument("--cols-for", action="append", default=[], metavar="CLIP=N", help="atlas columns for one clip (a wide pose may need fewer to stay under 2048 px)")
ap.add_argument("--allow-toolchain-drift", action="store_true")
args = ap.parse_args()
COLS_FOR = {k: int(v) for k, v in (kv.split("=", 1) for kv in args.cols_for)}


def check_toolchain():
    pins = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "toolchain.json")))
    have = {"python": ".".join(map(str, sys.version_info[:3])), "pillow": version("pillow"), "libavif": features.version("avif"), "numpy": version("numpy"), "opencv-python": version("opencv-python")}
    drift = {k: (have[k], pins[k]) for k in have if have[k] != pins[k]}
    if drift and not args.allow_toolchain_drift:
        raise SystemExit("toolchain differs from scripts/coach-motion-v2/toolchain.json (installed, pinned): " + json.dumps(drift) + "\nInstall requirements.txt on the pinned Python, or pass --allow-toolchain-drift for an exploratory run (its bytes are not the approved masters).")


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


check_toolchain()
graph = pm.load_graph(args.graph)
plan = pm.clip_plan(graph)
pm.check_frames(graph, args.frames)
x0, y0, x1, y1 = (int(v) for v in union_box([d for _, d, _ in plan]))
cw, ch = int(even(x1 - x0)), int(even(y1 - y0))
x1, y1 = x0 + cw, y0 + ch
os.makedirs(args.out, exist_ok=True)
clips = {}
t_all = time.time()
for cid, d, loop in plan:
    fs = files(d)
    cols = COLS_FOR.get(cid, COLS)
    chunks = []
    for ci in range(0, len(fs), CHUNK_FRAMES):
        part = fs[ci:ci + CHUNK_FRAMES]
        rows = math.ceil(len(part) / cols)
        pm.check_atlas(cid, ci // CHUNK_FRAMES, cols * cw, rows * ch)  # before any pixel is packed
        atlas = np.zeros((rows * ch, cols * cw, 4), np.uint8)
        for i, f in enumerate(part):
            cell = np.array(Image.open(f).convert("RGBA"))[y0:y1, x0:x1]
            atlas[(i // cols) * ch:(i // cols + 1) * ch, (i % cols) * cw:(i % cols + 1) * cw] = bleed(cell)
        stem = f"{d}-{ci // CHUNK_FRAMES:02d}" if len(fs) > CHUNK_FRAMES else d
        tmp = f"{args.out}/{stem}.avif"
        Image.fromarray(atlas, "RGBA").save(tmp, "AVIF", quality=args.quality, speed=args.speed, subsampling=args.subsampling, codec=args.codec)
        sha = pm.sha256_file(tmp)
        name = pm.fingerprint_name(stem, sha)
        os.replace(tmp, f"{args.out}/{name}")
        chunks.append(dict(file=name, frames=len(part), rows=rows, w=cols * cw, h=rows * ch, bytes=os.path.getsize(f"{args.out}/{name}"), sha256=sha))
    clips[cid] = dict(frames=len(fs), loop=loop, chunks=chunks)
    if cols != COLS:
        clips[cid]["cols"] = cols
    print(cid, len(fs), "frames", len(chunks), "chunks", sum(c["bytes"] for c in chunks), "bytes", flush=True)

manifest = pm.assemble(
    pack=args.px,
    px=args.px,
    source="live Gold Master (HeroCoachStage, lite) · authored loop poses (features/coach-motion/loop-pose.ts) · 120 Hz fixed-step sim sampled at 30 fps",
    crop=dict(x=int(x0), y=int(y0), w=int(cw), h=int(ch)),
    cell=dict(w=int(cw), h=int(ch)),
    chunk_frames=CHUNK_FRAMES,
    cols=COLS,
    encoder=dict(format="avif", library=f"Pillow {PIL.__version__}", libavif=features.version("avif"), quality=args.quality, speed=args.speed, codec=args.codec, subsampling=args.subsampling, range="full", alphaBleed=True),
    clips=clips,
    graph=graph,
)
keep = {c["file"] for clip in clips.values() for c in clip["chunks"]}
for stale in glob.glob(f"{args.out}/*.avif"):
    if os.path.basename(stale) not in keep:
        os.remove(stale)
json.dump(manifest, open(f"{args.out}/manifest.json", "w", newline="\n"), indent=1)
print(f"pack {args.px}: {manifest['totalBytes']} bytes, cell {cw}x{ch}, packHash {manifest['packHash'][:12]}, {time.time() - t_all:.0f}s")
