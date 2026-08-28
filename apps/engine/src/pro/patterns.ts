import rawPatterns from "./pro-patterns.json";
import type { BanResponsePattern, PairPattern, PositionAggregate, TriplePattern } from "../../../../scripts/pro/aggregate";

export interface ProPatternIndex { readonly version: 1; readonly positions: readonly PositionAggregate[]; readonly pairs: readonly PairPattern[]; readonly triples: readonly TriplePattern[]; readonly banResponses: readonly BanResponsePattern[]; }
function isArray(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
function valid(value: unknown): value is ProPatternIndex {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && isArray(candidate.positions) && isArray(candidate.pairs) && isArray(candidate.triples) && isArray(candidate.banResponses);
}
export function parseProPatterns(raw: unknown): ProPatternIndex | null { return valid(raw) ? raw : null; }
export function loadProPatterns(read: () => unknown = () => rawPatterns): ProPatternIndex | null { try { return parseProPatterns(read()); } catch { return null; } }
