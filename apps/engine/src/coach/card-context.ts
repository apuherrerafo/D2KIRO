import type { HeroId } from "../draft-protocol/types";
import type { CuratedCounter } from "../signals/hero-counters";
import { banOpeningOf, synergiesWithOwn, type BanOpening, type ContextReorderInput } from "./context-reorder";

// Lo que una tarjeta de héroe cuenta DEL DRAFT VISIBLE, con una sola fuente para el tablero del equipo y la lista del simulador
// (antes la lista solo recibía una frase y el tablero armaba esto aparte, así que dos pantallas decían razones distintas del mismo
// héroe). Solo hechos: qué abrieron los bans, a quién de lo ya revelado le gana, con qué aliado ya elegido combina. Nunca se supone
// lo que el rival va a sacar. Pura: sin I/O.

export const MAX_STRENGTHS_PER_CANDIDATE = 3;
export const MAX_SYNERGIES_PER_CANDIDATE = 2;

/** A hero this candidate beats according to the curated data, with the curated reason (`why`). Never invented. */
export interface TeamCoachStrength {
  vsHeroId: HeroId;
  level: "hard" | "medium";
  why: string;
  /** True only when that enemy is already visible to the Player; otherwise it is a "what if they pick it" note. */
  revealed: boolean;
}

/** A partner already on the Player's team and the curated reason the pair works. */
export interface TeamCoachSynergy {
  withHeroId: HeroId;
  why: string;
}

/** counterer -> the heroes it beats, built once per board from the curated counters (victim -> who counters it). */
export function strengthIndexOf(heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]> | undefined): Map<HeroId, TeamCoachStrength[]> {
  const index = new Map<HeroId, TeamCoachStrength[]>();
  if (!heroCounters) return index;
  for (const [victim, entries] of heroCounters) {
    for (const entry of entries) {
      const list = index.get(entry.vs) ?? [];
      list.push({ vsHeroId: victim, level: entry.level, why: entry.why.trim().replace(/[.\s]+$/, ""), revealed: false });
      index.set(entry.vs, list);
    }
  }
  return index;
}

/**
 * Whom this hero beats among the enemies the Player can ALREADY see (hard before medium, stable by hero id). An enemy
 * that is not revealed is never offered: saying who it beats before anyone picked it is a guess (user, 2026-10-29).
 */
export function strengthsOf(heroId: HeroId, index: ReadonlyMap<HeroId, readonly TeamCoachStrength[]>, excluded: ReadonlySet<HeroId>, revealedEnemies: ReadonlySet<HeroId> = new Set()): TeamCoachStrength[] {
  // Solo lo que el rival YA tiene: contar contra quién gana sobre algo que nadie ha sacado es suponer (decisión del usuario).
  const usable = (index.get(heroId) ?? []).filter((entry) => !excluded.has(entry.vsHeroId) && revealedEnemies.has(entry.vsHeroId)).map((entry) => ({ ...entry, revealed: true }));
  const rank = (entry: TeamCoachStrength): number => (entry.level === "hard" ? 0 : 1);
  return usable.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_STRENGTHS_PER_CANDIDATE);
}

export interface CardContext {
  /** What the visible bans opened for this hero (its banned counters) and the risk that stays (counters still free). */
  opening: BanOpening;
  /** Heroes this candidate beats among the REVEALED enemies (curated, hard first, at most 3). */
  strengths: TeamCoachStrength[];
  /** Curated partners among the heroes the Player's team ALREADY picked (never a hypothetical ally). */
  synergies: TeamCoachSynergy[];
}

// El índice depende solo del archivo de counters (una instancia por proceso): se arma una vez por Map, no por tarjeta.
const STRENGTH_INDEX_CACHE = new WeakMap<object, Map<HeroId, TeamCoachStrength[]>>();

function cachedStrengthIndex(heroCounters: ContextReorderInput["heroCounters"]): Map<HeroId, TeamCoachStrength[]> {
  if (!heroCounters) return strengthIndexOf(undefined);
  const cached = STRENGTH_INDEX_CACHE.get(heroCounters);
  if (cached) return cached;
  const built = strengthIndexOf(heroCounters);
  STRENGTH_INDEX_CACHE.set(heroCounters, built);
  return built;
}

export function cardContextOf(heroId: HeroId, input: ContextReorderInput): CardContext {
  const cannotBeEnemy = new Set<HeroId>([...input.banned, ...input.ownPicks]);
  return {
    opening: banOpeningOf(heroId, input),
    strengths: strengthsOf(heroId, cachedStrengthIndex(input.heroCounters), cannotBeEnemy, input.revealedEnemies),
    synergies: synergiesWithOwn(heroId, input).slice(0, MAX_SYNERGIES_PER_CANDIDATE).map((synergy) => ({ withHeroId: synergy.with, why: synergy.why.trim().replace(/[.\s]+$/, "") })),
  };
}

/** ¿La tarjeta trae al menos una razón real del draft? (la frase de solo posición se calla cuando sí.) */
export function hasCardContext(context: CardContext): boolean {
  return context.strengths.length > 0 || context.opening.openedBy.length > 0 || context.synergies.length > 0;
}
