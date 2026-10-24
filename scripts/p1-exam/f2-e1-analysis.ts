// F2-E1 analysis: applies the FROZEN rules (eval/replay/f2-e1.rules.json) to two replay runs over the same frozen moments.
//
//   bun scripts/p1-exam/f2-e1-analysis.ts --p0   --moments=<set> --f1=<f1 run>
//   bun scripts/p1-exam/f2-e1-analysis.ts --full --moments=<set> --f1=<f1 run> --e1=<e1 run> --out=<report.json>
//
// Everything here is a function of (moments, run outputs, curated capabilities, counters): no engine call, no I/O in the pure part.
// The critical-gap kinds are PARAMETERS (F1 and E1 differ in exactly that), so one analysis can judge both versions.
// Measurement tool, not a test; never imported from apps/ (invariantes.md).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assessCompositionNeedsOf, filledGaps, ownPicksRemainingFor } from "../../apps/engine/src/draft-paths/gaps";
import { UNCURATED_CAPABILITY_HERO_IDS, loadHeroCapabilities } from "../../apps/engine/src/draft-paths/capabilities";
import type { DraftCapabilityGap, HeroCapabilities } from "../../apps/engine/src/draft-paths/types";
import { loadWorldData } from "../wave5/driver";
import { M1_THRESHOLDS, i1Illegal, isAdverse, type ExamState, type ExamWorld } from "./checks";
import { fingerprint, type DecisionMoment, type MomentOutput, type ReplayResult } from "./replay";

const ROOT = resolve(import.meta.dir, "../..");
export const F1_KINDS: readonly DraftCapabilityGap[] = ["initiation", "catch", "damage_mix"];
export const E1_KINDS: readonly DraftCapabilityGap[] = [...F1_KINDS, "structural_damage"];
const OTHER_GAPS = ["initiation", "catch", "damage_mix"] as const;

export interface Classified { id: string; eligible: boolean; open: DraftCapabilityGap[]; structuralOpen: boolean; criticalF1: DraftCapabilityGap[]; a: boolean; a2: boolean; remaining: number; ownDamageTypes: string[] }

/** State-only classification (same for any version): is the moment in the closing window, with every own pick curated, and which gaps are open. */
export function classify(moment: DecisionMoment, caps: ReadonlyMap<number, HeroCapabilities>): Classified {
  const own = moment.visible.ownPicks.map((p) => p.heroId);
  const remaining = ownPicksRemainingFor(own);
  const allCurated = own.every((h) => caps.has(h));
  const eligible = allCurated && remaining >= 1 && remaining <= 2;
  const needs = assessCompositionNeedsOf(own, [...caps.values()], remaining);
  const open = needs.open;
  const criticalF1 = eligible ? open.filter((g) => F1_KINDS.includes(g)) : [];
  const structuralOpen = eligible && open.includes("structural_damage");
  return { id: moment.id, eligible, open, structuralOpen, criticalF1, a: structuralOpen, a2: structuralOpen && criticalF1.length > 0, remaining, ownDamageTypes: needs.ownDamageTypes };
}

export const boardTop3 = (output: MomentOutput): number[] => {
  const column = output.board.columns.find((c) => c.position === output.board.recommendedPosition);
  return (column?.top ?? []).slice().sort((a, b) => a.rank - b.rank).slice(0, 3).map((t) => t.heroId);
};
export const v4Top3 = (output: MomentOutput): number[] => (output.v4?.cards ?? []).slice(0, 3).map((c) => c.heroId);

/** A hero without curated capabilities fills nothing (it is never counted as lacking either). */
export function fills(hero: number, gap: DraftCapabilityGap, caps: ReadonlyMap<number, HeroCapabilities>, ownDamageTypes: string[]): boolean {
  const cap = caps.get(hero);
  return cap !== undefined && filledGaps(cap, [gap], ownDamageTypes as never).includes(gap);
}
export const gapFilled = (top3: number[], gap: DraftCapabilityGap, caps: ReadonlyMap<number, HeroCapabilities>, ownDamageTypes: string[]): boolean => top3.some((h) => fills(h, gap, caps, ownDamageTypes));

const pct = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 10000) / 100);
const ratio = (num: number, den: number): { n: number; of: number; pct: number | null } => ({ n: num, of: den, pct: pct(num, den) });

export interface World { caps: ReadonlyMap<number, HeroCapabilities>; counters: ExamWorld["counters"]; legalHeroIds: ReadonlySet<number> }

function examStateOf(moment: DecisionMoment, output: MomentOutput): ExamState {
  const board = output.board;
  return {
    draftKey: moment.origin.draftKey, index: moment.origin.stateIndex, round: moment.visible.round, ownPicksRemaining: ownPicksRemainingFor(moment.visible.ownPicks.map((p) => p.heroId)),
    banned: moment.visible.bans, ownPicks: moment.visible.ownPicks.map((p) => p.heroId), revealedEnemy: moment.visible.revealedEnemy,
    v3: output.v3.shortlist, v3PrimaryRationale: output.v3.primary,
    board: { recommendedPosition: board.recommendedPosition as never, targetBasis: board.targetBasis, columns: board.columns.map((c) => ({ position: c.position as never, state: c.state, eligibleNow: c.eligibleNow, top: c.top.map((t) => ({ heroId: t.heroId, reason: t.reasons[0] ?? "" })) })) },
    v4: output.v4 === null ? null : { ...output.v4, targetPosition: output.v4.targetPosition as never, viewedPosition: output.v4.viewedPosition as never, cards: output.v4.cards.map((c) => ({ heroId: c.heroId, rationale: c.rationale, basis: c.basisKind === null ? undefined : { kind: c.basisKind, sources: [] }, risks: c.risks })) } as never,
  } as unknown as ExamState;
}

/** Hard-counter exposure of a top-3 under the unchanged exam definition (curated HARD counters still available). */
function exposure(moment: DecisionMoment, heroes: number[], counters: ExamWorld["counters"]): number {
  const taken = new Set<number>([...moment.visible.bans, ...moment.visible.ownPicks.map((p) => p.heroId), ...moment.visible.revealedEnemy]);
  return heroes.reduce((sum, hero) => sum + (counters.get(hero) ?? []).filter((entry) => entry.level === "hard" && !taken.has(entry.vs)).length, 0);
}

export interface Run { kinds: readonly DraftCapabilityGap[]; results: Map<string, ReplayResult> }

/** CRITICAL_GAP on a card must be provable from the state and the version's own critical kinds; and must be present when provable. */
function criticalGapProof(moment: DecisionMoment, output: MomentOutput, c: Classified, kinds: readonly DraftCapabilityGap[], caps: ReadonlyMap<number, HeroCapabilities>): { shownWithoutProof: number; missing: number } {
  const critical = c.eligible ? c.open.filter((g) => kinds.includes(g)) : [];
  let shownWithoutProof = 0, missing = 0;
  for (const card of output.v4?.cards ?? []) {
    const cap = caps.get(card.heroId);
    const demonstrable = critical.length > 0 && cap !== undefined && critical.some((g) => !fills(card.heroId, g, caps, c.ownDamageTypes));
    const carries = card.risks.some((r) => r.kind === "CRITICAL_GAP");
    if (carries && !demonstrable) shownWithoutProof += 1;
    if (demonstrable && !carries) missing += 1;
  }
  return { shownWithoutProof, missing };
}

export function analyze(moments: DecisionMoment[], f1: Run, e1: Run | null, world: World): Record<string, any> {
  const rows = moments.map((m) => ({ m, c: classify(m, world.caps), r1: f1.results.get(m.id) }));
  const valid = rows.filter((x) => x.r1?.stateReproduced && x.r1.output !== null);
  const eligible = valid.filter((x) => x.c.eligible);
  const A = valid.filter((x) => x.c.a);
  const A2 = valid.filter((x) => x.c.a2);
  const report: Record<string, any> = {
    denominators: { moments: moments.length, validF1: valid.length, closingWindow: valid.filter((x) => x.c.remaining >= 1 && x.c.remaining <= 2).length, eligible: eligible.length, A: A.length, A2: A2.length, B: valid.length - A.length },
    P0: (() => {
      const prevalence = pct(A.length, eligible.length);
      const status = eligible.length < 50 ? "INCONCLUSIVE" : (prevalence ?? 0) >= 5 ? "PASS" : "FAIL";
      return { prevalence: ratio(A.length, eligible.length), byPicksRemaining: { 1: ratio(A.filter((x) => x.c.remaining === 1).length, eligible.filter((x) => x.c.remaining === 1).length), 2: ratio(A.filter((x) => x.c.remaining === 2).length, eligible.filter((x) => x.c.remaining === 2).length) }, status };
    })(),
    baselineF1: {
      structuralFill_board_top3_onA: ratio(A.filter((x) => gapFilled(boardTop3(x.r1!.output!), "structural_damage", world.caps, x.c.ownDamageTypes)).length, A.length),
      structuralFill_v4_top3_onA: ratio(A.filter((x) => gapFilled(v4Top3(x.r1!.output!), "structural_damage", world.caps, x.c.ownDamageTypes)).length, A.length),
      exposureTop3_onA: A.reduce((s, x) => s + exposure(x.m, boardTop3(x.r1!.output!), world.counters), 0),
      adverseCounterTop3_onA: Object.fromEntries(M1_THRESHOLDS.map((t) => [t.label, A.reduce((s, x) => s + x.r1!.output!.counterTop3.filter((e) => isAdverse({ heroId: e.heroId, score: 0, positionFit: 0, matches: 0, counter: { raw: e.raw, weighted: 0, sampleSize: e.sampleSize, vsRevealed: e.vsRevealed } } as never, t)).length, 0)])),
    },
    invariantsF1: (() => {
      const illegal = valid.flatMap((x) => i1Illegal(examStateOf(x.m, x.r1!.output!), { legalHeroIds: world.legalHeroIds } as ExamWorld));
      const proof = valid.map((x) => criticalGapProof(x.m, x.r1!.output!, x.c, F1_KINDS, world.caps));
      return { illegal: illegal.length, criticalGapShownWithoutProof: proof.reduce((s, p) => s + p.shownWithoutProof, 0), criticalGapMissing: proof.reduce((s, p) => s + p.missing, 0) };
    })(),
  };
  const ceiling = (report.baselineF1.structuralFill_board_top3_onA.pct ?? 0) > 80;
  report.P1_ceiling = { f1FillRateOnA: report.baselineF1.structuralFill_board_top3_onA, ceilingBreached: ceiling, note: "if F1 already fills the gap > 80% of the time the +20 points are not reachable and P1 is INCONCLUSIVE by the frozen rule" };
  if (e1 === null) return report;

  const pairs = valid.flatMap((x) => { const r2 = e1.results.get(x.m.id); return r2?.stateReproduced && r2.output !== null ? [{ ...x, r2 }] : []; });
  const changed = (x: { r1?: ReplayResult; r2: ReplayResult }): boolean => x.r1!.outputFingerprint !== x.r2.outputFingerprint;
  const Bp = pairs.filter((x) => !x.c.a), Ap = pairs.filter((x) => x.c.a), A2p = pairs.filter((x) => x.c.a2);
  const fill = (xs: typeof pairs, which: "r1" | "r2", gap: DraftCapabilityGap, surface: (o: MomentOutput) => number[]) => xs.filter((x) => gapFilled(surface(which === "r1" ? x.r1!.output! : x.r2.output!), gap, world.caps, x.c.ownDamageTypes)).length;
  const f1Fill = fill(Ap, "r1", "structural_damage", boardTop3), e1Fill = fill(Ap, "r2", "structural_damage", boardTop3);
  const deltaPp = (pct(e1Fill, Ap.length) ?? 0) - (pct(f1Fill, Ap.length) ?? 0);
  const sumExposure = (xs: typeof pairs, which: "r1" | "r2") => xs.reduce((s, x) => s + exposure(x.m, boardTop3(which === "r1" ? x.r1!.output! : x.r2.output!), world.counters), 0);
  const adverse = (xs: typeof pairs, which: "r1" | "r2") => Object.fromEntries(M1_THRESHOLDS.map((t) => [t.label, xs.reduce((s, x) => s + (which === "r1" ? x.r1!.output! : x.r2.output!).counterTop3.filter((e) => isAdverse({ heroId: e.heroId, score: 0, positionFit: 0, matches: 0, counter: { raw: e.raw, weighted: 0, sampleSize: e.sampleSize, vsRevealed: e.vsRevealed } } as never, t)).length, 0)]));
  const uncuratedIn = (o: MomentOutput): number[] => [...boardTop3(o), ...v4Top3(o)].filter((h) => UNCURATED_CAPABILITY_HERO_IDS.has(h));

  report.comparison = { pairs: pairs.length, bothReproduced: pairs.length === valid.length };
  report.changed = {
    inA: ratio(Ap.filter(changed).length, Ap.length), inA2: ratio(A2p.filter(changed).length, A2p.length), inB: ratio(Bp.filter(changed).length, Bp.length),
    recommendedPositionChangedInA: Ap.filter((x) => x.r1!.output!.board.recommendedPosition !== x.r2.output!.board.recommendedPosition).length,
    top3ChangedInA: Ap.filter((x) => fingerprint(boardTop3(x.r1!.output!)) !== fingerprint(boardTop3(x.r2.output!))).length,
    reasonsOnlyInA: Ap.filter((x) => changed(x) && fingerprint(boardTop3(x.r1!.output!)) === fingerprint(boardTop3(x.r2.output!)) && x.r1!.output!.board.recommendedPosition === x.r2.output!.board.recommendedPosition).length,
    changedIdsInA: Ap.filter(changed).map((x) => x.m.id),
    mustNotChangeViolations: Bp.filter(changed).map((x) => x.m.id),
  };
  report.P1 = { structuralFillF1: ratio(f1Fill, Ap.length), structuralFillE1: ratio(e1Fill, Ap.length), deltaPercentagePoints: Math.round(deltaPp * 100) / 100, v4SurfaceF1: ratio(fill(Ap, "r1", "structural_damage", v4Top3), Ap.length), v4SurfaceE1: ratio(fill(Ap, "r2", "structural_damage", v4Top3), Ap.length), status: Ap.length < 30 || ceiling ? "INCONCLUSIVE" : deltaPp >= 20 ? "PASS" : "FAIL" };
  report.P2 = { violations: ratio(Bp.filter(changed).length, Bp.length), status: Bp.filter(changed).length === 0 ? "PASS" : "FAIL" };
  const expF1 = sumExposure(Ap, "r1"), expE1 = sumExposure(Ap, "r2");
  report.P3 = { exposureTop3_F1_onA: expF1, exposureTop3_E1_onA: expE1, delta: expE1 - expF1, onChangedOnly: { F1: sumExposure(Ap.filter(changed), "r1"), E1: sumExposure(Ap.filter(changed), "r2") }, status: Ap.length < 30 ? "INCONCLUSIVE" : expE1 <= expF1 ? "PASS" : "FAIL" };
  const illegalE1 = pairs.flatMap((x) => i1Illegal(examStateOf(x.m, x.r2.output!), { legalHeroIds: world.legalHeroIds } as ExamWorld));
  const proofE1 = pairs.map((x) => criticalGapProof(x.m, x.r2.output!, x.c, E1_KINDS, world.caps));
  const promotions = pairs.flatMap((x) => { const before = new Set(uncuratedIn(x.r1!.output!)); return uncuratedIn(x.r2.output!).filter((h) => !before.has(h)).map((h) => `${x.m.id}:${h}`); });
  const p4 = { illegalE1: illegalE1.length, criticalGapShownWithoutProofE1: proofE1.reduce((s, p) => s + p.shownWithoutProof, 0), criticalGapMissingE1: proofE1.reduce((s, p) => s + p.missing, 0), uncuratedPromotions: promotions };
  report.P4 = { ...p4, status: p4.illegalE1 === 0 && p4.criticalGapShownWithoutProofE1 === 0 && p4.criticalGapMissingE1 === 0 && promotions.length === 0 ? "PASS" : "FAIL" };
  report.P5_otherGaps = Object.fromEntries(OTHER_GAPS.map((gap) => {
    const set = pairs.filter((x) => x.c.criticalF1.includes(gap));
    const f = fill(set, "r1", gap, boardTop3), e = fill(set, "r2", gap, boardTop3);
    const d = (pct(e, set.length) ?? 0) - (pct(f, set.length) ?? 0);
    return [gap, { moments: set.length, fillF1: ratio(f, set.length), fillE1: ratio(e, set.length), deltaPp: Math.round(d * 100) / 100, status: set.length < 10 ? "INCONCLUSIVE" : d >= -5 ? "PASS" : "FAIL" }];
  }));
  report.M1_reported = { adverseCounterTop3_onA: { F1: adverse(Ap, "r1"), E1: adverse(Ap, "r2") }, adverseCounterTop3_onChanged: { F1: adverse(Ap.filter(changed), "r1"), E1: adverse(Ap.filter(changed), "r2") }, note: "reported with the unchanged M1 thresholds; never a verdict input" };
  const statuses = [report.P0.status, report.P1.status, report.P2.status, report.P3.status, report.P4.status, ...Object.values(report.P5_otherGaps).map((g: any) => g.status)];
  report.verdict = verdictOf(statuses);
  report.verdictNote = "A numeric PASS is not a strategic improvement; the blind evaluation of the modified decisions is still required.";
  return report;
}

export function verdictOf(statuses: string[]): "PASS" | "FAIL" | "INCONCLUSIVE" {
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("INCONCLUSIVE")) return "INCONCLUSIVE";
  return "PASS";
}

function arg(name: string): string | undefined { return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3); }
const loadRun = (path: string, kinds: readonly DraftCapabilityGap[]): Run => ({ kinds, results: new Map((JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as { results: ReplayResult[] }).results.map((r) => [r.id, r])) });

if (import.meta.main) {
  const moments = (JSON.parse(readFileSync(resolve(ROOT, arg("moments")!), "utf8")) as { moments: DecisionMoment[] }).moments;
  const data = loadWorldData();
  const world: World = { caps: new Map(loadHeroCapabilities().map((c) => [c.hero, c])), counters: data.heroCounters, legalHeroIds: new Set(data.heroIds) };
  const f1 = loadRun(arg("f1")!, F1_KINDS);
  const report = analyze(moments, f1, process.argv.includes("--full") ? loadRun(arg("e1")!, E1_KINDS) : null, world);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (arg("out")) writeFileSync(resolve(ROOT, arg("out")!), text);
  console.log(text);
}
