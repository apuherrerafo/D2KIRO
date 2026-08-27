import { expect, test } from "bun:test";
import { aggregateExpandedMatchups, buildExplorerSql, EXPLORER_SQL } from "./fetch-expanded-matchups";

test("agrega filas Explorer, acepta envelope rows y descarta datos bajo el umbral", () => {
  const rows = aggregateExpandedMatchups({ rows: [
    { hero_id: 2, vs_hero_id: 1, games: 100, wins: 48 },
    { hero_id: 2, vs_hero_id: 1, games: 100, wins: 52 },
    { hero_id: 2, vs_hero_id: 3, games: 199, wins: 100 },
    { hero_id: 2, vs_hero_id: 4, games: 300, wins: 301 },
  ] });
  expect(rows).toEqual([
    { hero_id: 2, vs_hero_id: 1, games: 200, wins: 100 },
  ]);
});

test("salida determinista y segura: filas inválidas no llegan al snapshot", () => {
  expect(aggregateExpandedMatchups([{ hero_id: 5, vs_hero_id: 2, games: 200, wins: 100 }, { hero_id: "5" }])).toEqual([
    { hero_id: 5, vs_hero_id: 2, games: 200, wins: 100 },
  ]);
  expect(() => aggregateExpandedMatchups({ nope: [] })).toThrow("array de filas");
});

test("la consulta Explorer filtra All Pick, ranked alto y exige 200 partidas", () => {
  expect(EXPLORER_SQL).toContain("unnest(m.radiant_team)");
  expect(EXPLORER_SQL).toContain("avg_rank_tier >= 60");
  expect(EXPLORER_SQL).toContain("LIMIT 1000");
  expect(aggregateExpandedMatchups([{ hero_id: 1, vs_hero_id: 2, games: 199, wins: 100 }])).toEqual([]);
  expect(buildExplorerSql(12345)).toContain("match_id < 12345");
});
