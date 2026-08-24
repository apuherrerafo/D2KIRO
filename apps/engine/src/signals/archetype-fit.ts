import type { DraftState, HeroId } from "../draft/reducer";
import { archetypeFitBonus } from "../draft-paths/build-paths";
import { capabilitiesByHero } from "../draft-paths/gaps";
import type { CapabilityLevel, DraftPathArchetype, HeroCapabilities } from "../draft-paths/types";
import type { MetaSnapshot, SignalContribution } from "./types";

// TSK-089 (Fase 4, SPEC.md §11.4): reutiliza archetypeFitBonus (draft-paths/build-paths.ts, ya
// probada en producción por "Caminos de draft") en vez de reimplementarla. `SignalId` NO se
// amplía todavía (rompería SCORING_WEIGHTS_V4/V5, ambas congeladas) -- esta vista de tipo derivada
// desaparece sola en el sub-ticket que sí lo haga, por tipado estructural.
export type ArchetypeFitContribution = Omit<SignalContribution, "signal"> & { signal: "archetype_fit" };

export interface ArchetypeFitScorer {
  id: "archetype_fit";
  score(state: DraftState, candidate: HeroId, meta: MetaSnapshot): ArchetypeFitContribution;
}

// archetypeFitBonus no tiene escala uniforme entre arquetipos (0-2 salvo pickoff, que suma dos
// booleanos y llega a 0-3) -- la normalización a [0,1] tiene que vivir acá, nunca en un RAW_RANGE
// único por señal (mix.ts), que no puede representar un rango distinto por arquetipo.
const ARCHETYPE_MAX_BONUS: Record<DraftPathArchetype, number> = {
  push: 2,
  teamfight: 2,
  pickoff: 3,
  scaling: 2,
};

const ARCHETYPE_LABEL: Record<DraftPathArchetype, string> = {
  push: "Push",
  teamfight: "Teamfight",
  pickoff: "Pickoff",
  scaling: "Scaling",
};

const DIMENSION_LABEL: Record<Exclude<DraftPathArchetype, "pickoff">, string> = {
  push: "daño a estructuras",
  teamfight: "teamfight",
  scaling: "scaling",
};

// "low" nunca se consulta en la práctica (da bonus 0, que corta antes en buildExplanation) --
// declarado igual para las 3 claves reales de CapabilityLevel, así el lookup no necesita un `as`
// que le pida al lector confiar en una invariante en vez de dejar que el compilador la pruebe.
const LEVEL_QUALIFIER: Record<CapabilityLevel, string> = { low: "", medium: "buen", high: "muy buen" };

function levelOf(archetype: Exclude<DraftPathArchetype, "pickoff">, candidate: HeroCapabilities): CapabilityLevel {
  if (archetype === "push") return candidate.structuralDamage;
  if (archetype === "teamfight") return candidate.teamfight;
  return candidate.scaling;
}

function pickoffList(candidate: HeroCapabilities): string {
  if (candidate.hasCatch && candidate.hasInitiation) return "catch e initiation";
  if (candidate.hasCatch) return "catch";
  return "initiation";
}

function buildExplanation(archetype: DraftPathArchetype, raw: number, candidate: HeroCapabilities): string {
  if (raw === 0) return `No aporta a un draft de ${ARCHETYPE_LABEL[archetype]}`;
  if (archetype === "pickoff") return `Aporta ${pickoffList(candidate)} a tu draft de Pickoff`;
  const level = levelOf(archetype, candidate);
  return `Aporta ${LEVEL_QUALIFIER[level]} ${DIMENSION_LABEL[archetype]} a tu draft de ${ARCHETYPE_LABEL[archetype]}`;
}

export function createArchetypeFitScorer(
  capabilities: HeroCapabilities[],
  intent: DraftPathArchetype | undefined,
): ArchetypeFitScorer {
  const byHero = capabilitiesByHero(capabilities);

  return {
    id: "archetype_fit",
    // `raw` no depende de `state` ni de `meta` (SPEC.md §11.4) -- es constante por (intent, hero).
    // Firma más corta que la interfaz (2 params, no 3): TS acepta una función con menos parámetros
    // como compatible con un tipo que declara más, mismo patrón que ya usa position-fit.ts.
    score(_state, candidate): ArchetypeFitContribution {
      if (intent === undefined) {
        return {
          signal: "archetype_fit",
          raw: null,
          weighted: 0,
          applicable: false,
          explanation: "Elegí una intención de draft para activar esta señal",
          sampleSize: 0,
        };
      }

      const info = byHero.get(candidate);
      if (!info) {
        return {
          signal: "archetype_fit",
          raw: null,
          weighted: 0,
          explanation: "Sin datos de capacidades tácticas para este héroe",
          sampleSize: 0,
        };
      }

      const raw = archetypeFitBonus(intent, info) / ARCHETYPE_MAX_BONUS[intent];
      return {
        signal: "archetype_fit",
        raw,
        weighted: 0,
        explanation: buildExplanation(intent, raw, info),
        sampleSize: 0,
      };
    },
  };
}
