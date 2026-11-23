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
// R3.1/R3.2 -- cobertura estructural (A) y semantica (B). Pura, determinista, sin I/O (solo `node:crypto` para hashear).
//
// `vacuityProblems` solo exige >= 1 shortlist con tarjetas: una matriz que pierde 193 de 194 tarjetas seguia pasando.
// Dos controles complementarios, cada uno con su propio alcance:
//
//  A. ESTRUCTURAL (`coverageRegressionProblems`): la matriz debe seguir ejercitando el camino con tarjetas en la misma
//     proporcion y con la misma variedad que su REFERENCIA congelada (`coverage-reference.json`). Es un detector de regresion
//     contra una linea base OBSERVADA, no una verdad de producto: no sabe si una shortlist vacia es correcta.
//  B. SEMANTICA (`semanticCoverageProblems`): donde el FIXTURE declara un fundamento (un counter curado inyectado contra un
//     ban), la tarjeta es obligatoria; donde declara su ausencia, `[]` es VALID_ABSTENTION y nunca se fuerza una tarjeta.
//     La elegibilidad la fija el fixture, jamas la respuesta del Coach (no es circular).
//
// Cada regla activa emite un diagnostico con codigo estable `[REGLA]`, para que una prueba pueda exigir EXACTAMENTE esa regla
// (aislada de las demas) y para que un humano distinga una regresion tecnica de un cambio en los datos curados.
// =================================================================================================================
import { createHash } from "node:crypto";

export interface SegmentTally {
  open: number;
  answered: number;
  withCards: number;
}
export interface MatrixProfile extends MatrixCoverage {
  runs: number;
  /** Corridas (escenarios) distintas con al menos una shortlist con tarjetas. */
  runsWithCards: number;
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
  const profile: MatrixProfile = { ...matrixCoverage(matrix), runs: matrix.length, runsWithCards: 0, segments: {} };
  for (const run of matrix) {
    let runHasCards = false;
    for (const checkpoint of run.checkpoints) {
      if (checkpoint.humanOpenPositions.length === 0) continue;
      const answered = Boolean(checkpoint.v3);
      const withCards = answered && (checkpoint.v3?.shortlist.length ?? 0) > 0;
      if (withCards) runHasCards = true;
      bump(profile.segments, "round", String(checkpoint.round ?? "none"), answered, withCards);
      bump(profile.segments, "step", checkpoint.step ?? "none", answered, withCards);
      bump(profile.segments, "partySize", String(checkpoint.controlledPositions?.length ?? "none"), answered, withCards);
      bump(profile.segments, "side", checkpoint.side ?? "none", answered, withCards);
      for (const position of checkpoint.humanOpenPositions) bump(profile.segments, "openPosition", String(position), answered, withCards);
    }
    if (runHasCards) profile.runsWithCards += 1;
  }
  return profile;
}

/**
 * TOLERANCIAS -- PROVISIONALES, sin justificacion estadistica. Viven AQUI, en codigo congelado, y NO dentro de `coverage-reference.json`:
 * un JSON editable no puede debilitar el guard en silencio (la referencia que traiga un campo `tolerance` se rechaza como alterada, y
 * `coverage-reference.lock.test.ts` fija estos valores). Cambiarlas exige editar este archivo, esa prueba y `coverage-reference.md`.
 *
 *  - rateFloor 0.5: toda tasa (respuesta del Coach / humano abierto, tarjetas / respuesta, escenarios con tarjetas / escenarios, tarjetas
 *    por segmento) debe ser >= 0.5 x la de la referencia. Es una tolerancia de composicion elegida a criterio, no derivada de una
 *    distribucion: la matriz es determinista, asi que no hay ruido de muestreo que modelar. LIMITE CONOCIDO: una perdida global de ~25 %
 *    de las tarjetas pasa, y entre ~25 % y ~50 % solo la detecta algun segmento. Existe para detectar colapsos, no desgaste.
 *  - minSegmentAnswered 5: un segmento solo se exige si la referencia tenia >= 5 respuestas del Coach y tarjetas > 0. Tambien arbitrario;
 *    con bases muy chicas (p. ej. round=3: 4 tarjetas) un cambio legitimo puede disparar la regla (limite B1, registrado para R4).
 *
 * Se elimino el tope de concentracion de un solo escenario (10 %): era matematicamente inalcanzable en la matriz real (<= 8 checkpoints
 * con humano abierto por corrida y >= 97 tarjetas necesarias para pasar la tasa de tarjetas => maximo 8,2 %). La concentracion la cubre
 * `SCENARIO_SPREAD`.
 */
export const COVERAGE_TOLERANCE = Object.freeze({ rateFloor: 0.5, minSegmentAnswered: 5 });

export type CoverageRule =
  | "NOT_COMPARABLE"
  | "COACH_ANSWER_RATE"
  | "CARD_RATE"
  | "SCENARIO_SPREAD"
  | "SEGMENT_LOSS"
  | "REFERENCE_INVALID"
  | "REFERENCE_TAMPERED"
  | "REFERENCE_INCOMPATIBLE";
const tag = (rule: CoverageRule, text: string): string => `[${rule}] ${text}`;
/** Regla que emitio un diagnostico (`VACUITY` para los de `vacuityProblems`, que no llevan codigo). */
export function ruleOf(problem: string): CoverageRule | "VACUITY" {
  const match = /^\[([A-Z_]+)\]/.exec(problem);
  return match ? (match[1] as CoverageRule) : "VACUITY";
}

export interface CoverageReference {
  /**
   * Procedencia auditable: de que commit y cuando se midio, y el sha256 de cada FIXTURE sintetico del que depende la matriz (R3.3: ya no se hashea
   * ningun dato curado real). Hoy: `synthetic-counters` (`qa/scenarios/synthetic-counters.ts`) -- con counters vacios la matriz entera da 0 tarjetas.
   */
  provenance: { commit: string; measuredOn: string; source: string; fixtureInputs: Readonly<Record<string, string>> };
  profile: MatrixProfile;
  /** Huella de `{ provenance, profile }`: detecta una edicion a mano de la referencia sin pasar por `buildCoverageReference`. */
  integrity: { sha256: string };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

export function referenceIntegrityHash(reference: Pick<CoverageReference, "provenance" | "profile">): string {
  return createHash("sha256").update(stableStringify({ provenance: reference.provenance, profile: reference.profile })).digest("hex");
}

/**
 * Genera la referencia a partir de una matriz. NUNCA se invoca desde el camino de commit: una referencia nueva solo se escribe
 * a mano, con revision humana, cuando cambia el diseno de la matriz (escenarios) o la curacion de datos del fixture -- jamas
 * porque una corrida salio distinta. Ver `coverage-reference.md`.
 */
export function buildCoverageReference(matrix: readonly CoverageRun[], provenance: CoverageReference["provenance"]): CoverageReference {
  const body = { provenance, profile: matrixProfile(matrix) };
  return { ...body, integrity: { sha256: referenceIntegrityHash(body) } };
}

const rate = (numerator: number, denominator: number): number => (denominator === 0 ? 0 : numerator / denominator);
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/**
 * Confianza en la REFERENCIA (no en la matriz): ¿fue alterada a mano?, ¿trae una tolerancia propia?, ¿los fixtures sinteticos siguen
 * siendo los que la produjeron? `actualInputs` (sha256 por dato curado, calculado por el llamador con I/O) es opcional: sin el, no se
 * evalua compatibilidad. Un cambio de datos NO es una regresion del Coach y tampoco se resuelve regenerando sola la referencia.
 */
export function referenceTrustProblems(reference: CoverageReference, actualInputs?: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  if ("tolerance" in (reference as object)) {
    problems.push(tag("REFERENCE_TAMPERED", "la referencia trae un campo `tolerance` propio; las tolerancias viven solo en codigo (COVERAGE_TOLERANCE) y la del JSON se ignora"));
  }
  if (referenceIntegrityHash(reference) !== reference.integrity?.sha256) {
    problems.push(tag("REFERENCE_TAMPERED", "la huella de la referencia no coincide con su contenido: se edito a mano en vez de regenerarla con buildCoverageReference (coverage-reference.md)"));
  }
  if (actualInputs) {
    // Simetria: tambien se exige que un fixture NUEVO (presente hoy, ausente en la referencia) quede registrado; antes pasaba en silencio.
    const names = new Set([...Object.keys(reference.provenance.fixtureInputs), ...Object.keys(actualInputs)]);
    for (const file of names) {
      const recorded = reference.provenance.fixtureInputs[file];
      const actual = actualInputs[file];
      if (actual === recorded) continue;
      if (recorded === undefined) {
        problems.push(tag("REFERENCE_INCOMPATIBLE", `${file} existe hoy pero la referencia no lo registra: se agrego un fixture sin regenerar la referencia (coverage-reference.md).`));
        continue;
      }
      const detail = actual === undefined ? "no se pudo calcular su huella (fixture ausente)" : `cambio: referencia sha256:${recorded.slice(0, 12)}…, actual sha256:${actual.slice(0, 12)}…`;
      problems.push(
        tag(
          "REFERENCE_INCOMPATIBLE",
          `${file} ${detail}. Esto NO es una regresion del Coach: los fixtures sinteticos que alimentan la matriz son otros y la referencia ya no es comparable. No se regenera sola ni se da PASS por esto; revisar el cambio del fixture y, solo con revision humana, regenerar la referencia (coverage-reference.md).`,
        ),
      );
    }
  }
  return problems;
}

/**
 * Regresion de cobertura del perfil actual respecto de la referencia (vacio = sin regresion). Cada regla tiene su propio codigo:
 *  NOT_COMPARABLE     la matriz se encogio (humanos abiertos < 0,5 x referencia)
 *  COACH_ANSWER_RATE  el Coach responde menos (respuestas / humano abierto)
 *  CARD_RATE          menos tarjetas por respuesta (tarjetas / respuestas) -- tambien salta si se diluye con muchos checkpoints sin tarjeta
 *  SCENARIO_SPREAD    las tarjetas se concentran en pocos escenarios (corridas con tarjetas / corridas)
 *  SEGMENT_LOSS       un segmento (round/step/partySize/side/openPosition) que tenia tarjetas pierde la mitad de su tasa
 *  REFERENCE_INVALID  la referencia no tiene tarjetas/respuestas/humanos: no se puede exigir nada
 */
export function coverageRegressionProblems(current: MatrixProfile, reference: CoverageReference): string[] {
  const { profile: ref } = reference;
  if (ref.withCards === 0 || ref.coachAnswered === 0 || ref.humanOpen === 0) {
    return [tag("REFERENCE_INVALID", "la referencia no tiene tarjetas/respuestas/humanos abiertos: no se puede exigir cobertura (INSUFFICIENT_EVIDENCE)")];
  }
  const problems: string[] = [];
  const { rateFloor, minSegmentAnswered } = COVERAGE_TOLERANCE;
  const floor = (value: number) => value * rateFloor;
  if (current.humanOpen < floor(ref.humanOpen)) {
    problems.push(tag("NOT_COMPARABLE", `la matriz dejo de ser comparable: ${current.humanOpen} checkpoints con humano abierto (referencia ${ref.humanOpen}, piso ${floor(ref.humanOpen).toFixed(0)})`));
  }
  const answeredRate = rate(current.coachAnswered, current.humanOpen);
  if (answeredRate < floor(rate(ref.coachAnswered, ref.humanOpen))) {
    problems.push(tag("COACH_ANSWER_RATE", `el Coach responde en ${pct(answeredRate)} de los checkpoints con humano abierto (referencia ${pct(rate(ref.coachAnswered, ref.humanOpen))})`));
  }
  const cardsRate = rate(current.withCards, current.coachAnswered);
  const refCardsRate = rate(ref.withCards, ref.coachAnswered);
  if (cardsRate < floor(refCardsRate)) {
    problems.push(tag("CARD_RATE", `${current.withCards}/${current.coachAnswered} respuestas con tarjetas = ${pct(cardsRate)} (referencia ${pct(refCardsRate)}, piso ${pct(floor(refCardsRate))})`));
  }
  if (rate(current.runsWithCards, current.runs) < floor(rate(ref.runsWithCards, ref.runs))) {
    problems.push(tag("SCENARIO_SPREAD", `solo ${current.runsWithCards}/${current.runs} escenarios producen tarjetas (referencia ${ref.runsWithCards}/${ref.runs}): la cobertura se concentro en pocos escenarios`));
  }
  for (const [dimension, values] of Object.entries(ref.segments)) {
    for (const [value, base] of Object.entries(values)) {
      if (base.answered < minSegmentAnswered || base.withCards === 0) continue; // sin base o sin tarjetas de referencia: nunca se exige
      const now = current.segments[dimension]?.[value] ?? { open: 0, answered: 0, withCards: 0 };
      if (rate(now.withCards, now.answered) < floor(rate(base.withCards, base.answered))) {
        problems.push(tag("SEGMENT_LOSS", `segmento ${dimension}=${value} perdio cobertura: ${now.withCards}/${now.answered} con tarjetas (referencia ${base.withCards}/${base.answered})`));
      }
    }
  }
  return problems;
}

/**
 * Guard completo: confianza en la referencia (alteracion / fixtures distintos) + matriz no vacia + sin regresion.
 * `actualInputs` = sha256 de los fixtures sinteticos de hoy (ver `fixture-input-hashes.ts`); omitido en pruebas unitarias.
 */
export function matrixGuardProblems(matrix: readonly CoverageRun[], reference: CoverageReference, actualInputs?: Readonly<Record<string, string>>): string[] {
  const profile = matrixProfile(matrix);
  return [...referenceTrustProblems(reference, actualInputs), ...vacuityProblems(profile), ...coverageRegressionProblems(profile, reference)];
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
