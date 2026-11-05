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


// z de un intervalo de confianza de 95 %: una proporción observada solo "supera" un valor si lo supera aun en el extremo bajo razonable.
const CONFIDENCE_Z = 1.96;
const EVEN_WINRATE = 0.5;
/**
 * Ventaja MÍNIMA que debe sostener el winrate para ser un fundamento (puntos porcentuales sobre 50 %, en el extremo bajo del intervalo). Sin ella, con
 * las muestras enormes del bracket bajo/medio, 50,5 % sobre 270 000 partidas "supera 50 %" y la mitad del universo cuenta como "meta": significancia
 * estadística sin relevancia. Magnitud de criterio, pendiente de que el dueño del producto la confirme (medido con meta fresco: mediana 51,7 %).
 */
const MIN_META_EDGE = 0.02;

/**
 * ¿El winrate observado supera el 50 % con evidencia suficiente Y con una ventaja que importa? Límite inferior de Wilson (95 %) > 50 % + `MIN_META_EDGE`:
 * depende del tamaño de la muestra y del efecto, no solo del porcentaje (54 % sobre 500 partidas NO alcanza; 54 % sobre 5 000 sí; 50,5 % sobre 270 000 NO). Lo usa el contrato de elegibilidad del Coach para decidir si el
 * meta vigente es un fundamento (coach/recommendation-eligibility.ts). Pura; no puntúa ni cambia ninguna señal.
 */
export function winrateClearlyAboveEven(winrate: number, games: number): boolean {
  if (games <= 0) return false;
  const z2 = CONFIDENCE_Z * CONFIDENCE_Z;
  const centre = winrate + z2 / (2 * games);
  const margin = CONFIDENCE_Z * Math.sqrt((winrate * (1 - winrate)) / games + z2 / (4 * games * games));
  return (centre - margin) / (1 + z2 / games) > EVEN_WINRATE + MIN_META_EDGE;
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
