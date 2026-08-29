// Fase 9.0 — split congelado por torneo (GroupKFold sobre league_id). SPEC.md §15.4.3.
// Ningún torneo aparece en dos particiones. El split se serializa UNA vez en
// eval/baselines/split.json y las corridas posteriores lo LEEN — un split que cambia entre
// corridas destruye la comparabilidad que toda la fase existe para construir.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const SPLIT_PATH = "eval/baselines/split.json";
const DEFAULT_FOLDS = 5;
const DEFAULT_SEED = 0x9e3779b9;

export interface FrozenSplit {
  schemaVersion: 1;
  seed: number;
  folds: number;
  /** league_id -> índice de fold [0, folds). */
  assignment: Record<string, number>;
  generatedAt: string;
}

// hash entero determinista (xorshift sobre el league_id + seed) — sin dependencias.
function foldFor(leagueId: number, seed: number, folds: number): number {
  let h = (leagueId ^ seed) >>> 0;
  h ^= h << 13;
  h >>>= 0;
  h ^= h >> 17;
  h ^= h << 5;
  h >>>= 0;
  return h % folds;
}

export function buildSplit(leagueIds: number[], opts: { folds?: number; seed?: number } = {}): FrozenSplit {
  const folds = opts.folds ?? DEFAULT_FOLDS;
  const seed = opts.seed ?? DEFAULT_SEED;
  const assignment: Record<string, number> = {};
  for (const id of [...new Set(leagueIds)].sort((a, b) => a - b)) {
    assignment[String(id)] = foldFor(id, seed, folds);
  }
  return { schemaVersion: 1, seed, folds, assignment, generatedAt: new Date().toISOString() };
}

/** Carga el split congelado si existe; si no, lo construye y lo escribe. Nunca lo regenera. */
export function loadOrCreateSplit(leagueIds: number[], opts: { folds?: number; seed?: number; path?: string } = {}): FrozenSplit {
  const path = opts.path ?? SPLIT_PATH;
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as FrozenSplit;
    // el split existente manda; sólo se avisa si aparecieron torneos nuevos sin asignar
    const missing = [...new Set(leagueIds)].filter((id) => !(String(id) in raw.assignment));
    if (missing.length > 0) {
      process.stderr.write(
        `split.json no cubre ${missing.length} torneo(s) nuevos (${missing.slice(0, 5).join(", ")}...). ` +
          `Se dejan FUERA del backtest para no alterar el split congelado.\n`,
      );
    }
    return raw;
  }
  const split = buildSplit(leagueIds, opts);
  writeFileSync(path, `${JSON.stringify(split, null, 2)}\n`);
  return split;
}

export function foldOf(split: FrozenSplit, leagueId: number): number | null {
  const v = split.assignment[String(leagueId)];
  return v === undefined ? null : v;
}
