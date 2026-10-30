import type { HeroId } from "../draft-protocol/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";

// Decisión de producto (2026-10-29, el usuario): las sugerencias de cada posición ROTAN según lo que se ve del draft.
//   - Ronda 1 (a ciegas): los bans abren héroes. Si Axe, Lion y Ancient Apparition (que counterean a Morphling) están
//     baneados, Morphling se abre. Cuentan TODOS los counters baneados de un héroe, con los fuertes pesando más; no es
//     un combo, es una suma.
//   - Rondas 2 y 3: suben los héroes que le ganan a lo que YA salió en el rival y los que combinan con los aliados que
//     YA elegiste (solo esos).
//
// Es un reordenamiento por saltos acotados sobre el orden de V6, no un puntaje nuevo: V6 sigue siendo quien puntúa.
// Sin counters ni sinergias curados, o sin bans/picks que tocar, el orden es EXACTAMENTE el de V6 (candado de regresión).
// Función pura: sin I/O, sin reloj, sin azar.

export type CounterLevel = "hard" | "medium";

/** Un héroe que counterea al candidato (o al que el candidato le gana), con su nivel. */
export interface CounterNote {
  heroId: HeroId;
  level: CounterLevel;
}

export interface BanOpening {
  /** Counters del candidato que están baneados: lo que "se abrió". Fuertes primero. */
  openedBy: CounterNote[];
  /** Counters del candidato que siguen libres (no baneados, no tuyos, no ya revelados): el riesgo que queda a ciegas. */
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
}

const LEVEL_WEIGHT: Record<CounterLevel, number> = { hard: 2, medium: 1 };
/** Un hecho del draft (el rival YA lo tiene) vale el doble que un ban: es lo que de verdad vas a enfrentar. */
const REVEALED_FACTOR = 2;
const SYNERGY_POINTS = 2;
/** Cuántos lugares sube un héroe por punto, y el tope: ningún contexto saca a un héroe lejano de V6 al primer lugar. */
const JUMP_PER_POINT = 2;
const MAX_JUMP = 20;
const MAX_LISTED = 3;

const NO_SYNERGIES: ReadonlyMap<HeroId, readonly CuratedSynergy[]> = new Map();

function byLevelThenId(a: CounterNote, b: CounterNote): number {
  return LEVEL_WEIGHT[b.level] - LEVEL_WEIGHT[a.level] || a.heroId - b.heroId;
}

/** Qué se abrió por los bans y qué riesgo queda. Pura. Solo para mostrar: el puntaje sale de `contextPoints`. */
export function banOpeningOf(heroId: HeroId, input: Pick<ContextReorderInput, "banned" | "ownPicks" | "revealedEnemies" | "heroCounters">): BanOpening {
  const openedBy: CounterNote[] = [];
  const stillFree: CounterNote[] = [];
  for (const entry of input.heroCounters?.get(heroId) ?? []) {
    const note: CounterNote = { heroId: entry.vs, level: entry.level };
    if (input.banned.has(entry.vs)) openedBy.push(note);
    else if (!input.ownPicks.has(entry.vs) && !input.revealedEnemies.has(entry.vs)) stillFree.push(note);
  }
  return { openedBy: openedBy.sort(byLevelThenId).slice(0, MAX_LISTED), stillFree: stillFree.sort(byLevelThenId).slice(0, MAX_LISTED) };
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

/** Puntos de contexto de un héroe: 0 = V6 manda sin tocar. */
export function contextPoints(heroId: HeroId, input: ContextReorderInput): number {
  let points = 0;
  // `banOpeningOf` corta la lista para mostrarla; el puntaje cuenta TODOS los counters baneados.
  for (const entry of input.heroCounters?.get(heroId) ?? []) if (input.banned.has(entry.vs)) points += LEVEL_WEIGHT[entry.level];
  for (const beaten of beatsRevealed(heroId, input)) points += LEVEL_WEIGHT[beaten.level] * REVEALED_FACTOR;
  points += synergiesWithOwn(heroId, input).length * SYNERGY_POINTS;
  return points;
}

/**
 * Reordena por saltos acotados: cada héroe sube `min(MAX_JUMP, puntos × JUMP_PER_POINT)` lugares sobre su lugar en V6.
 * Estable: a igualdad de lugar efectivo gana el que ya iba primero en V6. Sin puntos para nadie -> el mismo orden.
 */
export function reorderByContext<T extends { heroId: HeroId }>(candidates: readonly T[], input: ContextReorderInput): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, effective: index - Math.min(MAX_JUMP, contextPoints(candidate.heroId, input) * JUMP_PER_POINT) }))
    .sort((a, b) => a.effective - b.effective || a.index - b.index)
    .map((entry) => entry.candidate);
}
