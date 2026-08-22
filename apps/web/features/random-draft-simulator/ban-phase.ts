// apps/web/features/random-draft-simulator/ban-phase.ts
// BanPhaseResolver: resuelve los 16 bans automáticos del Random Draft Simulator.
// Algoritmo: 50% prob. por héroe personal → relleno desde metaBanPool → fallback aleatorio.
// Requirements: 2.2, 2.3, 2.4, 2.5

import type { HeroId } from "./types";
import type { SeededRng } from "./seeded-rng";

// ---------------------------------------------------------------------------
// Interfaces públicas
// ---------------------------------------------------------------------------

export interface BanPhaseInput {
  /** 0-4 héroes configurados por el usuario */
  personalBanList: HeroId[];
  /** Héroes ordenados por tasa de ban descendente en el bracket activo */
  metaBanPool: HeroId[];
  /** Todos los héroes disponibles en el meta (usado como fallback) */
  allHeroIds: HeroId[];
  /** Generador pseudo-aleatorio determinístico derivado del draftSeed */
  rng: SeededRng;
}

export interface BanPhaseResult {
  /**
   * Héroes baneados resueltos — exactamente 16 si hay suficientes héroes únicos,
   * o menos si el pool total es insuficiente (Req. 2.5).
   * El lado alterna: índice 0 → Radiant, 1 → Dire, 2 → Radiant, ... (Req. 2.4)
   */
  resolvedBans: HeroId[];
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TARGET_BAN_COUNT = 16;
const LOG_PREFIX = "[Ban_Phase]";

// ---------------------------------------------------------------------------
// Implementación pública
// ---------------------------------------------------------------------------

/**
 * Resuelve la Ban_Phase determinística del Random Draft Simulator.
 *
 * Pasos (Req. 2.2, 2.3):
 * 1. Evalúa cada héroe de `personalBanList` con 50% de probabilidad (usando rng).
 * 2. Rellena hasta 16 con `metaBanPool` en orden descendente de ban rate, sin repetir.
 * 3. Si aún faltan bans y metaBanPool se agotó, toma del resto de `allHeroIds` aleatoriamente.
 * 4. Trunca al máximo de 16.
 * 5. Si hay menos de 16 héroes únicos disponibles en total, registra el mensaje exacto (Req. 2.5).
 *
 * La salida no contiene duplicados (Req. 2.3).
 * El orden alternado Radiant/Dire se deriva del índice de posición (Req. 2.4).
 */
export function resolveBanPhase(input: BanPhaseInput): BanPhaseResult {
  const { personalBanList, metaBanPool, allHeroIds, rng } = input;

  const banned = new Set<HeroId>();
  const result: HeroId[] = [];

  function tryAddBan(heroId: HeroId): void {
    if (result.length >= TARGET_BAN_COUNT) return;
    if (banned.has(heroId)) return;
    banned.add(heroId);
    result.push(heroId);
  }

  // Paso 1: Personal ban list — cada héroe tiene 50% de probabilidad (Req. 2.2)
  for (const heroId of personalBanList) {
    if (result.length >= TARGET_BAN_COUNT) break;
    if (rng.chance(0.5)) {
      tryAddBan(heroId);
    }
  }

  // Paso 2: Rellenar desde metaBanPool en orden (ya ordenado desc por ban rate) (Req. 2.3)
  for (const heroId of metaBanPool) {
    if (result.length >= TARGET_BAN_COUNT) break;
    tryAddBan(heroId);
  }

  // Paso 3: Fallback aleatorio desde allHeroIds (excluye ya baneados y metaBanPool) (Req. 2.3)
  if (result.length < TARGET_BAN_COUNT) {
    const metaSet = new Set<HeroId>(metaBanPool);
    const fallbackPool = allHeroIds.filter(
      (heroId) => !banned.has(heroId) && !metaSet.has(heroId),
    );

    // Mezclar el fallback pool para aleatoriedad determinística
    rng.shuffle(fallbackPool);

    for (const heroId of fallbackPool) {
      if (result.length >= TARGET_BAN_COUNT) break;
      tryAddBan(heroId);
    }
  }

  // Paso 4: Truncar al límite (ya garantizado por las guardas anteriores)
  const resolvedBans = result.slice(0, TARGET_BAN_COUNT);

  // Paso 5: Registrar en consola si no se alcanzaron los 16 bans esperados (Req. 2.5)
  if (resolvedBans.length < TARGET_BAN_COUNT) {
    console.log(
      `${LOG_PREFIX} bans emitidos: ${resolvedBans.length} de ${TARGET_BAN_COUNT} esperados`,
    );
  }

  return { resolvedBans };
}
