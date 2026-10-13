// Recalculates the SHA-256 of every Coach Motion V2 production asset and compares it with the manifests; also pins the toolchain and the fallback identity.
// usage: node scripts/coach-motion-v2/verify-assets.mjs [--pack 384] [--root <tree>] [--out report.json]      exit 1 on any mismatch
//        node scripts/coach-motion-v2/verify-assets.mjs --seal-fallback [--static-unchanged-ok]  records the static fallback's identity after it was regenerated (see below)
// No dependencies beyond node:fs / node:crypto, so it runs in CI and on a bare checkout.
//
// What it proves
//   1. every chunk file named by a manifest exists, has the manifest's byte size and SHA-256, and carries that hash in its (immutable-cache) file name
//   2. no AVIF in a pack folder is unreferenced (a stale chunk can never be served by accident), packHash and totalBytes recompute, no atlas exceeds the 2048 px cap
//   3. the encoder block of every manifest equals scripts/coach-motion-v2/toolchain.json
//   4. FALLBACK IDENTITY. The static Coach (public/coach-web-pack/hero/*.webp) comes from a separate pipeline. A Motion V2 pack records the id of the Gold Master
//      and of the static stills it was sealed against; identity.lock.json records which Gold Master the static stills were built from. Shipping NEW motion
//      with an OLD static fallback (or the reverse) therefore fails here:
//        Gold Master changed, motion not regenerated      -> pack.goldMaster.id != repo
//        Gold Master changed, motion regenerated, static not -> lock.staticFallback.builtFromGoldMaster != repo   (fix: regenerate the stills, then --seal-fallback)
//        static stills changed without the lock           -> repo static id != lock / pack
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name) => process.argv.includes(`--${name}`);
// --root points the check at another tree with the same layout (the tests tamper with a copy)
const ROOT = arg("root") ? resolve(arg("root")) : resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKS = join(ROOT, "apps/web/public/coach-motion-v2/prod");
const GOLD_MASTER_DIR = join(ROOT, "apps/web/public/coach-gold-master/modular");
const GOLD_MASTER_FILES = ["coach-modular.json", "coach-modular.bin"];
const STATIC_DIR = join(ROOT, "apps/web/public/coach-web-pack/hero");
const LOCK = join(ROOT, "scripts/coach-motion-v2/identity.lock.json");
const MAX_ATLAS_PX = 2048;

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
/** order-independent identity of named files: sha256 over `name:sha` lines, first 12 hex (same rule as pack_manifest.combined_id) */
const combinedId = (files) => createHash("sha256").update(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([n, s]) => `${n}:${s}\n`).join("")).digest("hex").slice(0, 12);

const goldMaster = Object.fromEntries(GOLD_MASTER_FILES.map((n) => [n, sha256(join(GOLD_MASTER_DIR, n))]));
const staticFiles = Object.fromEntries(readdirSync(STATIC_DIR).filter((f) => f.endsWith(".webp")).sort().map((f) => [f, sha256(join(STATIC_DIR, f))]));
const repoGoldMasterId = combinedId(goldMaster);
const repoStaticId = combinedId(staticFiles);

if (flag("seal-fallback")) {
  const prev = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, "utf8")) : null;
  if (prev && prev.staticFallback.builtFromGoldMaster !== repoGoldMasterId && prev.staticFallback.id === repoStaticId && !flag("static-unchanged-ok")) {
    console.error(`REFUSED: the Gold Master changed (${prev.staticFallback.builtFromGoldMaster} -> ${repoGoldMasterId}) but the static stills are byte-identical to the ones sealed before. Regenerate the static fallback from the new Gold Master first (pass --static-unchanged-ok only if the change cannot alter the stills).`);
    process.exit(1);
  }
  const lock = {
    _comment: "Identity of the static Coach fallback (public/coach-web-pack/hero) and the Gold Master it was built from. Written by `verify-assets.mjs --seal-fallback` AFTER the stills were regenerated; checked by verify-assets.mjs.",
    goldMasterId: repoGoldMasterId,
    staticFallback: { id: repoStaticId, builtFromGoldMaster: repoGoldMasterId, files: staticFiles },
  };
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`sealed: static fallback ${repoStaticId} built from Gold Master ${repoGoldMasterId}`);
  process.exit(0);
}

const report = { goldMasterId: repoGoldMasterId, staticFallbackId: repoStaticId, packs: {}, checks: {} };
const failures = [];
const check = (name, ok, detail) => {
  report.checks[name] = { ok, detail };
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : `- ${detail}`);
  if (!ok) failures.push(name);
};

const toolchain = JSON.parse(readFileSync(join(ROOT, "scripts/coach-motion-v2/toolchain.json"), "utf8"));
const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, "utf8")) : null;
const only = arg("pack");
const dirs = readdirSync(PACKS).filter((d) => statSync(join(PACKS, d)).isDirectory() && existsSync(join(PACKS, d, "manifest.json")) && (!only || d === only));
check("a pack exists", dirs.length > 0, `no pack under ${PACKS}`);

for (const pack of dirs) {
  const dir = join(PACKS, pack);
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const tag = (s) => `${pack}: ${s}`;
  check(tag("manifest version 4"), m.version === 4, `version ${m.version}`);
  const referenced = new Set();
  const bad = [];
  let bytes = 0;
  let chunks = 0;
  const lines = [];
  for (const [clip, c] of Object.entries(m.clips).sort(([a], [b]) => (a < b ? -1 : 1))) {
    c.chunks.forEach((ch, i) => {
      chunks += 1;
      referenced.add(ch.file);
      lines.push(`${clip}/${i}:${ch.sha256}\n`);
      const path = join(dir, ch.file);
      if (!existsSync(path)) return void bad.push(`${ch.file} missing`);
      const buf = readFileSync(path);
      bytes += buf.length;
      const sha = createHash("sha256").update(buf).digest("hex");
      if (sha !== ch.sha256) bad.push(`${ch.file}: sha256 ${sha.slice(0, 12)} != manifest ${ch.sha256.slice(0, 12)}`);
      if (buf.length !== ch.bytes) bad.push(`${ch.file}: ${buf.length} bytes != manifest ${ch.bytes}`);
      if (!ch.file.includes(`.${ch.sha256.slice(0, 12)}.`)) bad.push(`${ch.file}: name does not carry sha256 ${ch.sha256.slice(0, 12)}`);
      if (ch.w > MAX_ATLAS_PX || ch.h > MAX_ATLAS_PX) bad.push(`${ch.file}: atlas ${ch.w}x${ch.h} exceeds ${MAX_ATLAS_PX}`);
    });
  }
  check(tag(`${chunks} chunk files match their SHA-256, size and name`), bad.length === 0, bad.slice(0, 5).join("; ") + (bad.length > 5 ? ` (+${bad.length - 5})` : ""));
  const orphans = readdirSync(dir).filter((f) => f.endsWith(".avif") && !referenced.has(f));
  check(tag("no unreferenced AVIF in the pack folder"), orphans.length === 0, orphans.slice(0, 5).join(", "));
  check(tag("totalBytes recomputes"), bytes === m.totalBytes, `${bytes} != ${m.totalBytes}`);
  const packHash = createHash("sha256").update(lines.join("")).digest("hex");
  check(tag("packHash recomputes"), packHash === m.packHash, `${packHash.slice(0, 12)} != ${String(m.packHash).slice(0, 12)}`);
  const enc = m.encoder;
  check(tag("encoder equals toolchain.json"), enc.library === `Pillow ${toolchain.pillow}` && enc.libavif === toolchain.libavif, `${enc.library} / libavif ${enc.libavif} vs Pillow ${toolchain.pillow} / libavif ${toolchain.libavif}`);
  check(tag("Gold Master id matches the repo (motion not stale)"), m.provenance?.goldMaster?.id === repoGoldMasterId, `pack ${m.provenance?.goldMaster?.id} vs repo ${repoGoldMasterId}: regenerate the pack (encode.py) from the current Gold Master`);
  check(tag("static fallback id matches the repo (fallback not stale vs this pack)"), m.provenance?.staticFallback?.id === repoStaticId, `pack ${m.provenance?.staticFallback?.id} vs repo ${repoStaticId}: the stills changed after this pack was sealed`);
  report.packs[pack] = { packHash: m.packHash, chunks, bytes };
}

check("identity.lock.json exists", lock !== null, "run `verify-assets.mjs --seal-fallback` once the static stills are known good");
if (lock) {
  check("static fallback stills match identity.lock.json", lock.staticFallback.id === repoStaticId, `lock ${lock.staticFallback.id} vs repo ${repoStaticId}: the stills changed without --seal-fallback`);
  check("static fallback was built from the CURRENT Gold Master (no new motion over an old fallback)", lock.staticFallback.builtFromGoldMaster === repoGoldMasterId, `stills sealed against Gold Master ${lock.staticFallback.builtFromGoldMaster}, repo has ${repoGoldMasterId}: regenerate the static fallback, then --seal-fallback`);
}

const out = arg("out");
if (out) writeFileSync(out, JSON.stringify(report, null, 1));
console.log(failures.length ? `FAILED: ${failures.length}` : "ALL PASS");
process.exit(failures.length ? 1 : 0);
