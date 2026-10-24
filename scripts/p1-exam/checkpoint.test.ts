import { describe, expect, test } from "bun:test";
import { buildManifest, DOCS_ONLY_PREFIXES, seedsOf, verifyManifest, type VerifyContext } from "./checkpoint";

// Inline fixtures only: no exam output, no SQLite, no key (invariantes.md). The key is never read by the module.
const sha = (c: string): string => c.repeat(64);
const examJson = {
  identity: {
    certificationId: "EXAM_X", runtime: { bun: "1.0.0" }, comparableKey: sha("c"), reproduce: ["bun run exam"],
    code: { head: "aaa1111", contentStateHash: sha("d") },
    data: { empiricalSnapshot: { id: "SNAP", fileSha256: sha("e") }, curatedData: [{ path: "c.json", sha256: sha("1") }], positionalDataset: { path: "p.json", sha256: sha("2") }, generatedData: [{ path: "g.json", sha256: sha("3") }], rulesetTarget: "7.x" },
  },
  config: { drafts: 120, seeds: "AUDIT001.." }, coverage: { drafts: 120 }, limitations: ["numbers are baselines, not truth"],
};
const files: Record<string, string> = {
  "docs/diagnostics/EXAM_X.json": sha("4"), "docs/diagnostics/EXAM_X.md": sha("5"), "docs/diagnostics/EXAM_X_JUDGE.md": sha("6"), "docs/diagnostics/F1_CLOSURE.md": sha("7"),
  "c.json": sha("1"), "p.json": sha("2"), "g.json": sha("3"),
};
const manifestOf = () => buildManifest({
  id: "F1", branch: "integration/x", baseCommit: "base", contentCommit: "content", tag: "checkpoint/x", exam: examJson,
  resultFiles: ["docs/diagnostics/EXAM_X.json", "docs/diagnostics/EXAM_X.md", "docs/diagnostics/F1_CLOSURE.md"].map((path) => ({ path, sha256: files[path]! })),
  packet: { path: "docs/diagnostics/EXAM_X_JUDGE.md", sha256: files["docs/diagnostics/EXAM_X_JUDGE.md"]! }, keyCommitment: sha("9"),
});
const contextWith = (over: Partial<VerifyContext> = {}): VerifyContext => ({
  fileSha256: (path) => files[path] ?? null,
  readJson: (path) => (path === "docs/diagnostics/EXAM_X.json" ? examJson : null),
  isAncestor: () => true,
  changedFiles: () => ["docs/a.md", ".gitignore"],
  resolveCommit: () => "tagcommit",
  ...over,
});

describe("F1 checkpoint manifest", () => {
  test("a faithful manifest verifies clean and records status, seeds and the lab rule", () => {
    const manifest = manifestOf();
    expect(verifyManifest(manifest, contextWith())).toEqual([]);
    expect(manifest.status).toBe("F1 TECHNICAL REFERENCE, NO STRATEGIC CERTIFICATION");
    expect(manifest.exam.seeds).toEqual({ pattern: "AUDIT%03d", first: 1, last: 60, count: 60 });
    expect(manifest.labRule).toContain("SAME PICK MOMENT");
    expect(manifest.judge.key.opened).toBe(false);
  });

  test("seeds: 120 drafts over two sides -> 60 seeds; odd counts round up", () => {
    expect(seedsOf({ drafts: 120, seeds: "AUDIT001.." }).count).toBe(60);
    expect(seedsOf({ drafts: 121, seeds: "AUDIT001.." }).count).toBe(61);
  });

  test("a result file edited after freezing is caught", () => {
    const problems = verifyManifest(manifestOf(), contextWith({ fileSha256: (path) => (path === "docs/diagnostics/EXAM_X.md" ? sha("f") : files[path] ?? null) }));
    expect(problems).toEqual(["hash mismatch docs/diagnostics/EXAM_X.md"]);
  });

  test("a curated data file changed after the measurement is caught", () => {
    const problems = verifyManifest(manifestOf(), contextWith({ fileSha256: (path) => (path === "c.json" ? sha("f") : files[path] ?? null) }));
    expect(problems).toEqual(["hash mismatch c.json"]);
  });

  test("code touched between the measured commit and the checkpoint is caught; docs-only is not", () => {
    const touched = verifyManifest(manifestOf(), contextWith({ changedFiles: () => ["docs/a.md", "apps/engine/src/signals/mix.ts"] }));
    expect(touched).toEqual(["code changed after the measurement: apps/engine/src/signals/mix.ts"]);
    expect(DOCS_ONLY_PREFIXES).toEqual(["docs/", ".gitignore", "scripts/p1-exam/checkpoint."]);
  });

  test("the manifest cannot drift from the exam identity it claims to freeze", () => {
    const manifest = manifestOf();
    manifest.exam.comparableKey = sha("0");
    expect(verifyManifest(manifest, contextWith())).toEqual(["manifest and exam disagree on comparableKey"]);
  });

  test("the tag may add only docs/checkpoints/ on top of the content commit", () => {
    const manifest = manifestOf();
    const ok = verifyManifest(manifest, contextWith({ changedFiles: (from, to) => (from === "content" && to === "tagcommit" ? ["docs/checkpoints/F1.json"] : ["docs/a.md"]) }), { tag: "checkpoint/x" });
    expect(ok).toEqual([]);
    const bad = verifyManifest(manifest, contextWith({ changedFiles: (from, to) => (from === "content" && to === "tagcommit" ? ["docs/checkpoints/F1.json", "scripts/x.ts"] : ["docs/a.md"]) }), { tag: "checkpoint/x" });
    expect(bad).toEqual(["the tag adds files beyond docs/checkpoints/: scripts/x.ts"]);
    expect(verifyManifest(manifest, contextWith({ resolveCommit: () => null }), { tag: "checkpoint/x" })).toEqual(["tag checkpoint/x does not exist"]);
  });

  test("a manifest that leaks a private path or records the key as opened is rejected", () => {
    const leaked = manifestOf();
    leaked.judge.key.location = "D:/private/key.json";
    expect(verifyManifest(leaked, contextWith())).toContain("the manifest contains an absolute path");
    const opened = manifestOf() as any;
    opened.judge.key.opened = true;
    expect(verifyManifest(opened, contextWith())).toContain("the judge key is recorded as opened");
  });

  test("URLs are not mistaken for absolute paths", () => {
    const withUrl = manifestOf();
    withUrl.limitations = ["see https://example.com/a"];
    expect(verifyManifest(withUrl, contextWith({ readJson: () => ({ ...examJson, limitations: ["see https://example.com/a"] }) }))).toEqual([]);
  });
});
