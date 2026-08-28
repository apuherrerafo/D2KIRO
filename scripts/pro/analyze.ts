import { analyzeDraft, type AnalyzerCandidateInput } from "../../apps/engine/src/pro/analyzer";
import type { ProQueryContext } from "../../apps/engine/src/pro/query";

interface AnalyzerInput { readonly context: ProQueryContext; readonly candidates: readonly AnalyzerCandidateInput[]; }

async function main(): Promise<void> {
  const path = Bun.argv[2];
  if (!path) throw new Error("Uso: bun scripts/pro/analyze.ts <informe.json>");
  const input = JSON.parse(await Bun.file(path).text()) as AnalyzerInput;
  const report = analyzeDraft(input.context, input.candidates);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.main) await main();
