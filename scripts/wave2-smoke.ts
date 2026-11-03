#!/usr/bin/env bun
// WAVE 2 -- AUTOMATED PRODUCT ACCEPTANCE SMOKE (Coach orchestration). One command, one exit code:
//
//   bun run test:wave2:smoke        (0 = Wave 2 automated smoke PASS, non-zero = FAIL)
//
// Runs (1) the engine-level Wave 2 certification tests (Coach layer, hidden-twin isolation,
// architecture guard, V3 route, decision context) as a fast preflight, then (2) the real-browser
// scenarios through the EXISTING Playwright harness (playwright.config.ts: production web build + real
// engine + fixture DB, headless) -- the same infrastructure `test:wave1:smoke` uses. It writes
// docs/diagnostics/WAVE2_AUTOMATED_ACCEPTANCE.md from the actual results; failures are reported as
// failures. Failure evidence (screenshot, trace) stays under test-results/.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const REPORT_PATH = resolve(ROOT, "docs/diagnostics/WAVE2_AUTOMATED_ACCEPTANCE.md");
const JSON_PATH = resolve(ROOT, "test-results/wave2-playwright.json");

const ENGINE_TEST_PATHS = [
  "apps/engine/src/coach",
  "apps/engine/src/recommendation",
  "apps/engine/src/drafter/decision-context.test.ts",
  "apps/engine/src/server/routes/protocol-sessions.coach.test.ts",
  "apps/engine/src/server/routes/protocol-sessions.recommendations.test.ts",
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
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
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
console.log("[wave2-smoke] 1/2 engine certification preflight...");
const preflight = sh("bun", ["test", ...ENGINE_TEST_PATHS]);
const engine = countBunTests(preflight.out);
console.log(`[wave2-smoke]     engine: ${engine.pass} pass, ${engine.fail} fail (exit ${preflight.code})`);
if (preflight.code !== 0) console.log(preflight.out.split("\n").slice(-40).join("\n"));

console.log("[wave2-smoke] 2/2 real-browser Coach acceptance (headless Playwright)...");
mkdirSync(resolve(ROOT, "test-results"), { recursive: true });
rmSync(JSON_PATH, { force: true });
const playwright = spawnSync("bun", ["run", "e2e", "--", "e2e/wave2-acceptance.spec.ts", "--reporter=list,json"], {
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

const passed = rows.filter((row) => row.status === "PASS").length;
const failed = rows.length - passed;
const head = sh("git", ["rev-parse", "HEAD"]).out.trim();
const dirty = sh("git", ["status", "--porcelain"]).out.trim().length > 0;
const overallPass = preflight.code === 0 && playwrightCode === 0 && parseError === null && rows.length > 0 && failed === 0;

const SCENARIOS: { match: RegExp; area: string }[] = [
  { match: /^A\./, area: "Radiant: Coach orchestration across a full draft" },
  { match: /^B\./, area: "Dire: Coach orchestration across a full draft" },
  { match: /^C\./, area: "Player ignores the advice" },
  { match: /^D\./, area: "Hidden information isolation" },
];
const areaOf = (row: Row) => SCENARIOS.find((entry) => entry.match.test(row.title))?.area ?? "Other";

const lines: string[] = [];
lines.push("# Wave 2 — Automated Acceptance Report (Coach orchestration)", "");
lines.push(`**Result: ${overallPass ? "PASS" : "FAIL"}**`, "");
lines.push(`- Run started: ${startedAt.toISOString()}  (duration ${Math.round((Date.now() - startedAt.getTime()) / 1000)} s)`);
lines.push(`- Git HEAD: \`${head}\`${dirty ? " (+ uncommitted working-tree changes)" : ""}`);
lines.push("- Command: `bun run test:wave2:smoke`");
lines.push("- Environment: headless Chromium, production web build, real engine (`index.e2e.ts`), deterministic fixture DB (50 heroes)");
lines.push(`- Engine certification preflight: ${engine.pass} pass / ${engine.fail} fail`);
lines.push(`- Browser scenarios: ${passed}/${rows.length} pass`);
lines.push(`- Playwright exit code: ${playwrightCode}`, "");
if (parseError) lines.push(`> **Report problem:** ${parseError}`, "");

lines.push("## Scenarios", "", "| Area | Scenario | Seed(s) | Coach primary action per round | Result | Time |", "|---|---|---|---|---|---|");
for (const row of rows) {
  const seeds = row.annotations.filter((annotation) => annotation.type === "seed").map((annotation) => annotation.description).join(", ") || "—";
  const kinds = row.annotations.find((annotation) => annotation.type === "coach-strategy-kinds")?.description ?? "—";
  lines.push(`| ${areaOf(row)} | ${row.title.replaceAll("|", "\\|")} | ${seeds} | ${kinds} | ${row.status} | ${(row.durationMs / 1000).toFixed(1)} s |`);
}
lines.push("");

lines.push("## What each scenario proves", "");
lines.push("- **A / B (Radiant, Dire):** in every round an actionable Coach primary action + shortlist is on screen before the Player picks; right after own pick #1 (round not closed, nothing revealed) the Coach has recomputed (`trigger = OWN_PICK_CONFIRMED`, new revision, new state identity, own hero gone from the shortlist); after each enemy reveal it recomputes again (`ROUND_REVEALED`); revisions are monotonic; the full draft still completes; no HTTP 4xx/5xx; no Simulator Truth key is ever serialized.");
lines.push("- **C (ignore the advice):** a legal hero outside the Coach shortlist is accepted with no rejection notice and no 'wrong choice' text, and the Coach recomputes; the draft continues.");
lines.push("- **D (hidden information):** two sessions with the same seed and bans whose Enemy Bot seats are forced (test-only seam) to DIFFERENT hidden heroes produce a byte-identical Coach output AND V2 set before the reveal; after the reveal the state identity legally diverges. Hidden slots never carry a hero id in any response.", "");

lines.push("## Failures", "");
const failingRows = rows.filter((row) => row.status !== "PASS");
if (failingRows.length === 0 && preflight.code === 0 && !parseError) lines.push("None.", "");
else {
  if (preflight.code !== 0) lines.push(`- Engine preflight failed (exit ${preflight.code}) — run \`bun test ${ENGINE_TEST_PATHS.join(" ")}\` for details.`);
  for (const row of failingRows) {
    lines.push(`- **${row.title}** — ${row.status}`);
    if (row.error) lines.push("  ```", ...row.error.split("\n").map((line) => `  ${line}`), "  ```");
    for (const attachment of row.attachments) lines.push(`  - evidence: \`${attachment}\``);
  }
  lines.push("");
}
lines.push("## Scope", "", "Certifies ORCHESTRATION (legal observable state, no hidden-information cheating, continuous recompute, hierarchy of primary action over shortlist, evidence-scaled specificity, Player authority) — **not** hero quality. Personal position / Hero Pool / Flex UX (Wave 3) and Safe Core / contextual intelligence (Wave 4) are not exercised.", "");
lines.push("## What still needs a human", "", "A short visual check only: layout and legibility of the Coach panel (primary action, shortlist cards, badges) next to the round panel.", "");

mkdirSync(resolve(ROOT, "docs/diagnostics"), { recursive: true });
writeFileSync(REPORT_PATH, lines.join("\n"));
console.log(`[wave2-smoke] report: ${REPORT_PATH.replace(ROOT, ".")}`);
console.log(`[wave2-smoke] ${overallPass ? "PASS" : "FAIL"} — browser ${passed}/${rows.length}, engine preflight ${engine.pass} pass/${engine.fail} fail`);
process.exit(overallPass ? 0 : 1);
