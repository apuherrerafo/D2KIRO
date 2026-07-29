// S7 (fase 1b, SPEC.md §9.4): cálculo puro del pool propuesto. Cero I/O -- la ventana de fecha ya
// se filtró en la llamada a OpenDota (TSK-018), esta función no vuelve a filtrar por fecha. `now`
// se inyecta como parámetro (regla dura del proyecto: sin `Date.now()` propio en una función pura,
// mismo principio que `applyDraftEvent`/`buildSuggestions`).

export interface HeroPoolInputRow {
  heroId: number;
  games: number;
  wins: number;
}

export interface HeroPoolEntry {
  hero: number;
  source: "manual" | "calculated";
  personalWinrate: number | null;
  personalGames: number;
  updatedAt: string;
}

export interface CalculateProposedPoolResult {
  proposed: HeroPoolEntry[];
  baselineWinrate: number;
  consideredHeroes: number;
}

const MIN_GAMES = 10;
const SHRINK_K = 10;
const MAX_POOL_SIZE = 5;

interface ScoredRow extends HeroPoolInputRow {
  shrunk: number;
}

function computeBaseline(rows: HeroPoolInputRow[]): number {
  const totalGames = rows.reduce((sum, row) => sum + row.games, 0);
  if (totalGames === 0) return 0;
  const totalWins = rows.reduce((sum, row) => sum + row.wins, 0);
  return totalWins / totalGames;
}

function shrink(row: HeroPoolInputRow, baseline: number): number {
  return (row.wins + SHRINK_K * baseline) / (row.games + SHRINK_K);
}

export function calculateProposedPool(
  heroRows: HeroPoolInputRow[],
  now: () => string,
): CalculateProposedPoolResult {
  const consideredHeroes = heroRows.length;
  // Paso 2: el baseline se calcula sobre TODAS las filas, no solo las que pasan el mínimo -- si se
  // calculara solo sobre los elegibles, un héroe con pocas partidas y un winrate atípico distorsiona
  // el baseline de forma indebida.
  const baselineWinrate = computeBaseline(heroRows);

  // Paso 1: descartar héroes con menos de MIN_GAMES partidas en la ventana.
  const eligible = heroRows.filter((row) => row.games >= MIN_GAMES);

  // Paso 3: suavizado hacia el baseline (K=10).
  const scored: ScoredRow[] = eligible.map((row) => ({ ...row, shrunk: shrink(row, baselineWinrate) }));

  // Paso 4: orden por shrunk descendente, desempate por partidas jugadas descendente.
  scored.sort((a, b) => b.shrunk - a.shrunk || b.games - a.games);

  // Paso 5: "hasta 5" es un techo, no un piso.
  const timestamp = now();
  const proposed: HeroPoolEntry[] = scored.slice(0, MAX_POOL_SIZE).map((row) => ({
    hero: row.heroId,
    source: "calculated",
    personalWinrate: row.games > 0 ? row.wins / row.games : null,
    personalGames: row.games,
    updatedAt: timestamp,
  }));

  return { proposed, baselineWinrate, consideredHeroes };
}
