import type { HeroId } from "../draft-protocol/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";

// Decisión de producto (2026-10-29, el usuario): las sugerencias de cada posición ROTAN según lo que se ve del draft.
//   - Ronda 1 (a ciegas, ningún rival a la vista): los bans abren héroes. Cuentan TODOS los counters del héroe, los
//     fuertes pesan el doble; es una suma, no un combo.
//   - Rondas 2 y 3 (ya hay rivales a la vista): suben los que le ganan a lo que el rival YA tiene y los que combinan con
//     los aliados que YA elegiste; bajan los que un rival revelado counterea. Los bans ya no cuentan.
//
// Ajustes tras la revisión del breaker (2026-10-30), dentro de esa regla. Las magnitudes (tope, bonos) son parámetros de
// producto elegidos a criterio, NO salen de datos: pendientes de calibrar con drafts profesionales.
//   - El contexto DESEMPATA, no pisa a V6: es un bono en la escala del puntaje de V6, con tope (MAX_CONTEXT_BONUS). V6 da
//     ~6 héroes por posición; un salto por lugares terminaba pisando diferencias de 20 puntos con tres bans medium.
//   - La apertura por bans es la FRACCIÓN de la lista de counters que quedó baneada (denominador mínimo), no el total:
//     contar el total premiaba a los héroes con listas largas (Ember, 22 counters medium) y no a los que de verdad se abrían.
//   - Una sinergia suma una sola vez, aunque haya varias parejas.
// Sin counters ni sinergias que toquen a nadie, el orden es EXACTAMENTE el de V6. Función pura: sin I/O, reloj ni azar.

export type CounterLevel = "hard" | "medium";

/** Un héroe que counterea al candidato (o al que el candidato le gana), con su nivel. */
export interface CounterNote {
  heroId: HeroId;
  level: CounterLevel;
}

/**
 * Lo que la tarjeta dice de los bans en la ronda 1. Vacío fuera de la ronda 1 o cuando los bans no abrieron casi nada.
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
  /** Héroes del rival que ya se ven. Vacío = ronda 1, a ciegas. */
  revealedEnemies: ReadonlySet<HeroId>;
  /** victim -> quién la counterea (el formato de hero-counters.json). */
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  /** héroe -> sus parejas curadas. Ausente = ninguna (el llamador de producción inyecta el archivo real). */
  heroSynergies?: ReadonlyMap<HeroId, readonly CuratedSynergy[]>;
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
/** Penalización por cada rival revelado que lo counterea medium (el fuerte ya lo manda al fondo RB-4). */
const REVEALED_MEDIUM_PENALTY = 3;
/** Bono por combinar con algún aliado que ya elegiste (una sola vez). */
const SYNERGY_BONUS = 3;
/** Tope del bono en la escala de V6 (0-100): el contexto mueve a héroes parejos, nunca pisa diferencias grandes. */
const MAX_CONTEXT_BONUS = 6;
const MAX_LISTED = 3;

const NO_SYNERGIES: ReadonlyMap<HeroId, readonly CuratedSynergy[]> = new Map();

function byLevelThenId(a: CounterNote, b: CounterNote): number {
  return LEVEL_WEIGHT[b.level] - LEVEL_WEIGHT[a.level] || a.heroId - b.heroId;
}

function isBlind(input: Pick<ContextReorderInput, "revealedEnemies">): boolean {
  return input.revealedEnemies.size === 0;
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

function hasHardCounterFree(heroId: HeroId, input: Pick<ContextReorderInput, "banned" | "ownPicks" | "heroCounters">): boolean {
  return (input.heroCounters?.get(heroId) ?? []).some((entry) => entry.level === "hard" && !input.banned.has(entry.vs) && !input.ownPicks.has(entry.vs));
}

/** Lo que la tarjeta dice de los bans (ver `BanOpening`). Pura. */
export function banOpeningOf(heroId: HeroId, input: Pick<ContextReorderInput, "banned" | "ownPicks" | "revealedEnemies" | "heroCounters">): BanOpening {
  const none: BanOpening = { openedBy: [], stillFree: [] };
  if (!isBlind(input)) return none;
  const entries = input.heroCounters?.get(heroId) ?? [];
  const openedBy = entries.filter((entry) => input.banned.has(entry.vs)).map((entry): CounterNote => ({ heroId: entry.vs, level: entry.level }));
  const free = entries.filter((entry) => !input.banned.has(entry.vs) && !input.ownPicks.has(entry.vs)).map((entry): CounterNote => ({ heroId: entry.vs, level: entry.level }));
  const meaningful = openedBy.some((note) => note.level === "hard") || banFraction(heroId, input) * OPENING_SHARE_DIVISOR >= 1;
  if (!meaningful) return none;
  const hardFree = free.filter((note) => note.level === "hard");
  if (hardFree.length > 0) return { openedBy: [], stillFree: hardFree.sort(byLevelThenId).slice(0, MAX_LISTED) };
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

/** Bono de contexto en la escala del puntaje de V6, acotado a ±MAX_CONTEXT_BONUS. 0 = V6 manda sin tocar. */
export function contextBonus(heroId: HeroId, input: ContextReorderInput): number {
  let bonus = 0;
  if (isBlind(input)) {
    // Con un counter FUERTE libre los bans no lo suben: la tarjeta dice "Ojo: X lo counterea fuerte", y el orden dice lo mismo.
    if (!hasHardCounterFree(heroId, input)) bonus += MAX_BAN_BONUS * banFraction(heroId, input);
  } else {
    for (const beaten of beatsRevealed(heroId, input)) bonus += BEATS_BONUS[beaten.level];
    for (const entry of input.heroCounters?.get(heroId) ?? []) {
      if (entry.level === "medium" && input.revealedEnemies.has(entry.vs)) bonus -= REVEALED_MEDIUM_PENALTY;
    }
  }
  if (synergiesWithOwn(heroId, input).length > 0) bonus += SYNERGY_BONUS;
  return Math.max(-MAX_CONTEXT_BONUS, Math.min(MAX_CONTEXT_BONUS, bonus));
}

/**
 * Reordena por puntaje de V6 + bono de contexto. Estable: a igualdad gana el que ya iba primero en V6. Como el bono tiene
 * tope, un héroe solo pasa a otro que V6 tenía a menos de MAX_CONTEXT_BONUS puntos. Sin bono para nadie -> el mismo orden.
 */
export function reorderByContext<T extends { heroId: HeroId; score: number }>(candidates: readonly T[], input: ContextReorderInput): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, effective: candidate.score + contextBonus(candidate.heroId, input) }))
    .sort((a, b) => b.effective - a.effective || a.index - b.index)
    .map((entry) => entry.candidate);
}
