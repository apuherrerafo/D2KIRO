#!/usr/bin/env bun
// WAVE 1 -- AUTOMATED PRODUCT ACCEPTANCE SMOKE. One command, one exit code:
//
//   bun run test:wave1:smoke        (0 = Wave 1 automated smoke PASS, non-zero = FAIL)
//
// Runs (1) the engine-level Wave 1 certification tests (collision #3 first-registration, ban policy,
// Enemy Bot, timers, symmetry) as a fast preflight, then (2) the real-browser acceptance scenarios
// and the deterministic multi-seed soak through the EXISTING Playwright harness (playwright.config.ts:
// production web build + real engine + fixture DB, headless). It then writes
// docs/diagnostics/WAVE1_AUTOMATED_ACCEPTANCE.md from the actual results -- failures are reported
// as failures, never hidden. Failure evidence (screenshot, trace, error context) is kept by
// Playwright under test-results/ and linked from the report.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const REPORT_PATH = resolve(ROOT, "docs/diagnostics/WAVE1_AUTOMATED_ACCEPTANCE.md");
const JSON_PATH = resolve(ROOT, "test-results/wave1-playwright.json");

const ENGINE_TEST_PATHS = [
  "apps/engine/src/draft-protocol",
  "apps/engine/src/simulator",
  "apps/engine/src/server/protocol-session.simulator-timer.test.ts",
  "apps/engine/src/server/routes/protocol-sessions.ap-simulator.test.ts",
  "apps/engine/src/server/routes/protocol-sessions.test.ts",
  "apps/engine/src/server/adapter-parity.integration.test.ts",
  "apps/engine/src/server/protocol-session.integration.test.ts",
];

const AREAS: { match: RegExp; area: string }[] = [
  { match: /^A\./, area: "Browser flow: Radiant full draft" },
  { match: /^B\./, area: "Browser flow: Dire full draft" },
  { match: /ban flow|resolved bans|caps nominations|FAIL CLOSED/i, area: "Ban flow (browser)" },
  { match: /timers|expiry/i, area: "Timers and gold penalty" },
  { match: /hidden information|hidden enemy/i, area: "Hidden information + collision smoke" },
  { match: /soak/i, area: "Multi-seed soak (API)" },
];

interface Row {
  title: string;
  status: string;
  durationMs: number;
  seeds: string[];
  soak: { seed: string; side: string; position: number; banPrefs: number; bans: number; collisions: number; failures: string[] }[];
  error: string | null;
  attachments: string[];
}

function sh(command: string, args: string[]): { code: number; out: string } {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function collect(node: any, rows: Row[], titlePrefix: string[] = []): void {
  for (const suite of node.suites ?? []) collect(suite, rows, titlePrefix);
  for (const spec of node.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const results = test.results ?? [];
      const last = results.at(-1) ?? {};
      const annotations: { type: string; description?: string }[] = test.annotations ?? [];
      const soakAnnotation = annotations.find((annotation) => annotation.type === "soak")?.description;
      rows.push({
        title: spec.title,
        status: test.status === "expected" ? "PASS" : test.status === "skipped" ? "SKIPPED" : test.status === "flaky" ? "FLAKY (failed then passed)" : "FAIL",
        durationMs: results.reduce((sum: number, result: any) => sum + (result.duration ?? 0), 0),
        seeds: annotations.filter((annotation) => annotation.type === "seed").map((annotation) => annotation.description ?? ""),
        soak: soakAnnotation ? JSON.parse(soakAnnotation) : [],
        error: last.error?.message ? String(last.error.message).replace(/\[[0-9;]*m/g, "").split("\n").slice(0, 6).join("\n") : null,
        attachments: (last.attachments ?? []).flatMap((attachment: any) => (attachment.path ? [String(attachment.path).replace(ROOT, ".").replaceAll("\\", "/")] : [])),
      });
    }
  }
}

function countBunTests(out: string): { pass: number; fail: number } {
  const pass = /^\s*(\d+) pass/m.exec(out)?.[1];
  const fail = /^\s*(\d+) fail/m.exec(out)?.[1];
  return { pass: Number(pass ?? 0), fail: Number(fail ?? 0) };
}

const startedAt = new Date();
console.log("[wave1-smoke] 1/2 engine certification preflight...");
const preflight = sh("bun", ["test", ...ENGINE_TEST_PATHS]);
const engine = countBunTests(preflight.out);
console.log(`[wave1-smoke]     engine: ${engine.pass} pass, ${engine.fail} fail (exit ${preflight.code})`);
if (preflight.code !== 0) console.log(preflight.out.split("\n").slice(-40).join("\n"));

console.log("[wave1-smoke] 2/2 real-browser acceptance + soak (headless Playwright)...");
mkdirSync(resolve(ROOT, "test-results"), { recursive: true });
rmSync(JSON_PATH, { force: true });
const playwright = spawnSync("bun", ["run", "e2e", "--", "e2e/wave1-acceptance.spec.ts", "e2e/wave1-soak.spec.ts", "--reporter=list,json"], {
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
const browserRows = rows.filter((row) => !/soak/i.test(row.title));
const soakRows = rows.filter((row) => /soak/i.test(row.title));
const soakDrafts = soakRows.flatMap((row) => row.soak);
const soakFailures = soakDrafts.filter((draft) => draft.failures.length > 0);
const areaOf = (row: Row) => AREAS.find((entry) => entry.match.test(row.title))?.area ?? "Other";
const head = sh("git", ["rev-parse", "HEAD"]).out.trim();
const dirty = sh("git", ["status", "--porcelain"]).out.trim().length > 0;

const overallPass = preflight.code === 0 && playwrightCode === 0 && parseError === null && rows.length > 0 && failed === 0 && soakFailures.length === 0;

const lines: string[] = [];
lines.push("# Wave 1 — Automated Acceptance Report", "");
lines.push(`**Result: ${overallPass ? "PASS" : "FAIL"}**`, "");
lines.push(`- Run started: ${startedAt.toISOString()}  (duration ${Math.round((Date.now() - startedAt.getTime()) / 1000)} s)`);
lines.push(`- Git HEAD: \`${head}\`${dirty ? " (+ uncommitted working-tree changes)" : ""}`);
lines.push("- Command: `bun run test:wave1:smoke`");
lines.push("- Environment: headless Chromium, production web build, real engine (`index.e2e.ts`), deterministic fixture DB (50 heroes)");
lines.push(`- Engine certification preflight: ${engine.pass} pass / ${engine.fail} fail`);
lines.push(`- Browser scenarios: ${browserRows.filter((row) => row.status === "PASS").length}/${browserRows.length} pass`);
lines.push(`- Soak tests: ${soakRows.filter((row) => row.status === "PASS").length}/${soakRows.length} pass — ${soakDrafts.length - soakFailures.length}/${soakDrafts.length} drafts valid`);
lines.push(`- Playwright exit code: ${playwrightCode}`, "");
if (parseError) lines.push(`> **Report problem:** ${parseError}`, "");

lines.push("## Scenarios", "", "| Area | Scenario | Seed(s) | Result | Time |", "|---|---|---|---|---|");
for (const row of rows) lines.push(`| ${areaOf(row)} | ${row.title.replaceAll("|", "\\|")} | ${row.seeds.join(", ") || (row.soak.length ? "SOAKR001–010 / SOAKD001–010" : "—")} | ${row.status} | ${(row.durationMs / 1000).toFixed(1)} s |`);
lines.push("");

const section = (heading: string, filter: (row: Row) => boolean, note: string) => {
  const selected = rows.filter(filter);
  const verdict = selected.length === 0 ? "NOT RUN" : selected.every((row) => row.status === "PASS") ? "PASS" : "FAIL";
  lines.push(`## ${heading}: ${verdict}`, "", note, "");
};
section("Browser flows (Radiant + Dire)", (row) => /^[AB]\./.test(row.title), "Side, personal position, ban nominations, 2/2/1 round capacities, Mid+Carry legal in Round 1 and support in Round 3 (and the reverse order on Dire), 5 own + 5 enemy heroes, Player issues exactly 5 own-side seals, no 4xx/5xx.");
section("Timer", (row) => /timers|expiry/i.test(row.title), "Round base times 25/25/20 s asserted from the engine timer projection in every draft; expiry (deterministic clock, no real 25 s sleep), 2 gold/s per pending seat, locked seat frozen, pending seat keeps accruing, no auto-pick, late pick accepted. Clock: browser fake clock + test-only server timer offset (`index.e2e.ts` only).");
section("Ban flow", (row) => /ban flow|resolved bans|caps nominations|FAIL CLOSED/i.test(row.title) || /^[AB]\./.test(row.title), "0 and 1–4 nominations, resolved bans visible, banned heroes removed from (or disabled in) the selectable pool, 5th nomination impossible, failing resolution never starts Round 1 and retries the identical request.");
section("Hidden information", (row) => /hidden information|hidden enemy/i.test(row.title) || /^[AB]\./.test(row.title), "Hidden enemy slots never carry a hero id; no Simulator Truth key is ever serialized; enemy reveals equal 0/2/4/5 by phase; a hidden enemy pick stays selectable for the Player (Player-visible behaviour only).");
lines.push("## Collision coverage", "", "- **Browser smoke (this suite):** deterministic collision — the Player picks the (hidden) enemy Round-1 hero; expect the collision-ban banner, the reopened single seat, the hero no longer selectable afterwards, and the draft still completing. The seed is chosen from a fixed candidate list by fixture availability, not by searching for collisions.");
lines.push("- **Collision #1/#2/#3 rules and first-registration-wins (Task 11):** certified at engine level by the preflight above (`simulator-authority.test.ts`, `protocol-sessions.ap-simulator.test.ts`, `ap-availability-symmetry.test.ts`); not re-driven through the browser.", "");

lines.push("## Multi-seed soak", "");
if (soakDrafts.length === 0) lines.push("_No soak results were produced._", "");
else {
  lines.push("| Seed | Side | Pos | Ban prefs | Bans | Collision bans | Result |", "|---|---|---|---|---|---|---|");
  for (const draft of soakDrafts) lines.push(`| ${draft.seed} | ${draft.side} | ${draft.position} | ${draft.banPrefs} | ${draft.bans} | ${draft.collisions} | ${draft.failures.length === 0 ? "PASS" : `FAIL: ${draft.failures.join("; ").replaceAll("|", "\\|")}`} |`);
  lines.push("", "Per draft: COMPLETE, 5 own + 5 enemy heroes, no same-side duplicate, no banned hero selected, Enemy Bot heroes admissible for each round's internal seat positions, no HTTP 4xx/5xx.", "");
}

lines.push("## Failures", "");
const failingRows = rows.filter((row) => row.status !== "PASS");
if (failingRows.length === 0 && soakFailures.length === 0 && preflight.code === 0 && !parseError) lines.push("None.", "");
else {
  if (preflight.code !== 0) lines.push(`- Engine preflight failed (exit ${preflight.code}) — run \`bun test ${ENGINE_TEST_PATHS.join(" ")}\` for details.`);
  for (const row of failingRows) {
    lines.push(`- **${row.title}** — ${row.status}`);
    if (row.error) lines.push("  ```", ...row.error.split("\n").map((line) => `  ${line}`), "  ```");
    for (const attachment of row.attachments) lines.push(`  - evidence: \`${attachment}\``);
  }
  lines.push("");
}
lines.push("## Evidence", "", "Failure artifacts (screenshot, trace, error context) are kept by Playwright in `test-results/`; open a trace with `npx playwright show-trace <trace.zip>`. Video is not enabled (current setup does not use it).", "");
lines.push("## What still needs a human", "", "A short visual check only: layout/legibility of the round panel, the visible countdown, the gold-penalty text and the collision banner. Everything behavioural above is automated.", "");

mkdirSync(resolve(ROOT, "docs/diagnostics"), { recursive: true });
writeFileSync(REPORT_PATH, lines.join("\n"));
console.log(`[wave1-smoke] report: ${REPORT_PATH.replace(ROOT, ".")}`);
console.log(`[wave1-smoke] ${overallPass ? "PASS" : "FAIL"} — browser ${browserRows.filter((row) => row.status === "PASS").length}/${browserRows.length}, soak drafts ${soakDrafts.length - soakFailures.length}/${soakDrafts.length}, engine preflight ${engine.pass} pass/${engine.fail} fail`);
process.exit(overallPass ? 0 : 1);
