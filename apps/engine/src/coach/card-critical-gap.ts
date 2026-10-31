import { assessCompositionNeedsOf, capabilitiesByHero, ownPicksRemainingFor, unfilledCriticalGaps, type CompositionNeeds } from "../draft-paths/gaps";
import type { DraftCapabilityGap, HeroCapabilities } from "../draft-paths/types";
import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { HeroCandidate } from "./hero-card";
import type { CardRisk } from "./recommendation-output-v4";

// Aviso de "hueco crítico" en la tarjeta del Coach (rescatado de TSK-254 de la cadena F1).
//
// SÓLO INFORMA. Nada de aquí puntúa, reordena ni filtra un candidato: el orden de las tarjetas lo siguen decidiendo V6 + el bono de
// contexto, y este aviso se calcula DESPUÉS, sobre las tarjetas ya ordenadas. Se muestra únicamente cuando la carencia es demostrable:
// todos los picks propios tienen capacidades curadas, se está en la ventana de cierre (quedan 2 picks o menos) y el héroe de la tarjeta
// tiene capacidades curadas que NO llenan el hueco. Lo desconocido nunca se presenta como carencia.

/** Qué le falta críticamente al equipo ahora, y las capacidades curadas para juzgar cada tarjeta contra eso. */
export interface CardCompositionContext {
  needs: CompositionNeeds;
  capabilities: ReadonlyMap<HeroId, HeroCapabilities>;
}

/**
 * Uno por decisión, desde los picks propios visibles de la vista (ninguno si la vista no tiene lado). Undefined si no se inyectaron
 * capacidades: el aviso entonces no se puede derivar (nunca se adivina).
 */
export function deriveCompositionContext(view: PerspectiveDraftView, capabilities: readonly HeroCapabilities[] | undefined): CardCompositionContext | undefined {
  if (!capabilities || capabilities.length === 0) return undefined;
  const own = view.viewerSide === null ? [] : view.ownPicks.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
  return { needs: assessCompositionNeedsOf(own, [...capabilities], ownPicksRemainingFor(own)), capabilities: capabilitiesByHero([...capabilities]) };
}

// Cómo se lee cada carencia como verbo de "Tu equipo ...". Los tres críticos son los que hoy pueden aparecer; el resto queda definido
// para que el Record sea total.
const GAP_CLAUSE: Record<DraftCapabilityGap, string> = {
  initiation: "no tiene cómo iniciar peleas",
  catch: "no tiene cómo atrapar a un rival",
  waveclear: "no tiene waveclear",
  structural_damage: "tiene poco daño a estructuras",
  teamfight: "tiene poco teamfight",
  scaling: "tiene poco scaling",
  damage_mix: "hace casi todo el daño del mismo tipo y le falta un segundo tipo",
};

function listNaturally(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** Sin imperativos: informa, no ordena. Con 1 pick ya no queda quien lo cubra; con más, todavía puede hacerlo otro pick. */
function pickClause(remaining: number): string {
  if (remaining === 1) return "es tu último pick. Este héroe no ayuda con eso y ya no queda otro pick para cubrirlo";
  return `te quedan ${remaining} picks. Este héroe no ayuda con eso; tendría que cubrirlo otro de tus próximos picks`;
}

/**
 * Los avisos de la tarjeta: hoy sólo CRITICAL_GAP. Vacío cuando no hay nada demostrable (nunca ausente).
 * `detail` es lenguaje llano para el jugador: sin jerga del motor ni nombres de héroe.
 */
export function deriveCardRisks(candidate: HeroCandidate, composition?: CardCompositionContext): CardRisk[] {
  if (!composition) return [];
  // [] para un héroe sin capacidades curadas: no sabemos qué aporta, así que nunca se dice que deja el hueco abierto.
  const missing = unfilledCriticalGaps(composition.capabilities.get(candidate.heroId), composition.needs);
  if (missing.length === 0) return [];
  return [
    {
      kind: "CRITICAL_GAP",
      detail: `Hoy tu equipo ${listNaturally(missing.map((gap) => GAP_CLAUSE[gap]))} y ${pickClause(composition.needs.ownPicksRemaining)} (según nuestra lista de héroes).`,
      heroIds: [],
    },
  ];
}
