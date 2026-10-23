import { MAX_PICKS_PER_SIDE, type DraftState, type HeroId } from "../draft/reducer";
import type { CapabilityLevel, DamageType, DraftCapabilityGap, HeroCapabilities } from "./types";

const LEVEL_SCORE: Record<CapabilityLevel, number> = { low: 0, medium: 1, high: 2 };
const GAP_THRESHOLD = 2;

export function levelScore(level: CapabilityLevel): number {
  return LEVEL_SCORE[level];
}

export function capabilitiesByHero(capabilities: HeroCapabilities[]): Map<HeroId, HeroCapabilities> {
  return new Map(capabilities.map((entry) => [entry.hero, entry]));
}

function getOwnHeroes(state: DraftState): HeroId[] {
  if (state.localSide === "unknown") return [];
  return state.picks[state.localSide];
}

// Exportado para que build-paths.ts pueda calcular el tipo de daño dominante del equipo propio y
// pasárselo a filledGaps -- sin esto, filledGaps no puede saber si un candidato realmente
// diversifica o si repite el mismo tipo que ya está sobrerrepresentado (hallazgo real de
// @redteam: la versión anterior asumía que el equipo siempre era monótono en "physical").
export function ownCapabilities(state: DraftState, capabilities: HeroCapabilities[]): HeroCapabilities[] {
  const byHero = capabilitiesByHero(capabilities);
  return getOwnHeroes(state)
    .map((hero) => byHero.get(hero))
    .filter((entry): entry is HeroCapabilities => entry !== undefined);
}

function hasDamageMixGap(damageTypes: DamageType[]): boolean {
  if (damageTypes.length < 2) return false;
  if (damageTypes.includes("mixed")) return false;
  return new Set(damageTypes).size === 1;
}

export function detectDraftGaps(state: DraftState, capabilities: HeroCapabilities[]): DraftCapabilityGap[] {
  const own = ownCapabilities(state, capabilities);

  const gaps: DraftCapabilityGap[] = [];
  if (own.filter((entry) => entry.hasInitiation).length === 0) gaps.push("initiation");
  if (own.filter((entry) => entry.hasCatch).length === 0) gaps.push("catch");
  if (own.filter((entry) => entry.hasWaveclear).length === 0) gaps.push("waveclear");
  if (own.reduce((sum, entry) => sum + levelScore(entry.structuralDamage), 0) < GAP_THRESHOLD) gaps.push("structural_damage");
  if (own.reduce((sum, entry) => sum + levelScore(entry.teamfight), 0) < GAP_THRESHOLD) gaps.push("teamfight");
  if (own.reduce((sum, entry) => sum + levelScore(entry.scaling), 0) < GAP_THRESHOLD) gaps.push("scaling");
  if (hasDamageMixGap(own.map((entry) => entry.damageType))) gaps.push("damage_mix");
  return gaps;
}

// `ownDamageTypes`: cuando "damage_mix" está entre los gaps, siempre es monótono por construcción
// de hasDamageMixGap (todos el mismo tipo) -- un candidato lo resuelve si es "mixed" (cubre ambos
// por definición) o si su tipo es DISTINTO del que ya domina, sea cual sea ese tipo. Hallazgo real
// de @redteam: la versión anterior asumía que el equipo siempre era monótono en "physical" (OR
// hardcodeado contra magical/pure/mixed) -- con un equipo monótono en "magical", un candidato
// físico (la elección correcta) quedaba marcado como que NO resolvía el gap, y otro mágico quedaba
// marcado como que SÍ lo resolvía, empeorando el problema en vez de arreglarlo.
export function filledGaps(candidate: HeroCapabilities, gaps: DraftCapabilityGap[], ownDamageTypes: DamageType[] = []): DraftCapabilityGap[] {
  return gaps.filter((gap) => {
    if (gap === "initiation") return candidate.hasInitiation;
    if (gap === "catch") return candidate.hasCatch;
    if (gap === "waveclear") return candidate.hasWaveclear;
    if (gap === "structural_damage") return levelScore(candidate.structuralDamage) > 0;
    if (gap === "teamfight") return levelScore(candidate.teamfight) > 0;
    if (gap === "scaling") return levelScore(candidate.scaling) > 0;
    if (candidate.damageType === "mixed") return true;
    return !ownDamageTypes.includes(candidate.damageType);
  });
}

// ---- TSK-253 (F1 / T4): qué le falta al equipo y cuánto pesa ya -------------------------------------------------------------------
//
// `detectDraftGaps` dice QUÉ no tiene el equipo; no dice si importa todavía. Tres cosas distintas:
//   - capacidad del héroe: booleana (initiation / catch / waveclear) o con nivel (structural_damage / teamfight / scaling). Donde el
//     dato no tiene niveles NO se inventan: un iniciador es un iniciador, no "muy iniciador".
//   - cobertura del equipo: lo que aportan los picks propios CURADOS. Un pick propio sin capacidades curadas (Ringmaster, Kez, Largo)
//     es dato desconocido, no carencia (mismo criterio que `team_synergy`): con uno, el equipo no puede declarar un hueco como crítico.
//   - importancia: con 1 pick propio casi todo "falta" (nada es una necesidad todavía); en los últimos picks, lo que sigue abierto ya
//     no se puede esperar a llenar después.
//
// "Crítico" sale del plan v2 (invariantes I6 e I7), no de una escala nueva: no poder iniciar ni atrapar, o un solo tipo de daño, cuando
// quedan CLOSING_WINDOW_PICKS o menos picks propios (el mismo corte con el que el examen mide I6).

export const CRITICAL_GAP_KINDS: readonly DraftCapabilityGap[] = ["initiation", "catch", "damage_mix"];
export const CLOSING_WINDOW_PICKS = 2;

export interface CompositionNeeds {
  /** Todo hueco abierto -- exactamente `detectDraftGaps`. */
  open: DraftCapabilityGap[];
  /** Los huecos críticos que ya no se pueden esperar a llenar; vacío fuera de la ventana de cierre o si un pick propio no está curado. */
  critical: DraftCapabilityGap[];
  /** Tipos de daño de los picks propios curados: lo que `filledGaps` necesita para saber si un candidato diversifica. */
  ownDamageTypes: DamageType[];
  /** Picks propios que faltan, contando el que se está decidiendo (5 - ya elegidos). */
  ownPicksRemaining: number;
}

export function ownPicksRemainingOf(state: DraftState): number {
  return Math.max(MAX_PICKS_PER_SIDE - getOwnHeroes(state).length, 0);
}

export function assessCompositionNeeds(state: DraftState, capabilities: HeroCapabilities[], ownPicksRemaining: number): CompositionNeeds {
  const own = ownCapabilities(state, capabilities);
  const open = detectDraftGaps(state, capabilities);
  const coverageIsKnown = getOwnHeroes(state).length === own.length;
  const inClosingWindow = ownPicksRemaining >= 1 && ownPicksRemaining <= CLOSING_WINDOW_PICKS;
  const critical = coverageIsKnown && inClosingWindow ? open.filter((gap) => CRITICAL_GAP_KINDS.includes(gap)) : [];
  return { open, critical, ownDamageTypes: own.map((entry) => entry.damageType), ownPicksRemaining };
}

/**
 * Los huecos críticos que este candidato NO llena. Un candidato sin capacidades curadas devuelve [] : no sabemos qué aporta, y
 * desconocido no es carencia (nunca se le atribuye el hueco).
 */
export function unfilledCriticalGaps(candidate: HeroCapabilities | undefined, needs: CompositionNeeds): DraftCapabilityGap[] {
  if (candidate === undefined) return [];
  const filled = new Set(filledGaps(candidate, needs.critical, needs.ownDamageTypes));
  return needs.critical.filter((gap) => !filled.has(gap));
}

/** Qué parte de los picks que quedan se iría en llenar lo crítico (0 si no hay nada crítico; 1 si ya no alcanzan los picks). */
export function criticalPressure(needs: CompositionNeeds): number {
  if (needs.critical.length === 0 || needs.ownPicksRemaining < 1) return 0;
  return Math.min(1, needs.critical.length / needs.ownPicksRemaining);
}
