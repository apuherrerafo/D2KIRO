"""One-off: move the approved WATCHING -> ANALYZING edge of a committed v4 pack into its own namespace (ENTRY_HEAD_ -> ENTRY_HEAD_WA_, TRANSITION_TAIL -> TAIL_WA, files head-NNN -> head-wa-NNN,
tail-NN -> tail-wa-NN) WITHOUT re-encoding. The AVIF bytes are untouched (their sha256 is checked against the manifest first and again after the rename); only names, the
graph block and packHash change. A bare `head-` prefix cannot be told apart from the heads of a second edge, so every edge now owns `head-<ns>-` (see graph.json).
usage: python -I scripts/coach-motion-v2/migrate_head_namespace.py apps/web/public/coach-motion-v2/prod/384 [more pack dirs]"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pack_manifest as pm

OLD_HEAD, NEW_HEAD = "ENTRY_HEAD_", "ENTRY_HEAD_WA_"
OLD_TAIL, NEW_TAIL = "TRANSITION_TAIL", "TAIL_WA"


def new_name(clip_id):
    if re.fullmatch(OLD_HEAD + r"\d{3}", clip_id):
        return NEW_HEAD + clip_id[len(OLD_HEAD):]
    return NEW_TAIL if clip_id == OLD_TAIL else clip_id


def new_file(old_file, old_id, new_id):
    """`head-006.<sha12>.avif` -> `head-wa-006.<sha12>.avif`; `tail-01.<sha12>.avif` -> `tail-wa-01.<sha12>.avif`."""
    if old_id == new_id:
        return old_file
    if old_id.startswith(OLD_HEAD):
        return old_file.replace("head-", "head-wa-", 1)
    return old_file.replace("tail", "tail-wa", 1)


graph = pm.load_graph()
wa = next(e for e in graph["edges"] if e["id"] == "watching>analyzing")
for pack_dir in sys.argv[1:]:
    path = os.path.join(pack_dir, "manifest.json")
    m = json.load(open(path, encoding="utf-8"))
    if m.get("version") != 4:
        raise SystemExit(f"{path}: version {m.get('version')}, expected 4")
    edge = m["graph"]["edges"][0]
    if edge["entry"]["headClipPrefix"] == NEW_HEAD:
        print(f"{pack_dir}: already migrated")
        continue
    if edge["entry"]["headClipPrefix"] != OLD_HEAD or edge["tail"]["clip"] != OLD_TAIL or len(m["graph"]["edges"]) != 1:
        raise SystemExit(f"{path}: not the single-edge legacy graph this migration expects")
    renames, clips = [], {}
    for cid, clip in m["clips"].items():
        nid = new_name(cid)
        for c in clip["chunks"]:
            old = os.path.join(pack_dir, c["file"])
            sha = pm.sha256_file(old)
            if sha != c["sha256"]:
                raise SystemExit(f"{old}: sha256 {sha} does not match the manifest ({c['sha256']}); refusing to migrate")
            nf = new_file(c["file"], cid, nid)
            renames.append((old, os.path.join(pack_dir, nf)))
            c["file"] = nf
        clips[nid] = clip
    for old, new in renames:
        os.replace(old, new)
    for _, new in renames:
        assert pm.sha256_file(new)[:12] in new  # the fingerprint is still the content hash
    edge["entry"]["headClipPrefix"] = NEW_HEAD
    edge["tail"]["clip"] = NEW_TAIL
    m["clips"] = clips
    m["packHash"] = pm.pack_hash(clips)
    if (edge["entry"]["stride"], edge["entry"]["maxStepFrames"], edge["entry"]["armHeads"]) != (wa["entry"]["stride"], wa["entry"]["maxStepFrames"], wa["entry"]["armHeads"]):
        raise SystemExit(f"{path}: the committed edge differs from graph.json's watching>analyzing")
    json.dump(m, open(path, "w", newline="\n"), indent=1)
    print(f"{pack_dir}: {len(renames)} chunk files renamed, bytes untouched, packHash {m['packHash'][:12]}")
