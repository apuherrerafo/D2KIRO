import type { ProPatternIndex } from "../../apps/engine/src/pro/patterns";

export interface WeakPattern { readonly key: string; readonly sampleSize: number; readonly confidence: string; readonly patch: string; }

export function auditWeakPatterns(index: ProPatternIndex, minimumSampleSize = 30): readonly WeakPattern[] {
  const rows: WeakPattern[] = [];
  for (const row of index.positions) if (row.sampleSize < minimumSampleSize) rows.push({ key: `position:${row.heroId}:${row.positionEst}`, sampleSize: row.sampleSize, confidence: row.confidence, patch: row.patch });
  for (const row of index.pairs) if (row.sampleSize < minimumSampleSize) rows.push({ key: `pair:${row.heroes.join(":")}`, sampleSize: row.sampleSize, confidence: row.confidence, patch: row.patch });
  for (const row of index.triples) if (row.sampleSize < minimumSampleSize) rows.push({ key: `trio:${row.heroes.join(":")}`, sampleSize: row.sampleSize, confidence: row.confidence, patch: row.patch });
  for (const row of index.banResponses) if (row.sampleSize < minimumSampleSize) rows.push({ key: `ban:${row.bannedHero}->${row.nextPickHero}`, sampleSize: row.sampleSize, confidence: row.confidence, patch: row.patch });
  return rows.sort((a, b) => a.sampleSize - b.sampleSize || a.key.localeCompare(b.key));
}
