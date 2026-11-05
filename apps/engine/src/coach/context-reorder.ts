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
//       · si un aliado YA elegido le gana a ese counter (la base dice que Abaddon counterea a Legion: con Abaddon en tu
//         equipo, Legion revelada pesa menos). Una SINERGIA no rescata: verificado con las notas de Valve y la wiki
//         (2026-10-30) en 4 de 4 casos — Culling Blade mata a través de Shallow Grave, Aphotic Shield no quita el Call,
//         Ice Blast corta la curación de Solar Guardian, Disruption saca al aliado del Duel aunque tenga escudo.
//   - Counter que todavía NO sale pero cuya posición ya está ocupada en el rival (ya tienen offlane): pesa menos, y se avisa.
//   - Sinergia con aliados YA elegidos: suma una sola vez.
//   - ROBO (segundo pick, decisión del usuario 2026-11-02, estándar de un experto de Dota): un héroe LIBRE que counterea (fuerte o
//     medium, con razón real en la base) a un pick TUYO ya elegido sube, porque si lo eliges tú el rival no lo tiene. Suma una sola
//     vez (el mejor robo), no se aplica si un rival ya revelado lo counterea, y exige que el héroe se juegue de verdad (partidas
//     suficientes y la posición que estás eligiendo). Fuerte pesa más que medium; con una pareja se suman (hasta el tope), así que
//     quien junta pareja + robo va primero y quien tiene solo una de las dos, después. Nunca supone lo que el rival va a sacar.
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
  /** El porqué de Dota de la relación curada (solo en las notas que se MUESTRAN: `reasonedOpening` lo completa; una atribución nunca llega aquí). */
  why?: string;
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

export const LEVEL_WEIGHT: Record<CounterLevel, number> = { hard: 2, medium: 1 };
/** Una lista corta no cuenta como "toda baneada" por un solo counter: el denominador nunca baja de esto. */
const MIN_COUNTER_WEIGHT = 10;
/** Bono de V6 si TODA la lista de counters (con el denominador mínimo) está baneada. */
const MAX_BAN_BONUS = 6;
/** Si menos de 1/OPENING_SHARE_DIVISOR de su lista está baneada (y ningún fuerte), la tarjeta no dice "Se abre": ruido. */
const OPENING_SHARE_DIVISOR = 4;
/** Bono por cada rival que ya se ve y al que le gana, según el nivel del counter. */
const BEATS_BONUS: Record<CounterLevel, number> = { hard: 3, medium: 2 };
/** Bono por combinar con el primer aliado que ya elegiste. */
const SYNERGY_BONUS = 3;
/** Bono por cada aliado ya elegido ADICIONAL con el que también combina (pick 3 mira a tus picks 1 y 2, y así). */
const SYNERGY_EXTRA_ALLY_BONUS = 1;
/** Cuántos aliados distintos cuentan para la sinergia: a partir de ahí no suma más (el tope general sigue mandando). */
const MAX_SYNERGY_ALLIES = 3;
/**
 * Bono por "robar" un counter de un pick tuyo (una sola vez, el mejor). Fuerte 4 > pareja 3 > medium 2: con una pareja se suman hasta el
 * tope (pareja + robo fuerte 7 -> 6, pareja + robo medium 5), así el orden es pareja+robo, robo fuerte, pareja sola, robo medium.
 * Magnitud de criterio, pendiente de calibrar.
 */
const STEAL_BONUS: Record<CounterLevel, number> = { hard: 4, medium: 2 };
/**
 * Partidas mínimas (en alto MMR) para que un héroe cuente como robo: un counter de nicho que casi nadie juega no es amenaza real.
 * Magnitud de criterio, pendiente de calibrar (con el archivo real deja sin robo a ~1 de cada 6 héroes, los menos jugados).
 */
const STEAL_MIN_GAMES = 1500;
/** Una razón de la base que solo dice a quién se lo atribuye ("Lo dicen: DotaCoach (7.41f)") no cuenta como razón de Dota. */
const UNREASONED_PREFIX = "Lo dicen";
/**
 * ¿La razón curada de una relación (`why`) dice un PORQUÉ de Dota? Una que solo atribuye la fuente ("Lo dicen: DotaCoach (7.41f)") o que
 * viene vacía no es un fundamento verificable: no habilita una recomendación ni se muestra como razón (contrato de evidencia, 2026-11-03).
 */
export function isReasonedWhy(why: string): boolean {
  const trimmed = why.trim();
  return trimmed.length > 0 && !trimmed.startsWith(UNREASONED_PREFIX);
}
const REASONED_COUNTERS_CACHE = new WeakMap<object, ReadonlyMap<HeroId, readonly CuratedCounter[]>>();
const REASONED_SYNERGIES_CACHE = new WeakMap<object, ReadonlyMap<HeroId, readonly CuratedSynergy[]>>();

/**
 * Los counters curados SIN las atribuciones "Lo dicen: …": lo que el Coach le muestra al jugador (riesgos, ventana de counter, Safe Core) tiene que
 * traer un porqué verificable (contrato de elegibilidad, 2026-11-04). NO toca V6 ni el bono de orden: solo lo que se MUESTRA o se usa como razón.
 */
export function reasonedCounters(counters: ReadonlyMap<HeroId, readonly CuratedCounter[]> | undefined): ReadonlyMap<HeroId, readonly CuratedCounter[]> | undefined {
  if (!counters) return undefined;
  const cached = REASONED_COUNTERS_CACHE.get(counters);
  if (cached) return cached;
  const filtered = new Map<HeroId, readonly CuratedCounter[]>();
  for (const [victim, entries] of counters) {
    const kept = entries.filter((entry) => isReasonedWhy(entry.why));
    if (kept.length > 0) filtered.set(victim, kept);
  }
  REASONED_COUNTERS_CACHE.set(counters, filtered);
  return filtered;
}

/** Las parejas curadas SIN las atribuciones "Lo dicen: …" (misma regla que `reasonedCounters`). */
export function reasonedSynergies(synergies: ReadonlyMap<HeroId, readonly CuratedSynergy[]> | undefined): ReadonlyMap<HeroId, readonly CuratedSynergy[]> | undefined {
  if (!synergies) return undefined;
  const cached = REASONED_SYNERGIES_CACHE.get(synergies);
  if (cached) return cached;
  const filtered = new Map<HeroId, readonly CuratedSynergy[]>();
  for (const [hero, entries] of synergies) {
    const kept = entries.filter((entry) => isReasonedWhy(entry.why));
    if (kept.length > 0) filtered.set(hero, kept);
  }
  REASONED_SYNERGIES_CACHE.set(synergies, filtered);
  return filtered;
}
/** Un robo que protege a dos picks tuyos se muestra una sola vez nombrando hasta este número. */
const MAX_STEALS_LISTED = 2;
/** Tope del bono positivo en la escala de V6 (0-100): el contexto sube a héroes parejos, nunca pisa diferencias grandes. */
const MAX_CONTEXT_BONUS = 6;
/** Baja por cada counter YA revelado: [se cruzan en línea, no se cruzan]. Fuerte baja mucho, medium poco. */
const REVEALED_COUNTER_PENALTY: Record<CounterLevel, readonly [number, number]> = { hard: [12, 6], medium: [4, 2] };
/**
 * Si un aliado que ya elegiste counterea a ese counter revelado, SU baja se divide por esto (solo la de ese counter).
 * Magnitud de criterio, pendiente de calibrar; qué otros rescates existen (ítems) se investiga con fuentes.
 */
const ALLY_ANSWER_DIVISOR = 2;
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

/** Aliados ya elegidos que le ganan a este rival (están en su lista de counters curados). Pura. */
export function alliesAnswering(enemy: HeroId, input: Pick<ContextReorderInput, "ownPicks" | "heroCounters">): CounterNote[] {
  return (input.heroCounters?.get(enemy) ?? [])
    .filter((entry) => input.ownPicks.has(entry.vs))
    .map((entry): CounterNote => ({ heroId: entry.vs, level: entry.level }))
    .sort(byLevelThenId);
}

/** Un pick tuyo ya elegido al que este héroe le quita un counter, con el porqué curado (sin punto final). */
export interface StealNote {
  protectsHeroId: HeroId;
  level: CounterLevel;
  why: string;
}

/** ¿Se juega de verdad? Partidas suficientes y, si ya sabes la posición que eliges, que la juegue en al menos 1/4 de sus partidas. */
function isPlayedEnoughToSteal(heroId: HeroId, input: Pick<ContextReorderInput, "heroPositions" | "targetPosition">): boolean {
  const shares = input.heroPositions?.[heroId] ?? [];
  const total = shares.reduce((sum, entry) => sum + entry.matches, 0);
  if (total < STEAL_MIN_GAMES) return false;
  if (input.targetPosition === undefined) return true;
  return shares.some((entry) => entry.position === input.targetPosition && entry.matches * LANE_SHARE_DIVISOR >= total);
}

/**
 * A qué picks TUYOS ya elegidos les quita este héroe un counter si lo eliges tú (fuertes primero, hasta MAX_STEALS_LISTED). Vacío si
 * ya no está libre, si un rival ya revelado lo counterea (el robo no tapa ese riesgo), si no se juega lo suficiente o si la razón de
 * la base es solo "Lo dicen: …". Solo hechos de lo que se ve. Pura.
 */
export function stealsOf(heroId: HeroId, input: ContextReorderInput): StealNote[] {
  if (input.ownPicks.size === 0) return []; // ronda 1: no hay a quién proteger (y se evita el cálculo)
  if (!isFree(heroId, input) || !isPlayedEnoughToSteal(heroId, input) || revealedCounterPenalty(heroId, input) > 0) return [];
  const notes: StealNote[] = [];
  for (const own of input.ownPicks) {
    const entry = (input.heroCounters?.get(own) ?? []).find((counter) => counter.vs === heroId);
    if (!entry || entry.why.trim().startsWith(UNREASONED_PREFIX)) continue;
    notes.push({ protectsHeroId: own, level: entry.level, why: entry.why.trim().replace(/[.\s]+$/, "") });
  }
  return notes.sort((a, b) => LEVEL_WEIGHT[b.level] - LEVEL_WEIGHT[a.level] || a.protectsHeroId - b.protectsHeroId).slice(0, MAX_STEALS_LISTED);
}

/** Cuánto baja el héroe por los counters que el rival YA tiene (0 sin ninguno). Pura. */
export function revealedCounterPenalty(heroId: HeroId, input: ContextReorderInput): number {
  let penalty = 0;
  for (const entry of input.heroCounters?.get(heroId) ?? []) {
    if (!input.revealedEnemies.has(entry.vs)) continue;
    const [crossing, elsewhere] = REVEALED_COUNTER_PENALTY[entry.level];
    const base = crossesInLane(entry.vs, input) ? crossing : elsewhere;
    penalty += alliesAnswering(entry.vs, input).length > 0 ? base / ALLY_ANSWER_DIVISOR : base;
  }
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
  // La sinergia sube con cuántos de tus picks ya elegidos combinan con el héroe (el primero +3, cada otro con razón +1, hasta 3
  // aliados) y solo si no hay un counter revelado: no tapa a un counter (un Axe en tu línea no se compensa con una pareja).
  // Los escalones extra cuentan solo parejas con razón de Dota: una que dice únicamente "Lo dicen: …" es atribución, no razón.
  const pairs = synergiesWithOwn(heroId, input);
  const reasonedPartners = new Set(pairs.filter((synergy) => !synergy.why.trim().startsWith(UNREASONED_PREFIX)).map((synergy) => synergy.with)).size;
  const extraAllies = Math.max(0, Math.min(reasonedPartners, MAX_SYNERGY_ALLIES) - 1);
  if (pairs.length > 0 && penalty === 0) bonus += SYNERGY_BONUS + SYNERGY_EXTRA_ALLY_BONUS * extraAllies;
  // El robo: una sola vez, el mejor (las notas vienen con el fuerte primero). `stealsOf` ya calla si hay un counter rival revelado.
  const [bestSteal] = stealsOf(heroId, input);
  if (bestSteal) bonus += STEAL_BONUS[bestSteal.level];
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
