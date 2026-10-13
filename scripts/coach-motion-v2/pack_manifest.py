"""Pack-manifest rules shared by encode.py and migrate_v3_to_v4.py (the Coach Motion V2 production pipeline).
Imported with an explicit sys.path entry because `python -I` does not put the script directory on sys.path.

* content-addressed chunk files: `<stem>.<first 12 hex of sha256>.avif`, so a URL can be cached for ever and a changed chunk can never be served under an old name
* the semantic GRAPH (loops + edges) comes from graph.json, an authoring file; the manifest carries it so the player contains no topology
* PROVENANCE: ids of the Gold Master source and of the static-sprite fallback this pack was sealed against (verify-assets.mjs compares them with the repo)
* the decoded atlas cap: a chunk wider or taller than MAX_ATLAS_PX is a hard error, never silently written
* the graph is validated (validate_graph: the same static rules as plan.mjs) and every name of the pack (clip ids, frame folders) is DERIVED from it: no glob, no hardcoded clip
"""
import glob, hashlib, json, os, re

ENTRY_STRATEGIES = ["nearest-head"]
CHUNK_FRAMES_MIN_LOOKAHEAD = 14

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


def pad3(n):
    return f"{n:03d}"


def head_phases(loop_frames, stride):
    """Source-loop phases that have an entry head: 0, stride, 2 * stride, ..."""
    return list(range(0, loop_frames, stride))


def head_clip_ids(graph, edge):
    return [edge["entry"]["headClipPrefix"] + pad3(p) for p in head_phases(graph["loops"][edge["from"]]["frames"], edge["entry"]["stride"])]


def head_dir_names(graph, edge):
    return [edge["entry"]["headDirPrefix"] + pad3(p) for p in head_phases(graph["loops"][edge["from"]]["frames"], edge["entry"]["stride"])]


def _is_int(v, lo=0):
    return isinstance(v, int) and not isinstance(v, bool) and v >= lo


def graph_problems(graph):
    """Every reason graph.json is not a valid authoring graph (static rules only); [] = valid. The same rules as validateGraph in plan.mjs (authoring.test.ts runs both on the same mutations)."""
    problems = []
    bad = problems.append
    loops = graph.get("loops") or {}
    if not loops:
        bad("graph has no loops")
    clips, dirs = {}, {}

    def claim(table, name, owner, what):
        if name in table:
            bad(f"{what} {name} is used by both {table[name]} and {owner}")
        else:
            table[name] = owner

    for lid, l in loops.items():
        if not isinstance(l.get("clip"), str) or not l.get("clip") or not isinstance(l.get("dir"), str) or not l.get("dir"):
            bad(f"loop {lid}: needs a clip id and a frames folder")
        if not _is_int(l.get("frames"), 1):
            bad(f"loop {lid}: bad frames {l.get('frames')}")
        if not _is_int(l.get("strideLimit"), 1):
            bad(f"loop {lid}: bad strideLimit {l.get('strideLimit')}")
        if "blinks" in l and not _is_int(l["blinks"], 0):
            bad(f"loop {lid}: bad blinks {l['blinks']}")
        claim(clips, l.get("clip"), f"loop {lid}", "clip")
        claim(dirs, l.get("dir"), f"loop {lid}", "folder")
    ids, spaces = set(), set()
    edges = graph.get("edges") or []
    for e in edges:
        eid = e.get("id")
        if eid in ids:
            bad(f"duplicate edge {eid}")
        ids.add(eid)
        ns = e.get("ns") or ""
        if not re.match(r"^[a-z][a-z0-9]{0,3}$", ns):
            bad(f"edge {eid}: bad namespace {e.get('ns')}")
        elif ns in spaces:
            bad(f"edge {eid}: namespace {ns} is used by another edge")
        spaces.add(ns)
        src, dst = loops.get(e.get("from")), loops.get(e.get("to"))
        if not src or not dst:
            bad(f"edge {eid}: unknown loop {e.get('from') if not src else e.get('to')}")
            continue
        if e["from"] == e["to"]:
            bad(f"edge {eid}: from and to are the same loop")
        if eid != f"{e['from']}>{e['to']}":
            bad(f"edge {eid}: id must be \"{e['from']}>{e['to']}\"")
        if not _is_int(e.get("fps"), 1):
            bad(f"edge {eid}: bad fps {e.get('fps')}")
        en = e.get("entry") or {}
        if en.get("strategy") not in ENTRY_STRATEGIES:
            bad(f"edge {eid}: unknown entry strategy {en.get('strategy')}")
        stride = en.get("stride")
        if not _is_int(stride, 1) or stride > src["frames"]:
            bad(f"edge {eid}: bad entry stride {stride}")
        else:
            if stride > src["strideLimit"]:
                bad(f"edge {eid}: stride {stride} is coarser than {e['from']} supports (strideLimit {src['strideLimit']})")
            if en.get("maxStepFrames") != stride // 2:
                bad(f"edge {eid}: maxStepFrames {en.get('maxStepFrames')} must be floor(stride / 2) = {stride // 2}")
        if not _is_int(en.get("headFrames"), 1) or not _is_int(en.get("armHeads"), 1):
            bad(f"edge {eid}: bad headFrames / armHeads")
        if not isinstance(en.get("headClipPrefix"), str) or not en.get("headClipPrefix") or not isinstance(en.get("headDirPrefix"), str) or not en.get("headDirPrefix"):
            bad(f"edge {eid}: needs head prefixes")
        t = e.get("tail") or {}
        if not _is_int(t.get("frames"), 1):
            bad(f"edge {eid}: bad tail.frames {t.get('frames')}")
        if not _is_int(t.get("enterFrame"), 0) or t["enterFrame"] >= dst["frames"]:
            bad(f"edge {eid}: bad tail.enterFrame {t.get('enterFrame')}")
        if not isinstance(t.get("clip"), str) or not t.get("clip") or not isinstance(t.get("dir"), str) or not t.get("dir"):
            bad(f"edge {eid}: needs a tail clip id and folder")
        else:
            claim(clips, t["clip"], f"edge {eid} tail", "clip")
            claim(dirs, t["dir"], f"edge {eid} tail", "folder")
        if not _is_int(e.get("lookaheadFrames"), CHUNK_FRAMES_MIN_LOOKAHEAD):
            bad(f"edge {eid}: lookaheadFrames must be at least one chunk ({CHUNK_FRAMES_MIN_LOOKAHEAD})")

    def usable(e):
        en = e.get("entry") or {}
        return e.get("from") in loops and e.get("to") in loops and isinstance(en.get("headClipPrefix"), str) and isinstance(en.get("headDirPrefix"), str) and _is_int(en.get("stride"), 1)

    for e in edges:
        if usable(e):
            for table, names, what in ((clips, head_clip_ids(graph, e), "clip"), (dirs, head_dir_names(graph, e), "folder")):
                for n in names:
                    claim(table, n, f"edge {e['id']} head", what)
    for e in edges:
        if not usable(e):
            continue
        own, own_dirs = set(head_clip_ids(graph, e)), set(head_dir_names(graph, e))
        stray = next((c for c in clips if c.startswith(e["entry"]["headClipPrefix"]) and c not in own), None)
        stray_dir = next((d for d in dirs if d.startswith(e["entry"]["headDirPrefix"]) and d not in own_dirs), None)
        if stray:
            bad(f"edge {e['id']}: head prefix {e['entry']['headClipPrefix']} also matches {stray}")
        if stray_dir:
            bad(f"edge {e['id']}: head folder prefix {e['entry']['headDirPrefix']} also matches {stray_dir}")
    b = graph.get("budget") or {}
    if not _is_int(b.get("firstLoadBytes"), 1) or not _is_int(b.get("packCeilingBytes"), 1):
        bad("budget: firstLoadBytes and packCeilingBytes are required")
    path = b.get("firstLoadPath")
    if not isinstance(path, list) or len(path) < 1 or any(p not in loops for p in path):
        bad("budget: firstLoadPath must name loops of the graph")
    for lid in loops:
        if not ((b.get("calibration") or {}).get("bytesPerFrame", {}).get(lid, 0) > 0):
            bad(f"budget: no calibration bytesPerFrame for loop {lid}")
    return problems


def validate_graph(graph):
    problems = graph_problems(graph)
    if problems:
        raise SystemExit("graph.json is not a valid authoring graph:\n  - " + "\n  - ".join(problems))
    return graph


def clip_plan(graph):
    """[(clip id, source frames folder, is loop)] for every clip the graph needs, DERIVED from the graph (loops, then per edge its tail and one head per phase of its stride grid).
    Nothing is discovered on disk: a folder that is missing is an error (check_frames), a folder the graph does not name is ignored."""
    validate_graph(graph)
    plan = [(l["clip"], l["dir"], True) for l in graph["loops"].values()]
    for e in graph["edges"]:
        plan.append((e["tail"]["clip"], e["tail"]["dir"], False))
        plan.extend((cid, d, False) for cid, d in zip(head_clip_ids(graph, e), head_dir_names(graph, e)))
    return plan


def expected_frames(graph):
    """{frames folder: frame count} for every clip of the graph."""
    out = {l["dir"]: l["frames"] for l in graph["loops"].values()}
    for e in graph["edges"]:
        out[e["tail"]["dir"]] = e["tail"]["frames"]
        for d in head_dir_names(graph, e):
            out[d] = e["entry"]["headFrames"]
    return out


def check_frames(graph, frames_dir):
    """Every folder of the plan exists under frames_dir with exactly the frames the graph says."""
    for d, n in expected_frames(graph).items():
        have = len(glob.glob(os.path.join(frames_dir, d, "f*.png")))
        if have != n:
            raise SystemExit(f"frames folder {d}: {have} frames, the graph expects {n} (run capture.mjs for this graph)")


def manifest_graph(graph):
    """The graph as the manifest carries it (authoring-only keys dropped: dir, frames, strideLimit, blinks, ns, headDirPrefix, tail.dir / frames, budget)."""
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
    """Same invariants the player enforces at load (production-manifest.ts parseManifest), plus the authoring rules, caught at build time. Every name is derived from the graph;
    a head of one edge can never satisfy (or hide the absence of) a head of another, and a clip the graph does not account for is an error."""
    validate_graph(graph)
    expected = {}
    for lid, l in graph["loops"].items():
        expected[l["clip"]] = (l["frames"], True, f"loop {lid}")
    for e in graph["edges"]:
        if e["fps"] != fps:
            raise SystemExit(f"edge {e['id']}: fps {e['fps']} differs from the pack's {fps}")
        expected[e["tail"]["clip"]] = (e["tail"]["frames"], False, f"edge {e['id']} tail")
        for cid in head_clip_ids(graph, e):
            expected[cid] = (e["entry"]["headFrames"], False, f"edge {e['id']} head")
    for cid, (frames, loop, owner) in expected.items():
        if cid not in clips:
            raise SystemExit(f"{owner}: no clip {cid} in the pack (capture the heads of this edge's stride grid)")
        if clips[cid]["frames"] != frames or bool(clips[cid]["loop"]) != loop:
            raise SystemExit(f"{owner}: {cid} has {clips[cid]['frames']} frames (loop={clips[cid]['loop']}), expected {frames} (loop={loop})")
    orphans = [c for c in clips if c not in expected]
    if orphans:
        raise SystemExit(f"clips the graph does not account for: {orphans[:3]}")


def check_budget(graph, total_bytes):
    """Measured size of the finished pack against the STOP ceiling."""
    ceiling = graph["budget"]["packCeilingBytes"]
    if total_bytes > ceiling:
        raise SystemExit(f"STOP: the pack is {total_bytes} bytes, above the {ceiling} byte ceiling (graph.json budget.packCeilingBytes). Reassess before shipping it.")


def assemble(pack, px, source, crop, cell, chunk_frames, cols, encoder, clips, graph, root=ROOT):
    """The v4 manifest for a finished set of clips (each chunk already carries its fingerprinted file name)."""
    fps = 30
    check_graph(graph, clips, fps)
    total = sum(c["bytes"] for clip in clips.values() for c in clip["chunks"])
    check_budget(graph, total)
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
