// apps/web/features/random-draft-simulator/bot-drafter.ts
// BotDrafter: scoring simplificado + selección de héroe para el bot enemigo.
// El objetivo es QA del motor, no ganar drafts — el scoring es deliberadamente simple.
// Requirements: 4.1, 4.2, 4.3

import type { DraftState } from "@/features/draft/types";
import type { HeroId, TeamSide } from "./types";
import type { SeededRng } from "./seeded-rng";

// ---------------------------------------------------------------------------
// Tipos locales de meta (espejo de apps/engine/src/signals/types.ts)
// ---------------------------------------------------------------------------

export interface HeroPatchStat {
  patch: string;
  bracket: string;
  picks: number;
  wins: number;
}

export interface MetaHeroEntry {
  id: HeroId;
  localizedName: string;
  roles?: string[];
}

// TSK-063 (hallazgo 2.4 de "Radiografía de dota2coach"): mismo shape que HeroPositionShare/
// HeroPositions en apps/engine/src/signals/hero-positions.ts -- espejo deliberado, documentado en
// engine.md junto con el resto de espejos de este archivo (ver TSK-062). Dato real de posición
// (Dota2ProTracker, umbral de 200 partidas), no roles[] de OpenDota.
export interface HeroPositionShare {
  position: 1 | 2 | 3 | 4 | 5;
  matches: number;
}

export type HeroPositions = Record<HeroId, HeroPositionShare[]>;

/** Subconjunto de MetaSnapshot del motor necesario para el scoring del bot. */
export interface MetaSnapshot {
  heroes: Record<HeroId, MetaHeroEntry>;
  patchStats?: Record<HeroId, HeroPatchStat[]>;
  heroPositions?: HeroPositions;
}

// ---------------------------------------------------------------------------
// Interfaces públicas
// ---------------------------------------------------------------------------

export interface BotDrafterInput {
  /** Estado visible del draft (sin picks ocultos del bot) */
  draftState: DraftState;
  /** Lado que juega el bot */
  botSide: TeamSide;
  /** Snapshot del meta con patchStats para scoring */
  meta: MetaSnapshot;
  /** Generador pseudo-aleatorio derivado del draftSeed */
  rng: SeededRng;
  /** Cuántos conflictos ya ocurrieron en esta ronda */
  conflictCount: number;
}

export interface BotDrafterResult {
  heroId: HeroId;
}

// ---------------------------------------------------------------------------
// Constantes internas
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[Bot_Drafter]";

// Bonus de score cuando el héroe complementa la posición dominante ya cubierta por el bot
const POSITION_COMPLEMENT_BONUS = 5;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Construye el conjunto de héroes no disponibles (baneados + pickeados por ambos lados). */
function buildUnavailableSet(draftState: DraftState): Set<HeroId> {
  const unavailable = new Set<HeroId>();
  for (const heroId of draftState.banned) {
    unavailable.add(heroId);
  }
  for (const heroId of draftState.picks.radiant) {
    unavailable.add(heroId);
  }
  for (const heroId of draftState.picks.dire) {
    unavailable.add(heroId);
  }
  return unavailable;
}

/** Devuelve los picks actuales del lado del bot. */
function getBotPicks(draftState: DraftState, botSide: TeamSide): HeroId[] {
  return botSide === "radiant" ? draftState.picks.radiant : draftState.picks.dire;
}

/**
 * Obtiene el pick rate total de un héroe sumando todos los brackets del patch más reciente.
 * Retorna 0 si no hay datos disponibles.
 */
function getPickRate(heroId: HeroId, meta: MetaSnapshot): number {
  const stats = meta.patchStats?.[heroId];
  if (!stats || stats.length === 0) return 0;

  let totalPicks = 0;
  let totalWins = 0;

  for (const stat of stats) {
    totalPicks += stat.picks;
    totalWins += stat.wins;
  }

  if (totalPicks === 0) return 0;
  // Score base: win rate ponderado por popularidad (picks/wins)
  return (totalWins / totalPicks) * Math.log1p(totalPicks);
}

/**
 * Posición dominante de un héroe -- la de mayor cantidad de partidas registradas. `null` si no
 * hay dato de posición para ese héroe (mismo criterio de degradación que position_fit: sin dato
 * real, no se puede afirmar nada, nunca se adivina).
 */
function dominantPosition(heroId: HeroId, heroPositions: HeroPositions): HeroPositionShare["position"] | null {
  const shares = heroPositions[heroId];
  if (!shares || shares.length === 0) return null;

  let best = shares[0]!;
  for (const share of shares) {
    if (share.matches > best.matches) best = share;
  }
  return best.position;
}

/**
 * Determina si el héroe candidato complementa la posición dominante de los picks ya hechos por
 * el bot. Reemplaza el criterio anterior basado en `roles[]` de OpenDota (TSK-063, hallazgo 2.4
 * de "Radiografía de dota2coach") -- esas etiquetas temáticas no son posiciones reales (57% de
 * los héroes marcados "Carry"), lo que dejaba pasar composiciones inválidas como doble carry.
 * Usa `heroPositions` (mismo dato curado que ya usa `position_fit` en el motor real), nunca
 * `roles[]`. Sin dato de posición para el candidato, no hay base para afirmar que complementa
 * -- degrada a `false`, mismo comportamiento que el criterio anterior tenía sin roles.
 */
function complementsBotPositions(
  heroId: HeroId,
  botPicks: HeroId[],
  meta: MetaSnapshot,
): boolean {
  const heroPositions = meta.heroPositions ?? {};
  const candidatePosition = dominantPosition(heroId, heroPositions);
  if (candidatePosition === null) return false;

  const coveredPositions = new Set<HeroPositionShare["position"]>();
  for (const pickedId of botPicks) {
    const position = dominantPosition(pickedId, heroPositions);
    if (position !== null) coveredPositions.add(position);
  }

  return !coveredPositions.has(candidatePosition);
}

// ---------------------------------------------------------------------------
// Scoring interno
// ---------------------------------------------------------------------------

/**
 * Calcula el score simplificado de un héroe para el bot.
 *
 * Algoritmo (deliberadamente simple — objetivo: QA del motor, no ganar drafts):
 * 1. Score base = win rate ponderado por popularidad (de patchStats)
 * 2. Bonus por complemento de roles no cubiertos por los picks del bot
 *
 * El llamador ya filtra héroes no disponibles; esta función no penaliza baneados/pickeados.
 */
function botScoreHero(
  heroId: HeroId,
  draftState: DraftState,
  botSide: TeamSide,
  meta: MetaSnapshot,
): number {
  const baseScore = getPickRate(heroId, meta);
  const botPicks = getBotPicks(draftState, botSide);
  const bonus = complementsBotPositions(heroId, botPicks, meta) ? POSITION_COMPLEMENT_BONUS : 0;
  return baseScore + bonus;
}

// ---------------------------------------------------------------------------
// Función pública
// ---------------------------------------------------------------------------

/**
 * Selecciona el héroe que el bot debe pickear en la Blind_Round actual.
 *
 * Algoritmo (Req. 4.1, 4.2, 4.3):
 * 1. Construir el pool de héroes disponibles (no baneados, no pickeados).
 * 2. Calcular scores con `botScoreHero` para cada candidato.
 * 3. Seleccionar el héroe con el score más alto; en empate, el primero en la lista.
 * 4. Fallback: si no hay scores diferenciadores (todos en 0), elegir aleatoriamente con rng.
 * 5. Si el pool está vacío, registrar error en consola y retornar null (Req. 4.3).
 */
export function botPickHero(input: BotDrafterInput): BotDrafterResult | null {
  const { draftState, botSide, meta, rng, conflictCount: _conflictCount } = input;

  // Paso 1: pool disponible
  const unavailable = buildUnavailableSet(draftState);
  const availablePool = Object.keys(meta.heroes)
    .map(Number)
    .filter((heroId) => !unavailable.has(heroId));

  // Paso 5: pool vacío → null (Req. 4.3)
  if (availablePool.length === 0) {
    console.error(`${LOG_PREFIX} sin candidatos disponibles (pool vacío)`);
    return null;
  }

  // Paso 2: calcular scores
  const scored = availablePool.map((heroId) => ({
    heroId,
    score: botScoreHero(heroId, draftState, botSide, meta),
  }));

  // Verificar si hay algún héroe con score > 0 (datos de meta disponibles)
  const hasMetaData = scored.some((entry) => entry.score > 0);

  // Paso 4: fallback aleatorio si no hay sugerencias con datos (Req. 4.2)
  if (!hasMetaData) {
    const picked = rng.pick(availablePool);
    if (picked === undefined) {
      console.error(`${LOG_PREFIX} sin candidatos disponibles (fallback rng falló)`);
      return null;
    }
    return { heroId: picked };
  }

  // Paso 3: seleccionar el de mayor score; en empate, primero en la lista (Req. 4.1)
  let bestEntry = scored[0]!;
  for (let i = 1; i < scored.length; i++) {
    const entry = scored[i]!;
    if (entry.score > bestEntry.score) {
      bestEntry = entry;
    }
  }

  return { heroId: bestEntry.heroId };
}
