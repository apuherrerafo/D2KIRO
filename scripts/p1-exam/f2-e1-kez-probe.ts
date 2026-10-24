// F2-E1 follow-up: WHY does an uncurated hero (Kez) enter a top-3 when structural damage becomes a critical gap?
// Rebuilds the two P4 moments, ranks the recommended column under F1 and under E1 (E1 = the constant toggled at runtime, no engine edit) and
// prints the exact `team_synergy` arithmetic: raw, normalized, the state mean mu, and each hero's weighted contribution.
//   bun scripts/p1-exam/f2-e1-kez-probe.ts --moments=<set> --f1=<f1 run> [--ids=a,b] [--out=<json>]
// Measurement tool, not a test; never imported from apps/ (invariantes.md).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CRITICAL_GAP_KINDS } from "../../apps/engine/src/draft-paths/gaps";
import type { DraftCapabilityGap } from "../../apps/engine/src/draft-paths/types";
import { credibleHeroesForPosition } from "../../apps/engine/src/coach/hero-card";
import { buildRecommendationSetFromPerspective } from "../../apps/engine/src/recommendation/build-from-perspective";
import { buildSuggestions } from "../../apps/engine/src/signals/mix";
import { ACCOUNT_A, ACCOUNT_B, createLab, jsonRequest, loadWorldData, muteLog, unmuteLog, type WorldData } from "../wave5/driver";
import { boardTop3 } from "./f2-e1-analysis";
import { commandsFor, type DecisionMoment, type ReplayResult } from "./replay";

const ROOT = resolve(import.meta.dir, "../..");
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const POSITIONS = [1, 2, 3, 4, 5] as const;
type Variant = "F1" | "E1";

function withVariant<T>(variant: Variant, run: () => Promise<T>): Promise<T> {
  const kinds = CRITICAL_GAP_KINDS as DraftCapabilityGap[];
  const had = kinds.includes("structural_damage");
  if (variant === "E1" && !had) kinds.push("structural_damage");
  if (variant === "F1" && had) kinds.splice(kinds.indexOf("structural_damage"), 1);
  return run().finally(() => { if (variant === "E1" && !had) kinds.pop(); if (variant === "F1" && had) kinds.push("structural_damage"); });
}

async function rebuild(world: WorldData, moment: DecisionMoment) {
  const account = moment.session.account === "A" ? ACCOUNT_A : ACCOUNT_B;
  const lab = createLab({ ...world, pools: { ...world.pools, [account]: moment.pool.map((entry) => ({ ...entry })) } });
  const created = await lab.routes.post(jsonRequest({ rulesetId: "dota2/ranked-all-pick", patch: moment.session.patch, localSide: moment.session.side, adapterKind: "simulator", humanPosition: moment.session.humanPosition, simulatorSeed: moment.session.simulatorSeed, partyContext: { partySize: 5, side: moment.session.side, controlledSlots: [] }, controlledPositions: POSITIONS }));
  const { sessionId } = (await created.json()) as { sessionId: string };
  lab.store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [...moment.reconstruction.bans] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  const enemy = moment.session.side === "radiant" ? "dire" : "radiant";
  for (const c of commandsFor(moment)) {
    if (c.kind === "enemy-seal") lab.store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: enemy, slotIndex: c.slotIndex, heroId: c.heroId });
    else await lab.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: moment.session.side, slotIndex: c.slotIndex, heroId: c.heroId }, assignedPosition: c.assignedPosition }), sessionId);
  }
  return { lab, sessionId, account, context: lab.store.perspectiveRecommendationContext(sessionId)! };
}

interface Sig { raw: number | null; normalized: number | null; weighted: number }
async function rank(world: WorldData, moment: DecisionMoment, position: number) {
  const { context, account } = await rebuild(world, moment);
  const meta = position === moment.session.humanPosition ? { ...world.meta, heroPool: moment.pool, personalBaselineWinrate: null } : world.meta;
  void account;
  const firstSet: { hero: number; score: number; signals: Record<string, Sig> }[] = [];
  const teamSynergy = new Map<number, { raw: number | null; normalized: number | null }>();
  let wPrime: number | null = null;
  const computeSuggestions = async (draft: Parameters<typeof buildSuggestions>[0], _a: unknown, options?: Parameters<typeof buildSuggestions>[2]) => {
    let remaining = [...(options?.candidateHeroIds ?? [])];
    let first: Awaited<ReturnType<typeof buildSuggestions>> | null = null;
    for (let guard = 0; guard < 20 && remaining.length > 0; guard += 1) {
      const set = await buildSuggestions(draft, meta, { metaIsStale: true, heroPositions: world.heroPositions, ...options, candidateHeroIds: remaining });
      if (first === null) {
        first = set;
        for (const s of set.suggestions) firstSet.push({ hero: s.hero, score: s.score, signals: Object.fromEntries(s.signals.map((x) => [x.signal, { raw: x.raw, normalized: x.normalized ?? null, weighted: x.weighted }])) });
      }
      if (set.suggestions.length === 0) break;
      for (const s of set.suggestions) {
        const ts = s.signals.find((x) => x.signal === "team_synergy");
        if (ts) {
          teamSynergy.set(s.hero, { raw: ts.raw, normalized: ts.normalized ?? null });
          if (wPrime === null && ts.raw !== null && ts.normalized) wPrime = ts.weighted / ts.normalized;
        }
      }
      const taken = new Set(set.suggestions.map((s) => s.hero));
      remaining = remaining.filter((h) => !taken.has(h));
    }
    return first ?? buildSuggestions(draft, meta, { metaIsStale: true, heroPositions: world.heroPositions, ...options });
  };
  await buildRecommendationSetFromPerspective({ context, computeSuggestions: computeSuggestions as never, heroPositions: world.heroPositions, targetPosition: position as never, candidateHeroIds: credibleHeroesForPosition(position as never, world.heroPositions), teamOpening: false, singleSlotEvaluation: true, outputLimit: 50 });
  const withData = [...teamSynergy.values()].filter((v) => v.raw !== null && v.normalized !== null).map((v) => v.normalized!);
  const mu = withData.length > 0 ? withData.reduce((a, b) => a + b, 0) / withData.length : 50;
  const sorted = [...withData].sort((a, b) => a - b);
  return { firstSet, teamSynergy, wPrime, mu, candidates: teamSynergy.size, withData: withData.length, min: sorted[0] ?? null, median: sorted[Math.floor(sorted.length / 2)] ?? null, max: sorted[sorted.length - 1] ?? null, fillersAbove: withData.filter((v) => v > mu).length };
}

if (import.meta.main) {
  muteLog();
  try {
    const world = loadWorldData();
    const moments = new Map((JSON.parse(readFileSync(resolve(ROOT, arg("moments")!), "utf8")) as { moments: DecisionMoment[] }).moments.map((m) => [m.id, m]));
    const f1 = new Map((JSON.parse(readFileSync(resolve(ROOT, arg("f1")!), "utf8")) as { results: ReplayResult[] }).results.map((r) => [r.id, r]));
    const ids = (arg("ids") ?? "follow-coach:AUDIT028:radiant#3,follow-coach:AUDIT055:radiant#3").split(",");
    const report: Record<string, unknown>[] = [];
    for (const id of ids) {
      const moment = moments.get(id)!;
      const reference = f1.get(id)!.output!;
      const position = reference.board.recommendedPosition!;
      const f1Top = boardTop3(reference);
      const row: Record<string, unknown> = { id, position, ownPicks: moment.visible.ownPicks.map((p) => p.heroId), f1Top3: f1Top };
      for (const variant of ["F1", "E1"] as const) {
        const r = await withVariant(variant, () => rank(world, moment, position));
        const top3 = r.firstSet.slice(0, 3).map((s) => s.hero);
        const kez = r.firstSet.find((s) => s.hero === 145);
        const left = f1Top.filter((h) => !top3.includes(h));
        row[variant] = {
          top3, teamSynergy: { mu: Math.round(r.mu * 100) / 100, wPrime: r.wPrime === null ? null : Math.round(r.wPrime * 10000) / 10000, candidates: r.candidates, withData: r.withData, min: r.min, median: r.median, max: r.max, candidatesAboveMean: r.fillersAbove },
          kezInFirstSet: kez === undefined ? null : { score: Math.round(kez.score * 100) / 100, signals: kez.signals },
          kezTeamSynergyRaw: r.teamSynergy.get(145)?.raw ?? "not scored",
          kezImputedContribution: r.wPrime === null ? null : Math.round(r.wPrime * r.mu * 100) / 100,
          heroesThatLeftTop3: left.map((h) => ({ hero: h, teamSynergy: r.teamSynergy.get(h) ?? null, contributionIfScored: r.wPrime !== null && r.teamSynergy.get(h)?.normalized != null ? Math.round(r.wPrime * r.teamSynergy.get(h)!.normalized! * 100) / 100 : null })),
          firstSetTable: r.firstSet.map((s) => ({ hero: s.hero, score: Math.round(s.score * 100) / 100, teamSynergy: s.signals.team_synergy, positionFit: s.signals.position_fit?.weighted })),
        };
      }
      report.push(row);
    }
    unmuteLog();
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (arg("out")) writeFileSync(resolve(ROOT, arg("out")!), text);
    console.log(text);
  } finally {
    unmuteLog();
  }
}
