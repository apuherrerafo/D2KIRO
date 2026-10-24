// F1 checkpoint: freeze an exam run as an immutable, verifiable reference (no scoring, no engine code).
//
//   bun scripts/p1-exam/checkpoint.ts --write  --id=F1 --exam=ENGINE_P1_EXAM_F1_FINAL --base=<sha> --content=<sha> --key-commitment=<hex> [--m1=ENGINE_P1_EXAM_F1_FINAL_M1_200]
//   bun scripts/p1-exam/checkpoint.ts --verify --id=F1 [--tag=checkpoint/f1-v1]
//
// The manifest copies what the exam already recorded (identity, config, seeds, command) and pins the result files by SHA-256.
// The blind A/B key is NEVER read here: only a salted commitment computed outside the repo is recorded, so the key cannot be
// recovered from the manifest (a plain hash of 12 binary choices is brute-forceable).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

export const MANIFEST_SCHEMA = "f1-checkpoint/v1";
const ROOT = resolve(import.meta.dir, "../..");
const DIAGNOSTICS = "docs/diagnostics";
/** Between the code that was measured and the checkpoint, only documentation and this checkpoint tooling (it measures nothing) may change. */
export const DOCS_ONLY_PREFIXES = ["docs/", ".gitignore", "scripts/p1-exam/checkpoint."] as const;
const SEEDS_PER_SIDE_PAIR = 2;

export const LAB_RULE =
  "The primary unit of comparison is the SAME PICK MOMENT, not just the same draft. Every version (F1, F1+F2, F1+F2+F3, F1+F2+F3+F4) must receive exactly the same decision state: " +
  "allies and their positions, visible rivals, bans, evaluated position, Hero Pool, perspective and data snapshot. Information from future picks is never used. " +
  "A full autonomous draft is a SECONDARY test, because different decisions produce different paths.";

export interface ManifestFile { path: string; sha256: string }
export interface F1Manifest {
  schema: typeof MANIFEST_SCHEMA;
  id: string;
  status: string;
  integration: { branch: string; baseCommit: string; contentCommit: string; tag: string; tagTargetAddsOnly: string };
  exam: {
    certificationId: string; codeCommit: string; contentStateHash: string; comparableKey: string; runtime: Record<string, string>;
    reproduce: string[]; config: Record<string, unknown>; seeds: { pattern: string; first: number; last: number; count: number }; coverage: Record<string, unknown>;
  };
  data: { snapshot: Record<string, unknown>; curated: ManifestFile[]; positional: ManifestFile; generated: ManifestFile[]; rulesetTarget: string };
  results: ManifestFile[];
  judge: { packet: ManifestFile; key: { scheme: string; commitment: string; opened: false; location: string } };
  limitations: string[];
  labRule: string;
}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

export function seedsOf(config: { drafts: number; seeds: string }): F1Manifest["exam"]["seeds"] {
  const count = Math.ceil(config.drafts / SEEDS_PER_SIDE_PAIR);
  const pattern = config.seeds.replace(/\d+\.\.$/, "").concat("%03d");
  return { pattern, first: 1, last: count, count };
}

export interface BuildInput {
  id: string; branch: string; baseCommit: string; contentCommit: string; tag: string;
  exam: Record<string, any>; resultFiles: ManifestFile[]; packet: ManifestFile; keyCommitment: string;
}

export function buildManifest(input: BuildInput): F1Manifest {
  const { exam } = input;
  const identity = exam.identity;
  return {
    schema: MANIFEST_SCHEMA,
    id: input.id,
    status: `${input.id} TECHNICAL REFERENCE, NO STRATEGIC CERTIFICATION`,
    integration: { branch: input.branch, baseCommit: input.baseCommit, contentCommit: input.contentCommit, tag: input.tag, tagTargetAddsOnly: "docs/checkpoints/" },
    exam: {
      certificationId: identity.certificationId,
      codeCommit: identity.code.head,
      contentStateHash: identity.code.contentStateHash,
      comparableKey: identity.comparableKey,
      runtime: identity.runtime,
      reproduce: identity.reproduce ?? [],
      config: exam.config,
      seeds: seedsOf(exam.config),
      coverage: exam.coverage,
    },
    data: {
      snapshot: identity.data.empiricalSnapshot,
      curated: identity.data.curatedData,
      positional: { path: identity.data.positionalDataset.path, sha256: identity.data.positionalDataset.sha256 },
      generated: identity.data.generatedData,
      rulesetTarget: identity.data.rulesetTarget,
    },
    results: input.resultFiles,
    judge: {
      packet: input.packet,
      key: { scheme: "sha256(salt || keyfile); salt and key kept outside the repository, revealed together after the judge has answered", commitment: input.keyCommitment, opened: false, location: "private, not recorded" },
    },
    limitations: exam.limitations,
    labRule: LAB_RULE,
  };
}

export interface VerifyContext {
  fileSha256(path: string): string | null;
  readJson(path: string): Record<string, any> | null;
  isAncestor(older: string, newer: string): boolean;
  changedFiles(from: string, to: string): string[];
  resolveCommit(ref: string): string | null;
}

/** Empty list = the manifest still describes reality. Never reads the private key. */
export function verifyManifest(manifest: F1Manifest, ctx: VerifyContext, options: { tag?: string } = {}): string[] {
  const problems: string[] = [];
  if (manifest.schema !== MANIFEST_SCHEMA) problems.push(`unexpected schema ${String(manifest.schema)}`);
  if (manifest.judge.key.opened !== false) problems.push("the judge key is recorded as opened");
  if (/(?<![A-Za-z])[A-Za-z]:[\\/]|\\\\/.test(JSON.stringify(manifest))) problems.push("the manifest contains an absolute path");
  if (!/^[0-9a-f]{64}$/.test(manifest.judge.key.commitment)) problems.push("key commitment is not a sha256");

  for (const file of [...manifest.results, manifest.judge.packet, ...manifest.data.curated, manifest.data.positional, ...manifest.data.generated]) {
    const actual = ctx.fileSha256(file.path);
    if (actual === null) problems.push(`missing file ${file.path}`);
    else if (actual !== file.sha256) problems.push(`hash mismatch ${file.path}`);
  }

  const examJson = ctx.readJson(`${DIAGNOSTICS}/${manifest.exam.certificationId}.json`);
  if (examJson === null) problems.push("exam JSON not readable");
  else {
    const identity = examJson.identity;
    const same: Array<[string, unknown, unknown]> = [
      ["codeCommit", manifest.exam.codeCommit, identity?.code?.head],
      ["contentStateHash", manifest.exam.contentStateHash, identity?.code?.contentStateHash],
      ["comparableKey", manifest.exam.comparableKey, identity?.comparableKey],
      ["config", JSON.stringify(manifest.exam.config), JSON.stringify(examJson.config)],
      ["snapshot", JSON.stringify(manifest.data.snapshot), JSON.stringify(identity?.data?.empiricalSnapshot)],
      ["limitations", JSON.stringify(manifest.limitations), JSON.stringify(examJson.limitations)],
    ];
    for (const [name, mine, theirs] of same) if (mine !== theirs) problems.push(`manifest and exam disagree on ${name}`);
  }

  const { codeCommit } = manifest.exam;
  const { baseCommit, contentCommit } = manifest.integration;
  if (!ctx.isAncestor(baseCommit, contentCommit)) problems.push("base commit is not an ancestor of the content commit");
  if (!ctx.isAncestor(codeCommit, contentCommit)) problems.push("the measured code commit is not in the content history");
  else {
    const touched = ctx.changedFiles(codeCommit, contentCommit).filter((path) => !DOCS_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix)));
    if (touched.length > 0) problems.push(`code changed after the measurement: ${touched.slice(0, 5).join(", ")}`);
  }

  if (options.tag !== undefined) {
    const target = ctx.resolveCommit(options.tag);
    if (target === null) problems.push(`tag ${options.tag} does not exist`);
    else {
      if (!ctx.isAncestor(contentCommit, target)) problems.push("the tag does not contain the content commit");
      const extra = ctx.changedFiles(contentCommit, target).filter((path) => !path.startsWith(manifest.integration.tagTargetAddsOnly));
      if (extra.length > 0) problems.push(`the tag adds files beyond ${manifest.integration.tagTargetAddsOnly}: ${extra.slice(0, 5).join(", ")}`);
    }
  }
  return problems;
}

function gitOut(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const realContext: VerifyContext = {
  fileSha256: (path) => (existsSync(join(ROOT, path)) ? sha256(readFileSync(join(ROOT, path))) : null),
  readJson: (path) => (existsSync(join(ROOT, path)) ? JSON.parse(readFileSync(join(ROOT, path), "utf8")) : null),
  isAncestor: (older, newer) => {
    try { execFileSync("git", ["merge-base", "--is-ancestor", older, newer], { cwd: ROOT }); return true; } catch { return false; }
  },
  changedFiles: (from, to) => gitOut(["diff", "--name-only", from, to]).split("\n").filter((line) => line.length > 0),
  resolveCommit: (ref) => {
    try { return gitOut(["rev-parse", `${ref}^{commit}`]); } catch { return null; }
  },
};

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function main(): void {
  const id = arg("id") ?? "F1";
  const manifestPath = join(ROOT, "docs/checkpoints", `${id}.json`);
  if (process.argv.includes("--write")) {
    const examName = arg("exam");
    const base = arg("base"), content = arg("content"), commitment = arg("key-commitment");
    if (!examName || !base || !content || !commitment) throw new Error("--write needs --exam, --base, --content and --key-commitment");
    const names = [examName, arg("m1")].filter((n): n is string => typeof n === "string");
    const hash = (path: string): ManifestFile => ({ path, sha256: realContext.fileSha256(path) ?? (() => { throw new Error(`missing ${path}`); })() });
    const exam = realContext.readJson(`${DIAGNOSTICS}/${examName}.json`)!;
    const manifest = buildManifest({
      id, branch: arg("branch") ?? "integration/f1-reference", baseCommit: gitOut(["rev-parse", base]), contentCommit: gitOut(["rev-parse", content]), tag: arg("tag") ?? "checkpoint/f1-v1",
      exam,
      resultFiles: names.flatMap((n) => [hash(`${DIAGNOSTICS}/${n}.json`), hash(`${DIAGNOSTICS}/${n}.md`)]).concat(hash(`${DIAGNOSTICS}/F1_CLOSURE.md`)),
      packet: hash(`${DIAGNOSTICS}/${examName}_JUDGE.md`),
      keyCommitment: commitment,
    });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${manifestPath}`);
    return;
  }
  if (process.argv.includes("--verify")) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as F1Manifest;
    const problems = verifyManifest(manifest, realContext, { tag: arg("tag") });
    if (problems.length > 0) { console.error(problems.map((p) => `FAIL ${p}`).join("\n")); process.exit(1); }
    console.log(`OK ${manifest.id}: ${manifest.status} · code ${manifest.exam.codeCommit.slice(0, 7)} · content ${manifest.integration.contentCommit.slice(0, 7)}`);
    return;
  }
  throw new Error("use --write or --verify");
}

if (import.meta.main) main();
