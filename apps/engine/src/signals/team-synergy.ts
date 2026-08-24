import type { DraftState, HeroId, TeamSide } from "../draft/reducer";
import { detectDraftGaps, filledGaps, ownCapabilities } from "../draft-paths/gaps";
import type { CapabilityLevel, DamageType, DraftCapabilityGap, HeroCapabilities } from "../draft-paths/types";
import type { SignalContribution, SignalScorer } from "./types";

// TSK-069 (auditoría de inteligencia del motor, fase 2): antes, esta señal media "cobertura" con
// las etiquetas roles[] de OpenDota (Disabler/Initiator/Durable/Pusher/Support) -- las mismas que
// engine.md prohíbe usar para razonar sobre posición porque son ruidosas (57% de héroes marcados
// "Carry"). `draft-paths/capabilities.json` ya tiene el dato correcto -- curado a mano, con
// magnitud real (low/medium/high), y ya probado en producción por el panel "Caminos de draft"
// (draft-paths/gaps.ts) -- pero vivía completamente desconectado del ranking principal. Esta señal
// ahora reutiliza esa misma lógica de gaps en vez de reinventar una versión peor.

const TOTAL_GAP_KINDS = 7; // initiation | catch | waveclear | structural_damage | teamfight | scaling | damage_mix

// Mismo vocabulario que ya usa apps/web/features/draft-paths/constants.tsx (GAP_LABELS) -- los
// términos de jerga (initiation/catch/waveclear/teamfight/scaling) se mantienen en inglés a
// propósito, es como los nombra la comunidad real de Dota 2 en castellano (mismo criterio que
// "hard support/support/offlane/midlane/carry" en web.md). Espejado a mano porque apps/engine y
// apps/web son procesos independientes -- no se puede importar directamente.
const GAP_LABEL: Record<Exclude<DraftCapabilityGap, "damage_mix">, string> = {
  initiation: "initiation",
  catch: "catch",
  waveclear: "waveclear",
  structural_damage: "daño a estructuras",
  teamfight: "teamfight",
  scaling: "scaling",
};

const LEVEL_QUALIFIER: Record<CapabilityLevel, string> = { low: "algo de", medium: "buen", high: "muy buen" };
const DAMAGE_TYPE_LABEL: Record<DamageType, string> = {
  physical: "daño físico",
  magical: "daño mágico",
  pure: "daño puro",
  mixed: "daño físico y mágico",
};

const LEVEL_GAP_KINDS = new Set<DraftCapabilityGap>(["structural_damage", "teamfight", "scaling"]);

function levelOf(gap: DraftCapabilityGap, candidate: HeroCapabilities): CapabilityLevel {
  if (gap === "structural_damage") return candidate.structuralDamage;
  if (gap === "teamfight") return candidate.teamfight;
  return candidate.scaling; // "scaling" -- único caso restante entre los 3 de LEVEL_GAP_KINDS
}

// `damage_mix` no tiene una etiqueta fija -- se describe con el tipo de daño real que el
// candidato aporta (más informativo que un genérico "mezcla de daño"). Los 3 gaps de magnitud
// (structural_damage/teamfight/scaling) solo llegan acá ya filtrados por filledGaps(), que exige
// levelScore > 0 -- "low" nunca aparece en un gap ya marcado como cubierto.
function describeGap(gap: DraftCapabilityGap, candidate: HeroCapabilities): string {
  if (gap === "damage_mix") return DAMAGE_TYPE_LABEL[candidate.damageType];
  if (LEVEL_GAP_KINDS.has(gap)) return `${LEVEL_QUALIFIER[levelOf(gap, candidate)]} ${GAP_LABEL[gap]}`;
  return GAP_LABEL[gap];
}

// Lista en castellano natural: coma entre todos los elementos salvo el último, unido con "y" --
// "Aporta initiation, catch y muy buen teamfight", no la cadena repetida "X y Y y Z" (verificado
// en vivo con un candidato de 4 gaps, TSK-069).
function joinNaturally(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function buildExplanation(filled: DraftCapabilityGap[], candidate: HeroCapabilities): string {
  if (filled.length === 0) return "No aporta ninguna capacidad táctica que a tu equipo le falte todavía";
  const labels = filled.map((gap) => describeGap(gap, candidate));
  return `Aporta ${joinNaturally(labels)} que a tu equipo le falta`;
}

function ownPicks(state: { localSide: TeamSide | "unknown"; picks: Record<TeamSide, HeroId[]> }): HeroId[] {
  return state.localSide === "unknown" ? [] : state.picks[state.localSide];
}

interface NeededState {
  gaps: DraftCapabilityGap[];
  ownDamageTypes: DamageType[];
}

export function createTeamSynergyScorer(capabilities: HeroCapabilities[]): SignalScorer {
  const byHero = new Map(capabilities.map((entry) => [entry.hero, entry]));

  // TSK-069: un solo nivel de WeakMap por `state` alcanza -- a diferencia de la versión anterior
  // (que era un singleton de módulo reusado entre llamadas con `meta` distinto), esta fábrica se
  // construye una vez por llamada a buildSuggestions (mix.ts, mismo patrón que
  // createPositionFitScorer), así que `capabilities` ya queda fijo en el closure y no hace falta
  // anidar la cache por un segundo parámetro variable.
  const neededCache = new WeakMap<DraftState, NeededState>();

  function needed(state: DraftState): NeededState {
    let cached = neededCache.get(state);
    if (!cached) {
      cached = { gaps: detectDraftGaps(state, capabilities), ownDamageTypes: ownCapabilities(state, capabilities).map((c) => c.damageType) };
      neededCache.set(state, cached);
    }
    return cached;
  }

  return {
    id: "team_synergy",
    score(state, candidate): SignalContribution {
      // No hay un equipo propio observado todavía (localSide desconocido o cero picks) -- no
      // existe una "cobertura actual" contra la cual medir qué le falta al equipo, así que se
      // trata como dato insuficiente (null), no como cobertura=0.
      if (ownPicks(state).length === 0) {
        return {
          signal: "team_synergy",
          raw: null,
          weighted: 0,
          explanation: "Sin picks propios todavía para evaluar sinergia de equipo",
          sampleSize: 0,
        };
      }

      const candidateCapabilities = byHero.get(candidate);
      if (!candidateCapabilities) {
        return {
          signal: "team_synergy",
          raw: 0,
          weighted: 0,
          explanation: "Sin datos de capacidades tácticas para este héroe",
          sampleSize: 0,
        };
      }

      const { gaps, ownDamageTypes } = needed(state);
      const filled = filledGaps(candidateCapabilities, gaps, ownDamageTypes);

      return {
        signal: "team_synergy",
        raw: filled.length / TOTAL_GAP_KINDS,
        weighted: 0,
        explanation: buildExplanation(filled, candidateCapabilities),
        sampleSize: 0,
      };
    },
  };
}
