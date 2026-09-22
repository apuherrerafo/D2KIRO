#!/usr/bin/env bun
// WAVE 5 -- PRODUCT CERTIFICATION SMOKE. One command, one exit code:
//
//   bun run test:wave5:smoke                       (0 = PASS, non-zero = FAIL)
//   bun run test:wave5:smoke -- --skip-evidence    (skips the ~2.5 min real-data run; the result is then INCOMPLETE, never PASS)
//
// Runs (1) the engine release-certification suites (hidden-information matrix, Team/Personal isolation, Flex, Safe Core, compound
// fallback, seed determinism, the design.md §7/§15 hidden-information cases, the /engine proxy allowlist) as a fast preflight, then
// (2) the real-browser journeys through the EXISTING Playwright harness (production web build + real engine + fixture DB), then
// (3) the real-data evidence run (scripts/wave5-certification.ts: soak, hidden-information twins, isolation, fallback, Safe Core,
// latency). It writes docs/diagnostics/WAVE5_AUTOMATED_ACCEPTANCE.md from the actual results; failures are reported as failures.
// Certifies the PRODUCT PATH, not recommendation quality (that is the independent Dota Judge, WAVE5_DOTA_JUDGE.*).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const REPORT_PATH = resolve(ROOT, "docs/diagnostics/WAVE5_AUTOMATED_ACCEPTANCE.md");
const JSON_PATH = resolve(ROOT, "test-results/wave5-playwright.json");
const skipEvidence = process.argv.includes("--skip-evidence");

const ENGINE_TEST_PATHS = [
  "apps/engine/src/coach",
  "apps/engine/src/recommendation",
  "apps/engine/src/draft-protocol",
  "apps/engine/src/simulator",
  "apps/engine/src/drafter/decision-context.test.ts",
  "apps/engine/src/server/routes/protocol-sessions.coach.test.ts",
  "apps/engine/src/server/routes/protocol-sessions.recommendations.test.ts",
  "apps/engine/src/server/routes/protocol-sessions.ap-simulator.test.ts",
  "apps/web/next.config.test.ts",
  "scripts/wave5",
];

interface Row {
  title: string;
  status: string;
  durationMs: number;
  annotations: { type: string; description: string }[];
  error: string | null;
  attachments: string[];
}

function sh(command: string, args: string[]): { code: number; out: string } {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function collect(node: any, rows: Row[]): void {
  for (const suite of node.suites ?? []) collect(suite, rows);
  for (const spec of node.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const results = test.results ?? [];
      const last = results.at(-1) ?? {};
      rows.push({
        title: spec.title,
        status: test.status === "expected" ? "PASS" : test.status === "skipped" ? "SKIPPED" : test.status === "flaky" ? "FLAKY (failed then passed)" : "FAIL",
        durationMs: results.reduce((sum: number, result: any) => sum + (result.duration ?? 0), 0),
        annotations: (test.annotations ?? []).map((annotation: any) => ({ type: annotation.type, description: annotation.description ?? "" })),
        error: last.error?.message ? String(last.error.message).replace(/\[[0-9;]*m/g, "").split("\n").slice(0, 8).join("\n") : null,
        attachments: (last.attachments ?? []).flatMap((attachment: any) => (attachment.path ? [String(attachment.path).replace(ROOT, ".").replaceAll("\\", "/")] : [])),
      });
    }
  }
}

function countBunTests(out: string): { pass: number; fail: number } {
  return { pass: Number(/^\s*(\d+) pass/m.exec(out)?.[1] ?? 0), fail: Number(/^\s*(\d+) fail/m.exec(out)?.[1] ?? 0) };
}

const startedAt = new Date();
console.log("[wave5-smoke] 1/3 engine release-certification preflight...");
const preflight = sh("bun", ["test", ...ENGINE_TEST_PATHS]);
const engine = countBunTests(preflight.out);
console.log(`[wave5-smoke]     engine/web-config/tooling: ${engine.pass} pass, ${engine.fail} fail (exit ${preflight.code})`);
if (preflight.code !== 0) console.log(preflight.out.split("\n").slice(-40).join("\n"));

console.log("[wave5-smoke] 2/3 real-browser MVP journeys (headless Playwright)...");
mkdirSync(resolve(ROOT, "test-results"), { recursive: true });
rmSync(JSON_PATH, { force: true });
const playwright = spawnSync("bun", ["run", "e2e", "--", "e2e/wave5-certification.spec.ts", "--reporter=list,json"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: JSON_PATH },
});
const playwrightCode = playwright.status ?? 1;

const rows: Row[] = [];
let parseError: string | null = null;
if (existsSync(JSON_PATH)) {
  try {
    collect(JSON.parse(readFileSync(JSON_PATH, "utf8")), rows);
  } catch (error) {
    parseError = (error as Error).message;
  }
} else {
  parseError = "Playwright produced no JSON report (it may have failed before running any test).";
}

let evidenceCode = 0;
let evidenceSummary = "skipped (--skip-evidence)";
if (!skipEvidence) {
  console.log("[wave5-smoke] 3/3 real-data evidence run (soak, hidden-information twins, isolation, latency)...");
  const evidence = sh("bun", ["scripts/wave5-certification.ts"]);
  evidenceCode = evidence.code;
  evidenceSummary = evidence.out.split("\n").filter((line) => line.startsWith("[wave5-certification]")).join(" ") || `exit ${evidence.code}`;
  console.log(evidence.out.split("\n").slice(-20).join("\n"));
}

const passed = rows.filter((row) => row.status === "PASS").length;
const failed = rows.length - passed;
const head = sh("git", ["rev-parse", "HEAD"]).out.trim();
const dirty = sh("git", ["status", "--porcelain"]).out.trim().length > 0;
const overallPass = preflight.code === 0 && playwrightCode === 0 && parseError === null && rows.length > 0 && failed === 0 && evidenceCode === 0 && !skipEvidence;

const AREAS: { match: RegExp; area: string }[] = [
  { match: /^J1\./, area: "Complete Radiant journey (Pos2, Hero Pool, Flex assignment, deviation)" },
  { match: /^J2\./, area: "Complete Dire journey (Pos5, Hero Pool)" },
  { match: /^J3\./, area: "Side symmetry" },
  { match: /^H\./, area: "Hidden information (real HTTP path)" },
  { match: /^C1\./, area: "Collision #1" },
  { match: /^C3/, area: "Collision #3 (authority)" },
];
const areaOf = (row: Row) => AREAS.find((entry) => entry.match.test(row.title))?.area ?? "Other";

const lines: string[] = [];
lines.push("# Wave 5 — Automated Product Certification Report", "");
lines.push(`**Result: ${overallPass ? "PASS" : skipEvidence ? "INCOMPLETE (evidence run skipped)" : "FAIL"}**`, "");
lines.push(`- Run started: ${startedAt.toISOString()}  (duration ${Math.round((Date.now() - startedAt.getTime()) / 1000)} s)`);
lines.push(`- Git HEAD: \`${head}\`${dirty ? " (+ uncommitted working-tree changes)" : ""}`);
lines.push("- Command: `bun run test:wave5:smoke`");
lines.push("- Environment: headless Chromium, production web build, real engine (`index.e2e.ts`), deterministic fixture DB (50 heroes) for the browser layer; real meta snapshot (SQLite readonly) for the evidence run");
lines.push(`- Engine/web-config/tooling preflight: ${engine.pass} pass / ${engine.fail} fail`);
lines.push(`- Browser scenarios: ${passed}/${rows.length} pass`);
lines.push(`- Playwright exit code: ${playwrightCode}`);
lines.push(`- Real-data evidence run: ${evidenceSummary}`, "");
if (parseError) lines.push(`> **Report problem:** ${parseError}`, "");

lines.push("## Browser scenarios", "", "| Area | Scenario | Seed(s) | Coach primary action kinds (in order) | Result | Time |", "|---|---|---|---|---|---|");
for (const row of rows) {
  const seeds = row.annotations.filter((annotation) => annotation.type === "seed").map((annotation) => annotation.description).join(", ") || "—";
  const kinds = row.annotations.find((annotation) => annotation.type === "coach-strategy-kinds")?.description ?? "—";
  lines.push(`| ${areaOf(row)} | ${row.title.replaceAll("|", "\\|")} | ${seeds} | ${kinds} | ${row.status} | ${(row.durationMs / 1000).toFixed(1)} s |`);
}
lines.push("");
const uxFindings = rows.flatMap((row) => row.annotations.filter((annotation) => annotation.type.startsWith("ux-")).map((annotation) => `${annotation.type}: ${annotation.description}`));
lines.push("## UX observations recorded by the browser run (not failures — see WAVE5_PRODUCT_CERTIFICATION.md)", "");
lines.push(...(uxFindings.length ? [...new Set(uxFindings)].map((finding) => `- ${finding}`) : ["_None recorded._"]), "");
lines.push("## Failures", "");
const failingRows = rows.filter((row) => row.status !== "PASS");
if (failingRows.length === 0 && preflight.code === 0 && !parseError && evidenceCode === 0) lines.push("None.", "");
else {
  if (preflight.code !== 0) lines.push(`- Engine preflight failed (exit ${preflight.code}) — run \`bun test ${ENGINE_TEST_PATHS.join(" ")}\` for details.`);
  if (evidenceCode !== 0 && !skipEvidence) lines.push("- The real-data evidence run failed — see `docs/diagnostics/WAVE5_AUTOMATED_EVIDENCE.md`.");
  for (const row of failingRows) {
    lines.push(`- **${row.title}** — ${row.status}`);
    if (row.error) lines.push("  ```", ...row.error.split("\n").map((line) => `  ${line}`), "  ```");
    for (const attachment of row.attachments) lines.push(`  - evidence: \`${attachment}\``);
  }
  lines.push("");
}
lines.push("## Scope", "", "Certifies the PRODUCT PATH end to end (browser → /engine proxy → perspective-safe route → Coach → real V6 → DOM) and the invariants the MVP is sold on. It does **not** judge whether the advice is good Dota — that is the independent Dota Judge review (`docs/diagnostics/WAVE5_DOTA_JUDGE.*`). Task 26 (side context) and Task 27 (one-ply) are intentionally deferred from the MVP.", "");
lines.push("## What still needs a human", "", "A short visual check only (layout/legibility of the Coach panel: primary action, team shortlist, personal `TU … AHORA` view, Flex row and Safe Core block next to the round panel) and the Product Owner sign-off tasks 35/36 of tasks.md.", "");

mkdirSync(resolve(ROOT, "docs/diagnostics"), { recursive: true });
writeFileSync(REPORT_PATH, lines.join("\n"));
console.log(`[wave5-smoke] report: ${REPORT_PATH.replace(ROOT, ".")}`);
console.log(`[wave5-smoke] ${overallPass ? "PASS" : "FAIL"} — browser ${passed}/${rows.length}, engine preflight ${engine.pass} pass/${engine.fail} fail, evidence: ${evidenceSummary}`);
process.exit(overallPass ? 0 : 1);
