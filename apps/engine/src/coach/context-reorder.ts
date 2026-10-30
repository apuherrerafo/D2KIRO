import type { HeroId } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import type { CuratedSynergy } from "../signals/hero-synergies";

// Decisión de producto (el usuario, grill-me 2026-10-29/30): las sugerencias de cada posición ROTAN según lo que se ve.
//   - Bans (las tres rondas, incluidos los de choque Radiant/Dire, que el núcleo suma a la misma lista): abren héroes.
//     Cuentan todos los counters del héroe, los fuertes pesan el doble; es una suma, no un combo.
//   - Rivales ya revelados: suben los que les ganan. Un counter ya revelado BAJA al héroe (fuerte mucho, medium poco), pero
//     NO lo manda al fondo: depende de
//       · si se cruzan en línea (tabla del usuario: carry con offlane y pos4, mid con mid, offlane con carry y pos5…);
//       · si una sinergia con tus aliados lo rescata (con Oracle en tu equipo, Anti-Mage vuelve cerca de su lugar aunque
//         esté Axe).
//   - Counter que todavía NO sale pero cuya posición ya está ocupada en el rival (ya tienen offlane): pesa menos, y se avisa.
//   - Sinergia con aliados YA elegidos: suma una sola vez.
//   - La lista del pool y la general usan ESTE mismo orden: si un héroe está arriba en general, está arriba en tu pool.
//
// El contexto DESEMPATA, no pisa a V6 hacia arriba: el bono positivo tiene tope (MAX_CONTEXT_BONUS) en la escala del
// puntaje de V6. La baja por counters revelados tiene su propio tope, mayor (MAX_COUNTER_PENALTY), porque "baja mucho".
// Las magnitudes son parámetros de producto elegidos a criterio, NO salen de datos: pendientes de calibrar con drafts
// profesionales. Sin counters ni sinergias que toquen a nadie, el orden es EXACTAMENTE el de V6. Pura: sin I/O.

export type CounterLevel = "hard" | "medium";

/** Un héroe que counterea al candidato (o al que el candidato le gana), con su nivel. */
export interface CounterNote {
  heroId: HeroId;
  level: CounterLevel;
  /** Solo en "sigue libre": la posición habitual de ese counter ya la ocupa un rival revelado (menos probable). */
  takenPosition?: Position;
}

/**
 * Lo que la tarjeta dice de los bans. Vacío cuando los bans no abrieron casi nada.
 * - `openedBy` con datos: "Se abre: …"; `stillFree` son los counters medium que quedan libres ("Ojo: …").
 * - `openedBy` vacío y `stillFree` con datos: los bans tocaron sus counters, pero le queda uno FUERTE libre ("Ojo: …").
 */
export interface BanOpening {
  openedBy: CounterNote[];
  stillFree: CounterNote[];
}

export interface ContextReorderInput {
  banned: ReadonlySet<HeroId>;
  /** Héroes que ya elegiste tú / tu equipo (no pueden estar en el rival). */
  ownPicks: ReadonlySet<HeroId>;
  /** Héroes del rival que ya se ven. */
  revealedEnemies: ReadonlySet<HeroId>;
  /** victim -> quién la counterea (el formato de hero-counters.json). */
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  /** héroe -> sus parejas curadas. Ausente = ninguna (el llamador de producción inyecta el archivo real). */
  heroSynergies?: ReadonlyMap<HeroId, readonly CuratedSynergy[]>;
  /** Posiciones curadas por héroe: para saber en qué línea juega un counter y qué posiciones ya ocupó el rival. */
  heroPositions?: HeroPositions;
  /** La posición que estás eligiendo (la columna). Sin ella, todo counter revelado cuenta como "se cruzan en línea". */
  targetPosition?: Position;
}

const LEVEL_WEIGHT: Record<CounterLevel, number> = { hard: 2, medium: 1 };
/** Una lista corta no cuenta como "toda baneada" por un solo counter: el denominador nunca baja de esto. */
const MIN_COUNTER_WEIGHT = 10;
/** Bono de V6 si TODA la lista de counters (con el denominador mínimo) está baneada. */
const MAX_BAN_BONUS = 6;
/** Si menos de 1/OPENING_SHARE_DIVISOR de su lista está baneada (y ningún fuerte), la tarjeta no dice "Se abre": ruido. */
const OPENING_SHARE_DIVISOR = 4;
/** Bono por cada rival que ya se ve y al que le gana, según el nivel del counter. */
const BEATS_BONUS: Record<CounterLevel, number> = { hard: 3, medium: 2 };
/** Bono por combinar con algún aliado que ya elegiste (una sola vez). */
const SYNERGY_BONUS = 3;
/** Tope del bono positivo en la escala de V6 (0-100): el contexto sube a héroes parejos, nunca pisa diferencias grandes. */
const MAX_CONTEXT_BONUS = 6;
/** Baja por cada counter YA revelado: [se cruzan en línea, no se cruzan]. Fuerte baja mucho, medium poco. */
const REVEALED_COUNTER_PENALTY: Record<CounterLevel, readonly [number, number]> = { hard: [12, 6], medium: [4, 2] };
/**
 * Con una sinergia de tu equipo la baja se divide por esto. Provisorio y prudente (el usuario, 2026-10-30): qué parejas
 * rescatan de verdad hay que investigarlo con analistas; mientras, cualquier pareja la reduce a la mitad, no más.
 */
const SYNERGY_RESCUE_DIVISOR = 2;
/** Tope de la baja: dos counters fuertes revelados se suman (bajan mucho); uno fuerte y uno medium, un poco más que uno. */
const MAX_COUNTER_PENALTY = 24;
const MAX_LISTED = 3;

/** Tabla del usuario: con qué posiciones del rival te cruzas en la fase de línea. */
const LANE_OPPONENTS: Record<Position, readonly Position[]> = {
  1: [3, 4],
  2: [2],
  3: [1, 5],
  4: [1, 5],
  5: [3, 4],
};

const NO_SYNERGIES: ReadonlyMap<HeroId, readonly CuratedSynergy[]> = new Map();

function byLevelThenId(a: CounterNote, b: CounterNote): number {
  return LEVEL_WEIGHT[b.level] - LEVEL_WEIGHT[a.level] || a.heroId - b.heroId;
}

/** Una posición "cuenta" para la línea si el héroe la juega en al menos 1/LANE_SHARE_DIVISOR de sus partidas (flex). */
const LANE_SHARE_DIVISOR = 4;
/** "Ya tienen esa posición" solo si el héroe revelado la juega en al menos TAKEN_SHARE_TENTHS/10 de sus partidas. */
const TAKEN_SHARE_TENTHS = 7;

function sharesOf(heroId: HeroId, heroPositions: HeroPositions | undefined): { position: Position; share: number }[] {
  const shares = heroPositions?.[heroId] ?? [];
  const total = shares.reduce((sum, entry) => sum + entry.matches, 0);
  if (total === 0) return [];
  return shares.map((entry) => ({ position: entry.position, share: entry.matches / total }));
}

/** La posición en la que más se juega un héroe según los datos curados; null si no hay datos. */
export function likelyPosition(heroId: HeroId, heroPositions: HeroPositions | undefined): Position | null {
  let best: { position: Position; matches: number } | null = null;
  for (const share of heroPositions?.[heroId] ?? []) {
    if (!best || share.matches > best.matches) best = { position: share.position, matches: share.matches };
  }
  return best?.position ?? null;
}

/** Posiciones del rival ya ocupadas por sus héroes revelados: solo cuenta un héroe que juega ahí casi siempre (no flex). */
function takenEnemyPositions(input: Pick<ContextReorderInput, "revealedEnemies" | "heroPositions">): Set<Position> {
  const taken = new Set<Position>();
  for (const enemy of input.revealedEnemies) {
    for (const entry of sharesOf(enemy, input.heroPositions)) if (entry.share * 10 >= TAKEN_SHARE_TENTHS) taken.add(entry.position);
  }
  return taken;
}

/**
 * ¿Ese rival se cruza contigo en línea? Cuenta cualquier posición que juegue en al menos 1 de cada 4 partidas (un Viper
 * mid que va offlane el 44% sí se le para al carry). Sin tu posición o sin datos de él, se asume que sí (lo prudente).
 */
export function crossesInLane(enemy: HeroId, input: Pick<ContextReorderInput, "targetPosition" | "heroPositions">): boolean {
  const shares = sharesOf(enemy, input.heroPositions);
  if (input.targetPosition === undefined || shares.length === 0) return true;
  const lane = LANE_OPPONENTS[input.targetPosition];
  return shares.some((entry) => entry.share * LANE_SHARE_DIVISOR >= 1 && lane.includes(entry.position));
}

/** Un counter "sigue libre" si el rival todavía puede sacarlo: no baneado, no tuyo y no ya en su equipo (eso es otro aviso). */
function isFree(counter: HeroId, input: Pick<ContextReorderInput, "banned" | "ownPicks" | "revealedEnemies">): boolean {
  return !input.banned.has(counter) && !input.ownPicks.has(counter) && !input.revealedEnemies.has(counter);
}

/** Counters libres del héroe, marcando los que son menos probables porque su posición ya está ocupada en el rival. */
function freeCounters(heroId: HeroId, input: ContextReorderInput): CounterNote[] {
  const taken = takenEnemyPositions(input);
  return (input.heroCounters?.get(heroId) ?? [])
    .filter((entry) => isFree(entry.vs, input))
    .map((entry): CounterNote => {
      const position = likelyPosition(entry.vs, input.heroPositions);
      if (position !== null && taken.has(position)) return { heroId: entry.vs, level: entry.level, takenPosition: position };
      return { heroId: entry.vs, level: entry.level };
    });
}

/** Fracción ponderada de los counters de este héroe que está baneada (0 sin counters). */
export function banFraction(heroId: HeroId, input: Pick<ContextReorderInput, "banned" | "heroCounters">): number {
  let banned = 0;
  let total = 0;
  for (const entry of input.heroCounters?.get(heroId) ?? []) {
    total += LEVEL_WEIGHT[entry.level];
    if (input.banned.has(entry.vs)) banned += LEVEL_WEIGHT[entry.level];
  }
  if (total === 0) return 0;
  return banned / Math.max(MIN_COUNTER_WEIGHT, total);
}

/** Lo que la tarjeta dice de los bans (ver `BanOpening`). Pura. */
export function banOpeningOf(heroId: HeroId, input: ContextReorderInput): BanOpening {
  const none: BanOpening = { openedBy: [], stillFree: [] };
  const entries = input.heroCounters?.get(heroId) ?? [];
  const openedBy = entries.filter((entry) => input.banned.has(entry.vs)).map((entry): CounterNote => ({ heroId: entry.vs, level: entry.level }));
  const meaningful = openedBy.some((note) => note.level === "hard") || banFraction(heroId, input) * OPENING_SHARE_DIVISOR >= 1;
  if (!meaningful) return none;
  const free = freeCounters(heroId, input);
  // Un fuerte libre y PROBABLE tapa el "Se abre" (y el bono, en contextBonus). Uno menos probable (ya tienen su posición)
  // no lo tapa: se dice qué se abrió y se avisa de él como menos probable, igual que el orden.
  const probableHardFree = free.filter((note) => note.level === "hard" && note.takenPosition === undefined);
  if (probableHardFree.length > 0) return { openedBy: [], stillFree: probableHardFree.sort(byLevelThenId).slice(0, MAX_LISTED) };
  return { openedBy: openedBy.sort(byLevelThenId).slice(0, MAX_LISTED), stillFree: free.sort(byLevelThenId).slice(0, MAX_LISTED) };
}

/** A quién de lo que YA salió en el rival le gana este héroe (counters curados). Pura. */
export function beatsRevealed(heroId: HeroId, input: Pick<ContextReorderInput, "revealedEnemies" | "heroCounters">): CounterNote[] {
  const beaten: CounterNote[] = [];
  for (const enemy of input.revealedEnemies) {
    const entry = (input.heroCounters?.get(enemy) ?? []).find((counter) => counter.vs === heroId);
    if (entry) beaten.push({ heroId: enemy, level: entry.level });
  }
  return beaten.sort(byLevelThenId);
}

/** Parejas curadas de este héroe con los aliados que YA elegiste. Pura. */
export function synergiesWithOwn(heroId: HeroId, input: Pick<ContextReorderInput, "ownPicks" | "heroSynergies">): CuratedSynergy[] {
  const all = input.heroSynergies ?? NO_SYNERGIES;
  return (all.get(heroId) ?? []).filter((synergy) => input.ownPicks.has(synergy.with));
}

/** ¿Alguna sinergia con tus aliados rescata a este héroe de sus counters revelados? */
function rescuedBySynergy(heroId: HeroId, input: ContextReorderInput): boolean {
  return synergiesWithOwn(heroId, input).length > 0;
}

/** Cuánto baja el héroe por los counters que el rival YA tiene (0 sin ninguno). Pura. */
export function revealedCounterPenalty(heroId: HeroId, input: ContextReorderInput): number {
  let penalty = 0;
  for (const entry of input.heroCounters?.get(heroId) ?? []) {
    if (!input.revealedEnemies.has(entry.vs)) continue;
    const [crossing, elsewhere] = REVEALED_COUNTER_PENALTY[entry.level];
    penalty += crossesInLane(entry.vs, input) ? crossing : elsewhere;
  }
  if (penalty > 0 && rescuedBySynergy(heroId, input)) penalty /= SYNERGY_RESCUE_DIVISOR;
  return Math.min(MAX_COUNTER_PENALTY, penalty);
}

/** Bono de contexto en la escala del puntaje de V6: hasta +MAX_CONTEXT_BONUS y hasta −MAX_COUNTER_PENALTY. 0 = V6 manda. */
export function contextBonus(heroId: HeroId, input: ContextReorderInput): number {
  let bonus = 0;
  // Bans: con un counter FUERTE libre (y probable) no lo suben; la tarjeta dice "Ojo: X lo counterea fuerte".
  const blockingHardFree = freeCounters(heroId, input).some((note) => note.level === "hard" && note.takenPosition === undefined);
  if (!blockingHardFree) bonus += MAX_BAN_BONUS * banFraction(heroId, input);
  for (const beaten of beatsRevealed(heroId, input)) bonus += BEATS_BONUS[beaten.level];
  const penalty = revealedCounterPenalty(heroId, input);
  // La sinergia suma UNA vez: o rescata de un counter revelado, o da el bono; nunca las dos (un counter fuerte en tu
  // línea no puede quedar en cero solo porque tienes una pareja).
  if (synergiesWithOwn(heroId, input).length > 0 && penalty === 0) bonus += SYNERGY_BONUS;
  return Math.min(MAX_CONTEXT_BONUS, bonus) - penalty;
}

/**
 * PRECONDICIÓN: `candidates` ya viene en el orden de V6 (score de mayor a menor, empates por posición), como lo entrega
 * `extractHeroCandidates`; así, con bono 0 para todos, el resultado es idéntico a la entrada.
 * Reordena por puntaje de V6 + bono de contexto. Estable: a igualdad gana el que ya iba primero en V6.
 */
export function reorderByContext<T extends { heroId: HeroId; score: number }>(candidates: readonly T[], input: ContextReorderInput): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, effective: candidate.score + contextBonus(candidate.heroId, input) }))
    .sort((a, b) => b.effective - a.effective || a.index - b.index)
    .map((entry) => entry.candidate);
}
