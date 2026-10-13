"""One-off: turn the approved v3 pack folders into v4 WITHOUT re-encoding. The AVIF bytes are untouched (their sha256 is checked against the v3 manifest first);
the files are renamed to their content-addressed names and the manifest gains the graph, limits, provenance and packHash. Kept for traceability of how the approved slice
moved to v4; a regenerated pack (encode.py) produces the same layout directly.
usage: python -I scripts/coach-motion-v2/migrate_v3_to_v4.py apps/web/public/coach-motion-v2/prod/384 [more pack dirs]"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pack_manifest as pm

graph = pm.load_graph()
for pack_dir in sys.argv[1:]:
    path = os.path.join(pack_dir, "manifest.json")
    v3 = json.load(open(path, encoding="utf-8"))
    if v3.get("version") != 3:
        raise SystemExit(f"{path}: version {v3.get('version')}, expected 3")
    if v3["headStride"] != graph["edges"][0]["entry"]["stride"]:
        raise SystemExit(f"{path}: headStride {v3['headStride']} differs from graph.json")
    renames = []
    for cid, clip in v3["clips"].items():
        for i, c in enumerate(clip["chunks"]):
            old = os.path.join(pack_dir, c["file"])
            sha = pm.sha256_file(old)
            if sha != c["sha256"]:
                raise SystemExit(f"{old}: sha256 {sha} does not match the v3 manifest ({c['sha256']}); refusing to migrate")
            stem = c["file"][: -len(".avif")]
            c["file"] = pm.fingerprint_name(stem, sha)
            renames.append((old, os.path.join(pack_dir, c["file"])))
            pm.check_atlas(cid, i, c["w"], c["h"])
    for old, new in renames:
        os.replace(old, new)
    manifest = pm.assemble(
        pack=v3["pack"], px=v3["srcPx"], source=v3["source"], crop=v3["crop"], cell=v3["cell"], chunk_frames=v3["chunkFrames"], cols=v3["cols"],
        encoder=v3["encoder"], clips=v3["clips"], graph=graph,
    )
    if manifest["totalBytes"] != v3["totalBytes"]:
        raise SystemExit(f"{path}: totalBytes changed ({v3['totalBytes']} -> {manifest['totalBytes']})")
    json.dump(manifest, open(path, "w", newline="\n"), indent=1)
    print(f"{pack_dir}: {len(renames)} chunks renamed, packHash {manifest['packHash'][:12]}")
