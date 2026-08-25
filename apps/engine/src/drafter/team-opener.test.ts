import { describe, expect, test } from "bun:test";
import { recommendTeamOpeners, type TeamOpenerCandidate } from "./team-opener";

const candidates: TeamOpenerCandidate[] = [
  {
    hero: 1,
    baseScore: 0.7,
    strategy: "teamfight",
    matchups: [{ vsHero: 90, games: 400, wins: 160 }],
  },
  {
    hero: 2,
    baseScore: 0.72,
    strategy: "push",
    matchups: [],
  },
  {
    hero: 3,
    baseScore: 0.71,
    strategy: "pickoff",
    matchups: [],
  },
  {
    hero: 4,
    baseScore: 0.69,
    strategy: "teamfight",
    matchups: [],
  },
];

describe("recommendTeamOpeners", () => {
  test("excluye héroes baneados aun cuando tenían el mayor puntaje base", () => {
    const result = recommendTeamOpeners({ candidates, banned: [2] });

    expect(result.map((option) => option.hero)).not.toContain(2);
  });

  test("eleva un candidato cuando un matchup adverso con muestra suficiente ya está baneado", () => {
    const withoutBan = recommendTeamOpeners({ candidates, banned: [] });
    const withCounterBanned = recommendTeamOpeners({ candidates, banned: [90] });

    const before = withoutBan.find((option) => option.hero === 1)!;
    const after = withCounterBanned.find((option) => option.hero === 1)!;
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.evidence).toContainEqual({ kind: "counter_relief", hero: 90 });
    expect(after.summary).toContain("reduce una exposición conocida");
  });

  test("no inventa alivio cuando el ban no era un matchup adverso", () => {
    const result = recommendTeamOpeners({ candidates, banned: [91] });
    const option = result.find((item) => item.hero === 1)!;

    expect(option.evidence).not.toContainEqual({ kind: "counter_relief", hero: 91 });
    expect(option.summary).not.toContain("seguro");
  });

  test("prioriza alternativas de estrategia distinta antes de repetir la misma", () => {
    const result = recommendTeamOpeners({ candidates, banned: [], limit: 3 });

    expect(result.map((option) => option.strategy)).toEqual(["push", "pickoff", "teamfight"]);
  });
});
