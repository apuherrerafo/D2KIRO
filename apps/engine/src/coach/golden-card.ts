import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import type { CuratedSynergy } from "../signals/hero-synergies";
import { likelyPosition, synergiesWithOwn } from "./context-reorder";

// Card dorada -- UN héroe que NO está en tu pool pero encaja de verdad con este draft. Máximo 1, no siempre activa, para cualquier
// posición que todavía te falte. El estándar lo fijaron dos expertos de Dota y el usuario eligió la variante que sale casi siempre
// (≈80 % de los drafts pro del corpus; medición aproximada con bans simulados). Solo hechos del draft visible: nunca
// se supone lo que el rival va a sacar. Pura: sin I/O, sin reloj.
//
// Reglas (todas deben cumplirse):
//   1. Ya se ven al menos 2 héroes rivales (con menos, no hay a quién ganarle).
//   2. No está baneado, ni pickeado, ni en la lista de exclusión de ejecución difícil, ni en TU pool de esa posición; y juega esa
//      posición en al menos 1/4 de sus partidas y esa posición todavía te falta.
//   3. Le gana DURO a un rival CORE (pos 1-3) ya sacado, con una razón real en la base. Una victoria cuya razón solo dice "Lo dicen: …"
//      no cuenta ni se muestra, y las victorias sobre rivales que no son core no suman puntos.
//   4. Ningún rival ya sacado lo counterea duro; con 2 o más counters medios rivales no hay card; con 1 solo, solo si las victorias
//      suman 5 o más puntos.
//   5. Como mucho 1 counter duro suyo sigue libre (se avisa por nombre); con 2 o más no hay card.
// Los counters suyos ya fuera de juego (baneados o en tu equipo) y las parejas con tus picks NO son condición: solo ordenan entre
// varios que cumplen. Los winrates no se usan en ninguna regla.
//
// Magnitudes de producto elegidas a criterio de dos expertos de Dota (puntos 2/1, tolerancia de 5 puntos, 1 counter libre, 1/4 de
// partidas, pesos de protección), pendientes de calibrar contra drafts profesionales reales (la medición actual es aproximada y
// usa bans simulados). Que sean enteros no las vuelve datos: por eso este módulo está registrado en `perspective-graph-guard.test.ts`.

/** Mínimo de rivales ya sacados para que exista la card. */
export const GOLDEN_MIN_REVEALED_ENEMIES = 2;
/** Posición "suya" si la juega en al menos 1/4 de sus partidas. */
const POSITION_SHARE_DIVISOR = 4;
/** Puntos de victoria: duro 2, medio 1. Un counter medio rival se tolera con al menos este total. */
const WIN_POINTS = { hard: 2, medium: 1 } as const;
/** Con exactamente 1 counter medio de un rival ya sacado, las victorias deben sumar al menos esto; con 2 o más no hay card. */
const MEDIUM_RIVAL_COUNTER_MIN_POINTS = 5;
const MAX_MEDIUM_RIVAL_COUNTERS = 1;
/** Cuántos counters duros suyos pueden seguir libres (se avisan por nombre). */
const MAX_STILL_FREE_HARD = 1;
/** Puntos de protección (solo para ordenar, en cuartos para no usar decimales): duro 4, medio 1. */
const PROTECTION_POINTS = { hard: 4, medium: 1 } as const;
/** Una razón de la base que solo dice a quién se lo atribuye ("Lo dicen: DotaCoach (7.41f)") no cuenta como razón de Dota. */
const UNREASONED_PREFIX = "Lo dicen";
const CORE_POSITIONS: readonly Position[] = [1, 2, 3];

/**
 * Héroes que no se ofrecen como "perfecto" porque salen mal para quien no los domina (decisión de producto, lista propuesta por un
 * experto de Dota y pendiente de ajuste del usuario): Rubick, Invoker, Meepo, Chen, Tinker, Techies, Visage, Arc Warden, Io,
 * Lone Druid, Earth Spirit, y (a sugerencia del auditor de Dota) Storm Spirit, Puck y Void Spirit.
 */
export const GOLDEN_CARD_EXCLUDED: ReadonlySet<HeroId> = new Set([86, 74, 82, 66, 34, 105, 92, 113, 91, 80, 107, 17, 13, 126]);

export interface GoldenCardWin {
  vsHeroId: HeroId;
  level: "hard" | "medium";
  /** La razón curada de la base (sin punto final). */
  why: string;
  /** El rival juega pos 1, 2 o 3. */
  core: boolean;
}

export interface GoldenCard {
  heroId: HeroId;
  /** La posición abierta que cubre. */
  position: Position;
  /** A quién de lo ya sacado le gana (duros primero). */
  wins: GoldenCardWin[];
  /** Sus counters duros que siguen libres (0 o 1): se avisan por nombre. */
  stillFreeHardCounters: HeroId[];
  /** Sus counters que ya están fuera de juego (baneados o en tu equipo). */
  counteredOutBy: HeroId[];
  /** Parejas curadas con héroes que ya elegiste. */
  synergies: { withHeroId: HeroId; why: string }[];
}

export interface GoldenCardInput {
  view: PerspectiveDraftView;
  /** Posiciones que el equipo del jugador todavía puede cubrir ahora. */
  openPositions: readonly Position[];
  heroPositions: HeroPositions;
  heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]> | undefined;
  heroSynergies?: ReadonlyMap<HeroId, readonly CuratedSynergy[]>;
  /** La lista del pool configurado para esa posición, o undefined si no hay pool. */
  poolFor(position: Position): readonly HeroId[] | undefined;
  excluded?: ReadonlySet<HeroId>;
}

interface Scored {
  card: GoldenCard;
  winPoints: number;
  protection: number;
}

function cleanWhy(why: string): string {
  return why.trim().replace(/[.\s]+$/, "");
}

function visibleHeroes(slots: PerspectiveDraftView["ownPicks"]): HeroId[] {
  return slots.flatMap((slot) => (slot.visibility !== "HIDDEN" ? [slot.heroId] : []));
}

/** La posición abierta que este héroe juega en ≥1/4 de sus partidas (la más jugada primero) y donde NO está en tu pool. */
function coveredPosition(heroId: HeroId, input: GoldenCardInput): Position | null {
  const shares = input.heroPositions[heroId] ?? [];
  const total = shares.reduce((sum, entry) => sum + entry.matches, 0);
  if (total === 0) return null;
  const candidates = shares
    .filter((entry) => input.openPositions.includes(entry.position) && entry.matches * POSITION_SHARE_DIVISOR >= total)
    .sort((a, b) => b.matches - a.matches || a.position - b.position);
  for (const entry of candidates) {
    if (!(input.poolFor(entry.position) ?? []).includes(heroId)) return entry.position;
  }
  return null;
}

function winsOf(candidate: HeroId, revealedEnemies: readonly HeroId[], input: GoldenCardInput): GoldenCardWin[] {
  const wins: GoldenCardWin[] = [];
  for (const enemy of revealedEnemies) {
    const entry = (input.heroCounters?.get(enemy) ?? []).find((counter) => counter.vs === candidate);
    if (!entry || entry.why.startsWith(UNREASONED_PREFIX)) continue;
    const enemyPosition = likelyPosition(enemy, input.heroPositions);
    wins.push({ vsHeroId: enemy, level: entry.level, why: cleanWhy(entry.why), core: enemyPosition !== null && CORE_POSITIONS.includes(enemyPosition) });
  }
  return wins.sort((a, b) => WIN_POINTS[b.level] - WIN_POINTS[a.level] || a.vsHeroId - b.vsHeroId);
}

function evaluate(candidate: HeroId, revealedEnemies: readonly HeroId[], own: ReadonlySet<HeroId>, banned: ReadonlySet<HeroId>, input: GoldenCardInput): Scored | null {
  const position = coveredPosition(candidate, input);
  if (position === null) return null;
  const wins = winsOf(candidate, revealedEnemies, input);
  if (!wins.some((win) => win.level === "hard" && win.core)) return null;
  const winPoints = wins.filter((win) => win.core).reduce((sum, win) => sum + WIN_POINTS[win.level], 0);
  const ownCounters = input.heroCounters?.get(candidate) ?? [];
  const revealed = new Set(revealedEnemies);
  const rivalCounters = ownCounters.filter((counter) => revealed.has(counter.vs));
  if (rivalCounters.some((counter) => counter.level === "hard")) return null;
  if (rivalCounters.length > MAX_MEDIUM_RIVAL_COUNTERS) return null;
  if (rivalCounters.length > 0 && winPoints < MEDIUM_RIVAL_COUNTER_MIN_POINTS) return null;
  const stillFreeHard = ownCounters.filter((counter) => counter.level === "hard" && !banned.has(counter.vs) && !own.has(counter.vs)).map((counter) => counter.vs);
  if (stillFreeHard.length > MAX_STILL_FREE_HARD) return null;
  const outOfPlay = ownCounters.filter((counter) => banned.has(counter.vs) || own.has(counter.vs));
  const protection = outOfPlay.reduce((sum, counter) => sum + PROTECTION_POINTS[counter.level], 0);
  const synergies = synergiesWithOwn(candidate, { ownPicks: own, heroSynergies: input.heroSynergies }).map((synergy) => ({ withHeroId: synergy.with, why: cleanWhy(synergy.why) }));
  return { winPoints, protection, card: { heroId: candidate, position, wins, stillFreeHardCounters: stillFreeHard, counteredOutBy: outOfPlay.map((counter) => counter.vs).sort((a, b) => a - b), synergies } };
}

/**
 * La card dorada de este estado, o null si ningún héroe cumple el estándar. Entre varios que cumplen manda: más puntos de victoria,
 * luego más counters suyos ya fuera de juego, luego más parejas con tus picks, luego el id más bajo (determinista).
 */
export function selectGoldenCard(input: GoldenCardInput): GoldenCard | null {
  // Pieza decorativa: si algo inesperado lanzara, el tablero sigue sin la card (una señal rota nunca tira el motor).
  try {
    return pickGoldenCard(input);
  } catch {
    return null;
  }
}

function pickGoldenCard(input: GoldenCardInput): GoldenCard | null {
  const revealedEnemies = input.view.enemyPicks.flatMap((slot) => (slot.visibility === "REVEALED" ? [slot.heroId] : []));
  if (revealedEnemies.length < GOLDEN_MIN_REVEALED_ENEMIES) return null;
  const own = new Set<HeroId>(visibleHeroes(input.view.ownPicks));
  const banned = new Set<HeroId>(input.view.bannedHeroes);
  const gone = new Set<HeroId>([...own, ...banned, ...visibleHeroes(input.view.enemyPicks)]);
  const excluded = input.excluded ?? GOLDEN_CARD_EXCLUDED;
  const pool = Object.keys(input.heroPositions).map(Number).filter((heroId) => !gone.has(heroId) && !excluded.has(heroId));
  const scored = pool.flatMap((heroId) => {
    const result = evaluate(heroId, revealedEnemies, own, banned, input);
    return result === null ? [] : [result];
  });
  scored.sort((a, b) => b.winPoints - a.winPoints || b.protection - a.protection || b.card.synergies.length - a.card.synergies.length || a.card.heroId - b.card.heroId);
  return scored[0]?.card ?? null;
}
