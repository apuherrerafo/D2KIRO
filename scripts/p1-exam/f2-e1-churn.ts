// F2-E1 churn: the top-3 changed in 72 of the 89 applicable moments but only 14 gained structural coverage. What are the other 58?
//   bun scripts/p1-exam/f2-e1-churn.ts --moments=<set> --f1=<f1 run> --e1=<e1 run> [--out=<json>]
// Classification is a pure function of (moment, F1 top-3, E1 top-3, curated capabilities, curated counters). It labels; it does not judge strategy.
// Measurement tool, not a test; never imported from apps/ (invariantes.md).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { UNCURATED_CAPABILITY_HERO_IDS, loadHeroCapabilities } from "../../apps/engine/src/draft-paths/capabilities";
import type { DraftCapabilityGap, HeroCapabilities } from "../../apps/engine/src/draft-paths/types";
import { loadWorldData } from "../wave5/driver";
import { boardTop3, classify, fills } from "./f2-e1-analysis";
import type { DecisionMoment, ReplayResult } from "./replay";

const ROOT = resolve(import.meta.dir, "../..");
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export type ChurnClass =
  | "GAIN"                       // F1 had no structural hero in the top-3, E1 does (the intended effect)
  | "REORDER_ONLY"               // same three heroes, different order
  | "FILLER_FOR_NONFILLER"       // already covered; a structural hero replaces one that is not: consistent with the intent, no open gap lost
  | "NEUTRAL_SWAP"               // heroes differ, no open gap lost, exposure not up, no uncurated entry, not the pattern above
  | "POSSIBLE_REGRESSION"        // an open gap the F1 top-3 covered is no longer covered, or hard-counter exposure went up
  | "UNCURATED_ENTRY"            // an uncurated hero entered (its capabilities cannot be shown)
  | "STILL_UNFILLED";            // neither top-3 covers the structural gap

export interface ChurnInput {
  openGaps: DraftCapabilityGap[];
  ownDamageTypes: string[];
  f1Top3: number[];
  e1Top3: number[];
  caps: ReadonlyMap<number, HeroCapabilities>;
  exposure: (heroes: number[]) => number;
}

const covered = (heroes: number[], gap: DraftCapabilityGap, i: ChurnInput): boolean => heroes.some((h) => fills(h, gap, i.caps, i.ownDamageTypes));

export function classifyChurn(i: ChurnInput): { cls: ChurnClass; lostGaps: DraftCapabilityGap[]; exposureDelta: number } {
  const lostGaps = i.openGaps.filter((g) => covered(i.f1Top3, g, i) && !covered(i.e1Top3, g, i));
  const exposureDelta = i.exposure(i.e1Top3) - i.exposure(i.f1Top3);
  const f1Struct = covered(i.f1Top3, "structural_damage", i), e1Struct = covered(i.e1Top3, "structural_damage", i);
  const sameSet = i.f1Top3.length === i.e1Top3.length && i.f1Top3.every((h) => i.e1Top3.includes(h));
  const entering = i.e1Top3.filter((h) => !i.f1Top3.includes(h)), leaving = i.f1Top3.filter((h) => !i.e1Top3.includes(h));
  if (!f1Struct && e1Struct) return { cls: "GAIN", lostGaps, exposureDelta };
  if (sameSet) return { cls: "REORDER_ONLY", lostGaps, exposureDelta };
  if (!f1Struct && !e1Struct) return { cls: "STILL_UNFILLED", lostGaps, exposureDelta };
  if (entering.some((h) => UNCURATED_CAPABILITY_HERO_IDS.has(h))) return { cls: "UNCURATED_ENTRY", lostGaps, exposureDelta };
  if (lostGaps.length > 0 || exposureDelta > 0) return { cls: "POSSIBLE_REGRESSION", lostGaps, exposureDelta };
  const structural = (h: number): boolean => fills(h, "structural_damage", i.caps, i.ownDamageTypes);
  if (entering.some(structural) && leaving.some((h) => !structural(h))) return { cls: "FILLER_FOR_NONFILLER", lostGaps, exposureDelta };
  return { cls: "NEUTRAL_SWAP", lostGaps, exposureDelta };
}

if (import.meta.main) {
  const moments = (JSON.parse(readFileSync(resolve(ROOT, arg("moments")!), "utf8")) as { moments: DecisionMoment[] }).moments;
  const load = (p: string): Map<string, ReplayResult> => new Map((JSON.parse(readFileSync(resolve(ROOT, p), "utf8")) as { results: ReplayResult[] }).results.map((r) => [r.id, r]));
  const f1 = load(arg("f1")!), e1 = load(arg("e1")!);
  const caps = new Map(loadHeroCapabilities().map((c) => [c.hero, c]));
  const world = loadWorldData();
  const rows: { id: string; cls: ChurnClass; lostGaps: DraftCapabilityGap[]; exposureDelta: number; left: number[]; entered: number[]; position: number | null }[] = [];
  for (const m of moments) {
    const c = classify(m, caps);
    if (!c.a) continue;
    const a = boardTop3(f1.get(m.id)!.output!), b = boardTop3(e1.get(m.id)!.output!);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const taken = new Set<number>([...m.visible.bans, ...m.visible.ownPicks.map((p) => p.heroId), ...m.visible.revealedEnemy]);
    const exposure = (heroes: number[]): number => heroes.reduce((s, h) => s + (world.heroCounters.get(h) ?? []).filter((e) => e.level === "hard" && !taken.has(e.vs)).length, 0);
    const out = classifyChurn({ openGaps: c.open, ownDamageTypes: c.ownDamageTypes, f1Top3: a, e1Top3: b, caps, exposure });
    rows.push({ id: m.id, ...out, left: a.filter((h) => !b.includes(h)), entered: b.filter((h) => !a.includes(h)), position: e1.get(m.id)!.output!.board.recommendedPosition });
  }
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.cls] = (counts[r.cls] ?? 0) + 1;
  const report = { topThreeChanged: rows.length, counts, noGain: rows.filter((r) => r.cls !== "GAIN").length, rows };
  if (arg("out")) writeFileSync(resolve(ROOT, arg("out")!), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ topThreeChanged: report.topThreeChanged, noGain: report.noGain, counts }, null, 2));
}
