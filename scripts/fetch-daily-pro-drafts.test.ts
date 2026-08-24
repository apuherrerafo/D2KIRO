import { describe, expect, test } from "bun:test";
import { filterTier1LeagueIds, scanTier1Tournaments, selectNewMatchesToFetch } from "./fetch-daily-pro-drafts";
import type { DailyProMatchSummary, LeagueSummary } from "./fetch-daily-pro-drafts";

// Ingesta incremental por torneo (Fase Soft Launch, sesión Gobernanza 2.0). Fixtures sintéticos --
// nunca /leagues ni /proMatches reales (10108 ligas reales, se regenera solo con el tiempo, mismo
// criterio que capabilities.json/hero-positions.json: un test atado a datos reales se rompería en
// silencio, testing-seams.md).

function league(leagueid: number, tier: string | null): LeagueSummary {
  return { leagueid, tier };
}

function match(matchId: number, startTime: number, leagueid: number, leagueName: string): DailyProMatchSummary {
  return { match_id: matchId, start_time: startTime, leagueid, league_name: leagueName };
}

describe("filterTier1LeagueIds -- requisito #1 (filtrado por Tier 1)", () => {
  test("conserva solo leagueid con tier \"premium\", descarta professional/amateur/excluded/null", () => {
    const leagues = [
      league(1, "premium"),
      league(2, "professional"),
      league(3, "amateur"),
      league(4, "excluded"),
      league(5, null),
      league(6, "premium"),
    ];

    const result = filterTier1LeagueIds(leagues);

    expect(result).toEqual(new Set([1, 6]));
  });

  test("una lista sin ninguna liga premium devuelve un Set vacío, nunca lanza", () => {
    const result = filterTier1LeagueIds([league(1, "professional"), league(2, "amateur")]);
    expect(result.size).toBe(0);
  });
});

describe("scanTier1Tournaments -- agrupa por torneo, orden de primera aparición = recencia", () => {
  test("descarta partidas de ligas que no son Tier 1, aunque estén dentro del parche", () => {
    const pages = [[match(1, 200, 10, "Torneo Premium"), match(2, 199, 20, "Liga Professional")]];
    const scan = scanTier1Tournaments(pages, new Set([10]), 0);

    expect(scan.leagueOrder).toEqual([10]);
    expect(scan.matchesByLeague.get(20)).toBeUndefined();
  });

  test("descarta partidas más viejas que el parche activo (start_time < oldestPatchDate)", () => {
    const pages = [[match(1, 50, 10, "Torneo Viejo")]];
    const scan = scanTier1Tournaments(pages, new Set([10]), 100);

    expect(scan.leagueOrder).toEqual([]);
  });

  test("el orden de leagueOrder es el de PRIMERA aparición al escanear -- más reciente primero por construcción", () => {
    // /proMatches ya llega más-reciente-primero -- la página 0 trae el torneo más nuevo.
    const pages = [
      [match(1, 300, 10, "The International"), match(2, 299, 20, "ESL One")],
      [match(3, 250, 10, "The International"), match(4, 240, 30, "DreamLeague")],
    ];
    const scan = scanTier1Tournaments(pages, new Set([10, 20, 30]), 0);

    expect(scan.leagueOrder).toEqual([10, 20, 30]);
    expect(scan.matchesByLeague.get(10)?.length).toBe(2); // las 2 partidas de TI, aunque aparecieron en páginas distintas
    expect(scan.leagueNames.get(10)).toBe("The International");
  });
});

describe("selectNewMatchesToFetch -- requisitos #2 (dedup por match_id) y #3 (tope de torneos/drafts)", () => {
  function scanFixture() {
    return scanTier1Tournaments(
      [
        [match(1, 300, 10, "TI"), match(2, 290, 10, "TI"), match(3, 280, 20, "ESL One"), match(4, 270, 30, "DreamLeague")],
      ],
      new Set([10, 20, 30]),
      0,
    );
  }

  test("un match_id ya presente en el corpus se omite -- nunca dispara pedido de detalle", () => {
    const scan = scanFixture();
    const existing = new Set(["1"]); // match 1 ya está en el corpus

    const toFetch = selectNewMatchesToFetch(scan, existing, 2, 50);

    expect(toFetch.map((m) => m.match_id)).not.toContain(1);
    expect(toFetch.map((m) => m.match_id)).toEqual([2, 3]); // TI (match 2) + ESL One (match 3, dentro del tope de 2 torneos)
  });

  test("respeta el tope de torneos -- nunca toca un tercer torneo aunque tenga partidas nuevas", () => {
    const scan = scanFixture();

    const toFetch = selectNewMatchesToFetch(scan, new Set(), 2, 50);

    expect(toFetch.map((m) => m.match_id)).not.toContain(4); // DreamLeague es el 3er torneo, fuera del tope de 2
  });

  test("respeta el tope de --max-new-drafts aunque haya más torneos/partidas disponibles", () => {
    const scan = scanFixture();

    const toFetch = selectNewMatchesToFetch(scan, new Set(), 3, 2); // 3 torneos permitidos, pero tope de 2 drafts

    expect(toFetch).toHaveLength(2);
    expect(toFetch.map((m) => m.match_id)).toEqual([1, 2]); // corta apenas llega al tope, incluso dentro del mismo torneo
  });

  test("con el corpus vacío y sin ningún tope real, trae todas las partidas de los torneos objetivo", () => {
    const scan = scanFixture();

    const toFetch = selectNewMatchesToFetch(scan, new Set(), 2, 50);

    expect(toFetch.map((m) => m.match_id)).toEqual([1, 2, 3]);
  });
});
