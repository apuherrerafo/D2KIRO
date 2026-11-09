// P0-05F -- quality gates de una ingesta de meta (OpenDota). Función pura: recibe los CONTEOS de lo
// que quedó en staging (nunca la base) y decide si es publicable. Un `ok` en `meta_sync` sólo se
// registra si todos los gates pasan: "no registrar ok si falta información obligatoria".

export interface SyncQualityGates {
  /** Mínimo absoluto de héroes válidos en /heroes. */
  minHeroes: number;
  /** Fracción máxima de registros inválidos tolerada por fuente (heroes, heroStats, matchups). */
  maxInvalidRatio: number;
  /** Fracción mínima de héroes que deben tener filas de patch stats. */
  minPatchStatsCoverage: number;
  /** Fracción mínima de héroes pedidos cuyo /matchups llegó y trajo filas. */
  minMatchupCoverage: number;
  /** Fracción máxima de filas de matchup cuyo rival no existe en /heroes (se descartan al publicar). */
  maxOrphanMatchupRatio: number;
  /** Errores de fuente tolerados (respuesta que no es array). Una excepción de red/429 aborta antes y nunca llega aquí. */
  maxSourceErrors: number;
  /** Duplicados tolerados (hero id repetido, fila de stats repetida, par héroe/rival repetido). */
  maxDuplicates: number;
  /** Si ya hay datos publicados: el nuevo snapshot no puede ser más chico que esta fracción del anterior. */
  minHeroesVsPrevious: number;
  minMatchupRowsVsPrevious: number;
}

export const DEFAULT_SYNC_QUALITY_GATES: SyncQualityGates = {
  minHeroes: 100,
  maxInvalidRatio: 0.02,
  minPatchStatsCoverage: 0.95,
  minMatchupCoverage: 0.95,
  maxOrphanMatchupRatio: 0.02,
  maxSourceErrors: 0,
  maxDuplicates: 0,
  minHeroesVsPrevious: 0.9,
  minMatchupRowsVsPrevious: 0.8,
};

/** SÓLO PARA PRUEBAS con fixtures diminutos: apaga cada umbral. Producción usa DEFAULT_SYNC_QUALITY_GATES. */
export const PERMISSIVE_SYNC_GATES: SyncQualityGates = {
  minHeroes: 0,
  maxInvalidRatio: 1,
  minPatchStatsCoverage: 0,
  minMatchupCoverage: 0,
  maxOrphanMatchupRatio: 1,
  maxSourceErrors: Number.POSITIVE_INFINITY,
  maxDuplicates: Number.POSITIVE_INFINITY,
  minHeroesVsPrevious: 0,
  minMatchupRowsVsPrevious: 0,
};

export interface SyncStagingCounts {
  /** Respuestas de la fuente con forma inesperada (no era un array) en cualquiera de los 3 endpoints. */
  sourceErrors: number;
  heroes: { received: number; valid: number; invalid: number; duplicateIds: number };
  patchStats: {
    received: number;
    invalid: number;
    heroesCovered: number;
    heroesCoveredInHeroes: number;
    duplicateKeys: number;
    totalPicks: number;
  };
  matchups: {
    heroesRequested: number;
    heroesWithRows: number;
    invalidRows: number;
    receivedRows: number;
    orphanRows: number;
    duplicatePairs: number;
  };
  previous: { heroes: number; matchupRows: number };
}

export interface SyncQualityReport {
  passed: boolean;
  failures: string[];
  counts: SyncStagingCounts;
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

export function evaluateSyncQuality(
  counts: SyncStagingCounts,
  gates: SyncQualityGates = DEFAULT_SYNC_QUALITY_GATES,
): SyncQualityReport {
  const failures: string[] = [];
  const { heroes, patchStats, matchups, previous, sourceErrors } = counts;

  if (heroes.valid < gates.minHeroes) failures.push(`heroes: ${heroes.valid} válidos, mínimo ${gates.minHeroes}`);
  if (ratio(heroes.invalid, heroes.received) > gates.maxInvalidRatio) {
    failures.push(`heroes: ${heroes.invalid}/${heroes.received} registros inválidos supera ${gates.maxInvalidRatio}`);
  }
  if (heroes.duplicateIds > gates.maxDuplicates) failures.push(`heroes: ${heroes.duplicateIds} id(s) duplicado(s)`);

  if (ratio(patchStats.invalid, patchStats.received) > gates.maxInvalidRatio) {
    failures.push(`heroStats: ${patchStats.invalid}/${patchStats.received} registros inválidos supera ${gates.maxInvalidRatio}`);
  }
  if (ratio(patchStats.heroesCoveredInHeroes, heroes.valid) < gates.minPatchStatsCoverage) {
    failures.push(`heroStats: cubre ${patchStats.heroesCoveredInHeroes}/${heroes.valid} héroes, mínimo ${gates.minPatchStatsCoverage}`);
  }
  if (patchStats.duplicateKeys > gates.maxDuplicates) failures.push(`heroStats: ${patchStats.duplicateKeys} fila(s) duplicada(s)`);
  if (gates.minPatchStatsCoverage > 0 && patchStats.totalPicks <= 0) failures.push("heroStats: cero picks en total");

  if (sourceErrors > gates.maxSourceErrors) failures.push(`fuente: ${sourceErrors} respuesta(s) con forma inesperada`);
  if (ratio(matchups.heroesWithRows, matchups.heroesRequested) < gates.minMatchupCoverage) {
    failures.push(`matchups: ${matchups.heroesWithRows}/${matchups.heroesRequested} héroes con datos, mínimo ${gates.minMatchupCoverage}`);
  }
  if (ratio(matchups.invalidRows, matchups.receivedRows + matchups.invalidRows) > gates.maxInvalidRatio) {
    failures.push(`matchups: ${matchups.invalidRows} filas inválidas supera ${gates.maxInvalidRatio}`);
  }
  if (ratio(matchups.orphanRows, matchups.receivedRows) > gates.maxOrphanMatchupRatio) {
    failures.push(`matchups: ${matchups.orphanRows} filas con rival inexistente supera ${gates.maxOrphanMatchupRatio}`);
  }
  if (matchups.duplicatePairs > gates.maxDuplicates) failures.push(`matchups: ${matchups.duplicatePairs} par(es) duplicado(s)`);

  if (previous.heroes > 0 && heroes.valid < previous.heroes * gates.minHeroesVsPrevious) {
    failures.push(`heroes: ${heroes.valid} vs ${previous.heroes} publicados (cae bajo ${gates.minHeroesVsPrevious})`);
  }
  const publishableMatchupRows = matchups.receivedRows - matchups.orphanRows;
  if (previous.matchupRows > 0 && publishableMatchupRows < previous.matchupRows * gates.minMatchupRowsVsPrevious) {
    failures.push(`matchups: ${publishableMatchupRows} filas vs ${previous.matchupRows} publicadas (cae bajo ${gates.minMatchupRowsVsPrevious})`);
  }

  return { passed: failures.length === 0, failures, counts };
}
