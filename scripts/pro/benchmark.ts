import type { ProPatternIndex } from "../../apps/engine/src/pro/patterns";

export interface BenchmarkDraftRef { readonly draftId: string; readonly patch: string; readonly leagueId: number; }
export interface BenchmarkDimensions { readonly publicData: number; readonly highMmrData: number; readonly professionalData: number; readonly tier1Patterns: number; readonly banSensitivity: number; readonly pickOrderPrecision: number; readonly evidenceCoverage: number; readonly explanationQuality: number; }
export interface ProBenchmarkReport { readonly dimensions: BenchmarkDimensions; readonly tournamentDominantShare: number; readonly tournamentHerfindahl: number; readonly temporalStability: number; readonly heroCoverage: number; readonly biasedByTournament: boolean; }

export function tournamentDiversity(drafts: readonly BenchmarkDraftRef[]): { dominantShare: number; herfindahl: number } {
  if (drafts.length === 0) return { dominantShare: 0, herfindahl: 0 };
  const counts = new Map<number, number>();
  for (const draft of drafts) counts.set(draft.leagueId, (counts.get(draft.leagueId) ?? 0) + 1);
  const shares = [...counts.values()].map((count) => count / drafts.length);
  return { dominantShare: Math.max(...shares), herfindahl: shares.reduce((sum, share) => sum + share * share, 0) };
}

export function temporalPatternStability(oldKeys: readonly string[], newKeys: readonly string[]): number {
  const oldSet = new Set(oldKeys); const newSet = new Set(newKeys); const union = new Set([...oldSet, ...newSet]);
  return union.size === 0 ? 1 : [...oldSet].filter((key) => newSet.has(key)).length / union.size;
}

export function benchmarkPatterns(drafts: readonly BenchmarkDraftRef[], index: ProPatternIndex, dimensions: BenchmarkDimensions, temporal: { oldKeys: readonly string[]; newKeys: readonly string[] }): ProBenchmarkReport {
  const diversity = tournamentDiversity(drafts);
  const heroes = new Set(index.positions.map((row) => row.heroId));
  return { dimensions, tournamentDominantShare: diversity.dominantShare, tournamentHerfindahl: diversity.herfindahl,
    temporalStability: temporalPatternStability(temporal.oldKeys, temporal.newKeys), heroCoverage: heroes.size,
    biasedByTournament: diversity.dominantShare > 0.4 };
}

if (import.meta.main) {
  const path = Bun.argv[2];
  if (!path) throw new Error("Uso: bun scripts/pro/benchmark.ts <benchmark-input.json>");
  const input = JSON.parse(await Bun.file(path).text()) as { drafts: BenchmarkDraftRef[]; index: ProPatternIndex; dimensions: BenchmarkDimensions; temporal: { oldKeys: string[]; newKeys: string[] } };
  process.stdout.write(`${JSON.stringify(benchmarkPatterns(input.drafts, input.index, input.dimensions, input.temporal), null, 2)}\n`);
}
