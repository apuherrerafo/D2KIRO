import type { DraftState } from "../draft/reducer";
import type { Bracket } from "../meta/mappers";
import type { HeroPatchBracketStat, MetaSnapshot, SignalContribution, SignalScorer } from "./types";

export const MIN_PATCH_GAMES = 500;
export const MIN_PATCH_META_COVERAGE_HEROES = 20; // amplitud mínima -- no "2 héroes con suerte"
export const MIN_PATCH_META_COVERAGE_RATIO = 0.5; // mayoría de los héroes con alguna fila de ESE parche

// El producto está dirigido a jugadores de nivel bajo/medio, nunca a pro (architecture.md,
// Bloque 1). No hay taxonomía oficial de Valve para ese corte -- se toma la mitad inferior de
// la escalera de 8 brackets de OpenDota (mappers.ts BRACKETS) como un único "bracket bajo/medio"
// agregado. Immortal/divine/ancient/legend quedan fuera a propósito.
const LOW_MID_BRACKETS: readonly Bracket[] = ["herald", "guardian", "crusader", "archon"];

// Exportada para que `mix.ts` (readiness de `patch_meta`, AP Solo Mid data/signal repair) mida la
// COBERTURA agregada del parche sin duplicar el filtro de bracket -- misma función que ya usa el
// scorer por candidato, aplicada aquí a nivel de dataset completo.
export function lowMidTotals(rows: HeroPatchBracketStat[], patch: string): { games: number; wins: number } {
  return rows
    .filter((row) => row.patch === patch && LOW_MID_BRACKETS.includes(row.bracket))
    .reduce((acc, row) => ({ games: acc.games + row.picks, wins: acc.wins + row.wins }), {
      games: 0,
      wins: 0,
    });
}

export function patchMetaReady(state: DraftState, meta: MetaSnapshot): boolean {
  if (!state.patch || state.patch === "unknown") return false;
  const rows = meta.patchStats ?? {};
  let withAnyRowForPatch = 0;
  let withCoverage = 0;
  for (const heroRows of Object.values(rows)) {
    if (!heroRows.some((row) => row.patch === state.patch)) continue;
    withAnyRowForPatch++;
    if (lowMidTotals(heroRows, state.patch).games >= MIN_PATCH_GAMES) withCoverage++;
  }
  if (withAnyRowForPatch === 0 || withCoverage < MIN_PATCH_META_COVERAGE_HEROES) return false;
  return withCoverage / withAnyRowForPatch >= MIN_PATCH_META_COVERAGE_RATIO;
}


export const patchMetaScorer: SignalScorer = {
  id: "patch_meta",
  score(state, candidate, meta): SignalContribution {
    const rows = meta.patchStats?.[candidate] ?? [];
    const { games, wins } = lowMidTotals(rows, state.patch);

    if (games < MIN_PATCH_GAMES) {
      return {
        signal: "patch_meta",
        raw: null,
        weighted: 0,
        explanation: "Sin datos suficientes de este parche en bracket bajo/medio",
        sampleSize: 0,
      };
    }

    const winrate = wins / games;
    return {
      signal: "patch_meta",
      raw: winrate,
      weighted: 0,
      explanation: `Winrate de ${(winrate * 100).toFixed(1)}% este parche en bracket bajo/medio`,
      sampleSize: games,
    };
  },
};
