import { loadHeroLineProfiles } from "../lane/profiles";
import type { HeroLineProfile } from "../lane/profiles";
import type { DraftState, HeroId } from "../draft/reducer";

// Fase 8 (pro-drafter-spec-v1.md §3): primer paso del pipeline -- "DraftState -> vectores 5D por
// héroe candidato". Reutiliza loadHeroLineProfiles (6.1), nunca reimplementa el perfil.
//
// [SUPUESTO, ver plan Fase 5-8]: `candidatePool` real (signals/mix.ts) no está exportado y
// depende de MetaSnapshot, que esta función no recibe -- el llamador (8.4) ya entrega
// `candidates` como la lista válida generada desde meta. Acá solo se aplica una segunda
// comprobación defensiva contra `state` (banned/picks): filtrar una lista ya dada no es la misma
// responsabilidad que generarla desde meta.heroes, así que esto no es una segunda copia de
// candidatePool.
//
// `profiles` sigue el mismo patrón de costura que heroPositions?/heroCapabilities? en
// BuildSuggestionsOptions (S9/S10): por defecto carga el archivo real una sola vez a nivel de
// módulo, pero es inyectable para no acoplar los tests al contenido curado real.
const MODULE_HERO_LINE_PROFILES = loadHeroLineProfiles();

export function extractCandidateFeatures(
  state: DraftState,
  candidates: readonly HeroId[],
  profiles: Map<HeroId, HeroLineProfile> = MODULE_HERO_LINE_PROFILES,
): Map<HeroId, HeroLineProfile> {
  const excluded = new Set<HeroId>([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
  const result = new Map<HeroId, HeroLineProfile>();

  for (const heroId of candidates) {
    if (excluded.has(heroId)) continue;
    const profile = profiles.get(heroId);
    if (!profile) continue; // sin perfil curado -- se omite, nunca undefined en el mapa
    result.set(heroId, profile);
  }

  return result;
}
