/**
 * Cobertura de la matriz de QA: pura, sin I/O. Existe para poder PROBAR el guard anti-vacio contra matrices vacias
 * (matrix-coverage.test.ts): un candado que nunca se ha visto en rojo no es un candado.
 *
 * Contrato de elegibilidad (2026-11-03/04, P0-04): un estado sin ningun heroe con fundamento NO tiene tarjeta, asi que
 * "shortlist no vacia en cada checkpoint" no es una propiedad del producto. Lo que SI debe cumplirse a nivel de matriz es que
 * los oraculos juzguen algo: hay humanos abiertos, el Coach responde en ellos, y existen shortlists con tarjetas.
 */
export interface CoverageCheckpoint {
  humanOpenPositions: readonly number[];
  v3?: { shortlist: readonly unknown[] } | null;
}
export interface CoverageRun {
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
