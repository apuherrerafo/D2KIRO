import type { Position } from "../draft-protocol/roles/role-belief";
import type { HeroId } from "../draft-protocol/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { isPlayedEnoughToSteal, isReasonedWhy } from "./context-reorder";

// ADVERTIR (PO, 2026-11-05): "Amenazas libres a tus picks". Una amenaza libre es un counter FUERTE y con porqué (relación curada `hard`,
// nunca `medium`, nunca "Lo dicen: …") contra un héroe que YA elegiste, que todavía nadie eligió ni baneó. Solo informa: no entra al puntaje,
// al ranking, a las cinco tarjetas ni a "ELIGE AHORA" (el Robo, que sí mueve el orden, sigue en context-reorder.ts sin cambios).
//
// Qué dice de cada amenaza:
//   - a quién amenaza (un pick tuyo visible), cuál es el counter y el porqué curado (el mecanismo que se puede comprobar);
//   - `stealPositions`: en qué posiciones por llenar de tu equipo ese héroe se juega de verdad (mismo criterio de POSICIÓN que el Robo: partidas
//     suficientes y al menos 1/4 de ellas en esa posición). Vacío = ninguna posición libre TUYA encaja con él (o no hay datos de posición).
//     "Posiciones tuyas" = las columnas del tablero (las que controla el jugador): los asientos de un compañero o un bot no cuentan. No es
//     idéntico al Robo del ranking: éste además descarta al héroe si un rival ya revelado lo counterea; aquí solo se mira legalidad y posición.
// Solo lee lo que el jugador VE (picks propios visibles, bans, rivales revelados): un asiento rival sellado nunca entra. Pura: sin I/O.

export interface FreeThreat {
  /** El pick tuyo que amenaza. */
  ownHeroId: HeroId;
  /** El counter fuerte que sigue libre. */
  threatHeroId: HeroId;
  /** El porqué curado de Dota (sin punto final). */
  why: string;
  /** Posiciones por llenar de tu equipo donde ese héroe se puede robar legalmente. Vacío = no se puede robar. */
  stealPositions: Position[];
}

export interface FreeThreatsInput {
  banned: ReadonlySet<HeroId>;
  /** Tus picks ya elegidos y visibles. */
  ownPicks: ReadonlySet<HeroId>;
  /** Rivales ya revelados (un counter que el rival ya tiene ya no es "libre": es otro aviso). */
  revealedEnemies: ReadonlySet<HeroId>;
  /** victim -> quién la counterea (el formato de hero-counters.json). */
  heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]> | undefined;
  heroPositions: HeroPositions | undefined;
  /** Posiciones de tu equipo que todavía no tienen héroe. */
  unfilledPositions: readonly Position[];
}

/**
 * Las amenazas libres, robables primero (lo que todavía puedes resolver), luego por pick amenazado y por counter: el orden es determinista. Un mismo
 * counter que amenaza a dos picks tuyos aparece una vez por pick (cada uno con su porqué).
 */
export function freeThreatsOf(input: FreeThreatsInput): FreeThreat[] {
  if (!input.heroCounters || input.ownPicks.size === 0) return [];
  const threats: FreeThreat[] = [];
  for (const own of input.ownPicks) {
    for (const entry of input.heroCounters.get(own) ?? []) {
      if (entry.level !== "hard" || !isReasonedWhy(entry.why)) continue;
      const free = !input.banned.has(entry.vs) && !input.ownPicks.has(entry.vs) && !input.revealedEnemies.has(entry.vs);
      if (!free) continue;
      const stealPositions = [...input.unfilledPositions]
        .sort((a, b) => a - b)
        .filter((position) => isPlayedEnoughToSteal(entry.vs, { heroPositions: input.heroPositions, targetPosition: position }));
      threats.push({ ownHeroId: own, threatHeroId: entry.vs, why: entry.why.trim().replace(/[.\s]+$/, ""), stealPositions });
    }
  }
  const stealable = (threat: FreeThreat): number => (threat.stealPositions.length > 0 ? 0 : 1);
  return threats.sort((a, b) => stealable(a) - stealable(b) || a.ownHeroId - b.ownHeroId || a.threatHeroId - b.threatHeroId);
}
