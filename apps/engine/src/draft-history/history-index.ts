import { matchKey } from "./match-id";
import { MAX_PICKS_PER_SIDE } from "./types";
import type {
  DraftFormatKind,
  DraftHistoryObservation,
  DraftHistoryRecord,
  HeroId,
  MatchOutcome,
  PatchState,
  ProvenanceSource,
  Rejection,
  Side,
} from "./types";
import { validateDraftObservation } from "./validator";

// V7 PR-2 (TSK-249): búsqueda en el historial profesional. Sólo lectura, función pura sobre un
// arreglo en memoria; sin red, sin SQLite, sin scoring. El resultado es EVIDENCIA descriptiva:
// nada aquí dice que una composición sea "mejor", y una victoria o derrota nunca se presenta como causa.
//
// Modelo (decisiones de producto aprobadas):
// - Radiant/Dire NO son criterio de equivalencia. Cada partida se lee desde "nuestro equipo
//   histórico": el que contiene a nuestros aliados (y enfrenta a nuestros enemigos revelados). Se
//   evalúan las dos orientaciones y se queda la coherente; la perspectiva del observador no se usa.
// - Tres calidades de coincidencia: `direct` (todo lo observado encaja, cero conflictos), `partial`
//   (cero conflictos, falta parte de lo observado) y `contrast` (algún héroe cae del lado contrario).
//   Los ejemplos principales son sólo direct/partial; `contrast` va en una lista secundaria.
// - Se estudian victorias Y derrotas. Ordenar por relevancia de matchup, nunca por haber ganado.
// - Las estadísticas se agrupan por IDENTIDAD de los héroes coincidentes (más calidad, conflictos,
//   vigencia de parche y relación de formato): no se mezclan estrategias distintas en un porcentaje.
//
// Se declara como interfaz (`HistoryIndex`) para poder sustituir la implementación por una
// estructura invertida si el volumen futuro lo exige, sin tocar a los consumidores.

export type PatchRelation = "same" | "older" | "newer" | "unknown";
export type FormatRelation = "same_format" | "different_format" | "unknown";
export type OurOutcome = "win" | "loss" | "unknown";
export type MatchQuality = "direct" | "partial" | "contrast";

/** Un draft histórico que coincide, total o parcialmente, con la observación. */
export interface HistoryHit {
  matchKey: string;
  source: ProvenanceSource;
  quality: MatchQuality;
  /**
   * METADATO: bando histórico (Radiant/Dire) del equipo equivalente al nuestro. No es criterio de
   * equivalencia. Con `orientationAmbiguous` es arbitrario.
   */
  alliedSide: Side;
  /** `true` = las dos orientaciones encajan igual de bien (sólo ocurre con conflictos). */
  orientationAmbiguous: boolean;
  /** Ascendentes. */
  matchedAllyHeroIds: HeroId[];
  matchedEnemyHeroIds: HeroId[];
  /** Héroes de la observación hallados en el equipo histórico CONTRARIO al que les toca. */
  conflictingHeroIds: HeroId[];
  /**
   * Resultado visto desde el equipo equivalente al nuestro. `unknown` = la fuente no declaró
   * ganador, o la orientación es ambigua; nunca significa derrota.
   */
  ourOutcome: OurOutcome;
  patch: PatchState;
  patchRelation: PatchRelation;
  format: DraftFormatKind;
  formatRelation: FormatRelation;
  /** Picks conocidos del registro (no implican orden de selección). */
  historicalAllyHeroIds: HeroId[];
  historicalEnemyHeroIds: HeroId[];
  /** `false` = prefijo / roster incompleto: lo no visto puede ser lo no elegido aún. */
  recordPicksComplete: boolean;
  /** `null` = los bans de la observación o del registro son desconocidos. Nunca 0 por defecto. */
  banMatches: number | null;
}

/** Identidad de la afirmación que un grupo respalda. Las listas van en orden ascendente. */
export interface HistoryGroupKey {
  quality: MatchQuality;
  allyHeroIds: HeroId[];
  enemyHeroIds: HeroId[];
  conflictHeroIds: HeroId[];
  orientationAmbiguous: boolean;
  patchRelation: PatchRelation;
  formatRelation: FormatRelation;
}

/**
 * Estadística descriptiva de UN grupo. `sampleSize` cuenta todos los drafts del grupo;
 * `observedWinShare` sólo los que tienen ganador conocido (`wins + losses`). No es una
 * probabilidad de ganar ni un efecto causal.
 */
export interface HistoryGroup {
  key: HistoryGroupKey;
  sampleSize: number;
  wins: number;
  losses: number;
  unknownOutcomes: number;
  observedWinShare: number | null;
  /** Intervalo de Wilson 95 % sobre `wins / (wins + losses)`. Con pocas partidas es ancho. */
  winShareInterval95: { lower: number; upper: number } | null;
}

export type HistorySearchStatus =
  | "ok"
  | "no_matches"
  | "empty_observation"
  | "no_eligible_records"
  | "invalid_observation";

export interface HistorySearchResult {
  status: HistorySearchStatus;
  /** Siempre descriptivo: ni causalidad ni ranking de superioridad. */
  interpretation: "descriptive_only";
  population: {
    indexedRecords: number;
    /** Profesionales con procedencia verificable: el único universo buscable. */
    eligibleRecords: number;
    excludedByEvidenceClass: number;
    /** `professional` sin anclaje externo (`manual_curated` u `opendota_match`): la etiqueta no basta. */
    excludedUnverifiedProvenance: number;
    duplicatesDropped: number;
    matchedRecords: number;
    directMatches: number;
    partialMatches: number;
    contrastMatches: number;
  };
  /**
   * Ejemplos principales (cero conflictos), por resultado y cada categoría ordenada por relevancia
   * de matchup. `maxExamples` aplica por categoría: ninguna se oculta ni se fuerza a un balance.
   */
  examples: { wins: HistoryHit[]; losses: HistoryHit[]; unknown: HistoryHit[] };
  /** Secundarias: hay héroes del lado contrario. No son enfrentamientos equivalentes. */
  contrastReferences: HistoryHit[];
  /** Todas las partidas coincidentes, sin tope, agrupadas por afirmación comparable. */
  groups: HistoryGroup[];
  /** Sólo con `invalid_observation`: códigos y rutas, jamás el valor recibido. */
  rejections: Rejection[];
}

export interface HistorySearchOptions {
  /** Tope por categoría de ejemplos y para las referencias de contraste (default y máximo: 10). */
  maxExamples?: number;
}

export interface HistoryIndex {
  /** Registros indexados (tras quitar repetidos), de cualquier clase de evidencia. */
  readonly size: number;
  /** `observation` se valida en el borde; nunca lanza. */
  search(observation: unknown, options?: HistorySearchOptions): HistorySearchResult;
}

export interface CreateHistoryIndexOptions {
  /** Universo de héroes con el que se valida cada observación (default: el curado de PR-1). */
  heroUniverse?: ReadonlySet<number>;
}

export const MAX_EXAMPLES = 10;

// ---------------------------------------------------------------------------------------------
// Entradas indexadas
// ---------------------------------------------------------------------------------------------

interface Entry {
  key: string;
  source: ProvenanceSource;
  format: DraftFormatKind;
  outcome: MatchOutcome;
  patch: PatchState;
  radiant: readonly HeroId[];
  dire: readonly HeroId[];
  radiantSet: ReadonlySet<HeroId>;
  direSet: ReadonlySet<HeroId>;
  /** `null` = bans desconocidos. */
  bans: ReadonlySet<HeroId> | null;
  picksComplete: boolean;
}

function toEntry(record: DraftHistoryRecord): Entry {
  const common = {
    key: matchKey(record.provenance),
    source: record.provenance.source,
    format: record.format,
    outcome: record.outcome,
    patch: record.patch,
  };
  if (record.format === "captains_mode") {
    const picksOf = (side: Side): HeroId[] =>
      record.actions.filter((a) => a.action === "pick" && a.side === side).map((a) => a.heroId);
    const banIds = record.actions.filter((a) => a.action === "ban").map((a) => a.heroId);
    const radiant = picksOf("radiant");
    const dire = picksOf("dire");
    return {
      ...common,
      radiant,
      dire,
      radiantSet: new Set(radiant),
      direSet: new Set(dire),
      // Un CM sin ninguna acción de ban no demuestra "cero bans": se deja como desconocido.
      bans: banIds.length > 0 ? new Set(banIds) : null,
      picksComplete: record.completeness === "complete",
    };
  }
  const radiant = [...record.picks.radiant.heroIds];
  const dire = [...record.picks.dire.heroIds];
  return {
    ...common,
    radiant,
    dire,
    radiantSet: new Set(radiant),
    direSet: new Set(dire),
    bans: record.bans.status === "confirmed_visible" ? new Set(record.bans.heroIds) : null,
    picksComplete: record.picks.radiant.complete && record.picks.dire.complete,
  };
}

// ---------------------------------------------------------------------------------------------
// Parche y formato
// ---------------------------------------------------------------------------------------------

// "7.41e" -> [7, 41, 5]; "7.41" -> [7, 41, 0]. Sólo etiquetas con esa forma son ordenables.
const PATCH_LABEL = /^(\d+)\.(\d+)([a-z]?)$/;

function parsePatchLabel(label: string): [number, number, number] | null {
  const m = PATCH_LABEL.exec(label);
  if (m === null) return null;
  const letter = m[3] === "" ? 0 : (m[3] as string).charCodeAt(0) - 96;
  return [Number(m[1]), Number(m[2]), letter];
}

/** Vigencia del parche del REGISTRO respecto del de la observación. */
export function relatePatch(observed: PatchState, recorded: PatchState): PatchRelation {
  // Un id de la fuente no es comparable con una etiqueta (SPEC §16.4): no se convierte ni se adivina.
  if (observed.state !== "exact" || recorded.state !== "exact") return "unknown";
  if (observed.label === recorded.label) return "same";
  const a = parsePatchLabel(recorded.label);
  const b = parsePatchLabel(observed.label);
  if (a === null || b === null) return "unknown";
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (x !== y) return x < y ? "older" : "newer";
  }
  return "same";
}

function relateFormat(observed: DraftFormatKind, recorded: DraftFormatKind): FormatRelation {
  if (observed === "unknown" || recorded === "unknown") return "unknown";
  return observed === recorded ? "same_format" : "different_format";
}

// ---------------------------------------------------------------------------------------------
// Evaluación de un registro
// ---------------------------------------------------------------------------------------------

// Una observación tiene a lo sumo 5 aliados y 5 enemigos (validador de PR-1), así que cada
// subconjunto cabe en una máscara de bits sobre la posición dentro de su lista. Evita crear
// arreglos por registro en el camino caliente: sólo se materializan los que se devuelven.
// 5 bits por máscara (MAX_PICKS_PER_SIDE) -> el `groupId` entero ocupa 24 bits, dentro del límite
// de 32 de los operadores de bits de JS.
const SIDE_BITS = MAX_PICKS_PER_SIDE;

interface Obs {
  ally: readonly HeroId[];
  enemy: readonly HeroId[];
  total: number;
  bans: ReadonlySet<HeroId> | null;
  patch: PatchState;
  format: DraftFormatKind;
}

interface Match {
  entry: Entry;
  quality: MatchQuality;
  alliedSide: Side;
  ambiguous: boolean;
  allyMask: number;
  enemyMask: number;
  allyConflictMask: number;
  enemyConflictMask: number;
  nAlly: number;
  nEnemy: number;
  nConflict: number;
  ourOutcome: OurOutcome;
  patchRelation: PatchRelation;
  formatRelation: FormatRelation;
  banMatches: number | null;
  /** Identidad numérica de la afirmación que respalda (héroes coincidentes + conflictos + contexto). */
  groupId: number;
}

const PATCH_IDS: readonly PatchRelation[] = ["same", "older", "newer", "unknown"];
const FORMAT_IDS: readonly FormatRelation[] = ["same_format", "different_format", "unknown"];

function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m !== 0; m &= m - 1) n += 1;
  return n;
}

interface Orientation {
  allyMask: number;
  enemyMask: number;
  allyConflictMask: number;
  enemyConflictMask: number;
}

// Las dos orientaciones. En "aliados = Radiant", un aliado coincide si está en Radiant y choca si
// está en Dire; un enemigo, al revés. "aliados = Dire" es el espejo exacto.
function scan(entry: Entry, obs: Obs): [Orientation, Orientation] | null {
  const asRadiant: Orientation = { allyMask: 0, enemyMask: 0, allyConflictMask: 0, enemyConflictMask: 0 };
  const asDire: Orientation = { allyMask: 0, enemyMask: 0, allyConflictMask: 0, enemyConflictMask: 0 };
  let present = false;
  for (let i = 0; i < obs.ally.length; i += 1) {
    const hero = obs.ally[i] as HeroId;
    const bit = 1 << i;
    if (entry.radiantSet.has(hero)) {
      asRadiant.allyMask |= bit;
      asDire.allyConflictMask |= bit;
      present = true;
    } else if (entry.direSet.has(hero)) {
      asDire.allyMask |= bit;
      asRadiant.allyConflictMask |= bit;
      present = true;
    }
  }
  for (let j = 0; j < obs.enemy.length; j += 1) {
    const hero = obs.enemy[j] as HeroId;
    const bit = 1 << j;
    if (entry.direSet.has(hero)) {
      asRadiant.enemyMask |= bit;
      asDire.enemyConflictMask |= bit;
      present = true;
    } else if (entry.radiantSet.has(hero)) {
      asDire.enemyMask |= bit;
      asRadiant.enemyConflictMask |= bit;
      present = true;
    }
  }
  return present ? [asRadiant, asDire] : null;
}

const conflictCount = (o: Orientation): number => popcount(o.allyConflictMask) + popcount(o.enemyConflictMask);

function evaluate(entry: Entry, obs: Obs): Match | null {
  const orientations = scan(entry, obs);
  if (orientations === null) return null;
  const [asRadiant, asDire] = orientations;

  // La orientación coherente es la de menos conflictos (equivale a la de más coincidencias: lo
  // presente se reparte entre coincidir y chocar). Un empate sólo existe con conflictos; se desempata
  // con una regla que no mira Radiant/Dire ni la perspectiva del observador, y se marca ambiguo.
  const conflictsRadiant = conflictCount(asRadiant);
  const conflictsDire = conflictCount(asDire);
  const ambiguous = conflictsRadiant === conflictsDire;
  let alliedSide: Side;
  if (!ambiguous) {
    alliedSide = conflictsRadiant < conflictsDire ? "radiant" : "dire";
  } else {
    const byAlly = popcount(asRadiant.allyMask) - popcount(asDire.allyMask);
    const byMask = asRadiant.allyMask - asDire.allyMask || asRadiant.enemyMask - asDire.enemyMask;
    if (byAlly !== 0) alliedSide = byAlly > 0 ? "radiant" : "dire";
    else alliedSide = byMask >= 0 ? "radiant" : "dire";
  }
  const o = alliedSide === "radiant" ? asRadiant : asDire;

  const nAlly = popcount(o.allyMask);
  const nEnemy = popcount(o.enemyMask);
  const nConflict = conflictCount(o);
  let quality: MatchQuality = "partial";
  if (nConflict > 0) quality = "contrast";
  else if (nAlly + nEnemy === obs.total) quality = "direct";

  let ourOutcome: OurOutcome = "unknown";
  if (!ambiguous && entry.outcome.status === "known") {
    ourOutcome = entry.outcome.winner === alliedSide ? "win" : "loss";
  }

  let banMatches: number | null = null;
  if (obs.bans !== null && entry.bans !== null) {
    banMatches = 0;
    for (const hero of obs.bans) if (entry.bans.has(hero)) banMatches += 1;
  }

  const patchRelation = relatePatch(obs.patch, entry.patch);
  const formatRelation = relateFormat(obs.format, entry.format);
  const groupId =
    o.allyMask |
    (o.enemyMask << SIDE_BITS) |
    (o.allyConflictMask << (2 * SIDE_BITS)) |
    (o.enemyConflictMask << (3 * SIDE_BITS)) |
    (PATCH_IDS.indexOf(patchRelation) << (4 * SIDE_BITS)) |
    (FORMAT_IDS.indexOf(formatRelation) << (4 * SIDE_BITS + 2));

  return {
    entry,
    quality,
    alliedSide,
    ambiguous,
    allyMask: o.allyMask,
    enemyMask: o.enemyMask,
    allyConflictMask: o.allyConflictMask,
    enemyConflictMask: o.enemyConflictMask,
    nAlly,
    nEnemy,
    nConflict,
    ourOutcome,
    patchRelation,
    formatRelation,
    banMatches,
    groupId,
  };
}

// ---------------------------------------------------------------------------------------------
// Relevancia (ejemplos y orden de grupos)
// ---------------------------------------------------------------------------------------------

const PATCH_RANK: Record<PatchRelation, number> = { same: 0, older: 1, newer: 1, unknown: 2 };
const FORMAT_RANK: Record<FormatRelation, number> = { same_format: 0, different_format: 1, unknown: 2 };

// Fuerza de la coincidencia de matchup: menos conflictos primero (las limpias antes que las de
// contraste; direct antes que partial lo da el mayor número de coincidencias), más héroes coincidentes, más parejo entre los dos equipos, parche vigente, mismo formato.
// NUNCA mira el resultado: se ordena por relevancia, no por haber ganado.
function compareStrength(a: Match, b: Match): number {
  if (a.nConflict !== b.nConflict) return a.nConflict - b.nConflict;
  const total = b.nAlly + b.nEnemy - (a.nAlly + a.nEnemy);
  if (total !== 0) return total;
  const balance = Math.min(b.nAlly, b.nEnemy) - Math.min(a.nAlly, a.nEnemy);
  if (balance !== 0) return balance;
  if (a.patchRelation !== b.patchRelation) return PATCH_RANK[a.patchRelation] - PATCH_RANK[b.patchRelation];
  if (a.formatRelation !== b.formatRelation) return FORMAT_RANK[a.formatRelation] - FORMAT_RANK[b.formatRelation];
  return 0;
}

// Los bans sólo desempatan entre ejemplos igual de relevantes; un ban desconocido pesa como 0 SOLO
// para ordenar (el dato sigue siendo `null` en el resultado).
function compareExamples(a: Match, b: Match): number {
  const strength = compareStrength(a, b);
  if (strength !== 0) return strength;
  const bans = (b.banMatches ?? 0) - (a.banMatches ?? 0);
  if (bans !== 0) return bans;
  if (a.entry.key === b.entry.key) return 0;
  return a.entry.key < b.entry.key ? -1 : 1;
}

/** Mantiene los `limit` mejores según `compareExamples` sin ordenar todo el universo. */
function offerTopK(items: Match[], limit: number, candidate: Match): void {
  if (limit <= 0) return;
  if (items.length === limit && compareExamples(candidate, items[limit - 1] as Match) >= 0) return;
  let pos = items.length;
  while (pos > 0 && compareExamples(candidate, items[pos - 1] as Match) < 0) pos -= 1;
  items.splice(pos, 0, candidate);
  if (items.length > limit) items.pop();
}

const heroesAt = (list: readonly HeroId[], mask: number): HeroId[] =>
  list.filter((_, i) => (mask & (1 << i)) !== 0).sort((a, b) => a - b);

const conflictsOf = (m: Match, obs: Obs): HeroId[] =>
  [...heroesAt(obs.ally, m.allyConflictMask), ...heroesAt(obs.enemy, m.enemyConflictMask)].sort((a, b) => a - b);

function toHit(m: Match, obs: Obs): HistoryHit {
  const alliedHistory = m.alliedSide === "radiant" ? m.entry.radiant : m.entry.dire;
  const enemyHistory = m.alliedSide === "radiant" ? m.entry.dire : m.entry.radiant;
  return {
    matchKey: m.entry.key,
    source: m.entry.source,
    quality: m.quality,
    alliedSide: m.alliedSide,
    orientationAmbiguous: m.ambiguous,
    matchedAllyHeroIds: heroesAt(obs.ally, m.allyMask),
    matchedEnemyHeroIds: heroesAt(obs.enemy, m.enemyMask),
    conflictingHeroIds: conflictsOf(m, obs),
    ourOutcome: m.ourOutcome,
    patch: structuredClone(m.entry.patch),
    patchRelation: m.patchRelation,
    format: m.entry.format,
    formatRelation: m.formatRelation,
    historicalAllyHeroIds: [...alliedHistory],
    historicalEnemyHeroIds: [...enemyHistory],
    recordPicksComplete: m.entry.picksComplete,
    banMatches: m.banMatches,
  };
}

// ---------------------------------------------------------------------------------------------
// Estadística descriptiva
// ---------------------------------------------------------------------------------------------

const Z95 = 1.959964;

/** Intervalo de Wilson para una proporción. `null` sin partidas con ganador conocido. */
export function wilsonInterval95(wins: number, n: number): { lower: number; upper: number } | null {
  if (n <= 0) return null;
  const p = wins / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

interface GroupAcc {
  sample: Match;
  wins: number;
  losses: number;
  unknown: number;
}

// Un grupo = una afirmación comparable: mismos héroes aliados y enemigos coincidentes, mismos
// conflictos, misma vigencia de parche y misma relación de formato. Radiant/Dire no lo parte.
function buildGroups(matches: readonly Match[], obs: Obs): HistoryGroup[] {
  const acc = new Map<number, GroupAcc>();
  for (const m of matches) {
    let g = acc.get(m.groupId);
    if (g === undefined) {
      g = { sample: m, wins: 0, losses: 0, unknown: 0 };
      acc.set(m.groupId, g);
    }
    if (m.ourOutcome === "win") g.wins += 1;
    else if (m.ourOutcome === "loss") g.losses += 1;
    else g.unknown += 1;
  }
  return [...acc.entries()]
    .sort(([idA, a], [idB, b]) => compareStrength(a.sample, b.sample) || idA - idB)
    .map(([, g]) => {
      const decided = g.wins + g.losses;
      const s = g.sample;
      return {
        key: {
          quality: s.quality,
          allyHeroIds: heroesAt(obs.ally, s.allyMask),
          enemyHeroIds: heroesAt(obs.enemy, s.enemyMask),
          conflictHeroIds: conflictsOf(s, obs),
          orientationAmbiguous: s.ambiguous,
          patchRelation: s.patchRelation,
          formatRelation: s.formatRelation,
        },
        sampleSize: decided + g.unknown,
        wins: g.wins,
        losses: g.losses,
        unknownOutcomes: g.unknown,
        observedWinShare: decided > 0 ? g.wins / decided : null,
        winShareInterval95: wilsonInterval95(g.wins, decided),
      };
    });
}

// ---------------------------------------------------------------------------------------------
// Elegibilidad
// ---------------------------------------------------------------------------------------------

// Sólo es buscable la evidencia profesional CON ANCLAJE EXTERNO: una partida de liga de OpenDota
// (`opendota_league`, su feed de ligas profesionales). La etiqueta `evidenceClass: "professional"`
// la escribe quien arma el registro, igual que `manual_curated`: por sí sola no prueba que la
// partida sea profesional. `opendota_match` + `professional` queda fuera hasta que una fuente de
// liga lo respalde (tabla curada de ligas: pendiente, PR futuro).
//
// LIMITACIÓN CONOCIDA: `opendota_league` por sí solo NO certifica que una liga sea profesional. Aquí
// sólo se comprueba la etiqueta de fuente; la ingesta futura debe verificar la procedencia real de la
// liga (p. ej. una tabla curada de ligas profesionales) antes de escribir un registro con esa fuente.
type Eligibility = "eligible" | "unverified_professional" | "ranked";
const ELIGIBILITY_PREFERENCE: Record<Eligibility, number> = { eligible: 0, unverified_professional: 1, ranked: 2 };

function classify(record: DraftHistoryRecord): Eligibility {
  if (record.evidenceClass !== "professional") return "ranked";
  return record.provenance.source === "opendota_league" ? "eligible" : "unverified_professional";
}

function clampExamples(requested: number | undefined): number {
  if (requested === undefined || !Number.isInteger(requested)) return MAX_EXAMPLES;
  return Math.min(MAX_EXAMPLES, Math.max(0, requested));
}

// ---------------------------------------------------------------------------------------------
// Implementación en arreglos
// ---------------------------------------------------------------------------------------------

/**
 * Índice lineal sobre arreglos. Recorre todo el universo elegible en cada `search` (sin cachés ni
 * estado entre llamadas): un pick nuevo, uno retractado o un ban nuevo recalculan desde cero y
 * ninguna partida se descarta de forma permanente. `records` debe venir ya validado
 * (`loadDraftHistory*` de PR-1).
 *
 * Una misma partida llegada por dos vías (`matchKey` igual) cuenta una vez: se conserva la de
 * mejor procedencia (elegible > profesional sin anclaje > Ranked), no la primera que aparezca.
 */
export function createArrayHistoryIndex(
  records: readonly DraftHistoryRecord[],
  options: CreateHistoryIndexOptions = {},
): HistoryIndex {
  const chosen = new Map<string, { record: DraftHistoryRecord; eligibility: Eligibility }>();
  let duplicatesDropped = 0;
  for (const record of records) {
    const key = matchKey(record.provenance);
    const eligibility = classify(record);
    const existing = chosen.get(key);
    if (existing === undefined) {
      chosen.set(key, { record, eligibility });
      continue;
    }
    duplicatesDropped += 1;
    if (ELIGIBILITY_PREFERENCE[eligibility] < ELIGIBILITY_PREFERENCE[existing.eligibility]) {
      chosen.set(key, { record, eligibility });
    }
  }

  const eligible: Entry[] = [];
  let excludedByEvidenceClass = 0;
  let excludedUnverifiedProvenance = 0;
  for (const { record, eligibility } of chosen.values()) {
    if (eligibility === "ranked") excludedByEvidenceClass += 1;
    else if (eligibility === "unverified_professional") excludedUnverifiedProvenance += 1;
    else eligible.push(toEntry(record));
  }
  const indexed = chosen.size;

  const search = (observation: unknown, searchOptions: HistorySearchOptions = {}): HistorySearchResult => {
    const base = {
      interpretation: "descriptive_only" as const,
      population: {
        indexedRecords: indexed,
        eligibleRecords: eligible.length,
        excludedByEvidenceClass,
        excludedUnverifiedProvenance,
        duplicatesDropped,
        matchedRecords: 0,
        directMatches: 0,
        partialMatches: 0,
        contrastMatches: 0,
      },
      examples: { wins: [], losses: [], unknown: [] },
      contrastReferences: [],
      groups: [],
      rejections: [],
    };
    const validated = validateDraftObservation(
      observation,
      options.heroUniverse === undefined ? {} : { heroUniverse: options.heroUniverse },
    );
    if (!validated.ok) return { ...base, status: "invalid_observation", rejections: validated.rejections };
    const input: DraftHistoryObservation = validated.value;
    const obs: Obs = {
      ally: input.allyHeroIds,
      enemy: input.revealedEnemyHeroIds,
      total: input.allyHeroIds.length + input.revealedEnemyHeroIds.length,
      bans: input.bans.status === "confirmed_visible" ? new Set(input.bans.heroIds) : null,
      patch: input.patch,
      format: input.format,
    };
    if (obs.total === 0) return { ...base, status: "empty_observation" };
    if (eligible.length === 0) return { ...base, status: "no_eligible_records" };

    const limit = clampExamples(searchOptions.maxExamples);
    const matches: Match[] = [];
    const wins: Match[] = [];
    const losses: Match[] = [];
    const unknown: Match[] = [];
    const contrast: Match[] = [];
    const counts = { direct: 0, partial: 0, contrast: 0 };
    for (const entry of eligible) {
      const match = evaluate(entry, obs);
      if (match === null) continue;
      matches.push(match);
      counts[match.quality] += 1;
      if (match.quality === "contrast") offerTopK(contrast, limit, match);
      else if (match.ourOutcome === "win") offerTopK(wins, limit, match);
      else if (match.ourOutcome === "loss") offerTopK(losses, limit, match);
      else offerTopK(unknown, limit, match);
    }
    if (matches.length === 0) return { ...base, status: "no_matches" };

    const hits = (list: Match[]): HistoryHit[] => list.map((m) => toHit(m, obs));
    return {
      ...base,
      status: "ok",
      population: {
        ...base.population,
        matchedRecords: matches.length,
        directMatches: counts.direct,
        partialMatches: counts.partial,
        contrastMatches: counts.contrast,
      },
      examples: { wins: hits(wins), losses: hits(losses), unknown: hits(unknown) },
      contrastReferences: hits(contrast),
      groups: buildGroups(matches, obs),
    };
  };

  return { size: indexed, search };
}
