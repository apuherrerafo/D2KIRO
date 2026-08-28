import type { HeroId } from "../draft/reducer";
import type { Confidence, ProSourceRef } from "./types";
import type { ProPatternIndex } from "./patterns";

export interface ProQueryContext {
  readonly patch: string;
  readonly observedBans: readonly HeroId[];
  readonly confirmedAllies: readonly HeroId[];
  readonly revealedRivals: readonly HeroId[];
  readonly targetPosition: 1 | 2 | 3 | 4 | 5;
  readonly currentTurn: number;
}

export interface ProPatternMatch {
  readonly heroId: HeroId;
  readonly kind: "opening" | "pick_order" | "pair" | "trio" | "ban_response" | "flex";
  readonly sampleSize: number;
  readonly ref: ProSourceRef;
  readonly confidence: Confidence;
}

function phaseKind(turn: number): "opening" | "pick_order" {
  return turn <= 6 ? "opening" : "pick_order";
}

/** Pure lookup over the compiled professional-draft index. No network, I/O, or clock access. */
export function queryProPatterns(index: ProPatternIndex, ctx: ProQueryContext): readonly ProPatternMatch[] {
  if (!Number.isInteger(ctx.currentTurn) || ctx.currentTurn < 0 || ctx.currentTurn > 23 || !ctx.patch) return [];
  const matches: ProPatternMatch[] = [];
  const seen = new Set<string>();
  const rivals = new Set(ctx.revealedRivals);
  const allies = new Set(ctx.confirmedAllies);
  const add = (heroId: HeroId, kind: ProPatternMatch["kind"], sampleSize: number, ref: ProSourceRef, confidence: Confidence) => {
    if (rivals.has(heroId) || seen.has(`${heroId}:${kind}`)) return;
    seen.add(`${heroId}:${kind}`);
    matches.push({ heroId, kind, sampleSize, ref, confidence });
  };

  const positionRows = index.positions.filter((row) => row.patch === ctx.patch && row.positionEst === ctx.targetPosition);
  for (const row of positionRows) add(row.heroId, row.isFlexible ? "flex" : phaseKind(ctx.currentTurn), row.sampleSize, row.ref, row.confidence);

  for (const row of index.banResponses) {
    if (row.patch === ctx.patch && ctx.observedBans.includes(row.bannedHero)) add(row.nextPickHero, "ban_response", row.sampleSize, row.ref, row.confidence);
  }
  for (const row of index.pairs) {
    if (row.patch !== ctx.patch) continue;
    const candidate = row.heroes.find((hero) => !allies.has(hero));
    if (candidate !== undefined && row.heroes.some((hero) => allies.has(hero))) add(candidate, "pair", row.sampleSize, row.ref, row.confidence);
  }
  for (const row of index.triples) {
    if (row.patch !== ctx.patch) continue;
    const candidate = row.heroes.find((hero) => !allies.has(hero));
    if (candidate !== undefined && row.heroes.filter((hero) => allies.has(hero)).length >= 2) add(candidate, "trio", row.sampleSize, row.ref, row.confidence);
  }
  return matches;
}
