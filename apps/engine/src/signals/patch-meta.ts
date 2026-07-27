import type { Bracket } from "../meta/mappers";
import type { HeroPatchBracketStat, SignalContribution, SignalScorer } from "./types";

const MIN_PATCH_GAMES = 500;

// El producto está dirigido a jugadores de nivel bajo/medio, nunca a pro (architecture.md,
// Bloque 1). No hay taxonomía oficial de Valve para ese corte -- se toma la mitad inferior de
// la escalera de 8 brackets de OpenDota (mappers.ts BRACKETS) como un único "bracket bajo/medio"
// agregado. Immortal/divine/ancient/legend quedan fuera a propósito.
const LOW_MID_BRACKETS: readonly Bracket[] = ["herald", "guardian", "crusader", "archon"];

function lowMidTotals(rows: HeroPatchBracketStat[], patch: string): { games: number; wins: number } {
  return rows
    .filter((row) => row.patch === patch && LOW_MID_BRACKETS.includes(row.bracket))
    .reduce((acc, row) => ({ games: acc.games + row.picks, wins: acc.wins + row.wins }), {
      games: 0,
      wins: 0,
    });
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
