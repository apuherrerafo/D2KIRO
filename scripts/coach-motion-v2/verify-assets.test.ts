// verify-assets.mjs against tampered copies of the shipped tree: every way a Motion V2 pack, its manifest, the Gold Master or the static fallback can drift must fail it.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = join(REPO, "scripts/coach-motion-v2/verify-assets.mjs");
const PACK = "apps/web/public/coach-motion-v2/prod/384";
const GM = "apps/web/public/coach-gold-master/modular";
const STATIC = "apps/web/public/coach-web-pack/hero";
const made: string[] = [];

/** A private copy of just the files the checker reads (pack 384, Gold Master, static stills, toolchain + identity lock). */
function tree(): string {
  const root = mkdtempSync(join(tmpdir(), "cm-assets-"));
  made.push(root);
  for (const p of [PACK, GM, STATIC, "scripts/coach-motion-v2/toolchain.json", "scripts/coach-motion-v2/identity.lock.json"]) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    cpSync(join(REPO, p), join(root, p), { recursive: true });
  }
  return root;
}
const run = (root: string, ...extra: string[]) => {
  const r = spawnSync("node", [SCRIPT, "--root", root, "--pack", "384", ...extra], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const manifestPath = (root: string) => join(root, PACK, "manifest.json");
const editManifest = (root: string, fn: (m: any) => void) => {
  const m = JSON.parse(readFileSync(manifestPath(root), "utf8"));
  fn(m);
  writeFileSync(manifestPath(root), JSON.stringify(m));
};
const firstChunk = (root: string) => join(root, PACK, readdirSync(join(root, PACK)).find((f) => f.endsWith(".avif"))!);
/** same rule as pack_manifest.combined_id / verify-assets.mjs */
const combinedId = (files: Record<string, string>) => createHash("sha256").update(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)).map(([n, s]) => `${n}:${s}\n`).join("")).digest("hex").slice(0, 12);
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("verify-assets · the shipped tree", () => {
  test("recalculates every chunk SHA-256 and passes on the committed packs (384 and 512)", () => {
    const r = spawnSync("node", [SCRIPT], { encoding: "utf8" });
    expect(r.stdout).toContain("ALL PASS");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/384: 271 chunk files match/);
    expect(r.stdout).toMatch(/512: 78 chunk files match/);
  });
});

describe("verify-assets · it fails on a mismatch", () => {
  test("a pristine copy passes", () => {
    expect(run(tree()).code).toBe(0);
  });

  test("one flipped byte in a chunk fails (SHA-256)", () => {
    const root = tree();
    const f = firstChunk(root);
    const buf = readFileSync(f);
    buf[buf.length >> 1] ^= 0xff;
    writeFileSync(f, buf);
    const r = run(root);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL 384: 271 chunk files.*sha256/);
  });

  test("a missing chunk, an unreferenced AVIF and a wrong packHash each fail", () => {
    let root = tree();
    rmSync(firstChunk(root));
    expect(run(root).out).toMatch(/missing/);

    root = tree();
    writeFileSync(join(root, PACK, "stale.deadbeef0000.avif"), "x");
    expect(run(root).out).toMatch(/FAIL 384: no unreferenced AVIF/);

    root = tree();
    editManifest(root, (m) => void (m.packHash = "0".repeat(64)));
    expect(run(root).out).toMatch(/FAIL 384: packHash recomputes/);
  });

  test("a chunk renamed away from its content address fails (an old URL must never carry new bytes)", () => {
    const root = tree();
    editManifest(root, (m) => void (m.clips.WATCHING_LOOP.chunks[0].file = "watching-00.avif"));
    expect(run(root).code).toBe(1);
  });

  test("an encoder that is not the pinned toolchain fails", () => {
    const root = tree();
    editManifest(root, (m) => void (m.encoder.library = "Pillow 11.0.0"));
    expect(run(root).out).toMatch(/FAIL 384: encoder equals toolchain.json/);
  });
});

describe("verify-assets · fallback version check (new Motion V2 + old static fallback is detected)", () => {
  test("a changed Gold Master without regenerating the motion pack fails", () => {
    const root = tree();
    const f = join(root, GM, "coach-modular.json");
    writeFileSync(f, `${readFileSync(f, "utf8")} `);
    const r = run(root);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL 384: Gold Master id matches the repo/);
    expect(r.out).toMatch(/FAIL static fallback was built from the CURRENT Gold Master/);
  });

  test("motion regenerated for a new Gold Master but the static stills left as they were: NEW motion + OLD fallback fails", () => {
    const root = tree();
    const f = join(root, GM, "coach-modular.json");
    writeFileSync(f, `${readFileSync(f, "utf8")} `);
    const files = { "coach-modular.json": sha(f), "coach-modular.bin": sha(join(root, GM, "coach-modular.bin")) };
    editManifest(root, (m) => void (m.provenance.goldMaster = { id: combinedId(files), files })); // what encode.py would record
    const r = run(root);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/FAIL 384: Gold Master id/);
    expect(r.out).toMatch(/FAIL static fallback was built from the CURRENT Gold Master/);
    expect(r.out).toMatch(/regenerate the static fallback, then --seal-fallback/);
  });

  test("static stills regenerated without sealing the fallback lock fails; sealing refuses a Gold Master change that left the stills byte-identical", () => {
    const root = tree();
    const still = join(root, STATIC, "watching-c.webp");
    writeFileSync(still, Buffer.concat([readFileSync(still), Buffer.from([0])]));
    const r = run(root);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL static fallback stills match identity.lock.json/);

    const root2 = tree();
    const gm = join(root2, GM, "coach-modular.json");
    writeFileSync(gm, `${readFileSync(gm, "utf8")} `);
    const seal = run(root2, "--seal-fallback");
    expect(seal.code).toBe(1);
    expect(seal.out).toMatch(/REFUSED/);
    expect(run(root2, "--seal-fallback", "--static-unchanged-ok").code).toBe(0);
  });
});
