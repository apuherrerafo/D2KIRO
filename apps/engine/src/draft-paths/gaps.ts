import type { DraftState, HeroId } from "../draft/reducer";
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
