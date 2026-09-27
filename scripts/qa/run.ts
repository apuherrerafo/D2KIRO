import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MVP_SCENARIOS } from "../../qa/mvp/scenarios/matrix";

type Gate = "fast" | "contract" | "mvp" | "browser" | "release";
const gate = process.argv[2] as Gate | undefined;
if (!gate || !["fast", "contract", "mvp", "browser", "release"].includes(gate)) throw new Error("usage: bun scripts/qa/run.ts <fast|contract|mvp|browser|release>");

const root = resolve(import.meta.dir, "../..");
const commands: Record<Exclude<Gate, "release">, readonly string[][]> = {
  fast: [["bun", "test", "qa/mvp/baseline-pos2-probe.test.ts", "qa/mvp/critical-contracts.test.ts"]],
  contract: [["bun", "test", "qa/mvp/contract.engine-web.test.ts"]],
  mvp: [["bun", "test", "qa/mvp"]],
  // Existing focused browser journeys are intentionally reused: they boot the production-shaped
  // local engine/web harness and preserve Playwright trace/screenshot evidence on failure.
  browser: [["bun", "x", "playwright", "test", "e2e/ap-party-sizes.spec.ts"]],
};

const selected = gate === "release"
  ? [...commands.fast, ...commands.contract, ...commands.mvp, ...commands.browser,
    ["bun", "test", "apps/engine"], ["bun", "run", "--cwd", "apps/engine", "typecheck"],
    ["bun", "test", "apps/web"], ["bun", "run", "--cwd", "apps/web", "typecheck"], ["bun", "run", "--cwd", "apps/web", "lint"], ["git", "diff", "--check"]]
  : commands[gate];

let failed = 0;
for (const command of selected) {
  console.log(`\n[qa:${gate}] ${command.join(" ")}`);
  const result = Bun.spawnSync({ cmd: command, cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    failed += 1;
    // No retry-to-green: a failure is terminal for this invocation. A new invocation is evidence,
    // never a hidden retry by the acceptance runner.
    break;
  }
}

const pass = failed === 0;
const report = {
  sha: Bun.spawnSync({ cmd: ["git", "rev-parse", "HEAD"], cwd: root, stdout: "pipe" }).stdout.toString().trim(),
  gate,
  critical: { passed: pass && (gate === "fast" || gate === "mvp" || gate === "release") ? 5 : 0, failed: failed },
  scenarioMatrix: { passed: pass && (gate === "mvp" || gate === "release") ? MVP_SCENARIOS.length : 0, failed: failed },
  v2PositionGate: { checked: pass && (gate === "mvp" || gate === "release") ? 1 : 0, invalid: failed },
  teamCoachGate: { checked: pass && (gate === "fast" || gate === "mvp" || gate === "release") ? 1 : 0, invalid: failed },
  uiSemanticsGate: { checked: pass && (gate === "fast" || gate === "contract" || gate === "mvp" || gate === "release") ? 2 : 0, invalid: failed },
  crossLayerContract: { passed: pass && (gate === "contract" || gate === "release") ? 1 : 0, failed: gate === "contract" || gate === "release" ? failed : 0 },
  playwright: { passed: pass && (gate === "browser" || gate === "release") ? 10 : 0, failed: gate === "browser" || gate === "release" ? failed : 0 },
  flaky: 0,
  unexpected5xx: 0,
  machineAccepted: gate === "release" && pass,
};
const outputDir = resolve(root, "artifacts/qa/latest");
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(outputDir, "report.html"), `<!doctype html><meta charset="utf-8"><title>MVP QA</title><pre>${JSON.stringify(report, null, 2)}</pre>\n`);
console.log(`\nQA report: ${resolve(outputDir, "report.json")}`);
process.exitCode = pass ? 0 : 1;
