/**
 * Cobertura de la matriz de QA: pura, sin I/O. Existe para poder PROBAR el guard anti-vacio contra matrices vacias
 * (matrix-coverage.test.ts) y contra regresiones masivas (matrix-coverage.mutation.test.ts): un candado que nunca se ha visto
 * en rojo no es un candado.
 *
 * Contrato de elegibilidad (2026-11-03/04, P0-04): un estado sin ningun heroe con fundamento NO tiene tarjeta, asi que
 * "shortlist no vacia en cada checkpoint" no es una propiedad del producto. Lo que SI debe cumplirse a nivel de matriz es que
 * los oraculos juzguen algo: hay humanos abiertos, el Coach responde en ellos, y existen shortlists con tarjetas.
 */
export interface CoverageCheckpoint {
  humanOpenPositions: readonly number[];
  v3?: { shortlist: readonly unknown[] } | null;
  /** Dimensiones de segmentacion (opcionales: el `Checkpoint` real de `qa/scenarios/generate.ts` las trae todas). */
  round?: number | null;
  step?: string;
  side?: string;
  controlledPositions?: readonly number[];
}
export interface CoverageRun {
  scenarioId?: string;
  checkpoints: readonly CoverageCheckpoint[];
}
export interface MatrixCoverage {
  humanOpen: number;
  coachAnswered: number;
  withCards: number;
}

export function matrixCoverage(matrix: readonly CoverageRun[]): MatrixCoverage {
  const coverage: MatrixCoverage = { humanOpen: 0, coachAnswered: 0, withCards: 0 };
  for (const run of matrix) {
    for (const checkpoint of run.checkpoints) {
      if (checkpoint.humanOpenPositions.length === 0) continue;
      coverage.humanOpen += 1;
      if (!checkpoint.v3) continue;
      coverage.coachAnswered += 1;
      if (checkpoint.v3.shortlist.length > 0) coverage.withCards += 1;
    }
  }
  return coverage;
}

/** Devuelve los motivos por los que la matriz es vacia (lista vacia = la matriz juzga algo real). */
export function vacuityProblems(coverage: MatrixCoverage): string[] {
  const problems: string[] = [];
  if (coverage.humanOpen === 0) problems.push("ningun checkpoint con posicion humana abierta");
  if (coverage.coachAnswered === 0) problems.push("el Coach no respondio en ningun checkpoint con humano abierto");
  if (coverage.withCards === 0) problems.push("ninguna shortlist del Coach tiene tarjetas");
  return problems;
}

// =================================================================================================================
// R3.1 -- cobertura estructural (A) y semantica (B). Pura, determinista, sin I/O.
//
// `vacuityProblems` solo exige >= 1 shortlist con tarjetas: una matriz que pierde 193 de 194 tarjetas seguia pasando.
// Dos controles complementarios, cada uno con su propio alcance:
//
//  A. ESTRUCTURAL (`coverageRegressionProblems`): la matriz debe seguir ejercitando el camino con tarjetas en la misma
//     proporcion y con la misma variedad que su REFERENCIA congelada (`coverage-reference.json`): tasas, escenarios
//     distintos con tarjetas, concentracion maxima en un escenario y, por segmento, tasa de tarjetas. Es un detector de
//     regresion contra una linea base OBSERVADA, no una verdad de producto: no sabe si una shortlist vacia es correcta.
//  B. SEMANTICA (`semanticCoverageProblems`): donde el FIXTURE declara un fundamento (un counter curado inyectado contra un
//     ban), la tarjeta es obligatoria; donde declara su ausencia, `[]` es VALID_ABSTENTION y nunca se fuerza una tarjeta.
//     La elegibilidad la fija el fixture, jamas la respuesta del Coach (no es circular).
//
// Clasificacion de una sonda: EXPECTED_COVERAGE | VALID_ABSTENTION | UNEXPECTED_COVERAGE_LOSS | INSUFFICIENT_EVIDENCE.
// =================================================================================================================

export interface SegmentTally {
  open: number;
  answered: number;
  withCards: number;
}
export interface MatrixProfile extends MatrixCoverage {
  runs: number;
  /** Corridas (escenarios) distintas con al menos una shortlist con tarjetas. */
  runsWithCards: number;
  /** Mayor numero de checkpoints con tarjetas dentro de UNA sola corrida. */
  maxRunCards: number;
  /** dimension -> valor -> conteo. Dimensiones: round, step, partySize, side, openPosition. */
  segments: Record<string, Record<string, SegmentTally>>;
}

function bump(segments: MatrixProfile["segments"], dimension: string, value: string, answered: boolean, withCards: boolean): void {
  const bucket = (segments[dimension] ??= {});
  const tally = (bucket[value] ??= { open: 0, answered: 0, withCards: 0 });
  tally.open += 1;
  if (answered) tally.answered += 1;
  if (withCards) tally.withCards += 1;
}

/** Perfil de cobertura: los tres conteos de `matrixCoverage` mas variedad de escenarios y segmentos. Solo cuenta checkpoints con humano abierto. */
export function matrixProfile(matrix: readonly CoverageRun[]): MatrixProfile {
  const profile: MatrixProfile = { ...matrixCoverage(matrix), runs: matrix.length, runsWithCards: 0, maxRunCards: 0, segments: {} };
  for (const run of matrix) {
    let runCards = 0;
    for (const checkpoint of run.checkpoints) {
      if (checkpoint.humanOpenPositions.length === 0) continue;
      const answered = Boolean(checkpoint.v3);
      const withCards = answered && (checkpoint.v3?.shortlist.length ?? 0) > 0;
      if (withCards) runCards += 1;
      bump(profile.segments, "round", String(checkpoint.round ?? "none"), answered, withCards);
      bump(profile.segments, "step", checkpoint.step ?? "none", answered, withCards);
      bump(profile.segments, "partySize", String(checkpoint.controlledPositions?.length ?? "none"), answered, withCards);
      bump(profile.segments, "side", checkpoint.side ?? "none", answered, withCards);
      for (const position of checkpoint.humanOpenPositions) bump(profile.segments, "openPosition", String(position), answered, withCards);
    }
    if (runCards > 0) profile.runsWithCards += 1;
    profile.maxRunCards = Math.max(profile.maxRunCards, runCards);
  }
  return profile;
}

export interface CoverageTolerance {
  /**
   * Piso relativo: toda tasa (respuesta del Coach / humano abierto, tarjetas / respuesta, corridas con tarjetas / corridas,
   * tarjetas por segmento) debe ser >= rateFloor x la tasa de la referencia. 0.5 absorbe un cambio legitimo de composicion
   * (curacion de counters por parche, escenarios nuevos que solo suman abstenciones) hasta duplicar el denominador, y aun asi falla
   * ante un colapso (194 -> 1 es 0.5% de la tasa de referencia).
   */
  rateFloor: number;
  /** Tope de concentracion: ninguna corrida aporta mas de esta fraccion de todos los checkpoints con tarjetas (referencia observada: 0.041). */
  maxRunShare: number;
  /** Un segmento solo se exige si en la referencia tenia al menos tantas respuestas del Coach (con menos no hay base) y tarjetas > 0. */
  minSegmentAnswered: number;
}
export interface CoverageReference {
  /** Procedencia: de que commit y cuando se midio. Sin esto una referencia no es auditable. */
  provenance: { commit: string; measuredOn: string; source: string };
  profile: MatrixProfile;
  tolerance: CoverageTolerance;
}

export const DEFAULT_COVERAGE_TOLERANCE: CoverageTolerance = { rateFloor: 0.5, maxRunShare: 0.1, minSegmentAnswered: 5 };

/**
 * Genera la referencia a partir de una matriz. NUNCA se invoca desde el camino de commit: una referencia nueva solo se escribe
 * a mano, con revision humana, cuando cambia el diseno de la matriz (escenarios) o la curacion de datos del fixture -- jamas
 * porque una corrida salio distinta. Ver `coverage-reference.md`.
 */
export function buildCoverageReference(matrix: readonly CoverageRun[], provenance: CoverageReference["provenance"], tolerance: CoverageTolerance = DEFAULT_COVERAGE_TOLERANCE): CoverageReference {
  return { provenance, profile: matrixProfile(matrix), tolerance };
}

const rate = (numerator: number, denominator: number): number => (denominator === 0 ? 0 : numerator / denominator);
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** Motivos por los que el perfil actual es una regresion de cobertura respecto de la referencia (vacio = sin regresion). */
export function coverageRegressionProblems(current: MatrixProfile, reference: CoverageReference): string[] {
  const { profile: ref, tolerance } = reference;
  if (ref.withCards === 0 || ref.coachAnswered === 0 || ref.humanOpen === 0) {
    return ["referencia de cobertura invalida: sin tarjetas/respuestas/humanos abiertos no se puede exigir nada (INSUFFICIENT_EVIDENCE)"];
  }
  const problems: string[] = [];
  const floor = (value: number) => value * tolerance.rateFloor;
  if (current.humanOpen < floor(ref.humanOpen)) {
    problems.push(`la matriz dejo de ser comparable: ${current.humanOpen} checkpoints con humano abierto (referencia ${ref.humanOpen}, piso ${floor(ref.humanOpen).toFixed(0)})`);
  }
  const answeredRate = rate(current.coachAnswered, current.humanOpen);
  if (answeredRate < floor(rate(ref.coachAnswered, ref.humanOpen))) {
    problems.push(`el Coach responde en ${pct(answeredRate)} de los checkpoints con humano abierto (referencia ${pct(rate(ref.coachAnswered, ref.humanOpen))})`);
  }
  const cardsRate = rate(current.withCards, current.coachAnswered);
  const refCardsRate = rate(ref.withCards, ref.coachAnswered);
  if (cardsRate < floor(refCardsRate)) {
    problems.push(`${current.withCards}/${current.coachAnswered} respuestas con tarjetas = ${pct(cardsRate)} (referencia ${pct(refCardsRate)}, piso ${pct(floor(refCardsRate))})`);
  }
  if (rate(current.runsWithCards, current.runs) < floor(rate(ref.runsWithCards, ref.runs))) {
    problems.push(`solo ${current.runsWithCards}/${current.runs} escenarios producen tarjetas (referencia ${ref.runsWithCards}/${ref.runs}): la cobertura se concentro en pocos escenarios`);
  }
  if (current.withCards > 0 && current.maxRunCards / current.withCards > tolerance.maxRunShare) {
    problems.push(`un solo escenario aporta ${current.maxRunCards}/${current.withCards} de las tarjetas (tope ${pct(tolerance.maxRunShare)})`);
  }
  for (const [dimension, values] of Object.entries(ref.segments)) {
    for (const [value, base] of Object.entries(values)) {
      if (base.answered < tolerance.minSegmentAnswered || base.withCards === 0) continue; // sin base o sin tarjetas de referencia: nunca se exige
      const now = current.segments[dimension]?.[value] ?? { open: 0, answered: 0, withCards: 0 };
      if (rate(now.withCards, now.answered) < floor(rate(base.withCards, base.answered))) {
        problems.push(`segmento ${dimension}=${value} perdio cobertura: ${now.withCards}/${now.answered} con tarjetas (referencia ${base.withCards}/${base.answered})`);
      }
    }
  }
  return problems;
}

/** Guard completo de la matriz: no esta vacia (`vacuityProblems`) y no regreso respecto de la referencia. */
export function matrixGuardProblems(matrix: readonly CoverageRun[], reference: CoverageReference): string[] {
  const profile = matrixProfile(matrix);
  return [...vacuityProblems(profile), ...coverageRegressionProblems(profile, reference)];
}

export type ProbeClassification = "EXPECTED_COVERAGE" | "VALID_ABSTENTION" | "UNEXPECTED_COVERAGE_LOSS" | "INSUFFICIENT_EVIDENCE";
/** Una sonda semantica: el fixture DECLARA si hay fundamento (`grounded`); `shortlistLength` es lo que el Coach respondio. */
export interface SemanticProbe {
  label: string;
  position: number;
  grounded: boolean;
  shortlistLength: number;
}

export function classifyProbe(probe: SemanticProbe): ProbeClassification {
  if (probe.grounded) return probe.shortlistLength > 0 ? "EXPECTED_COVERAGE" : "UNEXPECTED_COVERAGE_LOSS";
  return probe.shortlistLength === 0 ? "VALID_ABSTENTION" : "INSUFFICIENT_EVIDENCE";
}

export function semanticCoverageProblems(probes: readonly SemanticProbe[]): string[] {
  const problems: string[] = [];
  if (!probes.some((probe) => probe.grounded)) problems.push("INSUFFICIENT_EVIDENCE: ninguna sonda con fundamento declarado, no se puede determinar la cobertura esperada");
  for (const probe of probes) {
    const kind = classifyProbe(probe);
    if (kind === "UNEXPECTED_COVERAGE_LOSS") problems.push(`UNEXPECTED_COVERAGE_LOSS: ${probe.label} (posicion ${probe.position}) tiene un fundamento declarado por el fixture y el Coach no devolvio tarjeta`);
    if (kind === "INSUFFICIENT_EVIDENCE") problems.push(`${probe.label} (posicion ${probe.position}): el fixture no declara fundamento pero hay ${probe.shortlistLength} tarjeta(s); fixture no hermetico o tarjeta sin fundamento (INSUFFICIENT_EVIDENCE)`);
  }
  return problems;
}
