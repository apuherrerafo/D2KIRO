// apps/web/features/random-draft-simulator/ban-list.ts
// Lógica pura de la Personal_Ban_List: agregar y quitar héroes.
// Req. 1.2, 1.3, 1.4, 1.6

import type { HeroId } from "./types";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const MAX_BAN_LIST_SIZE = 4;

// ---------------------------------------------------------------------------
// Tipos de retorno
// ---------------------------------------------------------------------------

export type AddHeroResult =
  | { ok: true; list: HeroId[] }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// addHeroToBanList (Req. 1.3, 1.4)
// ---------------------------------------------------------------------------

/**
 * Intenta agregar `heroId` a `list`.
 *
 * - Rechaza si el héroe ya está presente (Req. 1.3).
 * - Rechaza si la lista ya tiene 4 elementos (Req. 1.4).
 * - En ambos casos retorna `{ ok: false, reason }` y deja la lista sin cambios.
 * - Si la operación es válida retorna `{ ok: true, list: [...list, heroId] }`.
 */
export function addHeroToBanList(
  list: HeroId[],
  heroId: HeroId
): AddHeroResult {
  if (list.includes(heroId)) {
    return {
      ok: false,
      reason: `El héroe ${heroId} ya está en la lista de bans.`,
    };
  }

  if (list.length >= MAX_BAN_LIST_SIZE) {
    return {
      ok: false,
      reason: `La lista de bans ya tiene el máximo de ${MAX_BAN_LIST_SIZE} héroes.`,
    };
  }

  return { ok: true, list: [...list, heroId] };
}

// ---------------------------------------------------------------------------
// removeHeroFromBanList (Req. 1.6)
// ---------------------------------------------------------------------------

/**
 * Retorna la lista sin el `heroId` indicado.
 * No produce error si el héroe no existe en la lista.
 */
export function removeHeroFromBanList(list: HeroId[], heroId: HeroId): HeroId[] {
  return list.filter(function excludeHero(id) {
    return id !== heroId;
  });
}
