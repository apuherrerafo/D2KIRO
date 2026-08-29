// Fase 9.0, costura S16 — funciones de métrica de evaluación. Todas PURAS: entrada = un
// ranking de héroes (+ etiquetas), salida = un número. Sin I/O, sin estado.
//
// Dos benchmarks las consumen (SPEC.md §15.4.3):
//   - Engine Quality (principal, Golden Dataset graduado): NDCG@5 titular + Bad Pick Rate@5 +
//     Pairwise Accuracy.
//   - Professional Pick Agreement (secundario, drafts pro): Recall@{1,3,5,10} + MRR.
// Estabilidad/reactividad: Jaccard@K + Kendall-τ.

import type { HeroId } from "../../apps/engine/src/draft/reducer";

export type Grade = 0 | 1 | 2; // bad = 0, acceptable = 1, excellent = 2

export interface GoldenLabels {
  excellent: HeroId[];
  acceptable: HeroId[];
  bad: HeroId[];
}

// ---------- NDCG@5 (relevancia graduada) ----------

function dcg(gains: number[]): number {
  // posición 1-indexed -> descuento log2(pos + 1)
  return gains.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0);
}

/**
 * NDCG@5. `graded` mapea héroe -> ganancia (2/1/0). Un héroe ausente del map cuenta como
 * ganancia 0 (NO se excluye — R1-8/§15.4.3). IDCG = DCG del orden ideal sobre TODAS las
 * ganancias conocidas, cortado a 5. Si no hay ninguna ganancia > 0, NDCG = 0.
 */
export function ndcg5(ranking: HeroId[], graded: Map<HeroId, Grade>): number {
  const k = 5;
  const actualGains = ranking.slice(0, k).map((h) => graded.get(h) ?? 0);

  const idealGains = [...graded.values()].sort((a, b) => b - a).slice(0, k);
  const idcg = dcg(idealGains);
  if (idcg === 0) return 0;

  return dcg(actualGains) / idcg;
}

// ---------- Professional Pick Agreement ----------

export function recallAtK(ranking: HeroId[], target: HeroId, k: number): 0 | 1 {
  return ranking.slice(0, k).includes(target) ? 1 : 0;
}

/** Mean Reciprocal Rank de un solo objetivo: 1 / (posición 1-indexed), o 0 si no aparece. */
export function mrr(ranking: HeroId[], target: HeroId): number {
  const idx = ranking.indexOf(target);
  return idx === -1 ? 0 : 1 / (idx + 1);
}

// ---------- Bad Pick Rate@5 ----------

/**
 * Fracción de las primeras 5 recomendaciones marcadas `bad`. Un héroe **no etiquetado** en
 * ninguna de las 3 listas es *desconocido*: se excluye del denominador, nunca cuenta como bad
 * (§15.4.3 — confundir "no lo etiqueté" con "es malo" fabricaría un número peor que la realidad).
 * Sin ningún héroe etiquetado en el top-5 -> 0.
 */
export function badPickRateAt5(ranking: HeroId[], labels: GoldenLabels): number {
  const bad = new Set(labels.bad);
  const known = new Set([...labels.excellent, ...labels.acceptable, ...labels.bad]);
  const top = ranking.slice(0, 5).filter((h) => known.has(h));
  if (top.length === 0) return 0;
  return top.filter((h) => bad.has(h)).length / top.length;
}

// ---------- Pairwise Accuracy ----------

function gradeOf(hero: HeroId, labels: GoldenLabels): Grade | null {
  if (labels.excellent.includes(hero)) return 2;
  if (labels.acceptable.includes(hero)) return 1;
  if (labels.bad.includes(hero)) return 0;
  return null;
}

/**
 * De todos los pares (mejor, peor) que las etiquetas permiten ordenar (excellent > acceptable >
 * bad), fracción en que `ranking` los coloca en el orden correcto. Un héroe etiquetado que no
 * aparece en `ranking` se trata como peor que cualquiera que sí aparece (el motor lo omitió).
 * Sin pares comparables -> 1 (nada que equivocar).
 */
export function pairwiseAccuracy(ranking: HeroId[], labels: GoldenLabels): number {
  const labeled = [...labels.excellent, ...labels.acceptable, ...labels.bad];
  const rankPos = new Map<HeroId, number>();
  ranking.forEach((h, i) => rankPos.set(h, i));
  const posOf = (h: HeroId): number => rankPos.get(h) ?? Number.POSITIVE_INFINITY;

  let total = 0;
  let correct = 0;
  for (let i = 0; i < labeled.length; i++) {
    for (let j = i + 1; j < labeled.length; j++) {
      const a = labeled[i]!;
      const b = labeled[j]!;
      const ga = gradeOf(a, labels)!;
      const gb = gradeOf(b, labels)!;
      if (ga === gb) continue; // sin orden esperado
      total++;
      const better = ga > gb ? a : b;
      const worse = ga > gb ? b : a;
      if (posOf(better) < posOf(worse)) correct++;
    }
  }
  return total === 0 ? 1 : correct / total;
}

// ---------- Estabilidad / reactividad ----------

export function jaccardAtK(a: HeroId[], b: HeroId[], k: number): number {
  const sa = new Set(a.slice(0, k));
  const sb = new Set(b.slice(0, k));
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : inter / union;
}

/**
 * Kendall-τ (variante τ-a) sobre la intersección de ambos rankings: de todos los pares de
 * héroes presentes en los dos, fracción concordante menos discordante. Rango [-1, 1].
 * Menos de 2 héroes en común -> 1 (nada que comparar).
 */
export function kendallTau(a: HeroId[], b: HeroId[]): number {
  const posA = new Map<HeroId, number>();
  a.forEach((h, i) => posA.set(h, i));
  const common = b.filter((h) => posA.has(h));
  const n = common.length;
  if (n < 2) return 1;

  const posB = new Map<HeroId, number>();
  common.forEach((h, i) => posB.set(h, i));

  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const x = common[i]!;
      const y = common[j]!;
      const da = posA.get(x)! - posA.get(y)!;
      const db = posB.get(x)! - posB.get(y)!;
      if (da * db > 0) concordant++;
      else discordant++;
    }
  }
  return (concordant - discordant) / (concordant + discordant);
}
