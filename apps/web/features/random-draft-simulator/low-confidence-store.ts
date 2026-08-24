import { create } from "zustand";
import type { HeroId } from "@/features/draft/types";

// Diagnóstico de curación de corpus (sesión Gobernanza 2.0): acumula, durante un draft del
// simulador, qué héroes salieron con `knn_similarity: null` en las sugerencias de Pro-Drafter --
// específicamente esa señal, no las otras 2 (Línea/Denial dependen de otros archivos, no del
// corpus de partidas profesionales, así que no son accionables para "recoger más data").
// Store aparte de RandomDraftStore (store.ts) a propósito -- ese store declara explícitamente
// "puro estado local, ninguna acción llama a un endpoint HTTP", y este SÍ termina en un POST
// (use-random-draft-session.ts, al llegar a la fase "complete").
export interface LowConfidenceSighting {
  hero: HeroId;
  heroName: string;
  rank: 1 | 2 | 3;
}

interface LowConfidenceStoreState {
  sightings: Map<HeroId, LowConfidenceSighting>;
  record(sighting: LowConfidenceSighting): void;
  reset(): void;
}

export const useLowConfidenceStore = create<LowConfidenceStoreState>((set) => ({
  sightings: new Map(),
  record(sighting) {
    // El rank más reciente gana -- una sola fila por héroe, no una por cada vez que apareció
    // en el Top 3 a lo largo del draft.
    set((state) => {
      const next = new Map(state.sightings);
      next.set(sighting.hero, sighting);
      return { sightings: next };
    });
  },
  reset() {
    set({ sightings: new Map() });
  },
}));
