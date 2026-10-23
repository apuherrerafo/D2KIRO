#!/usr/bin/env bun
// F1 / TSK-250 -- DRAFTER EXAM, baseline. Measures how the Coach recommends heroes TODAY; changes no behaviour.
//
//   bun scripts/p1-exam/exam.ts --out=ENGINE_P1_EXAM_BASELINE [--drafts=60]
//     -> docs/diagnostics/<out>.{md,json}
//
// Same real-data driver as Wave 5 (scripts/wave5/driver.ts: protocol routes + Enemy Bot + V6 over the FROZEN snapshot + curated data), but
// at every decision point it also asks for what the real simulator path shows: `?format=v4` and the Team Coach Board. Nothing here is
// imported from apps/; it only READS engine code to measure it. Deterministic: same code + same data => byte-identical artifacts
// (latency is printed to the console, never written to the artifact). Refuses to overwrite an existing report.
//
// "Ladder mode": re-run after each F1 ticket with a new --out and compare with `bun scripts/wave5/packet-diff.ts`-style diffs of the JSON.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadHeroCapabilities } from "../../apps/engine/src/draft-paths/capabilities";
import { SIDES, loadWorldData, muteLog, percentile, unmuteLog, type WorldData } from "../wave5/driver";
import { POLICIES, runExam } from "./session";
import { collectEvidenceIdentity } from "../wave5/evidence-identity";
import {
  availableHardCounters, i1Illegal, i2Roles, i3Order, i6Gap, i7Damage, i9Counters, inMorePlayedHalf, mean, meanPairwiseJaccard, notCredibleShown, rate, varianceShare,
  type ExamState, type ExamWorld, type Pos,
} from "./checks";

const OUT_DIR = join(import.meta.dir, "../../docs/diagnostics");
const SCHEMA = "engine-p1-exam/v1";
const POSITIONS: Pos[] = [1, 2, 3, 4, 5];
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

// ---- Summary ------------------------------------------------------------------------------------------------------------------------------
const EXAMPLES = 5;
const examples = (items: readonly string[]): string[] => items.slice(0, EXAMPLES);
const round4 = (x: number | null): number | null => (x === null ? null : Math.round(x * 10_000) / 10_000);

export function summarize(states: readonly ExamState[], world: ExamWorld) {
  const total = states.length;
  const i1 = states.flatMap((s) => i1Illegal(s, world));
  const i2 = states.flatMap((s) => i2Roles(s, world));
  const i3 = states.map((s) => i3Order(s));
  const divergences = i3.flatMap((r) => r.divergences);
  const unrankedOpen = i3.flatMap((r) => r.unrankedOpenColumns);
  const phaseAsStrategic = i3.filter((r) => r.phasePresentedAsStrategic).length;
  const opening = i3.filter((r) => r.coreFirstWithoutWindow !== null);
  const coreFirst = opening.filter((r) => r.coreFirstWithoutWindow === true).length;

  const i6 = states.map((s) => i6Gap(s, world)).filter((r) => r.applies);
  const i7 = states.map((s) => i7Damage(s, world)).filter((r) => r.applies);
  const i9 = states.flatMap((s) => i9Counters(s, world).shown);
  const statesWithI9 = new Set(i9.map((x) => x.where.split(" ")[0]));

  // I4: top-3 reactivity for the same position across different drafts, at the very first decision of each draft (drafts differ by seed/bans).
  const firsts = states.filter((s) => s.ownPicks.length === 0 && s.board);
  const jaccardByPosition: Record<string, number | null> = {};
  const concentration: Record<string, { distinctPrimaries: number; sample: number; mostCommonShare: number | null }> = {};
  for (const position of POSITIONS) {
    const columns = firsts.map((s) => s.board!.columns.find((c) => c.position === position && c.state === "RANKED")).filter((c): c is NonNullable<typeof c> => c !== undefined && c.top.length > 0);
    jaccardByPosition[`pos${position}`] = round4(meanPairwiseJaccard(columns.map((c) => c.top.slice(0, 3).map((t) => t.heroId))));
    const counts = new Map<number, number>();
    for (const c of columns) counts.set(c.top[0]!.heroId, (counts.get(c.top[0]!.heroId) ?? 0) + 1);
    concentration[`pos${position}`] = { distinctPrimaries: counts.size, sample: columns.length, mostCommonShare: round4(columns.length === 0 ? null : Math.max(...counts.values()) / columns.length) };
  }
  const jaccardAll = round4(mean(Object.values(jaccardByPosition).filter((x): x is number => x !== null)));

  const shares = states.map((s) => s.positionFitShare).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const levels = states.map((s) => s.positionFitLevelShare).filter((x): x is number => x !== null).sort((a, b) => a - b);

  // I8 / I10 at the first own decision of round 1.
  const round1 = states.filter((s) => s.round === 1 && s.ownPicks.length === 0 && s.board);
  const exposures = round1.flatMap((s) => { const hero = s.board!.columns.find((c) => c.position === s.board!.recommendedPosition)?.top[0]?.heroId; return hero === undefined ? [] : [availableHardCounters(hero, s, world)]; });
  const popularity = round1.flatMap((s) => s.board!.columns.filter((c) => c.state === "RANKED").flatMap((c) => c.top.slice(0, 3).map((t) => inMorePlayedHalf(t.heroId, c.position, world.positions)))).filter((x): x is boolean => x !== null);
  const notCredible = states.flatMap((s) => notCredibleShown(s, world));

  return {
    states: total,
    hard: {
      I1_illegal: { violations: i1.length, examples: examples(i1) },
      I2_roleFeasibility: { violations: i2.length, examples: examples(i2) },
      I3_conformity: {
        targetDivergesFromDeclaredPrecedence: { states: divergences.length, of: total, rate: round4(rate(divergences.length, total)), examples: examples(divergences) },
        openColumnNotRanked: { violations: unrankedOpen.length, examples: examples(unrankedOpen) },
        phaseShownAsStrategic: phaseAsStrategic,
      },
      I6_visible: {
        gapOpenStates: i6.length,
        gapNotVisibleOnAnyCard: i6.filter((r) => r.gapNotVisible).length,
        note: "A late open initiation/catch gap that no card mentions. T4/T5 are expected to close it; at baseline it is a known defect.",
      },
      I9_visible: {
        hardCounteredHeroesInTop3: i9.length,
        statesAffected: statesWithI9.size,
        withoutVisibleRisk: i9.filter((x) => !x.riskVisible).length,
        examples: examples(i9.filter((x) => !x.riskVisible).map((x) => `${x.where}: hero ${x.heroId} hard-countered by revealed ${x.by.join("+")}`)),
        note: "Plan v2: allowed in the top-3 only when fewer than 3 credible alternatives exist AND the risk is shown. At baseline the risk is never shown.",
      },
      I11_honestBasis: { status: "NOT_MEASURABLE", reason: "No `basis` field exists on any card yet (it is created by T5/TSK-254); today a curated claim and a statistical claim look identical." },
    },
    observations: {
      I3_openingOnCore: { openingStates: opening.length, coreFirstWithoutWindow: coreFirst, rate: round4(rate(coreFirst, opening.length)), note: "Simulator recommends Pos 1/2 on the Player's first decision of round 1 with no COUNTER_WINDOW/POOL_SCARCITY behind it." },
      I4_reactivityJaccardTop3: { overall: jaccardAll, byPosition: jaccardByPosition, sampleStates: firsts.length, note: "1.0 = the same three heroes for a position in every draft." },
      I5_positionFitShareOfScore: {
        levelMedian: round4(levels.length === 0 ? null : percentile(levels, 50)), levelP10: round4(levels.length === 0 ? null : percentile(levels, 10)), levelP90: round4(levels.length === 0 ? null : percentile(levels, 90)),
        orderMedian: round4(shares.length === 0 ? null : percentile(shares, 50)), orderP10: round4(shares.length === 0 ? null : percentile(shares, 10)), orderP90: round4(shares.length === 0 ? null : percentile(shares, 90)),
        states: levels.length, candidatesPerState: round4(mean(states.map((s) => s.candidateCount))),
        note: "level = share of V6's score that is position_fit; order = cov(position_fit, score)/var(score) among the candidates V6 keeps (TOP_N) for the recommended column. Not the whole credible field: V6 truncates before the exam can see it.",
      },
      I7_damageMix: { monoDamageStates: i7.length, top3Diversifies: i7.filter((r) => r.top3Diversifies).length },
      I6_fill: { gapOpenStates: i6.length, top3Fills: i6.filter((r) => r.top3Fills).length, fillerExistsInShownSet: i6.filter((r) => r.credibleFillerExists).length },
      I8_exposureOfRound1Primary: { states: exposures.length, meanHardCountersAvailable: round4(mean(exposures)), maxHardCountersAvailable: exposures.length === 0 ? null : Math.max(...exposures) },
      I10_round1Top3InMorePlayedHalf: { candidates: popularity.length, inMorePlayedHalf: popularity.filter(Boolean).length, rate: round4(rate(popularity.filter(Boolean).length, popularity.length)), note: "Observation only (plan v2 removed it as a gate): high = the ranking leans on popularity." },
      top1Concentration: concentration,
      shownButNotCredibleAtColumn: { count: notCredible.length, examples: examples(notCredible) },
    },
  };
}

// ---- Judge packet (what a human judges; filled in at T6) -----------------------------------------------------------------------------
const COMPONENT_QUESTIONS = [
  { id: "C1-position", text: "Position order: is the position the board recommends the right one to commit to NOW (and not just the lowest open one)?" },
  { id: "C2-ranking", text: "Hero ranking: are the heroes shown for that position the ones you would consider, or do they look chosen for being popular?" },
  { id: "C3-composition", text: "Composition: does the advice notice what the team still lacks (initiation / catch / damage mix)?" },
  { id: "C4-exposure", text: "Exposure: is any recommended hero a clear counter-target of what the rival has shown, and does the card say so?" },
];
const PLAN_QUESTIONS = [
  { id: "P1-tempo", text: "Does this team need to win early, or can it scale?" },
  { id: "P2-objectives", text: "Can this draft convert an advantage into objectives?" },
  { id: "P3-plan", text: "Does the recommendation improve the plan, or only the score?" },
];

function judgePacket(states: readonly ExamState[], world: ExamWorld, data: WorldData) {
  const criteria: { label: string; test: (s: ExamState) => boolean }[] = [
    { label: "round-1 opening recommends a core without a window", test: (s) => i3Order(s).coreFirstWithoutWindow === true },
    { label: "round-1 opening recommends hard support / support", test: (s) => s.round === 1 && s.ownPicks.length === 0 && (s.board?.recommendedPosition === 5 || s.board?.recommendedPosition === 4) },
    { label: "simulator target differs from the declared precedence", test: (s) => i3Order(s).divergences.length > 0 },
    { label: "a hard-countered hero sits in a top-3", test: (s) => i9Counters(s, world).shown.length > 0 },
    { label: "late open initiation/catch gap", test: (s) => i6Gap(s, world).applies },
    { label: "mono-damage team", test: (s) => i7Damage(s, world).applies },
    { label: "round 2 after rival reveals", test: (s) => s.round === 2 && s.revealedEnemy.length >= 2 },
    { label: "round 3 closing pick", test: (s) => s.round === 3 },
  ];
  const used = new Set<string>();
  const points = criteria.flatMap((criterion) => {
    const hit = states.find((s) => !used.has(`${s.draftKey}#${s.index}`) && s.board && criterion.test(s));
    if (!hit) return [];
    used.add(`${hit.draftKey}#${hit.index}`);
    const name = (id: number): string => data.name(id);
    return [{
      coverage: criterion.label,
      opaqueKey: createHash("sha256").update(`${hit.draftKey}#${hit.index}`).digest("hex").slice(0, 12),
      round: hit.round,
      bans: hit.banned.map(name),
      ownPicks: hit.ownPicks.map(name),
      revealedEnemy: hit.revealedEnemy.map(name),
      boardRecommendedPosition: hit.board!.recommendedPosition,
      boardTop3ByPosition: Object.fromEntries(hit.board!.columns.filter((c) => c.top.length > 0).map((c) => [`pos${c.position}`, c.top.slice(0, 3).map((t) => name(t.heroId))])),
      v3Top3: hit.v3.slice(0, 3).map((c) => name(c.heroId)),
      precedenceWouldPick: hit.lpp ? `pos${hit.lpp.position} (${hit.lpp.signal})` : null,
      judgeAnswers: Object.fromEntries([...COMPONENT_QUESTIONS, ...PLAN_QUESTIONS].map((q) => [q.id, { answer: null, notes: null }])),
    }];
  });
  return { schema: "engine-p1-judge-packet/v1", componentQuestions: COMPONENT_QUESTIONS, planQuestions: PLAN_QUESTIONS, points };
}

// ---- Markdown ------------------------------------------------------------------------------------------------------------------------------
const pct = (x: number | null): string => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

function markdown(report: { identity: ReturnType<typeof collectEvidenceIdentity>; config: Record<string, unknown>; coverage: Record<string, unknown>; summary: ReturnType<typeof summarize> }): string {
  const { summary, identity } = report;
  const h = summary.hard;
  const o = summary.observations;
  const lines: string[] = [];
  lines.push("# ENGINE_P1_EXAM — línea base del examen de drafter (TSK-250)", "");
  lines.push(`Código: \`${identity.code.head.slice(0, 7)}\` (${identity.code.cleanAtHead ? "árbol limpio" : `${identity.code.dirtyPathCount} archivo(s) distintos de HEAD`}) · estado \`${identity.code.contentStateHash.slice(0, 16)}\` · snapshot \`${(identity.data.empiricalSnapshot as { id?: string }).id}\` · clave comparable \`${identity.comparableKey.slice(0, 16)}\``, "");
  lines.push("Este reporte **mide, no juzga y no cambia comportamiento**. Camino medido: el del simulador (Team Coach Board + `?format=v4`) más la lista V3 que el juez de Wave 5 ya conocía.", "");
  lines.push(`Muestra: ${JSON.stringify(report.coverage)}`, "");
  lines.push("## Defectos duros (plan v2, tabla C)", "", "| Invariante | Resultado |", "| --- | --- |");
  lines.push(`| I1 nada ilegal | ${h.I1_illegal.violations} violaciones |`);
  lines.push(`| I2 factibilidad de roles | ${h.I2_roleFeasibility.violations} violaciones |`);
  lines.push(`| I3 conformidad: objetivo = precedencia declarada | ${h.I3_conformity.targetDivergesFromDeclaredPrecedence.states}/${summary.states} estados divergen (${pct(h.I3_conformity.targetDivergesFromDeclaredPrecedence.rate)}) |`);
  lines.push(`| I3 toda columna abierta rankeada | ${h.I3_conformity.openColumnNotRanked.violations} violaciones |`);
  lines.push(`| I3 PHASE presentado como ventaja | ${h.I3_conformity.phaseShownAsStrategic} |`);
  lines.push(`| I6-visible hueco de iniciación/catch | ${h.I6_visible.gapNotVisibleOnAnyCard}/${h.I6_visible.gapOpenStates} estados con hueco abierto sin que ninguna tarjeta lo diga |`);
  lines.push(`| I9-visible counter duro en top-3 | ${h.I9_visible.hardCounteredHeroesInTop3} apariciones en ${h.I9_visible.statesAffected} estados; ${h.I9_visible.withoutVisibleRisk} sin riesgo visible |`);
  lines.push(`| I11 honestidad de la base | ${h.I11_honestBasis.status}: ${h.I11_honestBasis.reason} |`, "");
  lines.push("## Observaciones (no son ley)", "");
  lines.push(`- **I3 apertura en cores:** ${o.I3_openingOnCore.coreFirstWithoutWindow}/${o.I3_openingOnCore.openingStates} aperturas de ronda 1 recomiendan Pos 1/2 sin ventana de counter ni escasez de pool (${pct(o.I3_openingOnCore.rate)}).`);
  lines.push(`- **I4 reactividad (Jaccard del top-3, misma posición entre drafts distintos):** global ${o.I4_reactivityJaccardTop3.overall}; por posición ${JSON.stringify(o.I4_reactivityJaccardTop3.byPosition)}. 1.0 = siempre los mismos tres.`);
  const i5 = o.I5_positionFitShareOfScore;
  lines.push(`- **I5 peso de \`position_fit\`:** ${pct(i5.levelMedian)} del score (mediana; p10 ${pct(i5.levelP10)}, p90 ${pct(i5.levelP90)}) y ${pct(i5.orderMedian)} de la dispersión que ordena a los candidatos (mediana; p10 ${pct(i5.orderP10)}, p90 ${pct(i5.orderP90)}); ${i5.states} estados, ~${i5.candidatesPerState} candidatos por estado. Es sobre lo que V6 conserva (TOP_N), no sobre todo el campo.`);
  lines.push(`- **I6 relleno:** de ${o.I6_fill.gapOpenStates} estados con hueco abierto, el top-3 lo llena en ${o.I6_fill.top3Fills}; existe un relleno en lo mostrado en ${o.I6_fill.fillerExistsInShownSet}.`);
  lines.push(`- **I7 daño:** de ${o.I7_damageMix.monoDamageStates} estados mono-daño, el top-3 diversifica en ${o.I7_damageMix.top3Diversifies}.`);
  lines.push(`- **I8 exposición del primary de ronda 1:** ${o.I8_exposureOfRound1Primary.meanHardCountersAvailable} counters duros disponibles en promedio (máx ${o.I8_exposureOfRound1Primary.maxHardCountersAvailable}) sobre ${o.I8_exposureOfRound1Primary.states} aperturas.`);
  lines.push(`- **I10 popularidad:** ${pct(o.I10_round1Top3InMorePlayedHalf.rate)} de los top-3 de ronda 1 caen en la mitad más jugada de su posición (${o.I10_round1Top3InMorePlayedHalf.inMorePlayedHalf}/${o.I10_round1Top3InMorePlayedHalf.candidates}).`);
  lines.push(`- **Concentración del #1:** ${JSON.stringify(o.top1Concentration)}`);
  lines.push(`- **Mostrado pero no creíble en su columna:** ${o.shownButNotCredibleAtColumn.count}.`, "");
  lines.push("## Cómo reproducir", "", ...identity.reproduce.map((r) => `- \`${r}\``), "");
  return `${lines.join("\n")}\n`;
}

// ---- main -------------------------------------------------------------------------------------------------------------------------------
async function main(): Promise<void> {
  const out = arg("out");
  if (!out || !/^[A-Za-z0-9_]+$/.test(out)) throw new Error("usage: --out=<BASENAME> [--drafts=N]");
  if (existsSync(join(OUT_DIR, `${out}.json`)) || existsSync(join(OUT_DIR, `${out}.md`))) throw new Error(`${out}.{md,json} already exists -- evidence is never overwritten; pass a new --out=`);
  const draftCount = Number(arg("drafts") ?? 60);
  if (!Number.isInteger(draftCount) || draftCount < 1 || draftCount > 200) throw new Error("--drafts must be an integer in 1..200");

  const data = loadWorldData();
  const capabilities = new Map(loadHeroCapabilities().map((c) => [c.hero, c]));
  const world: ExamWorld = { legalHeroIds: new Set(data.heroIds), positions: data.heroPositions, counters: data.heroCounters, capabilities };

  muteLog();
  const run = await runExam(data, draftCount);
  unmuteLog();

  const summary = summarize(run.states, world);
  const byRound = (r: number): number => run.states.filter((s) => s.round === r).length;
  const coverage = { drafts: run.drafts, completed: run.completed, decisionPoints: run.states.length, round1: byRound(1), round2: byRound(2), round3: byRound(3), harnessFailures: run.failures.length, harnessBadStatuses: run.badStatuses.length };
  const identity = collectEvidenceIdentity({
    certificationId: out,
    snapshot: { id: data.snapshot.id, live: data.snapshot.live },
    positionsMode: data.positionsMode,
    reproduce: [`bun scripts/p1-exam/exam.ts --out=${out} --drafts=${draftCount}`],
  });
  // The wall clock is the only non-deterministic field of the identity: dropped so two runs of the same system are byte-identical.
  const { generatedAt: _generatedAt, ...stableIdentity } = identity;
  const report = {
    schema: SCHEMA,
    purpose: "Baseline of how the Coach recommends heroes today (F1, TSK-250). Measures; changes nothing. PASS technical != strategic improvement.",
    identity: stableIdentity,
    config: { drafts: draftCount, policies: POLICIES, personalPositions: POSITIONS, sides: SIDES, seeds: "AUDIT001.." },
    coverage,
    limitations: [
      "Frozen statistical snapshot labelled 7.41e (label unverified); curated positions/counters are hand-curated. Absolute numbers are comparative baselines, not truth.",
      "The simulated Player follows V3 (follow-coach / varied / deviate); the Enemy Bot is scripted. States are realistic, not human.",
      "The lab has no saved-team pools: POOL_SCARCITY is approximated with the Player's own pool at their personal position.",
      "I3 'declared precedence' is LivePositionPriorityV1 evaluated offline over the board's own columns; it does not run in the simulator today.",
      "I11 is not measurable until T5 creates the `basis` field.",
    ],
    summary,
    judgePacket: judgePacket(run.states, world, data),
    harnessFailures: run.failures.slice(0, 20),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${out}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, `${out}.md`), markdown({ identity, config: report.config, coverage, summary }) + judgeMarkdown(report.judgePacket));

  const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
  console.log(`[p1-exam] ${coverage.drafts} drafts (${coverage.completed} completed), ${coverage.decisionPoints} decision points -> docs/diagnostics/${out}.{md,json}`);
  console.log(`[p1-exam] latency (not in the artifact): v3 p50/p95 ${percentile(sorted(run.v3Ms), 50).toFixed(0)}/${percentile(sorted(run.v3Ms), 95).toFixed(0)} ms, board ${percentile(sorted(run.boardMs), 50).toFixed(0)}/${percentile(sorted(run.boardMs), 95).toFixed(0)} ms, v4 ${percentile(sorted(run.v4Ms), 50).toFixed(0)}/${percentile(sorted(run.v4Ms), 95).toFixed(0)} ms`);
  if (run.failures.length > 0) console.log(`[p1-exam] harness failures: ${run.failures.length} (first: ${run.failures[0]})`);
}

function judgeMarkdown(packet: ReturnType<typeof judgePacket>): string {
  const lines = ["## Paquete del juez (se rellena en T6)", "", "Preguntas por componente:", ...packet.componentQuestions.map((q) => `- **${q.id}** ${q.text}`), "", "Preguntas de plan (línea base que decide la prioridad de F2):", ...packet.planQuestions.map((q) => `- **${q.id}** ${q.text}`), ""];
  for (const point of packet.points) {
    lines.push(`### ${point.opaqueKey} — ${point.coverage}`, "", `Ronda ${point.round} · bans: ${point.bans.join(", ") || "—"} · propios: ${point.ownPicks.join(", ") || "—"} · rivales: ${point.revealedEnemy.join(", ") || "—"}`);
    lines.push(`- Posición recomendada por el board: Pos ${point.boardRecommendedPosition} · la precedencia declarada elegiría: ${point.precedenceWouldPick ?? "—"}`);
    lines.push(`- Top-3 V3: ${point.v3Top3.join(", ")}`);
    for (const [position, heroes] of Object.entries(point.boardTop3ByPosition)) lines.push(`- Board ${position}: ${(heroes as string[]).join(", ")}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) await main();
