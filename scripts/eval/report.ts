// Fase 9.0 — formatea el resultado de los dos benchmarks a un reporte legible (SPEC.md §15.4.3).
// Puro: recibe los objetos de resultado, devuelve un string markdown. Sin I/O.

import type { EngineQualityResult } from "./benchmark-engine-quality";
import type { ProAgreementResult } from "./benchmark-pro-agreement";

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const n3 = (x: number): string => x.toFixed(3);

export interface ReportMeta {
  generatedAt: string;
  commit: string;
  splitHash: string;
  snapshotSyncedAt: string | null;
  /** SPEC §16.4 — el patch semántico forzado sobre el `state` del replay (o null si no se forzó). */
  patchOverride: string | null;
  corpusSize: { drafts: number; tournaments: number; goldenCases: number };
}

// TSK-212 (Fase 9.1, SPEC.md §16.8): EvidenceCoverage / GuessingIndex medios del Top-6, por
// ranker que pasa por `buildSuggestions` (v6*), en cada contexto de benchmark. `random` /
// `patchMetaOnly` no pasan por el motor -> no tienen estas métricas.
export interface EvidenceAggregate {
  evidenceCoverage: number;
  guessingIndex: number;
  n: number;
}
export interface EvidenceProfile {
  engineQuality: Record<string, EvidenceAggregate>;
  proAgreement: Record<string, EvidenceAggregate>;
}

export function renderReport(
  meta: ReportMeta,
  quality: EngineQualityResult,
  agreement: ProAgreementResult,
  evidence?: EvidenceProfile,
): string {
  const lines: string[] = [];
  lines.push(`# Reporte de evaluación — V6-medido`);
  lines.push("");
  lines.push(
    `> **INSTRUMENTO COMPARATIVO, NO PREDICTIVO** (ADR-002). No existe snapshot de meta ` +
      `point-in-time. El valor absoluto de cualquier métrica no es interpretable — sólo el delta ` +
      `entre baselines de la misma corrida. "Professional Pick Agreement" NO es "accuracy".`,
  );
  lines.push("");
  lines.push(`- Commit: \`${meta.commit}\``);
  lines.push(`- Generado: ${meta.generatedAt}`);
  lines.push(`- Split congelado: \`${meta.splitHash}\``);
  lines.push(`- Snapshot de meta sincronizado: ${meta.snapshotSyncedAt ?? "desconocido"}`);
  if (meta.patchOverride !== null) {
    lines.push(
      `- Patch del backtest forzado a \`${meta.patchOverride}\` (SPEC §16.4) — el backtest asume ` +
        `que el meta vigente aplica al draft; sin esto \`patch_meta\` sería 100% null.`,
    );
  }
  lines.push(
    `- Corpus: ${meta.corpusSize.drafts} drafts / ${meta.corpusSize.tournaments} torneos / ` +
      `${meta.corpusSize.goldenCases} casos Golden`,
  );
  lines.push("");

  // ---- Benchmark A ----
  lines.push(`## Benchmark A — Engine Quality (PRINCIPAL, Golden Dataset)`);
  lines.push("");
  if (!quality.valid) {
    lines.push(`**CORRIDA INVÁLIDA** — ConstraintViolationRate = ${pct(quality.constraintViolationRate)} > 0.`);
    lines.push(`Primeras violaciones: ${quality.violations.slice(0, 5).map((v) => `${v.ranker}:${v.hero}`).join(", ")}`);
  } else if (quality.corpus.cases === 0) {
    lines.push(`_Golden Dataset vacío — se re-corre tras la curación (TSK-206)._`);
  } else {
    lines.push(`| ranker | NDCG@5 | Bad Pick Rate@5 | Pairwise Acc |`);
    lines.push(`|---|---|---|---|`);
    for (const [id, seg] of Object.entries(quality.perRanker)) {
      lines.push(`| ${id} | ${n3(seg.overall.ndcg5)} | ${pct(seg.overall.badPickRate5)} | ${pct(seg.overall.pairwiseAccuracy)} |`);
    }
    if (quality.bootstrap) {
      lines.push("");
      lines.push(`NDCG@5 (v6Full) IC95 bootstrap sobre casos: **${n3(quality.bootstrap.point)}** [${n3(quality.bootstrap.lo)}, ${n3(quality.bootstrap.hi)}]`);
    }
    lines.push("");
    lines.push(`### v6Full por contexto de decisión`);
    lines.push(`| contexto | n | NDCG@5 | Bad Pick@5 |`);
    lines.push(`|---|---|---|---|`);
    for (const [ctx, s] of Object.entries(quality.perRanker.v6Full.byDecisionContext)) {
      lines.push(`| ${ctx} | ${s.n} | ${n3(s.ndcg5)} | ${pct(s.badPickRate5)} |`);
    }
    lines.push("");
    lines.push(`### v6Full por estrato`);
    lines.push(`| estrato | n | NDCG@5 | Bad Pick@5 |`);
    lines.push(`|---|---|---|---|`);
    for (const [str, s] of Object.entries(quality.perRanker.v6Full.byStratum)) {
      if (s.n > 0) lines.push(`| ${str} | ${s.n} | ${n3(s.ndcg5)} | ${pct(s.badPickRate5)} |`);
    }
  }
  lines.push("");

  // ---- Benchmark B ----
  lines.push(`## Benchmark B — Professional Pick Agreement (SECUNDARIO, ${agreement.corpus.cases} casos)`);
  lines.push("");
  lines.push(`_Techo de Recall en @${agreement.recallCeilingK} (TOP_N de buildSuggestions). @k>${agreement.recallCeilingK} == @${agreement.recallCeilingK}._`);
  lines.push("");
  if (!agreement.valid) {
    lines.push(`**CORRIDA INVÁLIDA** — ConstraintViolationRate = ${pct(agreement.constraintViolationRate)} > 0.`);
  } else {
    lines.push(`| baseline | R@1 | R@3 | R@5 | R@6 | MRR |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const [id, seg] of Object.entries(agreement.perBaseline)) {
      const r = seg.overall.recall;
      lines.push(`| ${id} | ${pct(r[1])} | ${pct(r[3])} | ${pct(r[5])} | ${pct(r[6])} | ${n3(seg.overall.mrr)} |`);
    }
    lines.push("");
    for (const ci of agreement.bootstrap) {
      lines.push(`- ${ci.metric} — IC95 a nivel ${ci.level}: **${pct(ci.point)}** [${pct(ci.lo)}, ${pct(ci.hi)}]${ci.note ? ` — ${ci.note}` : ""}`);
    }
    lines.push("");
    lines.push(`### v6Full por contexto × tier`);
    lines.push(`| contexto | R@3 (n) | tier | R@3 (n) |`);
    for (const [ctx, s] of Object.entries(agreement.perBaseline.v6Full.byDecisionContext)) {
      lines.push(`| ${ctx} | ${pct(s.recall[3])} (${s.n}) | | |`);
    }
    for (const [tier, s] of Object.entries(agreement.perBaseline.v6Full.byTier)) {
      lines.push(`| | | ${tier} | ${pct(s.recall[3])} (${s.n}) |`);
    }
  }
  lines.push("");
  lines.push(`### Baselines omitidos`);
  for (const o of agreement.omittedBaselines) lines.push(`- \`${o.id}\`: ${o.reason}`);
  lines.push("");

  // ---- Cobertura de evidencia (Fase 9.1, §16.8) ----
  if (evidence) {
    lines.push(`## Cobertura de evidencia (v6, Top-6)`);
    lines.push("");
    lines.push(`| ranker | contexto | EvCov medio | GuessingIndex medio | n (sugerencias) |`);
    lines.push(`|---|---|---|---|---|`);
    const row = (id: string, ctx: string, a: EvidenceAggregate | undefined): void => {
      if (!a || a.n === 0) return;
      lines.push(`| ${id} | ${ctx} | ${n3(a.evidenceCoverage)} | ${n3(a.guessingIndex)} | ${a.n} |`);
    };
    for (const id of Object.keys(evidence.engineQuality)) row(id, "Golden", evidence.engineQuality[id]);
    for (const id of Object.keys(evidence.proAgreement)) row(id, "Pro (muestra)", evidence.proAgreement[id]);
    lines.push("");
    const gq = evidence.engineQuality.v6Full;
    if (gq && gq.n > 0) {
      lines.push(
        `GuessingIndex medio del Top-6 de \`v6Full\` (Golden): **${n3(gq.guessingIndex)}** ` +
          `(EvCov ${n3(gq.evidenceCoverage)}).`,
      );
    }
    lines.push(`_\`random\` / \`patchMetaOnly\` no pasan por \`buildSuggestions\` — sin EvCov._`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
