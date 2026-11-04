#!/usr/bin/env bun
// FRIENDS_FAMILY_READY — consolida los archivos `ff-eval-*.json` que descargan los evaluadores.
//
//   bun scripts/f-and-f/consolidate.ts [carpeta-de-resultados]   (por defecto qa/friends-family/results)
//     -> imprime el informe y escribe <carpeta>/_consolidado.{md,json}
//
// Este script NO inventa veredictos: solo agrega los de las personas. Sin archivos válidos -> no hay informe.
// Los umbrales de abajo son una PROPUESTA de arranque (constantes únicas): confírmalos antes de usar el veredicto.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PICK_RATINGS = ["bueno", "aceptable", "malo", "error_grave"] as const;
export const EXPLANATION_RATINGS = ["correcta", "dudosa", "incorrecta"] as const;
export const POSITION_RATINGS = ["ok", "dudosa", "mala"] as const;
export const ADVICE_RATINGS = ["razonable", "dudoso", "malo"] as const;
export type PickRating = (typeof PICK_RATINGS)[number];

/** Umbrales propuestos (ver README del kit). */
export const THRESHOLDS = {
  /** BLOQUEA si en >= N situaciones hay un error grave por consenso dentro del top 3. */
  blockScenariosWithGraveTop3: 2,
  /** BLOQUEA si más de esta fracción de picks tiene explicación "incorrecta" por consenso. */
  blockIncorrectExplanationShare: 0.2,
  /** BLOQUEA si el consejo principal es "malo" por consenso en >= N situaciones. */
  blockBadAdviceScenarios: 3,
  /** Mínimo de evaluadores independientes para poder declarar PASS. */
  minEvaluators: 2,
} as const;

export interface ScenarioDoc { schema: string; count: number; scenarios: { id: string; top5: { rank: number; heroId: number; name: string }[] }[] }
export interface EvalItem { scenarioId: string; rank: number; heroId: number; hero: string; pick: string; explanation: string; position: string; reason: string }
export interface EvalScenarioRow { scenarioId: string; advice: string; adviceReason: string; missingHero: string; note: string }
export interface EvalResult { schema: "ff-eval/v1"; scenariosSha256: string; evaluator: string; startedAt: string; finishedAt: string; items: EvalItem[]; scenarios: EvalScenarioRow[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** Valida UN archivo de evaluador contra el kit. Devuelve los errores (vacío = válido). Nunca lanza. */
export function validateResult(raw: unknown, doc: ScenarioDoc, expectedSha: string | null): string[] {
  const errors: string[] = [];
  if (!isRecord(raw) || raw.schema !== "ff-eval/v1") return ["esquema desconocido (se esperaba ff-eval/v1)"];
  if (expectedSha !== null && raw.scenariosSha256 !== expectedSha) errors.push("el archivo es de OTRA versión del kit (sha distinto)");
  if (typeof raw.evaluator !== "string" || raw.evaluator.trim().length < 2) errors.push("falta el nombre del evaluador");
  if (!Array.isArray(raw.items) || !Array.isArray(raw.scenarios)) return [...errors, "faltan items o scenarios"];
  const seen = new Set<string>();
  for (const it of raw.items) {
    if (!isRecord(it)) { errors.push("item malformado"); continue; }
    const key = `${String(it.scenarioId)}#${String(it.rank)}`;
    if (seen.has(key)) errors.push(`item repetido ${key}`);
    seen.add(key);
    if (!oneOf(PICK_RATINGS, it.pick)) errors.push(`${key}: calidad de pick inválida`);
    if (!oneOf(EXPLANATION_RATINGS, it.explanation)) errors.push(`${key}: explicación inválida`);
    if (!oneOf(POSITION_RATINGS, it.position)) errors.push(`${key}: posición inválida`);
    const needs = it.pick === "malo" || it.pick === "error_grave" || it.explanation !== "correcta" || it.position !== "ok";
    if (needs && (typeof it.reason !== "string" || it.reason.trim().length < 5)) errors.push(`${key}: falta la razón`);
  }
  for (const s of doc.scenarios) for (const h of s.top5) if (!seen.has(`${s.id}#${h.rank}`)) errors.push(`${s.id}#${h.rank}: sin evaluar`);
  const ids = new Set<string>();
  for (const sc of raw.scenarios) {
    if (!isRecord(sc)) { errors.push("situación malformada"); continue; }
    ids.add(String(sc.scenarioId));
    if (!oneOf(ADVICE_RATINGS, sc.advice)) errors.push(`${String(sc.scenarioId)}: consejo principal sin valorar`);
    else if (sc.advice !== "razonable" && (typeof sc.adviceReason !== "string" || sc.adviceReason.trim().length < 5)) errors.push(`${String(sc.scenarioId)}: falta la razón del consejo`);
  }
  for (const s of doc.scenarios) if (!ids.has(s.id)) errors.push(`${s.id}: consejo principal sin valorar`);
  return errors;
}

/** Etiqueta modal; en empate gana la PEOR (criterio conservador). */
export function modalWorst<T extends string>(order: readonly T[], labels: readonly T[]): T {
  const counts = new Map<T, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  let best = labels[0]!;
  for (const l of order) if ((counts.get(l) ?? 0) >= (counts.get(best) ?? 0) && counts.has(l)) best = l; // `order` va de mejor a peor
  return best;
}

const majority = (n: number): number => Math.floor(n / 2) + 1;

export interface ItemSummary {
  scenarioId: string; rank: number; hero: string; evaluators: number;
  pick: PickRating; pickAgreement: number; graveConsensus: boolean; graveDisputed: boolean;
  explanation: string; position: string;
  reasons: { evaluator: string; pick: string; explanation: string; position: string; reason: string }[];
}
export interface Consolidated {
  evaluators: string[];
  items: ItemSummary[];
  scenarios: { scenarioId: string; advice: string; missingHeroes: string[]; notes: string[]; gravesTop3: number }[];
  totals: { items: number; graveConsensus: number; graveDisputed: number; incorrectExplanationShare: number; scenariosWithGraveTop3: number; badAdviceScenarios: number; pickDistribution: Record<string, number> };
  verdict: "BLOQUEA" | "REVISAR" | "PASS" | "SIN_DATOS";
  verdictReasons: string[];
}

export function consolidate(results: readonly EvalResult[], doc: ScenarioDoc): Consolidated {
  if (results.length === 0) return { evaluators: [], items: [], scenarios: [], totals: { items: 0, graveConsensus: 0, graveDisputed: 0, incorrectExplanationShare: 0, scenariosWithGraveTop3: 0, badAdviceScenarios: 0, pickDistribution: {} }, verdict: "SIN_DATOS", verdictReasons: ["no hay resultados válidos"] };
  const n = results.length;
  const items: ItemSummary[] = [];
  for (const s of doc.scenarios) {
    for (const h of s.top5) {
      const rows = results.flatMap((r) => r.items.filter((i) => i.scenarioId === s.id && i.rank === h.rank).map((i) => ({ evaluator: r.evaluator, ...i })));
      const picks = rows.map((r) => r.pick as PickRating);
      const pick = modalWorst(PICK_RATINGS, picks);
      const graves = picks.filter((p) => p === "error_grave").length;
      items.push({
        scenarioId: s.id, rank: h.rank, hero: h.name, evaluators: rows.length, pick,
        pickAgreement: rows.length === 0 ? 0 : picks.filter((p) => p === pick).length / rows.length,
        graveConsensus: graves >= majority(rows.length) && graves > 0,
        graveDisputed: graves > 0 && graves < majority(rows.length),
        explanation: modalWorst(EXPLANATION_RATINGS, rows.map((r) => r.explanation as (typeof EXPLANATION_RATINGS)[number])),
        position: modalWorst(POSITION_RATINGS, rows.map((r) => r.position as (typeof POSITION_RATINGS)[number])),
        reasons: rows.filter((r) => r.reason !== "").map((r) => ({ evaluator: r.evaluator, pick: r.pick, explanation: r.explanation, position: r.position, reason: r.reason })),
      });
    }
  }
  const scenarios = doc.scenarios.map((s) => {
    const rows = results.flatMap((r) => r.scenarios.filter((x) => x.scenarioId === s.id));
    return {
      scenarioId: s.id,
      advice: modalWorst(ADVICE_RATINGS, rows.map((x) => x.advice as (typeof ADVICE_RATINGS)[number])),
      missingHeroes: rows.map((x) => x.missingHero).filter((x) => x !== ""),
      notes: rows.map((x) => x.note).filter((x) => x !== ""),
      gravesTop3: items.filter((i) => i.scenarioId === s.id && i.rank <= 3 && i.graveConsensus).length,
    };
  });
  const pickDistribution: Record<string, number> = {};
  for (const i of items) pickDistribution[i.pick] = (pickDistribution[i.pick] ?? 0) + 1;
  const totals = {
    items: items.length,
    graveConsensus: items.filter((i) => i.graveConsensus).length,
    graveDisputed: items.filter((i) => i.graveDisputed).length,
    incorrectExplanationShare: items.length === 0 ? 0 : items.filter((i) => i.explanation === "incorrecta").length / items.length,
    scenariosWithGraveTop3: scenarios.filter((s) => s.gravesTop3 > 0).length,
    badAdviceScenarios: scenarios.filter((s) => s.advice === "malo").length,
    pickDistribution,
  };
  const block: string[] = [];
  const review: string[] = [];
  if (totals.scenariosWithGraveTop3 >= THRESHOLDS.blockScenariosWithGraveTop3) block.push(`error grave por consenso en el top 3 de ${totals.scenariosWithGraveTop3} situaciones (umbral ${THRESHOLDS.blockScenariosWithGraveTop3})`);
  if (totals.incorrectExplanationShare > THRESHOLDS.blockIncorrectExplanationShare) block.push(`${(totals.incorrectExplanationShare * 100).toFixed(0)}% de explicaciones "incorrectas" por consenso (umbral ${(THRESHOLDS.blockIncorrectExplanationShare * 100).toFixed(0)}%)`);
  if (totals.badAdviceScenarios >= THRESHOLDS.blockBadAdviceScenarios) block.push(`consejo principal "malo" por consenso en ${totals.badAdviceScenarios} situaciones (umbral ${THRESHOLDS.blockBadAdviceScenarios})`);
  if (totals.scenariosWithGraveTop3 === 1) review.push("hay 1 situación con error grave por consenso en el top 3");
  if (totals.graveConsensus > totals.scenariosWithGraveTop3) review.push("hay errores graves por consenso fuera del top 3");
  if (totals.graveDisputed > 0) review.push(`${totals.graveDisputed} picks con "error grave" de solo parte de los evaluadores (discutir)`);
  if (n < THRESHOLDS.minEvaluators) review.push(`solo ${n} evaluador(es): se necesitan al menos ${THRESHOLDS.minEvaluators} independientes para PASS`);
  const verdict = block.length > 0 ? "BLOQUEA" : review.length > 0 ? "REVISAR" : "PASS";
  return { evaluators: results.map((r) => r.evaluator), items, scenarios, totals, verdict, verdictReasons: block.length > 0 ? block : review.length > 0 ? review : ["sin errores graves por consenso y umbrales respetados"] };
}

export function renderMarkdown(c: Consolidated, suspects: Record<string, string | null> = {}): string {
  const lines: string[] = [];
  lines.push("# Consolidado Friends & Family — evaluación humana", "");
  lines.push(`**Veredicto propuesto: ${c.verdict}** — ${c.verdictReasons.join("; ")}`, "");
  lines.push(`Evaluadores (${c.evaluators.length}): ${c.evaluators.join(", ") || "—"}`, "");
  lines.push(`- Picks evaluados: ${c.totals.items} · distribución por consenso: ${Object.entries(c.totals.pickDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push(`- Errores graves por consenso: ${c.totals.graveConsensus} · discutidos: ${c.totals.graveDisputed}`);
  lines.push(`- Explicaciones "incorrectas" por consenso: ${(c.totals.incorrectExplanationShare * 100).toFixed(0)}%`, "");
  lines.push("## Por situación", "", "| Situación | Consejo principal | Graves top 3 | Sospecha (organizadores) |", "|---|---|---|---|");
  for (const s of c.scenarios) lines.push(`| ${s.scenarioId} | ${s.advice} | ${s.gravesTop3} | ${suspects[s.scenarioId] ?? ""} |`);
  lines.push("", "## Picks con problemas (malo / error grave / explicación o posición dudosa por consenso)", "");
  for (const i of c.items.filter((x) => x.pick === "malo" || x.pick === "error_grave" || x.explanation !== "correcta" || x.position !== "ok" || x.graveDisputed)) {
    lines.push(`### ${i.scenarioId} · #${i.rank} ${i.hero} — pick ${i.pick} (acuerdo ${(i.pickAgreement * 100).toFixed(0)}%) · explicación ${i.explanation} · posición ${i.position}${i.graveConsensus ? " · **ERROR GRAVE por consenso**" : i.graveDisputed ? " · error grave discutido" : ""}`);
    for (const r of i.reasons) lines.push(`- ${r.evaluator} (${r.pick}/${r.explanation}/${r.position}): ${r.reason}`);
    lines.push("");
  }
  const missing = c.scenarios.filter((s) => s.missingHeroes.length > 0);
  if (missing.length > 0) { lines.push("## Héroes que los evaluadores dicen que faltaron", ""); for (const s of missing) lines.push(`- ${s.scenarioId}: ${s.missingHeroes.join("; ")}`); lines.push(""); }
  lines.push("> Los umbrales son una propuesta (`THRESHOLDS` en `consolidate.ts`). Este informe resume juicios humanos; no los reemplaza.");
  return lines.join("\n") + "\n";
}

function main(): void {
  const root = join(import.meta.dir, "../..");
  const dir = process.argv[2] ?? join(root, "qa/friends-family/results");
  const docPath = join(root, "qa/friends-family/situaciones.json");
  const manifestPath = join(root, "qa/friends-family/manifest.json");
  if (!existsSync(docPath)) throw new Error("falta qa/friends-family/situaciones.json (genera el kit primero)");
  const docText = readFileSync(docPath, "utf8");
  const doc = JSON.parse(docText.trim()) as ScenarioDoc;
  const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { scenariosSha256: string; scenarios: { id: string; suspect: string | null }[] }) : null;
  const expectedSha = manifest?.scenariosSha256 ?? null;
  const valid: EvalResult[] = [];
  for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => /^ff-eval-.*\.json$/.test(x)) : []) {
    let raw: unknown = null;
    try { raw = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { /* inválido: se informa abajo */ }
    const errors = validateResult(raw, doc, expectedSha);
    if (errors.length > 0) { process.stderr.write(`DESCARTADO ${f}: ${errors.slice(0, 5).join(" | ")}${errors.length > 5 ? ` (+${errors.length - 5})` : ""}\n`); continue; }
    valid.push(raw as EvalResult);
  }
  const names = valid.map((v) => v.evaluator.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("hay dos archivos del mismo evaluador: cada persona entrega uno solo");
  const result = consolidate(valid, doc);
  const suspects = Object.fromEntries((manifest?.scenarios ?? []).map((s) => [s.id, s.suspect]));
  const md = renderMarkdown(result, suspects);
  writeFileSync(join(dir, "_consolidado.md"), md);
  writeFileSync(join(dir, "_consolidado.json"), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(md);
}

if (import.meta.main) main();
