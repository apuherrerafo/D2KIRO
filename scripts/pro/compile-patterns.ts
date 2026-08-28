import type { ProDraft } from "../../apps/engine/src/pro/types";
import type { BanResponsePattern, PairPattern, PositionAggregate, TriplePattern } from "./aggregate";
import type { DraftCandidate } from "../../apps/engine/src/knn/corpus";
import type { ProPatternIndex } from "../../apps/engine/src/pro/patterns";

export interface PatternCompileInput { readonly positions: readonly PositionAggregate[]; readonly pairs: readonly PairPattern[]; readonly triples: readonly TriplePattern[]; readonly banResponses: readonly BanResponsePattern[]; readonly drafts: readonly ProDraft[]; }
export interface CompiledPatterns { readonly patterns: ProPatternIndex; readonly corpus: readonly DraftCandidate[]; }
function corpusFrom(drafts: readonly ProDraft[]): DraftCandidate[] {
  return drafts.map((draft) => {
    const picks = [0, 1].map((team) => draft.turns.filter((turn) => turn.isPick && turn.team === team).sort((a, b) => a.order - b.order).map((turn) => turn.heroId));
    return { draftId: draft.matchId, patch: draft.patch, radiantHeroes: picks[0]!, direHeroes: picks[1]!, winningSide: draft.winningSide };
  }).filter((draft) => draft.radiantHeroes.length === 5 && draft.direHeroes.length === 5)
    .sort((a, b) => a.draftId.localeCompare(b.draftId));
}
export function compilePatterns(input: PatternCompileInput): CompiledPatterns {
  return { patterns: { version: 1, positions: [...input.positions].sort((a, b) => a.heroId - b.heroId || a.positionEst - b.positionEst), pairs: [...input.pairs], triples: [...input.triples], banResponses: [...input.banResponses] }, corpus: corpusFrom(input.drafts) };
}

export async function writeCompiledPatterns(input: PatternCompileInput, outputPath: string): Promise<CompiledPatterns> {
  const compiled = compilePatterns(input);
  await Bun.write(outputPath, `${JSON.stringify(compiled.patterns, null, 2)}\n`);
  return compiled;
}

if (import.meta.main) {
  const inputPath = Bun.argv[2];
  const outputPath = Bun.argv[3] ?? "apps/engine/src/pro/pro-patterns.json";
  if (!inputPath) throw new Error("Uso: bun scripts/pro/compile-patterns.ts <agregados.json> [salida.json]");
  const input = JSON.parse(await Bun.file(inputPath).text()) as PatternCompileInput;
  await writeCompiledPatterns(input, outputPath);
  console.log(`Patrones compilados en ${outputPath}`);
}
