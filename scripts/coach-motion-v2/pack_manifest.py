"""Pack-manifest rules shared by encode.py and migrate_v3_to_v4.py (the Coach Motion V2 production pipeline).
Imported with an explicit sys.path entry because `python -I` does not put the script directory on sys.path.

* content-addressed chunk files: `<stem>.<first 12 hex of sha256>.avif`, so a URL can be cached for ever and a changed chunk can never be served under an old name
* the semantic GRAPH (loops + edges) comes from graph.json, an authoring file; the manifest carries it so the player contains no topology
* PROVENANCE: ids of the Gold Master source and of the static-sprite fallback this pack was sealed against (verify-assets.mjs compares them with the repo)
* the decoded atlas cap: a chunk wider or taller than MAX_ATLAS_PX is a hard error, never silently written
"""
import glob, hashlib, json, os

MAX_ATLAS_PX = 2048
FINGERPRINT_LEN = 12
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
GOLD_MASTER_DIR = "apps/web/public/coach-gold-master/modular"
GOLD_MASTER_FILES = ["coach-modular.json", "coach-modular.bin"]
STATIC_FALLBACK_DIR = "apps/web/public/coach-web-pack/hero"
GRAPH_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "graph.json")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fingerprint_name(stem, sha):
    return f"{stem}.{sha[:FINGERPRINT_LEN]}.avif"


def check_atlas(clip, chunk, w, h, limit=MAX_ATLAS_PX):
    if w > limit or h > limit:
        raise SystemExit(
            f"atlas too large: {clip} chunk {chunk} would be {w}x{h} px (limit {limit}). "
            f"Pack it with fewer columns (--cols-for {clip}=N), fewer frames per chunk, or a tighter crop; refusing to write an oversized atlas."
        )


def combined_id(files):
    """Order-independent identity of a set of named files: sha256 over `name:sha` lines, first 12 hex."""
    text = "".join(f"{name}:{sha}\n" for name, sha in sorted(files.items()))
    return hashlib.sha256(text.encode()).hexdigest()[:FINGERPRINT_LEN]


def provenance(root=ROOT):
    gm = {n: sha256_file(os.path.join(root, GOLD_MASTER_DIR, n)) for n in GOLD_MASTER_FILES}
    static = {os.path.basename(p): sha256_file(p) for p in sorted(glob.glob(os.path.join(root, STATIC_FALLBACK_DIR, "*.webp")))}
    if not static:
        raise SystemExit(f"no static fallback stills under {STATIC_FALLBACK_DIR}")
    return {"goldMaster": {"id": combined_id(gm), "files": gm}, "staticFallback": {"id": combined_id(static), "files": static}}


def pack_hash(clips):
    text = "".join(f"{cid}/{i}:{c['sha256']}\n" for cid, clip in sorted(clips.items()) for i, c in enumerate(clip["chunks"]))
    return hashlib.sha256(text.encode()).hexdigest()


def load_graph(path=GRAPH_FILE):
    return json.load(open(path, encoding="utf-8"))


def clip_plan(graph, frames_dir):
    """[(clip id, source dir name, is loop)] for every clip the graph needs; entry heads are discovered from the head-* folders of the frames dir."""
    plan = []
    for loop in graph["loops"].values():
        plan.append((loop["clip"], loop["dir"], True))
    for edge in graph["edges"]:
        plan.append((edge["tail"]["clip"], edge["tail"]["dir"], False))
        en = edge["entry"]
        for d in sorted(glob.glob(os.path.join(frames_dir, en["headDirPrefix"] + "*"))):
            name = os.path.basename(d)
            plan.append((en["headClipPrefix"] + name[len(en["headDirPrefix"]):], name, False))
    return plan


def manifest_graph(graph):
    """The graph as the manifest carries it (authoring-only `dir` keys dropped)."""
    return {
        "loops": {k: {"clip": v["clip"]} for k, v in graph["loops"].items()},
        "edges": [
            {
                "id": e["id"], "from": e["from"], "to": e["to"], "fps": e["fps"],
                "entry": {k: v for k, v in e["entry"].items() if k != "headDirPrefix"},
                "tail": {"clip": e["tail"]["clip"], "enterFrame": e["tail"]["enterFrame"]},
                "lookaheadFrames": e["lookaheadFrames"],
            }
            for e in graph["edges"]
        ],
    }


def check_graph(graph, clips, fps):
    """Same invariants the player enforces at load (production-manifest.ts parseManifest), caught at build time."""
    for e in graph["edges"]:
        n = clips[graph["loops"][e["from"]]["clip"]]["frames"]
        stride = e["entry"]["stride"]
        if e["fps"] != fps:
            raise SystemExit(f"edge {e['id']}: fps {e['fps']} differs from the pack's {fps}")
        if stride // 2 > e["entry"]["maxStepFrames"]:
            raise SystemExit(f"edge {e['id']}: stride {stride} allows an entry mismatch of {stride // 2} frames, above maxStepFrames {e['entry']['maxStepFrames']}")
        for p in range(0, n, stride):
            cid = e["entry"]["headClipPrefix"] + f"{p:03d}"
            if cid not in clips:
                raise SystemExit(f"edge {e['id']}: no head clip {cid} (stride {stride} over {n} frames); capture heads at every {stride} frames")
            if clips[cid]["frames"] != e["entry"]["headFrames"]:
                raise SystemExit(f"edge {e['id']}: {cid} has {clips[cid]['frames']} frames, expected {e['entry']['headFrames']}")
        extra = [c for c in clips if c.startswith(e["entry"]["headClipPrefix"]) and int(c[len(e["entry"]["headClipPrefix"]):]) % stride != 0]
        if extra:
            raise SystemExit(f"edge {e['id']}: head clips {extra[:3]}... are not on the stride {stride} grid")


def assemble(pack, px, source, crop, cell, chunk_frames, cols, encoder, clips, graph, root=ROOT):
    """The v4 manifest for a finished set of clips (each chunk already carries its fingerprinted file name)."""
    fps = 30
    check_graph(graph, clips, fps)
    return dict(
        version=4,
        pack=str(pack),
        source=source,
        srcPx=px,
        fps=fps,
        crop=crop,
        cell=cell,
        chunkFrames=chunk_frames,
        cols=cols,
        limits=dict(maxAtlasPx=MAX_ATLAS_PX),
        provenance=provenance(root),
        encoder=encoder,
        totalBytes=sum(c["bytes"] for clip in clips.values() for c in clip["chunks"]),
        packHash=pack_hash(clips),
        graph=manifest_graph(graph),
        clips=clips,
    )
