import { computeJointRoleAssignment, type JointAssignmentHeroInput, type JointRoleAssignmentResult } from "../draft-protocol/roles/joint-assignment";
import { computeRoleBelief, type Position, type RoleBelief } from "../draft-protocol/roles/role-belief";
import type { HeroId } from "../draft-protocol/types";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { HeroPositions } from "../signals/hero-positions";

// Qué posiciones le faltan a la composición propia cuando el Live NO sabe (o sabe sólo en parte) qué posición ocupa cada pick.
//
// El resolver del Live (live-position-resolver.ts) no vincula un héroe a una posición sin que una fuente lo diga: correcto, y esto no lo
// cambia. Pero "no sé cuál es cuál" no es "no sé nada": Lion + Crystal Maiden + Rubick no pueden cubrir carry ni offlane, estén en el
// asiento que estén. Esta función reutiliza dos cosas que ya existen y las exige a la vez para dar una posición por cubierta:
//   - FACTIBILIDAD (S4, `computeJointRoleAssignment`): enumera todas las asignaciones viables del equipo completo, los asientos afirmados por una
//     fuente incluidos como hechos, y dice qué posición queda cubierta en ellas.
//   - PROBABILIDAD (S4, `computeRoleBelief`): cuánto juega de verdad cada héroe cada posición (su distribución completa, flex incluidos).
// La factibilidad sola engaña: tres supports que sólo caben en {mid, soft, hard} "cubren" el mid con certeza aunque quien lo juegue sea el 12%
// de las veces. Por eso una posición cuenta como cubierta sólo si LAS DOS dicen que más probable que no lo está, y nunca hay más posiciones
// cubiertas que héroes propios (un límite estructural, no un número elegido).
// Excepción de bloque: dos héroes que probablemente SON los dos supports cubren juntos los dos asientos de support (4 y 5) aunque ninguno
// domine uno en particular (Lion 37% pos 4 / 52% pos 5 + Crystal Maiden 16% / 84%: la pos 4 sola queda en 0,47 y, sin esto, seguiría
// "abierta"). Se activa cuando la probabilidad de que al menos dos se sienten en {4, 5} supera 1/2; el mismo criterio de mayoría de siempre.
// Con un solo pick propio no hay nada que inferir: se queda el comportamiento de siempre.
//
// Es una PREFERENCIA de orden, nunca una identidad: no marca ninguna posición como ocupada, no vincula ningún héroe, no toca la
// elegibilidad ni el ranking de ninguna columna, y sólo mira los picks propios visibles (nada del rival, nada oculto). Pura.

export interface CompositionNeed {
  /** `1 − cobertura` por posición: 1 = ningún pick propio puede sentarse ahí, ~0 = alguno la ocupa seguro. */
  readonly need: Readonly<Record<Position, number>>;
  /** Las posiciones que los picks propios cubren más probable que no (cobertura > 1/2): a lo sumo una por héroe propio. */
  readonly covered: readonly Position[];
}

export interface CompositionNeedInput {
  /** Picks propios visibles (KNOWN/REVEALED). */
  ownHeroes: readonly HeroId[];
  /** Posiciones que una fuente afirmó para algún pick propio: se respetan como hechos y nunca se reinfieren ni se sacan de la cuenta. */
  confirmed?: ReadonlyMap<HeroId, Position>;
  heroPositions: HeroPositions | undefined;
}

const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];
const MAX_TEAM = 5;
const MIN_TEAM = 2;
const SUPPORT_SEATS: readonly Position[] = [4, 5];

/**
 * `null` = no hay nada que añadir y el llamador se queda con su comportamiento de siempre: sin datos de posición, menos de dos picks, todos los picks
 * ya confirmados (nada que inferir), más de 5 héroes, o una contradicción entre asientos afirmados (no se repara).
 *
 * Cuatro supports para los tres asientos que pueden cubrir no admiten una asignación completa: alguno juega fuera de rol. Eso no borra lo que se
 * sabe de los otros: se calcula con cada subconjunto que sí cabe dejando afuera el menor número de héroes SIN posición afirmada (los asientos
 * confirmados nunca se sacan) y la factibilidad de cada posición es la del mejor de ellos.
 */
export function deriveCompositionNeed(input: CompositionNeedInput): CompositionNeed | null {
  const { confirmed, heroPositions } = input;
  // Canonical order keeps the solver's floating-point accumulation deterministic across capture order.
  const ownHeroes = [...new Set(input.ownHeroes)].sort((a, b) => a - b);
  if (!heroPositions || ownHeroes.length < MIN_TEAM || ownHeroes.length > MAX_TEAM) return null;
  if (ownHeroes.every((heroId) => confirmed?.has(heroId))) return null;

  const beliefs = new Map<HeroId, RoleBelief>(ownHeroes.map((heroId) => [heroId, computeRoleBelief({ heroId, confirmedPosition: confirmed?.get(heroId) ?? null, heroPositions })]));
  const jointOf = (team: readonly HeroId[]) => computeJointRoleAssignment(team.map((heroId): JointAssignmentHeroInput => ({ heroId, belief: beliefs.get(heroId)! })));

  const full = jointOf(ownHeroes);
  let jointNeed: Readonly<Record<Position, number>>;
  let fittingAssignments: readonly JointRoleAssignmentResult[];
  if (!full.rejected) {
    jointNeed = full.expectedPositionNeed;
    fittingAssignments = [full];
  } else if (full.rejected === "IMPOSSIBLE_ASSIGNMENT") {
    const fits = largestFittingTeams(ownHeroes, confirmed, jointOf);
    if (fits.length === 0) return null;
    // A favourable subset cannot declare a seat covered when another largest viable subset leaves it open.
    const worst = (position: Position): number => Math.max(...fits.map((subset) => subset.expectedPositionNeed[position]));
    jointNeed = { 1: worst(1), 2: worst(2), 3: worst(3), 4: worst(4), 5: worst(5) };
    fittingAssignments = fits;
  } else {
    return null;
  }

  // Probabilidad de que AL MENOS UN héroe propio juegue la posición, con la distribución de cada uno por separado.
  const played = (position: Position): number => 1 - ownHeroes.reduce((miss, heroId) => miss * (1 - beliefs.get(heroId)!.probabilities[position]), 1);
  // This is mass from complete injective assignments, not independent per-hero support chances.
  // For an impossible full team, every largest viable subset must support the claim.
  const supportPair = Math.min(...fittingAssignments.map(probabilityBothSupportSeatsCovered));
  const coverage = (position: Position): number => {
    const own = Math.min(1 - jointNeed[position], played(position));
    return SUPPORT_SEATS.includes(position) && supportPair * 2 > 1 ? Math.max(own, supportPair) : own;
  };
  if (!POSITIONS.every((position) => Number.isFinite(coverage(position)))) return null; // datos corruptos: el Coach sigue como siempre
  const need = Object.fromEntries(POSITIONS.map((position) => [position, Math.min(1, Math.max(0, 1 - coverage(position)))])) as Record<Position, number>;
  const covered = POSITIONS.filter((position) => coverage(position) * 2 > 1)
    .sort((a, b) => coverage(b) - coverage(a) || a - b)
    .slice(0, ownHeroes.length)
    .sort((a, b) => a - b);
  return { need, covered };
}

/** Probability mass of S4 assignments that cover both support seats. */
function probabilityBothSupportSeatsCovered(assignment: JointRoleAssignmentResult): number {
  return assignment.candidates.reduce(
    (total, candidate) => total + (SUPPORT_SEATS.every((position) => [...candidate.assignment.values()].includes(position)) ? candidate.probability : 0),
    0,
  );
}

/**
 * Los equipos más grandes que SÍ admiten una asignación completa, dejando afuera el menor número posible de héroes SIN posición afirmada (los
 * asientos confirmados nunca se sacan). Cuatro supports para los asientos que pueden cubrir: se saca uno; cuatro supports puros 4/5: se sacan dos.
 */
function largestFittingTeams<T extends { rejected?: string }>(
  ownHeroes: readonly HeroId[],
  confirmed: ReadonlyMap<HeroId, Position> | undefined,
  jointOf: (team: readonly HeroId[]) => T,
): T[] {
  const free = ownHeroes.filter((heroId) => !confirmed?.has(heroId));
  let leftOut: HeroId[][] = [[]];
  for (let dropped = 1; dropped <= free.length; dropped += 1) {
    leftOut = leftOut.flatMap((chosen) => free.filter((heroId) => !chosen.includes(heroId) && (chosen.length === 0 || heroId > chosen[chosen.length - 1]!)).map((heroId) => [...chosen, heroId]));
    const fits = leftOut.map((drop) => jointOf(ownHeroes.filter((heroId) => !drop.includes(heroId)))).filter((subset) => !subset.rejected);
    if (fits.length > 0) return fits;
  }
  return [];
}

/** Las posiciones de `positions` que los picks propios todavía NO cubren (más probable que no). */
export function uncoveredPositions(positions: readonly Position[], need: CompositionNeed): Position[] {
  return positions.filter((position) => !need.covered.includes(position));
}

/**
 * Sólo una captura en vivo. En el simulador cada pick queda atado a su posición al elegirlo, así que no hay nada que inferir y el
 * resultado es siempre `null` (comportamiento idéntico al de antes). Nunca lanza: ante cualquier fallo el Coach sigue como siempre.
 */
export function compositionNeedForContext(context: PerspectiveRecommendationContext, heroPositions: HeroPositions | undefined): CompositionNeed | null {
  if (context.liveCapture !== true) return null;
  try {
    const ownHeroes = context.view.ownPicks.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
    return deriveCompositionNeed({ ownHeroes, confirmed: context.ownAssignedPositions ?? undefined, heroPositions });
  } catch {
    return null;
  }
}
