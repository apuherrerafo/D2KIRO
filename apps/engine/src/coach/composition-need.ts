import { computeJointRoleAssignment, type JointAssignmentHeroInput } from "../draft-protocol/roles/joint-assignment";
import { computeRoleBelief, type Position } from "../draft-protocol/roles/role-belief";
import type { HeroId } from "../draft-protocol/types";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { HeroPositions } from "../signals/hero-positions";

// Qué posiciones le faltan a la composición propia cuando el Live NO sabe qué posición ocupa cada pick.
//
// El resolver del Live (live-position-resolver.ts) no vincula un héroe a una posición sin que una fuente lo diga: correcto, y esto no lo
// cambia. Pero "no sé cuál es cuál" no es "no sé nada": Lion + Crystal Maiden + Rubick no pueden cubrir carry ni offlane, estén en el
// asiento que estén. Esta función le pregunta eso al sistema de asignación conjunta que ya existe (S4: `computeJointRoleAssignment`),
// que enumera TODAS las asignaciones viables de los héroes propios (los flex incluidos, con su distribución completa, no su posición más
// popular) y devuelve cuánto queda sin cubrir cada posición.
//
// Es una PREFERENCIA de orden, nunca una identidad: no marca ninguna posición como ocupada, no vincula ningún héroe, no toca la
// elegibilidad ni el ranking de ninguna columna, y sólo mira los picks propios visibles (nada del rival, nada oculto). Pura.

export type CompositionNeed = Readonly<Record<Position, number>>;

export interface CompositionNeedInput {
  /** Picks propios visibles (KNOWN/REVEALED). */
  ownHeroes: readonly HeroId[];
  /** Posiciones que una fuente afirmó para algún pick propio: se respetan como hechos y nunca se reinfieren. */
  confirmed?: ReadonlyMap<HeroId, Position>;
  heroPositions: HeroPositions | undefined;
}

const MAX_TEAM = 5;

/**
 * `null` = no hay nada que añadir y el llamador se queda con su comportamiento de siempre: sin datos de posición, sin picks, todos los
 * picks ya confirmados (nada que inferir), más de 5 héroes, o dos picks que una fuente afirmó en la misma posición (no se repara).
 * Si no, `1 − cobertura` por posición: 1 = ningún pick propio puede sentarse ahí, ~0 = alguno la ocupa seguro.
 *
 * Cuatro supports para los tres asientos que pueden cubrir no admiten una asignación completa: alguno juega fuera de rol. Eso no borra lo que
 * se sabe de los otros: se calcula con cada subconjunto de héroes que sí cabe (dejando uno afuera) y cada posición se considera tan cubierta
 * como en el mejor de ellos. Sólo cuando el choque no involucra a un pick afirmado por una fuente; si lo involucra, el choque es de verdad y devuelve null.
 */
export function deriveCompositionNeed(input: CompositionNeedInput): CompositionNeed | null {
  const { ownHeroes, confirmed, heroPositions } = input;
  if (!heroPositions || ownHeroes.length === 0 || ownHeroes.length > MAX_TEAM) return null;
  if (ownHeroes.every((heroId) => confirmed?.has(heroId))) return null;
  const jointOf = (team: readonly HeroId[]) =>
    computeJointRoleAssignment(
      team.map((heroId): JointAssignmentHeroInput => ({
        heroId,
        belief: computeRoleBelief({ heroId, confirmedPosition: confirmed?.get(heroId) ?? null, heroPositions }),
      })),
    );
  const result = jointOf(ownHeroes);
  if (!result.rejected) return result.expectedPositionNeed;
  if (result.rejected !== "IMPOSSIBLE_ASSIGNMENT") return null;
  // Un choque que involucra a un pick afirmado por una fuente es de verdad (dos héroes en el mismo asiento): no se repara. Uno entre picks
  // sin posición afirmada es sólo "más héroes de este rol que asientos que pueden cubrir".
  if ((result.conflicts ?? []).some((conflict) => conflict.heroIds.some((heroId) => confirmed?.has(heroId)))) return null;
  const subsets = ownHeroes.map((_, left) => jointOf(ownHeroes.filter((__, index) => index !== left))).filter((subset) => !subset.rejected);
  if (subsets.length === 0) return null;
  const need = (position: Position): number => Math.min(...subsets.map((subset) => subset.expectedPositionNeed[position]));
  return { 1: need(1), 2: need(2), 3: need(3), 4: need(4), 5: need(5) };
}

/**
 * Sólo una captura en vivo. En el simulador cada pick queda atado a su posición al elegirlo, así que no hay nada que inferir y el
 * resultado es siempre `null` (comportamiento idéntico al de antes).
 */
export function compositionNeedForContext(context: PerspectiveRecommendationContext, heroPositions: HeroPositions | undefined): CompositionNeed | null {
  if (context.liveCapture !== true) return null;
  const ownHeroes = context.view.ownPicks.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
  return deriveCompositionNeed({ ownHeroes, confirmed: context.ownAssignedPositions ?? undefined, heroPositions });
}
