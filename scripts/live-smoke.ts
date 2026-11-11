#!/usr/bin/env bun
// `bun run smoke:live` -- smoke del MVP de Live SIN Dota abierto. Corre cada spec de Live en su PROPIA
// invocación de Playwright: mezclarlos en una sola corrida comparte la cuenta/base del e2e y un spec deja
// estado que rompe a otro (hallazgo del preflight, 2026-11-11). Todo GSI/Companion aquí es SIMULADO:
// esto NO certifica Dota real. No toca motor, pesos ni datasets; usa puertos 3100/4100 (nunca 3000/4000).

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const LIVE_SPECS = [
  "e2e/live-canonical-4b2.spec.ts",
  "e2e/live-canonical-4b2-cert.spec.ts",
  "e2e/live-light-4b.spec.ts",
  "e2e/live-hierarchy-4b1.spec.ts",
  "e2e/live-companion.spec.ts",
  "e2e/live-party-context.spec.ts",
  "e2e/party5-qa-preset.spec.ts",
];

const ROOT = resolve(import.meta.dir, "..");
const rows: string[] = [];
let failed = 0;
for (const spec of LIVE_SPECS) {
  // Un reintento SÓLO si el primer intento falla: el arranque en frío de Next (primera compilación de
  // /live-draft) puede pasar de los 60 s del primer test. Un fallo que se repite es real.
  let result = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const run = spawnSync(process.execPath, ["x", "playwright", "test", spec, "--workers=1", "--reporter=dot"], { cwd: ROOT, encoding: "utf8" });
    const summary = `${run.stdout ?? ""}`.match(/(\d+) passed[^\n]*/)?.[0] ?? "sin resultado";
    result = run.status === 0 ? `PASS  (${summary})` : `FAIL  (${summary}; intento ${attempt})`;
    if (run.status === 0) break;
  }
  if (!result.startsWith("PASS")) failed += 1;
  rows.push(`${result.padEnd(40)} ${spec}`);
  console.log(rows[rows.length - 1]);
}
console.log(failed === 0 ? "\n== SMOKE LIVE (simulado): PASS ==" : `\n== SMOKE LIVE (simulado): ${failed} archivo(s) FALLAN ==`);
console.log("Recordatorio: GSI/Companion SIMULADOS. Dota real = UNTESTED.");
process.exit(failed === 0 ? 0 : 1);
