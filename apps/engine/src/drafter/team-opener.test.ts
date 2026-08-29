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
    const withCounterBanned = recommendTeamOpeners({
      candidates,
      banned: [90],
      heroNames: { 1: "Warlock", 90: "Silencer" },
    });

    const before = withoutBan.find((option) => option.hero === 1)!;
    const after = withCounterBanned.find((option) => option.hero === 1)!;
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.evidence).toContainEqual({ kind: "counter_relief", hero: 90, source: "statistical" });
    expect(after.summary).toContain("Silencer está baneado");
    expect(after.summary).toContain("Warlock");
  });

  test("no inventa alivio cuando el ban no era un matchup adverso", () => {
    const result = recommendTeamOpeners({ candidates, banned: [91] });
    const option = result.find((item) => item.hero === 1)!;

    expect(option.evidence).toEqual([]);
    expect(option.summary).not.toContain("seguro");
  });

  // TSK-191: la capa curada de counter-picks alimenta el alivio por bans de la apertura.
  test("un counter CURADO baneado eleva al candidato (sin matchup estadístico de por medio)", () => {
    const curatedCands: TeamOpenerCandidate[] = [
      { hero: 10, baseScore: 0.6, strategy: "teamfight", matchups: [], curatedCounters: [{ vs: 69, level: "hard" }, { vs: 26, level: "medium" }] },
      { hero: 11, baseScore: 0.62, strategy: "push", matchups: [], curatedCounters: [{ vs: 99, level: "hard" }] },
    ];
    const noBan = recommendTeamOpeners({ candidates: curatedCands, banned: [] });
    const withBan = recommendTeamOpeners({ candidates: curatedCands, banned: [69, 26], heroNames: { 10: "Morphling", 69: "Doom", 26: "Lion" } });

    const before = noBan.find((o) => o.hero === 10)!;
    const after = withBan.find((o) => o.hero === 10)!;
    expect(after.score).toBeCloseTo(before.score + 0.12 + 0.06, 10); // hard + medium
    expect(after.evidence).toContainEqual({ kind: "counter_relief", hero: 69, source: "curated", level: "hard" });
    expect(after.summary).toContain("Doom");
    expect(after.summary).toContain("Lion");
    // Con 10 ahora en 0.6 + 0.18 = 0.78 supera a 11 (0.62) -> el top-5 se reordena.
    expect(withBan.map((o) => o.hero)).toEqual([10, 11]);
    expect(noBan.map((o) => o.hero)).toEqual([11, 10]);
  });

  test("prioridad curada: un vs que es curado y matchup estadístico ≥200 cuenta una sola vez", () => {
    const cand: TeamOpenerCandidate[] = [
      { hero: 20, baseScore: 0.6, strategy: "teamfight", matchups: [{ vsHero: 68, games: 400, wins: 120 }], curatedCounters: [{ vs: 68, level: "hard" }] },
    ];
    const result = recommendTeamOpeners({ candidates: cand, banned: [68] });
    const option = result[0]!;
    expect(option.evidence).toEqual([{ kind: "counter_relief", hero: 68, source: "curated", level: "hard" }]);
    expect(option.score).toBeCloseTo(0.6 + 0.12, 10); // sólo el peso curado, no también el estadístico
  });

  test("sensibilidad: dos sets de bans distintos producen un top-5 medible mente distinto", () => {
    const cands: TeamOpenerCandidate[] = [
      { hero: 30, baseScore: 0.70, strategy: "teamfight", matchups: [], curatedCounters: [{ vs: 1, level: "hard" }, { vs: 2, level: "hard" }] },
      { hero: 31, baseScore: 0.71, strategy: "push", matchups: [], curatedCounters: [{ vs: 3, level: "hard" }, { vs: 4, level: "hard" }] },
      { hero: 32, baseScore: 0.72, strategy: "pickoff", matchups: [], curatedCounters: [] },
    ];
    const bansA = recommendTeamOpeners({ candidates: cands, banned: [1, 2] }).map((o) => o.hero); // favorece a 30
    const bansB = recommendTeamOpeners({ candidates: cands, banned: [3, 4] }).map((o) => o.hero); // favorece a 31
    expect(bansA[0]).toBe(30);
    expect(bansB[0]).toBe(31);
    expect(bansA).not.toEqual(bansB);
  });

  test("prioriza alternativas de estrategia distinta antes de repetir la misma", () => {
    const result = recommendTeamOpeners({ candidates, banned: [], limit: 3 });

    expect(result.map((option) => option.strategy)).toEqual(["push", "pickoff", "teamfight"]);
  });

  test("da una razón de apertura propia a cada plan, sin reutilizar una plantilla genérica", () => {
    const result = recommendTeamOpeners({
      candidates,
      banned: [],
      limit: 3,
      heroNames: { 1: "Warlock", 2: "Leshrac", 3: "Spirit Breaker" },
    });

    expect(result.map((option) => option.summary)).toEqual([
      "Leshrac abre un plan de presión a estructuras.",
      "Spirit Breaker abre un plan de pickoff e iniciación.",
      "Warlock abre un plan de peleas de equipo.",
    ]);
  });
});
