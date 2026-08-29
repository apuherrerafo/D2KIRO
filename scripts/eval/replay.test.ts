import { describe, expect, test } from "bun:test";
import { buildReplayCases } from "./replay";
import type { ProDraftTurn, ReplayMeta } from "./types";

const META: ReplayMeta = { matchId: "M1", leagueId: 42, tier: "professional", patch: "60" };

// Un draft CM plausible: 24 turnos, bans y picks alternados de forma laxa. team 0 = Radiant.
// Sólo importa la FORMA (24 turnos, orders 0..23 únicos, héroes de pick sin repetir).
function draft24(): ProDraftTurn[] {
  const turns: ProDraftTurn[] = [];
  for (let order = 0; order < 24; order++) {
    const team = (order % 2) as 0 | 1;
    // los primeros 8 turnos bans, luego mezcla — no tiene que ser la tabla real de Valve
    const isPick = order >= 6 && order % 3 !== 0;
    turns.push({ order, isPick, hero: 100 + order, team });
  }
  return turns;
}

describe("buildReplayCases — S15", () => {
  test("prueba de no-fuga: el estado en turnIndex no contiene ningún héroe de [turnIndex, 24)", () => {
    const turns = draft24();
    const { cases } = buildReplayCases(turns, META);
    expect(cases.length).toBeGreaterThan(0);

    const sorted = [...turns].sort((a, b) => a.order - b.order);
    for (const c of cases) {
      const futureHeroes = new Set(sorted.slice(c.turnIndex).map((t) => t.hero));
      const inState = [...c.state.banned, ...c.state.picks.radiant, ...c.state.picks.dire];
      for (const h of inState) {
        expect(futureHeroes.has(h)).toBe(false);
      }
      // y el actualHero es exactamente el héroe del turno turnIndex
      expect(c.actualHero).toBe(sorted[c.turnIndex]!.hero);
      // el estado tiene exactamente turnIndex acciones aplicadas
      expect(inState.length).toBe(c.turnIndex);
      expect(c.state.lastSeq).toBe(c.turnIndex);
    }
  });

  test("localSide es el equipo que actúa; los picks previos se reparten por lado", () => {
    // order 6 (team 0, pick), order 7 (team 1, pick), order 8 (team 0, ban)...
    const turns = draft24();
    const { cases } = buildReplayCases(turns, META);

    const firstDireCase = cases.find((c) => c.side === "dire");
    expect(firstDireCase).toBeDefined();
    expect(firstDireCase!.state.localSide).toBe("dire");

    // en ese caso, los picks de Radiant en el estado son sólo los de turnos previos con team 0
    const sorted = [...turns].sort((a, b) => a.order - b.order);
    const expectedRadiant = sorted
      .slice(0, firstDireCase!.turnIndex)
      .filter((t) => t.isPick && t.team === 0)
      .map((t) => t.hero);
    expect(firstDireCase!.state.picks.radiant).toEqual(expectedRadiant);
  });

  test("decisionContext: primer pick del draft = team_opening; con 2+2 = response; con 4+4 = closing", () => {
    // draft construido a mano para forzar los 3 contextos
    const turns: ProDraftTurn[] = [];
    // 6 bans (orders 0-5), luego picks
    for (let o = 0; o < 6; o++) turns.push({ order: o, isPick: false, hero: 10 + o, team: (o % 2) as 0 | 1 });
    // picks: R,D,R,D,R,D,R,D,R,D (orders 6..15) + 8 bans más (orders 16..23)
    const pickTeams: (0 | 1)[] = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
    pickTeams.forEach((team, k) => turns.push({ order: 6 + k, isPick: true, hero: 200 + k, team }));
    for (let o = 16; o < 24; o++) turns.push({ order: o, isPick: false, hero: 50 + o, team: (o % 2) as 0 | 1 });

    const { cases } = buildReplayCases(turns, META);
    const byIndex = new Map(cases.map((c) => [c.turnIndex, c]));

    // turno 6: primer pick, 0 picks en el tablero -> team_opening
    expect(byIndex.get(6)!.decisionContext).toBe("team_opening");
    // turno 10: 2 picks propios (team 0 en 6 y 8) y 2 rivales (team 1 en 7 y 9) -> response_pick
    expect(byIndex.get(10)!.decisionContext).toBe("response_pick");
    // turno 14: 4 y 4 -> closing_pick
    expect(byIndex.get(14)!.decisionContext).toBe("closing_pick");
  });

  test("shape inválido: 23 turnos -> 0 casos, 1 skipped con motivo", () => {
    const turns = draft24().slice(0, 23);
    const res = buildReplayCases(turns, META);
    expect(res.cases).toHaveLength(0);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]!.matchId).toBe("M1");
    expect(res.skipped[0]!.reason).toContain("23");
  });

  test("shape inválido: héroe pickeado dos veces -> skipped", () => {
    const turns = draft24();
    const firstPick = turns.find((t) => t.isPick)!;
    const secondPick = turns.filter((t) => t.isPick)[1]!;
    secondPick.hero = firstPick.hero;
    const res = buildReplayCases(turns, META);
    expect(res.cases).toHaveLength(0);
    expect(res.skipped[0]!.reason).toContain("dos veces");
  });

  test("los bans se reconstruyen como estado pero NUNCA son un caso", () => {
    const turns = draft24();
    const { cases } = buildReplayCases(turns, META);
    for (const c of cases) expect(c.action).toBe("pick");
    // hay bans en el draft y aparecen en state.banned de algún caso tardío
    const late = cases[cases.length - 1]!;
    expect(late.state.banned.length).toBeGreaterThan(0);
  });

  test("entrada sin ordenar se ordena por order antes de reconstruir", () => {
    const turns = draft24();
    const shuffled = [turns[5]!, turns[0]!, turns[23]!, ...turns.filter((_, i) => ![0, 5, 23].includes(i))];
    const a = buildReplayCases(turns, META);
    const b = buildReplayCases(shuffled, META);
    expect(b.cases).toEqual(a.cases);
  });
});
