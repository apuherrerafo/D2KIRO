import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bracket } from "../meta/mappers";
import type { SignalContribution, SignalId } from "./types";

// TSK-209 (Fase 9.1, SPEC.md §16.6, costura S18). Carga la calibración empírica que reemplaza la
// normalización lineal de `RAW_RANGE` (ADR-004): en vez de estirar cada `raw` sobre un rango de
// dominio adivinado, se estira sobre los percentiles p05/p95 medidos en los folds de train del
// corpus profesional (`scripts/stats/build-percentiles.ts`, TSK-208).
//
// Este módulo NO cambia el comportamiento del motor por sí solo -- sólo expone `enrich()` y
// `calibratedNormalize()`. `mix.ts` los conecta al pipeline en TSK-210. Con una `Calibration`
// vacía (archivo ausente/corrupto), `calibratedNormalize` reproduce exactamente `normalize()` de
// `mix.ts` -- ese es el candado de regresión cero de la fase.

// ESPEJO exacto de `RAW_RANGE` (apps/engine/src/signals/mix.ts). Es el fallback dentro de
// `calibratedNormalize` cuando una señal no tiene percentiles útiles (o la `Calibration` está
// vacía). No se edita en 9.1 -- `weights.ts`/`RAW_RANGE` quedan congelados. TSK-210 puede dedup-ear
// haciendo que `mix.ts` importe esta constante; hasta entonces son dos copias idénticas a mano
// (mismo criterio que el espejo de `RAW_RANGE` en `scripts/stats/build-percentiles.ts`).
export const FALLBACK_RAW_RANGE: Record<SignalId, [number, number]> = {
  counter: [-0.12, 0.12],
  patch_meta: [0.3, 0.7],
  team_synergy: [0, 1],
  hero_pool_fit: [0, 1],
  position_fit: [0, 1],
  archetype_fit: [0, 1],
};

// §16.6: `evidenceConfidence` para las señales estadísticas es `sampleSize / (sampleSize + K)`.
// K es la "masa de prior": cuántas partidas de evidencia hacen falta para llegar a ~0.5 de
// confianza. `position_fit`/`patch_meta` viven sobre agregados de cientos de partidas; `counter`
// sobre matchups mucho más chicos tras Fase 8 (`COUNTER_MIN_GAMES = 10`).
const EVIDENCE_K: Partial<Record<SignalId, number>> = {
  position_fit: 200,
  counter: 20,
  patch_meta: 200,
};

// §16.6: las señales categóricas no tienen `sampleSize` con sentido estadístico -- su
// `evidenceConfidence` es binaria: 1 si hay `raw`, 0 si es `null`.
const CATEGORICAL_SIGNALS: ReadonlySet<SignalId> = new Set<SignalId>(["team_synergy", "hero_pool_fit", "archetype_fit"]);

const KNOWN_SIGNAL_IDS: ReadonlySet<string> = new Set<SignalId>([
  "counter",
  "patch_meta",
  "team_synergy",
  "hero_pool_fit",
  "position_fit",
  "archetype_fit",
]);

export interface CalibrationBand {
  p05: number;
  p95: number;
  n: number;
}

export interface SignalCalibration {
  global?: CalibrationBand;
  // Reservado (SPEC §16.5, ADR-004): un `DraftState` de replay no lleva bracket, así que hoy
  // `percentiles.json` sólo trae `global`. El resolvedor lo prefiere si algún día se puebla.
  byBracket?: Partial<Record<Bracket, CalibrationBand>>;
}

export interface Calibration {
  schemaVersion: 1;
  // "percentiles.json" = se leyó y validó al menos una señal; "fallback" = archivo ausente,
  // corrupto, o sin ninguna señal utilizable -> `calibratedNormalize` cae a `FALLBACK_RAW_RANGE`.
  source: "percentiles.json" | "fallback";
  signals: Partial<Record<SignalId, SignalCalibration>>;
}

const EMPTY_CALIBRATION: Calibration = { schemaVersion: 1, source: "fallback", signals: {} };

const DEFAULT_PERCENTILES_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "data",
  "generated",
  "percentiles.json",
);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Un `band` sólo cuenta si p05 y p95 son finitos y p05 < p95 -- p05 === p95 haría dividir por
// cero, y ya viene filtrado como `null` desde `build-percentiles.ts`, pero acá se vuelve a
// verificar porque el archivo es input externo (mismo criterio que `loadHeroPositions`).
function parseBand(value: unknown): CalibrationBand | null {
  if (typeof value !== "object" || value === null) return null;
  const band = value as Record<string, unknown>;
  if (!isFiniteNumber(band.p05) || !isFiniteNumber(band.p95)) return null;
  if (band.p05 >= band.p95) return null;
  const n = isFiniteNumber(band.n) ? band.n : 0;
  return { p05: band.p05, p95: band.p95, n };
}

function parseSignalCalibration(value: unknown): SignalCalibration | null {
  if (value === null || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const result: SignalCalibration = {};

  const global = parseBand(entry.global);
  if (global) result.global = global;

  if (entry.byBracket && typeof entry.byBracket === "object") {
    const byBracket: Partial<Record<Bracket, CalibrationBand>> = {};
    for (const [bracket, raw] of Object.entries(entry.byBracket as Record<string, unknown>)) {
      const band = parseBand(raw);
      if (band) byBracket[bracket as Bracket] = band;
    }
    if (Object.keys(byBracket).length > 0) result.byBracket = byBracket;
  }

  if (!result.global && !result.byBracket) return null;
  return result;
}

// Un archivo corrupto / ausente / con forma inesperada degrada a `Calibration` vacía -- nunca
// lanza. Mismo criterio literal que `loadHeroPositions()` (testing-seams.md, S18). Exportada
// aparte para poder probarla con fixtures sintéticos.
export function parseCalibration(raw: unknown): Calibration {
  if (typeof raw !== "object" || raw === null) return EMPTY_CALIBRATION;
  const root = raw as Record<string, unknown>;
  if (root.schemaVersion !== 1) return EMPTY_CALIBRATION;
  if (typeof root.signals !== "object" || root.signals === null) return EMPTY_CALIBRATION;

  const signals: Partial<Record<SignalId, SignalCalibration>> = {};
  for (const [signal, value] of Object.entries(root.signals as Record<string, unknown>)) {
    if (!KNOWN_SIGNAL_IDS.has(signal)) continue; // señal desconocida -> se ignora, no rompe
    const parsed = parseSignalCalibration(value);
    if (parsed) signals[signal as SignalId] = parsed;
  }

  if (Object.keys(signals).length === 0) return EMPTY_CALIBRATION;
  return { schemaVersion: 1, source: "percentiles.json", signals };
}

export function loadCalibration(path: string = DEFAULT_PERCENTILES_PATH): Calibration {
  try {
    return parseCalibration(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return EMPTY_CALIBRATION;
  }
}

function resolveBand(signal: SignalId, bracket: Bracket | null, calibration: Calibration): [number, number] | null {
  const sig = calibration.signals[signal];
  if (!sig) return null;
  if (bracket && sig.byBracket?.[bracket]) {
    const band = sig.byBracket[bracket]!;
    return [band.p05, band.p95];
  }
  if (sig.global) return [sig.global.p05, sig.global.p95];
  return null;
}

// `clamp((raw − p05) / (p95 − p05), 0, 1) * 100`, con `byBracket[bracket]` si existe, si no
// `global`, si no `FALLBACK_RAW_RANGE[signal]`. Con `Calibration` vacía es idéntica bit a bit a
// `normalize()` de `mix.ts` (candado de regresión cero, §16.7).
export function calibratedNormalize(
  signal: SignalId,
  raw: number,
  bracket: Bracket | null,
  calibration: Calibration,
): number {
  const [min, max] = resolveBand(signal, bracket, calibration) ?? FALLBACK_RAW_RANGE[signal];
  const clamped = Math.min(max, Math.max(min, raw));
  return ((clamped - min) / (max - min)) * 100;
}

// §16.6: cuánta evidencia respalda ESTE `raw`. `raw: null` -> 0 siempre. Categóricas -> 1.
// Estadísticas -> `sampleSize / (sampleSize + K)`.
export function evidenceConfidenceOf(contribution: SignalContribution): number {
  if (contribution.raw === null) return 0;
  if (CATEGORICAL_SIGNALS.has(contribution.signal)) return 1;
  const k = EVIDENCE_K[contribution.signal] ?? 20;
  return contribution.sampleSize / (contribution.sampleSize + k);
}

// Agrega `normalized` y `evidenceConfidence` a un `SignalContribution` que sale de un scorer sin
// ellos. Lo llama `mix.ts` (TSK-210) para garantizar que ambos campos salgan siempre poblados
// hacia la UI y los reportes -- los 6 scorers no se tocan.
export function enrich(
  contribution: SignalContribution,
  bracket: Bracket | null,
  calibration: Calibration,
): SignalContribution {
  const normalized =
    contribution.raw === null ? null : calibratedNormalize(contribution.signal, contribution.raw, bracket, calibration);
  return { ...contribution, normalized, evidenceConfidence: evidenceConfidenceOf(contribution) };
}

// Cargada una sola vez al inicializar el módulo (patrón `MODULE_HERO_POSITIONS`/
// `MODULE_HERO_COUNTERS`). Las pruebas construyen su propia `Calibration` inline o pasan un `path`
// -- nunca dependen de `data/generated/percentiles.json` real, que se regenera por parche.
export const MODULE_CALIBRATION: Calibration = loadCalibration();
