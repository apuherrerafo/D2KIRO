// Fase 9.0 — los rankeadores baseline del backtest (SPEC.md §15.4.3, R1-7).
// Sin baselines, un Recall@3 no dice si el motor aporta algo por encima de "recomendá lo popular".
//
// NOTA (SPEC §15.4.3): "Si algún baseline no se puede obtener sin tocar el motor, se documenta y
// se omite con nota." En 9.0 no se toca apps/engine/src/**. Consecuencias:
//   - `positionFitOnly` se OMITE: aislar una sola señal exigiría un flag nuevo en
//     BuildSuggestionsOptions. Queda documentado aquí y en el reporte.
//   - `v6WithoutCounter` se aproxima con `v6NoCuratedCounters` (heroCounters vacío): la capa
//     estadística de `counter` sigue corriendo, pero el piso curado (Fase 8) se desactiva.
//   - El ranking de V6 llega hasta TOP_N (=6) elementos: Recall@k para k>6 == Recall@6.
//     Parametrizar TOP_N para eval es trabajo de 9.1 (que sí toca el motor).

import { buildSuggestions } from "../../apps/engine/src/signals/mix";
import type { DraftState, HeroId } from "../../apps/engine/src/draft/reducer";
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";

export type Ranker = (state: DraftState, meta: MetaSnapshot) => HeroId[];

export const BASELINE_IDS = ["random", "patchMetaOnly", "v6NoCuratedCounters", "v6Full"] as const;
export type BaselineId = (typeof BASELINE_IDS)[number];

export const OMITTED_BASELINES: { id: string; reason: string }[] = [
  { id: "positionFitOnly", reason: "aislar una sola señal exige un flag nuevo en BuildSuggestionsOptions; 9.0 no toca apps/engine/src/**" },
];

function availableHeroes(state: DraftState, meta: MetaSnapshot): HeroId[] {
  const taken = new Set<HeroId>([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
  return Object.keys(meta.heroes)
    .map(Number)
    .filter((h) => !taken.has(h));
}

// PRNG determinista (mulberry32) sembrado por el estado, para que `random` sea reproducible.
function seededShuffle<T>(items: T[], seedStr: string): T[] {
  let seed = 0;
  for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = (): number => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const rankRandom: Ranker = (state, meta) =>
  seededShuffle(availableHeroes(state, meta), `${state.sessionId}:${state.lastSeq}`);

const rankPatchMetaOnly: Ranker = (state, meta) => {
  const picksOf = (h: HeroId): number =>
    (meta.patchStats?.[h] ?? []).reduce((sum, s) => sum + s.picks, 0);
  return availableHeroes(state, meta).sort((a, b) => picksOf(b) - picksOf(a));
};

const rankV6Full: Ranker = (state, meta) => buildSuggestions(state, meta, {}).suggestions.map((s) => s.hero);

const rankV6NoCuratedCounters: Ranker = (state, meta) =>
  buildSuggestions(state, meta, { heroCounters: new Map() }).suggestions.map((s) => s.hero);

export const RANKERS: Record<BaselineId, Ranker> = {
  random: rankRandom,
  patchMetaOnly: rankPatchMetaOnly,
  v6NoCuratedCounters: rankV6NoCuratedCounters,
  v6Full: rankV6Full,
};
