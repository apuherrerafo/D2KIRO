#!/usr/bin/env bun
// FRIENDS_FAMILY_READY — consolida los archivos `ff-eval-*.json` que descargan los evaluadores.
//
//   bun scripts/f-and-f/consolidate.ts [carpeta-de-resultados]   (por defecto qa/friends-family/results)
//     -> imprime el informe y escribe <carpeta>/_consolidado.{md,json}
//
// Este script NO inventa veredictos ni calcula una "precisión": solo agrega juicios humanos y señala qué hay que
// mirar. 15 situaciones no sirven para declarar un porcentaje global de acierto, y aquí no se calcula ninguno.
//
// Reglas del veredicto (umbrales provisionales de la prueba cerrada):
//   - 0 picks ilegales: se comprueba por máquina al GENERAR el kit (build-kit aborta). No lo juzgan las personas.
//   - 0 errores graves sin investigar: cualquier "error grave" de CUALQUIER evaluador exige una investigación
//     registrada en results/investigaciones.json. Sin ella el veredicto es REVISAR.
//   - Un error grave investigado y "confirmado" BLOQUEA hasta corregirlo o aceptarlo como limitación (PO).
//   - Desacuerdo entre evaluadores => REVISAR. Nunca se asume que la opinión más dura es la correcta.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PICK_RATINGS = ["bueno", "aceptable", "malo", "error_grave"] as const;
export const EXPLANATION_RATINGS = ["correcta", "dudosa", "incorrecta"] as const;
export const POSITION_RATINGS = ["ok", "dudosa", "mala"] as const;
export const POSITION_CHOICE_RATINGS = ["bien", "dudosa", "mala"] as const;
export const BETTER_POSITION_VALUES = ["", "sin_opinion", "1", "2", "3", "4", "5", "esperar"] as const;
export const CONCLUSIONS = ["descartado", "confirmado", "limitacion_aceptada"] as const;

/** Parámetros provisionales. */
export const MIN_EVALUATORS = 3;

export interface ScenarioDoc { schema: string; count: number; scenarios: { id: string; top5: { rank: number; heroId: number; name: string }[] }[] }
export interface EvalItem { scenarioId: string; rank: number; heroId: number; hero: string; pick: string; explanation: string; position: string; reason: string }
export interface EvalScenarioRow { scenarioId: string; positionChoice: string; positionChoiceReason: string; betterPosition: string; missingHero: string; note: string }
export interface EvalResult { schema: "ff-eval/v2"; scenariosSha256: string; evaluator: string; comprehension: { passed: boolean }; startedAt: string; finishedAt: string; items: EvalItem[]; scenarios: EvalScenarioRow[] }
export interface Investigation { scenarioId: string; rank: number; conclusion: (typeof CONCLUSIONS)[number]; by: string; note: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const longEnough = (v: unknown): boolean => typeof v === "string" && v.trim().length >= 5;

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Hash del kit tal como lo fija build-kit (el JSON sin el salto de línea final). */
export const kitSha = (fileText: string): string => sha256(fileText.replace(/\n$/, ""));

/** Valida UN archivo de evaluador contra el kit. Devuelve los errores (vacío = válido). Nunca lanza. */
export function validateResult(raw: unknown, doc: ScenarioDoc, expectedSha: string): string[] {
  const errors: string[] = [];
  if (!isRecord(raw) || raw.schema !== "ff-eval/v2") return ["esquema desconocido (se esperaba ff-eval/v2)"];
  if (raw.scenariosSha256 !== expectedSha) errors.push("el archivo es de OTRA versión del kit (sha distinto)");
  if (typeof raw.evaluator !== "string" || raw.evaluator.trim().length < 2) errors.push("falta el nombre del evaluador");
  if (!isRecord(raw.comprehension) || raw.comprehension.passed !== true) errors.push("no superó la comprobación de comprensión inicial");
  if (!Array.isArray(raw.items) || !Array.isArray(raw.scenarios)) return [...errors, "faltan items o scenarios"];

  const known = new Map<string, { heroId: number; name: string }>();
  for (const s of doc.scenarios) for (const h of s.top5) known.set(`${s.id}#${h.rank}`, { heroId: h.heroId, name: h.name });

  const seen = new Set<string>();
  for (const it of raw.items) {
    if (!isRecord(it)) { errors.push("item malformado"); continue; }
    const key = `${String(it.scenarioId)}#${String(it.rank)}`;
    const expected = typeof it.rank === "number" && Number.isInteger(it.rank) ? known.get(key) : undefined;
    if (!expected) { errors.push(`${key}: no existe en el kit`); continue; }
    if (it.heroId !== expected.heroId || it.hero !== expected.name) errors.push(`${key}: el héroe no coincide con el kit`);
    if (seen.has(key)) errors.push(`item repetido ${key}`);
    seen.add(key);
    if (!oneOf(PICK_RATINGS, it.pick)) errors.push(`${key}: calidad de pick inválida`);
    if (!oneOf(EXPLANATION_RATINGS, it.explanation)) errors.push(`${key}: explicación inválida`);
    if (!oneOf(POSITION_RATINGS, it.position)) errors.push(`${key}: etiqueta de posición inválida`);
    const needs = it.pick === "malo" || it.pick === "error_grave" || it.explanation !== "correcta" || it.position !== "ok";
    if (needs && !longEnough(it.reason)) errors.push(`${key}: falta la razón`);
  }
  for (const key of known.keys()) if (!seen.has(key)) errors.push(`${key}: sin evaluar`);

  const rows = new Set<string>();
  for (const sc of raw.scenarios) {
    if (!isRecord(sc)) { errors.push("situación malformada"); continue; }
    const id = String(sc.scenarioId);
    if (!doc.scenarios.some((s) => s.id === id)) { errors.push(`${id}: situación inexistente en el kit`); continue; }
    if (rows.has(id)) errors.push(`${id}: situación repetida`);
    rows.add(id);
    if (!oneOf(POSITION_CHOICE_RATINGS, sc.positionChoice)) { errors.push(`${id}: elección de posición sin valorar`); continue; }
    if (!oneOf(BETTER_POSITION_VALUES, sc.betterPosition)) errors.push(`${id}: posición alternativa inválida`);
    if (sc.positionChoice !== "bien") {
      if (!longEnough(sc.positionChoiceReason)) errors.push(`${id}: falta la razón de la elección de posición`);
      if (sc.betterPosition === "" || sc.betterPosition === undefined) errors.push(`${id}: indica qué posición habrías mostrado (o "sin opinión")`);
    }
  }
  for (const s of doc.scenarios) if (!rows.has(s.id)) errors.push(`${s.id}: elección de posición sin valorar`);
  return errors;
}

export function validateInvestigations(raw: unknown): { ok: Investigation[]; errors: string[] } {
  if (!Array.isArray(raw)) return { ok: [], errors: ["investigaciones.json debe ser una lista"] };
  const ok: Investigation[] = [];
  const errors: string[] = [];
  raw.forEach((r, i) => {
    if (!isRecord(r) || typeof r.scenarioId !== "string" || typeof r.rank !== "number" || !Number.isInteger(r.rank) || !oneOf(CONCLUSIONS, r.conclusion) || typeof r.by !== "string" || r.by.trim().length < 2 || typeof r.note !== "string" || !longEnough(r.note)) {
      errors.push(`investigación #${i + 1} inválida (scenarioId, rank entero, conclusion ∈ ${CONCLUSIONS.join("|")}, by, note ≥ 5 caracteres)`);
      return;
    }
    ok.push({ scenarioId: r.scenarioId, rank: r.rank, conclusion: r.conclusion, by: r.by.trim(), note: r.note.trim() });
  });
  return { ok, errors };
}

/** Etiqueta con mayoría estricta (> n/2); `null` si no hay (sin consenso). */
export function strictMajority<T extends string>(labels: readonly T[]): T | null {
  const counts = new Map<T, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  for (const [l, c] of counts) if (c > labels.length / 2) return l;
  return null;
}

const isGood = (p: string): boolean => p === "bueno" || p === "aceptable";
const isBad = (p: string): boolean => p === "malo" || p === "error_grave";

export interface ItemSummary {
  scenarioId: string; rank: number; hero: string; evaluators: number;
  consensusPick: PickRatingOrNone; disagreement: boolean;
  graveAny: boolean; graveUninvestigated: boolean; investigation: Investigation | null;
  consensusExplanation: string | null; consensusPosition: string | null;
  reasons: { evaluator: string; pick: string; explanation: string; position: string; reason: string }[];
}
type PickRatingOrNone = (typeof PICK_RATINGS)[number] | "sin_consenso";

export interface ScenarioSummary {
  scenarioId: string; consensusPositionChoice: string | null; disagreement: boolean;
  alternatives: { evaluator: string; choice: string; better: string; reason: string }[]; missingHeroes: string[]; notes: string[];
}

export interface Consolidated {
  evaluators: string[];
  items: ItemSummary[];
  scenarios: ScenarioSummary[];
  totals: { items: number; gravesAnyUninvestigated: number; gravesConfirmed: number; itemDisagreements: number; scenarioDisagreements: number; pickDistribution: Record<string, number> };
  verdict: "BLOQUEA" | "REVISAR" | "PASS" | "SIN_DATOS";
  verdictReasons: string[];
}

export function consolidate(results: readonly EvalResult[], doc: ScenarioDoc, investigations: readonly Investigation[] = []): Consolidated {
  const empty = { items: 0, gravesAnyUninvestigated: 0, gravesConfirmed: 0, itemDisagreements: 0, scenarioDisagreements: 0, pickDistribution: {} };
  if (results.length === 0) return { evaluators: [], items: [], scenarios: [], totals: empty, verdict: "SIN_DATOS", verdictReasons: ["no hay resultados válidos"] };
  const invOf = (sid: string, rank: number): Investigation | null => investigations.find((i) => i.scenarioId === sid && i.rank === rank) ?? null;

  const items: ItemSummary[] = [];
  for (const s of doc.scenarios) {
    for (const h of s.top5) {
      const rows = results.flatMap((r) => r.items.filter((i) => i.scenarioId === s.id && i.rank === h.rank).map((i) => ({ evaluator: r.evaluator, ...i })));
      const picks = rows.map((r) => r.pick);
      const graveAny = picks.includes("error_grave");
      const inv = invOf(s.id, h.rank);
      items.push({
        scenarioId: s.id, rank: h.rank, hero: h.name, evaluators: rows.length,
        consensusPick: strictMajority(picks as (typeof PICK_RATINGS)[number][]) ?? "sin_consenso",
        disagreement: picks.some(isGood) && picks.some(isBad),
        graveAny, graveUninvestigated: graveAny && inv === null, investigation: inv,
        consensusExplanation: strictMajority(rows.map((r) => r.explanation)),
        consensusPosition: strictMajority(rows.map((r) => r.position)),
        reasons: rows.filter((r) => r.reason !== "").map((r) => ({ evaluator: r.evaluator, pick: r.pick, explanation: r.explanation, position: r.position, reason: r.reason })),
      });
    }
  }

  const scenarios: ScenarioSummary[] = doc.scenarios.map((s) => {
    const rows = results.flatMap((r) => r.scenarios.filter((x) => x.scenarioId === s.id).map((x) => ({ evaluator: r.evaluator, ...x })));
    const choices = rows.map((x) => x.positionChoice);
    return {
      scenarioId: s.id,
      consensusPositionChoice: strictMajority(choices),
      disagreement: choices.includes("bien") && choices.includes("mala"),
      alternatives: rows.filter((x) => x.positionChoice !== "bien").map((x) => ({ evaluator: x.evaluator, choice: x.positionChoice, better: x.betterPosition, reason: x.positionChoiceReason })),
      missingHeroes: rows.map((x) => x.missingHero).filter((x) => x !== ""),
      notes: rows.map((x) => x.note).filter((x) => x !== ""),
    };
  });

  const pickDistribution: Record<string, number> = {};
  for (const i of items) pickDistribution[i.consensusPick] = (pickDistribution[i.consensusPick] ?? 0) + 1;
  const totals = {
    items: items.length,
    gravesAnyUninvestigated: items.filter((i) => i.graveUninvestigated).length,
    gravesConfirmed: items.filter((i) => i.investigation?.conclusion === "confirmado").length,
    itemDisagreements: items.filter((i) => i.disagreement).length,
    scenarioDisagreements: scenarios.filter((s) => s.disagreement).length,
    pickDistribution,
  };

  const block: string[] = [];
  const review: string[] = [];
  if (totals.gravesConfirmed > 0) block.push(`${totals.gravesConfirmed} error(es) grave(s) CONFIRMADO(S) tras investigar: corregir o aceptar como limitación antes de invitar`);
  if (totals.gravesAnyUninvestigated > 0) review.push(`${totals.gravesAnyUninvestigated} pick(s) con "error grave" de al menos un evaluador SIN investigar (registrar en investigaciones.json)`);
  if (results.length < MIN_EVALUATORS) review.push(`solo ${results.length} evaluador(es): se necesitan ${MIN_EVALUATORS} independientes`);
  if (totals.itemDisagreements > 0) review.push(`${totals.itemDisagreements} pick(s) con desacuerdo entre evaluadores (uno lo ve bueno/aceptable y otro malo/grave)`);
  if (totals.scenarioDisagreements > 0) review.push(`${totals.scenarioDisagreements} situación(es) con desacuerdo sobre si el coach eligió bien la POSICIÓN`);
  const badTop3 = items.filter((i) => i.rank <= 3 && (i.consensusPick === "malo" || i.consensusPick === "error_grave"));
  if (badTop3.length > 0) review.push(`${badTop3.length} pick(s) del top 3 calificados "malo" por consenso`);
  const badPos = scenarios.filter((s) => s.consensusPositionChoice === "mala" || s.consensusPositionChoice === "dudosa");
  if (badPos.length > 0) review.push(`${badPos.length} situación(es) donde el consenso duda de la POSICIÓN que eligió el coach`);
  const wrongExplanations = items.filter((i) => i.consensusExplanation === "incorrecta");
  if (wrongExplanations.length > 0) review.push(`${wrongExplanations.length} explicación(es) "incorrecta(s)" por consenso (afirman algo falso)`);

  const verdict = block.length > 0 ? "BLOQUEA" : review.length > 0 ? "REVISAR" : "PASS";
  return { evaluators: results.map((r) => r.evaluator), items, scenarios, totals, verdict, verdictReasons: block.length > 0 ? [...block, ...review] : review.length > 0 ? review : ["sin hallazgos que investigar (esto NO es una medida de precisión del coach)"] };
}

export function renderMarkdown(c: Consolidated, suspects: Record<string, string | null> = {}): string {
  const lines: string[] = [];
  lines.push("# Consolidado Friends & Family — evaluación humana", "");
  lines.push(`**Veredicto propuesto: ${c.verdict}**`, "");
  for (const r of c.verdictReasons) lines.push(`- ${r}`);
  lines.push("", `Evaluadores (${c.evaluators.length}): ${c.evaluators.join(", ") || "—"}`, "");
  lines.push(`- Picks evaluados: ${c.totals.items} · por consenso: ${Object.entries(c.totals.pickDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push("- Son **conteos**, no un porcentaje de acierto: 15 situaciones no permiten declarar una precisión global.", "");
  lines.push("## Elección de posición por situación", "", "| Situación | Consenso | Desacuerdo | Sospecha (organizadores) |", "|---|---|---|---|");
  for (const s of c.scenarios) lines.push(`| ${s.scenarioId} | ${s.consensusPositionChoice ?? "sin consenso"} | ${s.disagreement ? "SÍ" : "no"} | ${suspects[s.scenarioId] ?? ""} |`);
  const withAlt = c.scenarios.filter((s) => s.alternatives.length > 0);
  if (withAlt.length > 0) {
    lines.push("", "### Quién dudó de la posición y qué habría mostrado", "");
    for (const s of withAlt) for (const a of s.alternatives) lines.push(`- ${s.scenarioId} · ${a.evaluator}: ${a.choice}; habría mostrado ${a.better === "esperar" ? "esperar" : a.better === "sin_opinion" || a.better === "" ? "(sin opinión)" : `pos ${a.better}`} — ${a.reason}`);
  }
  lines.push("", "## Picks que requieren mirada (malo, grave, desacuerdo o explicación/posición dudosa)", "");
  const flagged = c.items.filter((x) => x.graveAny || x.disagreement || x.consensusPick === "malo" || x.consensusPick === "error_grave" || x.consensusExplanation === "incorrecta" || x.consensusPosition === "mala");
  for (const i of flagged) {
    const inv = i.investigation ? ` · investigado: ${i.investigation.conclusion} (${i.investigation.by})` : i.graveAny ? " · **SIN INVESTIGAR**" : "";
    lines.push(`### ${i.scenarioId} · #${i.rank} ${i.hero} — consenso ${i.consensusPick}${i.disagreement ? " · DESACUERDO" : ""}${inv}`);
    for (const r of i.reasons) lines.push(`- ${r.evaluator} (${r.pick}/${r.explanation}/${r.position}): ${r.reason}`);
    lines.push("");
  }
  const missing = c.scenarios.filter((s) => s.missingHeroes.length > 0);
  if (missing.length > 0) { lines.push("## Héroes que dicen que faltaron", ""); for (const s of missing) lines.push(`- ${s.scenarioId}: ${s.missingHeroes.join("; ")}`); lines.push(""); }
  lines.push("> Resume juicios humanos; no los reemplaza. Una discrepancia entre evaluadores se resuelve hablando de la mecánica, no dando la razón a la opinión más dura.");
  return lines.join("\n") + "\n";
}

function main(): void {
  const root = join(import.meta.dir, "../..");
  const dir = process.argv[2] ?? join(root, "qa/friends-family/results");
  const docPath = join(root, "qa/friends-family/situaciones.json");
  const manifestPath = join(root, "qa/friends-family/manifest.json");
  if (!existsSync(docPath)) throw new Error("falta qa/friends-family/situaciones.json (genera el kit primero)");
  const docText = readFileSync(docPath, "utf8");
  const doc = JSON.parse(docText) as ScenarioDoc;
  const expectedSha = kitSha(docText);
  const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { scenariosSha256?: string; scenarios: { id: string; suspect: string | null }[] }) : null;
  if (manifest?.scenariosSha256 !== undefined && manifest.scenariosSha256 !== expectedSha) throw new Error("manifest.json y situaciones.json no son de la misma generación del kit");

  const files = existsSync(dir) ? readdirSync(dir).filter((x) => /^ff-eval-.*\.json$/.test(x)).sort() : [];
  const valid: EvalResult[] = [];
  const seenNames = new Set<string>();
  const seenContent = new Set<string>();
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    let raw: unknown = null;
    try { raw = JSON.parse(text); } catch { /* inválido: se informa abajo */ }
    const errors = validateResult(raw, doc, expectedSha);
    if (errors.length > 0) { process.stderr.write(`DESCARTADO ${f}: ${errors.slice(0, 5).join(" | ")}${errors.length > 5 ? ` (+${errors.length - 5})` : ""}\n`); continue; }
    const result = raw as EvalResult;
    const name = result.evaluator.trim().toLowerCase();
    const contentHash = sha256(JSON.stringify({ items: result.items, scenarios: result.scenarios }));
    if (seenNames.has(name)) { process.stderr.write(`DESCARTADO ${f}: ya hay un archivo del evaluador "${result.evaluator}"\n`); continue; }
    // Contenido idéntico: se AVISA (podría ser una copia, o dos personas que respondieron igual) pero no se descarta a nadie.
    if (seenContent.has(contentHash)) process.stderr.write(`AVISO ${f}: contenido idéntico al de otro archivo; confirma que es una persona distinta (la independencia exige respuestas propias)\n`);
    seenNames.add(name);
    seenContent.add(contentHash);
    valid.push(result);
  }

  let investigations: Investigation[] = [];
  const invPath = join(dir, "investigaciones.json");
  if (existsSync(invPath)) {
    const parsed = validateInvestigations(JSON.parse(readFileSync(invPath, "utf8")));
    if (parsed.errors.length > 0) throw new Error(parsed.errors.join("; "));
    investigations = parsed.ok;
  }

  const result = consolidate(valid, doc, investigations);
  const suspects = Object.fromEntries((manifest?.scenarios ?? []).map((s) => [s.id, s.suspect]));
  const md = renderMarkdown(result, suspects);
  writeFileSync(join(dir, "_consolidado.md"), md);
  writeFileSync(join(dir, "_consolidado.json"), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(md);
}

if (import.meta.main) main();
