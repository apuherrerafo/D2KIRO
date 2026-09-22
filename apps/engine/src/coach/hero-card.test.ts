import { describe, expect, test } from "bun:test";
import { buildHeroCard, candidateServesPosition, curatedFlexPositions, demoteRevealedHardCountered, deriveHeroBadges, extractHeroCandidates } from "./hero-card";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { neutralImpact, recSet, resolvedImpact, roleOnlyHero, signal, singleRec, type HeroFixture } from "./test.fixtures";

// AP Ranked Roles V1 / Wave 2 (task 17) -- badges come from real evidence only.

const withCounter: HeroFixture = {
  heroId: 7,
  signals: [signal("counter", 0.6, 20, { normalized: 80 }), signal("position_fit", 0.5, 5, { normalized: 40 })],
  impact: resolvedImpact(3),
};

describe("deriveHeroBadges", () => {
  test("pool configurado y héroe en el pool -> YOUR_POOL", () => {
    expect(deriveHeroBadges(singleRec(withCounter), [7, 8])).toContain("YOUR_POOL");
  });

  test("pool configurado y héroe fuera -> OUTSIDE_YOUR_POOL (y nunca YOUR_POOL)", () => {
    const badges = deriveHeroBadges(singleRec(withCounter), [8, 9]);
    expect(badges).toContain("OUTSIDE_YOUR_POOL");
    expect(badges).not.toContain("YOUR_POOL");
  });

  test("sin pool configurado (Wave 2) ninguna insignia de pool", () => {
    const badges = deriveHeroBadges(singleRec(withCounter), []);
    expect(badges).not.toContain("YOUR_POOL");
    expect(badges).not.toContain("OUTSIDE_YOUR_POOL");
  });

  test("las insignias reusan la regla que V6 ya aplica para CITAR una señal: dato propio + aporta; counter/synergy además raw > 0 (sin umbral nuevo)", () => {
    const hero: HeroFixture = {
      heroId: 1,
      signals: [signal("counter", 0.01, 1), signal("team_synergy", 0.3, 2), signal("position_fit", 0.2, 3), signal("patch_meta", 0.1, 4)],
      impact: resolvedImpact(1),
    };
    // COUNTER additionally needs a REVEALED enemy to be about (Dota-Judge RB-3); POSITION_FIT is never a badge.
    expect(deriveHeroBadges(singleRec(hero), [], 1, [], { revealedEnemies: [50] })).toEqual(["COUNTER", "SYNERGY", "META"]);
  });

  describe("Dota-Judge RB-3 -- semántica de insignias", () => {
    // Hero 7 = the candidate. A statistical counter vote carries sampleSize > 0 (games vs revealed enemies); a
    // ban-relief-only vote carries sampleSize 0 (it names no enemy at all).
    const statistical: HeroFixture = { heroId: 7, signals: [signal("counter", 0.05, 10, { sampleSize: 40 })], impact: resolvedImpact(3) };
    const banReliefOnly: HeroFixture = { heroId: 7, signals: [signal("counter", 0.04, 10, { sampleSize: 0 })], impact: resolvedImpact(3) };
    const curated = new Map<number, CuratedCounter[]>([[50, [{ vs: 7, level: "hard", why: "fixture" }]]]);

    test("0 enemigos revelados -> 0 insignias COUNTER, aunque `counter` aporte (alivio de baneo / evidencia sin objetivo)", () => {
      expect(deriveHeroBadges(singleRec(statistical), [], 7, [], { revealedEnemies: [], heroCounters: curated })).not.toContain("COUNTER");
      expect(deriveHeroBadges(singleRec(banReliefOnly), [], 7, [], { revealedEnemies: [] })).not.toContain("COUNTER");
      expect(deriveHeroBadges(singleRec(statistical), [], 7)).not.toContain("COUNTER"); // sin contexto tampoco
    });

    test("evidencia real contra un rival REVELADO -> COUNTER (estadística con partidas, o relación curada)", () => {
      expect(deriveHeroBadges(singleRec(statistical), [], 7, [], { revealedEnemies: [50] })).toContain("COUNTER");
      expect(deriveHeroBadges(singleRec(banReliefOnly), [], 7, [], { revealedEnemies: [50], heroCounters: curated })).toContain("COUNTER");
    });

    test("un aporte genérico de `counter` (sólo alivio de baneo) sin relación con el rival revelado NO da COUNTER", () => {
      const elsewhere = new Map<number, CuratedCounter[]>([[99, [{ vs: 7, level: "hard", why: "vs un héroe que no está revelado" }]]]);
      expect(deriveHeroBadges(singleRec(banReliefOnly), [], 7, [], { revealedEnemies: [50], heroCounters: elsewhere })).not.toContain("COUNTER");
    });

    test("POSITION_FIT no se muestra como insignia aunque la señal vote con dato", () => {
      const fit: HeroFixture = { heroId: 7, signals: [signal("position_fit", 0.9, 20)], impact: resolvedImpact(3) };
      expect(deriveHeroBadges(singleRec(fit), [], 7)).not.toContain("POSITION_FIT");
    });
  });

  describe("Dota-Judge RB-4 -- democión categórica por counter duro curado revelado", () => {
    const hardVs = (vs: number): CuratedCounter => ({ vs, level: "hard", why: "fixture" });
    const counters = new Map<number, CuratedCounter[]>([
      [1, [hardVs(50)]], // hero 1 is hard-countered by 50
      [3, [{ vs: 50, level: "medium", why: "fixture" }]], // medium never demotes
      [4, [hardVs(60)]], // countered by a hero that is NOT revealed
    ]);
    const order = [1, 2, 3, 4, 5].map((heroId) => ({ heroId }));

    test("los que tienen un counter duro revelado van detrás, y el orden V6 se conserva dentro de cada grupo", () => {
      expect(demoteRevealedHardCountered(order, [50], counters).map((c) => c.heroId)).toEqual([2, 3, 4, 5, 1]);
    });

    test("medium y counters duros NO revelados no demotan", () => {
      expect(demoteRevealedHardCountered(order, [], counters).map((c) => c.heroId)).toEqual([1, 2, 3, 4, 5]);
      expect(demoteRevealedHardCountered(order, [60], counters).map((c) => c.heroId)).toEqual([1, 2, 3, 5, 4]);
    });

    test("si TODOS están counterados no se descarta nada y el orden es el V6", () => {
      const all = new Map<number, CuratedCounter[]>(order.map(({ heroId }) => [heroId, [hardVs(50)]]));
      expect(demoteRevealedHardCountered(order, [50], all).map((c) => c.heroId)).toEqual([1, 2, 3, 4, 5]);
    });

    test("sin mapa curado no cambia nada", () => {
      expect(demoteRevealedHardCountered(order, [50], undefined).map((c) => c.heroId)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("Dota-Judge RB-2 -- candidateServesPosition", () => {
    const positions: HeroPositions = { 9: [{ position: 4, matches: 900 }, { position: 2, matches: 300 }], 8: [{ position: 2, matches: 5000 }, { position: 4, matches: 300 }] };
    const candidate = (heroId: number, impact: ReturnType<typeof resolvedImpact> | ReturnType<typeof neutralImpact>) =>
      extractHeroCandidates(recSet([{ heroId, signals: [signal("position_fit", 0.5, 10)], impact }]), positions)[0]!;

    test("un héroe con rol resuelto sirve exactamente esa posición (lo que dice su tarjeta), no una segunda oculta", () => {
      const resolved = candidate(9, resolvedImpact(4));
      expect(candidateServesPosition(resolved, 4, positions)).toBe(true);
      expect(candidateServesPosition(resolved, 2, positions)).toBe(false);
    });

    test("un héroe sin rol resuelto sirve una posición sólo si la evidencia curada la hace creíble (Invoker-4 no)", () => {
      const supportish = candidate(9, neutralImpact());
      const invokerLike = candidate(8, neutralImpact());
      expect(candidateServesPosition(supportish, 4, positions)).toBe(true); // dominant
      expect(candidateServesPosition(invokerLike, 4, positions)).toBe(false); // 300 of 5300, not dominant
    });
  });

  test("un counter NEGATIVO (raw <= 0) no da insignia aunque su weighted sea > 0; una señal sin aporte (weighted 0) tampoco", () => {
    const hero: HeroFixture = { heroId: 1, signals: [signal("counter", -0.05, 9), signal("team_synergy", 0, 9), signal("position_fit", 0.9, 0)], impact: resolvedImpact(1) };
    expect(deriveHeroBadges(singleRec(hero), [])).toEqual([]);
  });

  test("una señal con raw:null (relleno de la media) NUNCA da insignia, aunque su weighted sea alto", () => {
    const filler: HeroFixture = { heroId: 1, signals: [signal("counter", null, 40), signal("patch_meta", null, 40)], impact: resolvedImpact(1) };
    expect(deriveHeroBadges(singleRec(filler), [])).toEqual([]);
  });

  test("evidencia vacía -> ninguna insignia espuria", () => {
    const bare: HeroFixture = { heroId: 1, signals: [], impact: resolvedImpact(1) };
    expect(deriveHeroBadges(singleRec(bare), [])).toEqual([]);
  });

  test("META se suprime cuando el meta está stale", () => {
    const meta: HeroFixture = { heroId: 1, signals: [signal("patch_meta", 0.6, 20)], impact: resolvedImpact(1) };
    const fresh = singleRec(meta);
    expect(deriveHeroBadges(fresh, [])).toContain("META");
    const stale = { ...fresh, risks: [{ kind: "degraded_meta" as const, detail: "stale" }] };
    expect(deriveHeroBadges(stale, [])).not.toContain("META");
  });

  test("FLEX es la definición del repo: el catálogo curado registra al héroe en 2+ posiciones", () => {
    const hero: HeroFixture = { heroId: 1, signals: [], impact: resolvedImpact(2) };
    const positions: HeroPositions = { 1: [{ position: 2, matches: 500 }, { position: 3, matches: 100 }], 2: [{ position: 1, matches: 900 }] };
    expect(curatedFlexPositions(1, positions)).toEqual([2, 3]);
    expect(curatedFlexPositions(2, positions)).toEqual([]);
    expect(curatedFlexPositions(3, positions)).toEqual([]);
    expect(curatedFlexPositions(1, undefined)).toEqual([]);
    const [candidate] = extractHeroCandidates(recSet([hero]), positions);
    expect(buildHeroCard(candidate!, []).badges).toContain("FLEX");
    const [single] = extractHeroCandidates(recSet([{ ...hero, heroId: 2 }]), positions);
    expect(buildHeroCard(single!, []).badges).not.toContain("FLEX");
  });

  test("no se fabrican insignias de Wave 3/4: SAFE, GOOD_ON_SIDE, COUNTERS_BANNED", () => {
    const badges: string[] = deriveHeroBadges(singleRec(withCounter), [7]);
    for (const banned of ["SAFE", "GOOD_ON_SIDE", "COUNTERS_BANNED"]) expect(badges).not.toContain(banned);
  });
});

describe("extractHeroCandidates / buildHeroCard", () => {
  test("ordena por el score V6 propio del héroe (suma de sus contribuciones), estable en empates", () => {
    const set = recSet([roleOnlyHero(1, 1, 5), roleOnlyHero(2, 2, 9), roleOnlyHero(3, 3, 9)]);
    expect(extractHeroCandidates(set).map((candidate) => candidate.heroId)).toEqual([2, 3, 1]);
  });

  test("una recomendación compuesta (dos héroes) aporta ambos como candidatos, cada uno con su propio score", () => {
    const a = singleRec(roleOnlyHero(1, 1, 5));
    const b = singleRec(roleOnlyHero(2, 2, 9), 1);
    const compound = {
      ...a,
      actions: [...a.actions, ...b.actions],
      signalsByHero: { ...a.signalsByHero, ...b.signalsByHero },
      roleImpact: { ...a.roleImpact, ...b.roleImpact },
      score: 14,
    };
    const set = { ...recSet([]), recommendations: [compound] };
    expect(extractHeroCandidates(set).map((candidate) => [candidate.heroId, candidate.score])).toEqual([[2, 9], [1, 5]]);
  });

  test("la tarjeta acompaña la posición con roleStatus: un rol UNRESOLVED no se muestra como cierto", () => {
    const unresolved: HeroFixture = { heroId: 1, signals: [signal("position_fit", 0.6, 5)], impact: neutralImpact() };
    const [candidate] = extractHeroCandidates(recSet([unresolved]));
    const card = buildHeroCard(candidate!, []);
    expect(card.roleStatus).toBe("UNRESOLVED");
    expect(card.isFromPool).toBe(false);
  });

  test("el rationale sale de la señal real más fuerte; sin señal con dato no se inventa una razón", () => {
    const [strong] = extractHeroCandidates(recSet([withCounter]));
    expect(buildHeroCard(strong!, []).rationale).toBe("counter fixture");
    const bare: HeroFixture = { heroId: 1, signals: [signal("counter", null, 3)], impact: resolvedImpact(1) };
    const [none] = extractHeroCandidates(recSet([bare]));
    expect(buildHeroCard(none!, []).rationale).toBe("Sin señal con datos propios suficientes.");
  });
});
