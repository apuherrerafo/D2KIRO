// apps/web/features/random-draft-simulator/meta-loader.ts
// Carga el MetaSnapshot que necesitan BotDrafter/BanPhaseResolver: catálogo de héroes
// (GET /api/heroes, ya usado por use-hero-catalog.ts) + patchStats (GET /api/meta/hero-stats,
// endpoint de solo lectura agregado al motor para esta feature -- ver tasks.md, Notes).
// No es camino caliente: se llama una sola vez al arrancar una Draft_Session, nunca durante un
// pick individual.

import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";
import type { HeroId } from "./types";
import type { HeroPatchStat, HeroPositions, MetaHeroEntry, MetaSnapshot } from "./bot-drafter";
import { dominantNonEmptyPatch, statsInPatch } from "./patch-scope";

interface RawHero {
  id: number;
  localizedName: string;
  roles: string[];
}

interface HeroStatsResponse {
  patchStats: Record<string, HeroPatchStat[]>;
  // TSK-063: agregado a la misma respuesta -- ausente se trata como "sin dato de posición para
  // ningún héroe" (heroPositions: {}), nunca rompe la carga del meta.
  heroPositions?: HeroPositions;
  // Parche vigente según el motor (aditivo; ausente en motores viejos -> se usa el dominante).
  currentPatch?: string;
}

export interface LoadedMeta {
  meta: MetaSnapshot;
  allHeroIds: HeroId[];
  /** Héroes ordenados por picks totales desc -- proxy de tasa de ban (ver Notas en tasks.md: no
   *  existe dato de ban rate en el proyecto). */
  metaBanPool: HeroId[];
  /** Patch más frecuente entre las filas de patchStats -- no hay endpoint de "patch actual" en
   *  el motor; "unknown" si no hay ninguna fila (sin sincronizar todavía). */
  currentPatch: string;
}

/** Picks de UN solo parche: nunca se suman parches distintos (restos con patch "" de una sync vieja). */
function totalPicks(stats: HeroPatchStat[] | undefined, patch: string): number {
  return statsInPatch(stats, patch).reduce((sum, entry) => sum + entry.picks, 0);
}

function detectCurrentPatch(patchStats: Record<HeroId, HeroPatchStat[]>, preferred?: string): string {
  // Un patch vacío (restos de la sync antigua) nunca es un parche real; criterio único en patch-scope.ts.
  return dominantNonEmptyPatch(patchStats, preferred) ?? "unknown";
}

/** Carga heroes + patchStats del motor y arma el MetaSnapshot + metaBanPool que necesita `initDraft`. */
export async function loadMetaSnapshot(): Promise<LoadedMeta> {
  const [heroesRes, statsRes] = await Promise.all([
    fetch(`${ENGINE_HTTP_BASE_URL}/api/heroes`),
    fetch(`${ENGINE_HTTP_BASE_URL}/api/meta/hero-stats`),
  ]);

  const rawHeroes = (await heroesRes.json()) as RawHero[];
  const { patchStats, heroPositions, currentPatch: enginePatch } = (await statsRes.json()) as HeroStatsResponse;

  const heroes: Record<HeroId, MetaHeroEntry> = {};
  const allHeroIds: HeroId[] = [];

  for (const hero of rawHeroes) {
    heroes[hero.id] = { id: hero.id, localizedName: hero.localizedName, roles: hero.roles };
    allHeroIds.push(hero.id);
  }

  const normalizedPatchStats: Record<HeroId, HeroPatchStat[]> = {};
  for (const [heroIdStr, stats] of Object.entries(patchStats)) {
    normalizedPatchStats[Number(heroIdStr)] = stats;
  }

  const currentPatch = detectCurrentPatch(normalizedPatchStats, typeof enginePatch === "string" ? enginePatch : undefined);
  const metaBanPool = allHeroIds
    .slice()
    .sort((a, b) => totalPicks(normalizedPatchStats[b], currentPatch) - totalPicks(normalizedPatchStats[a], currentPatch));

  return {
    meta: { heroes, patchStats: normalizedPatchStats, currentPatch, heroPositions: heroPositions ?? {} },
    allHeroIds,
    metaBanPool,
    currentPatch,
  };
}
