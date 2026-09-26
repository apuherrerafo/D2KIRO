import { describe, expect, test } from "bun:test";
import { computeRoleBelief } from "../draft-protocol/roles/role-belief";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import type { FunctionalRecommendationEvidence } from "../recommendation/evidence";
import { createCoachRecommendations } from "../server/routes/coach-recommendations";
import { loadHeroCounters, type CuratedCounter } from "../signals/hero-counters";
import { isCandidateAdmittedForPosition, isCredibleForPosition, type HeroPositions } from "../signals/hero-positions";
import { createCounterScorer } from "../signals/counter";
import type { Suggestion, SuggestionSet } from "../signals/mix";
import type { HeroMatchupStat, MetaSnapshot, SignalContribution } from "../signals/types";
import { credibleHeroesForPosition } from "./hero-card";
import { isPersonalSeatCovered, personalCandidateUniverse } from "./personal-hero-view";
import { harness } from "./session-harness.fixtures";

// WAVE 5 -- Dota Judge remediation (RB-1..RB-4). Release regression suite for the judge scenarios S01 / S04 / S05 / S09 /
// S12 / S13 / S14 / S15. It asserts the PRODUCT INVARIANT each scenario broke, never a copy of an expected hero ranking. Everything is
// inline: no SQLite, no network. S14 tests against the real production curated hero-counters.json catalog. Only V6's scorer is a
// scripted stand-in; the perspective-safe Coach, the orchestrator, the position rules and the store are the real ones.

// ---- inline world -----------------------------------------------------------------------------------------------
const POSITIONS: HeroPositions = {
  11: [{ position: 3, matches: 3000 }], // offlaner
  18: [{ position: 3, matches: 1500 }], // offlaner
  12: [{ position: 5, matches: 3900 }, { position: 4, matches: 1100 }, { position: 3, matches: 670 }], // Winter-Wyvern-like: Pos3 is 12% of its games
  13: [{ position: 5, matches: 1200 }, { position: 4, matches: 344 }, { position: 3, matches: 335 }], // Ogre-Magi-like: Pos3 is 18%
  14: [{ position: 2, matches: 6600 }, { position: 4, matches: 700 }], // Invoker-like: Pos4 is 10%
  15: [{ position: 4, matches: 2000 }, { position: 5, matches: 400 }], // support
  16: [{ position: 5, matches: 2000 }], // hard support only
  17: [{ position: 4, matches: 1500 }, { position: 1, matches: 1400 }], // flex support/carry
  20: [{ position: 1, matches: 4000 }],
  21: [{ position: 1, matches: 3000 }],
  30: [{ position: 2, matches: 1000 }], // Meepo-like mid
  31: [{ position: 2, matches: 900 }],
  32: [{ position: 2, matches: 800 }],
  22: [{ position: 1, matches: 2500 }],
  23: [{ position: 2, matches: 2500 }],
  40: [{ position: 3, matches: 4000 }], // Axe-like enemy
  41: [{ position: 5, matches: 2000 }], // enemy hard support
};
const ALL_HEROES = Object.keys(POSITIONS).map(Number);
const ACCOUNT = 900000001;

interface ScriptOptions {
  /** Heroes V6 may see (default: all). Lets a scenario keep filler heroes of other roles out of the top 6. */
  pool?: readonly number[];
  /** V6 score (position_fit `weighted`) per hero; unlisted heroes get 1. */
  scores: Record<number, number>;
  /** A `counter` vote WITHOUT any enemy behind it (ban relief): raw > 0, sampleSize 0. */
  banReliefOnly?: readonly number[];
  /** A statistical `counter` vote versus revealed enemies: raw > 0, sampleSize > 0. */
  statisticalCounter?: readonly number[];
  /** Wave 5 H1/H3 loophole fixture: statistical delta <= 0, but ban relief makes raw > 0. hasRevealedEnemyCounterEvidence = false. */
  netNegativeWithBanRelief?: readonly number[];
}

interface Call { candidateHeroIds: readonly number[] | undefined; targetPosition: number | undefined; teamOpening: boolean | undefined }

/**
 * Scripted V6. It mimics what the real engine does with the options it is given: a `targetPosition` admits any hero with a
 * curated presence there (the legacy predicate -- exactly what let Winter Wyvern into the Pos3 list), and `candidateHeroIds`
 * narrows the universe BEFORE ranking. Returns at most 6 suggestions (V6's TOP_N).
 *
 * Wave 5 Hardening (RH-R3): uses the REAL createCounterScorer producer to score candidates for S15 / counter evidence scenarios.
 */
function scriptedCompute(
  options: ScriptOptions,
  calls: Call[] = [],
  positions: HeroPositions = POSITIONS,
  heroCounters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map(),
): ComputeSuggestionsForRecommendation {
  const BANNED_FIXTURE_HERO = 90;
  const combinedCurated = new Map<number, CuratedCounter[]>();
  for (const [k, v] of heroCounters.entries()) {
    combinedCurated.set(k, [...v]);
  }
  if (options.netNegativeWithBanRelief) {
    for (const hero of options.netNegativeWithBanRelief) {
      const existing = combinedCurated.get(hero) ?? [];
      combinedCurated.set(hero, [...existing, { vs: BANNED_FIXTURE_HERO, level: "hard", why: "counter 90 baneado" }]);
    }
  }
  if (options.banReliefOnly) {
    for (const hero of options.banReliefOnly) {
      const existing = combinedCurated.get(hero) ?? [];
      combinedCurated.set(hero, [...existing, { vs: BANNED_FIXTURE_HERO, level: "hard", why: "counter 90 baneado" }]);
    }
  }

  const matchups: Record<number, HeroMatchupStat[]> = {};
  if (options.statisticalCounter) {
    for (const hero of options.statisticalCounter) {
      matchups[hero] = [
        { vsHero: 40, games: 60, wins: 45 }, // positive delta vs revealed enemy 40
        { vsHero: 88, games: 60, wins: 15 },
      ];
    }
  }
  if (options.netNegativeWithBanRelief) {
    for (const hero of options.netNegativeWithBanRelief) {
      matchups[hero] = [
        { vsHero: 40, games: 50, wins: 24 }, // negative delta vs revealed enemy 40 (0.48 < baseline 0.50), compensated by ban relief
        { vsHero: 88, games: 50, wins: 26 },
      ];
    }
  }

  const metaSnapshot: MetaSnapshot = {
    heroes: {
      40: { id: 40, localizedName: "héroe 40" },
      41: { id: 41, localizedName: "héroe 41" },
      [BANNED_FIXTURE_HERO]: { id: BANNED_FIXTURE_HERO, localizedName: `héroe ${BANNED_FIXTURE_HERO}` },
    },
    matchups,
  };

  const counterProducer = createCounterScorer(combinedCurated);

  return async (state, _account, opts) => {
    calls.push({ candidateHeroIds: opts?.candidateHeroIds, targetPosition: opts?.targetPosition, teamOpening: opts?.teamOpening });
    const excluded = new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
    const allowed = opts?.candidateHeroIds ? new Set(opts.candidateHeroIds) : null;
    const candidates = (options.pool ?? Object.keys(positions).map(Number)).filter((hero) => !excluded.has(hero) && (allowed === null || allowed.has(hero)) && (opts?.targetPosition === undefined || isCandidateAdmittedForPosition(hero, opts.targetPosition, positions)));
    const suggestions: Suggestion[] = candidates
      .map((hero): Suggestion => {
        const hasCounterVote =
          options.banReliefOnly?.includes(hero) ||
          options.statisticalCounter?.includes(hero) ||
          options.netNegativeWithBanRelief?.includes(hero);

        let counterContrib: SignalContribution;
        if (hasCounterVote) {
          const stateForCounter =
            (options.netNegativeWithBanRelief?.includes(hero) || options.banReliefOnly?.includes(hero)) &&
            !state.banned.includes(BANNED_FIXTURE_HERO)
              ? { ...state, banned: [...state.banned, BANNED_FIXTURE_HERO] }
              : state;
          const produced = counterProducer.score(stateForCounter, hero, metaSnapshot);
          counterContrib = {
            ...produced,
            weighted: 5,
          };
        } else {
          counterContrib = {
            signal: "counter",
            raw: null,
            normalized: null,
            evidenceConfidence: 0,
            weighted: 0,
            explanation: "sin datos",
            sampleSize: 0,
            hasRevealedEnemyCounterEvidence: false,
          };
        }

        const signals: SignalContribution[] = [
          { signal: "position_fit", raw: 0.6, normalized: 60, evidenceConfidence: 1, weighted: options.scores[hero] ?? 1, explanation: `posición de ${hero}`, sampleSize: 100 },
          counterContrib,
        ];
        return { hero, rank: 1, score: signals.reduce((sum, signal) => sum + signal.weighted, 0), signals, reason: `fixture ${hero}`, confidence: "alta", evidenceCoverage: 0.9, guessingIndex: 0.1 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((suggestion, index) => ({ ...suggestion, rank: (index + 1) as Suggestion["rank"] }));
    const functionalEvidence: FunctionalRecommendationEvidence = {
      metaIsStale: false,
      signalEvidence: suggestions.map((s) => ({ hero: s.hero, signals: s.signals.map((e) => ({ signal: e.signal, raw: e.raw, normalized: e.normalized ?? null, evidenceConfidence: e.evidenceConfidence ?? null, explanation: e.explanation, sampleSize: e.sampleSize, applicable: null })) })),
      heroPositions: [],
      teamOpening: null,
      partyPreferredPositions: [],
    };
    const set: SuggestionSet = { schema: "suggestions/v1", sessionId: state.sessionId, basedOnSeq: state.lastSeq, decisionContext: "team_opening", suggestions, comparison: null, degraded: [], computedInMs: 1, functionalEvidence };
    return set;
  };
}

const hard = (vs: number): CuratedCounter => ({ vs, level: "hard", why: "fixture" });

function world(options: ScriptOptions, heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]>, heroPositions?: HeroPositions) {
  const positions = heroPositions ?? POSITIONS;
  const pool = options.pool ?? Object.keys(positions).map(Number);
  const h = harness({ heroPositions: positions, pool, sessionId: "judge-remediation", adapterKind: "manual" });
  const calls: Call[] = [];
  const coach = createCoachRecommendations({
    source: h.store,
    computeSuggestions: scriptedCompute(options, calls, positions, heroCounters),
    heroPositions: positions,
    heroCounters: heroCounters ?? new Map(),
  });
  return { h, calls, ask: (personal: 1 | 2 | 3 | 4 | 5) => coach.recommend(h.id, personal, ACCOUNT) };
}

/** Round 1 played out: our seats hold `own`, the enemy's seats hold `enemy`, so the enemy heroes are now REVEALED. */
function playRoundOne(h: ReturnType<typeof harness>, own: [number, number], enemy: [number, number]): void {
  h.seal(h.side, 0, own[0]);
  h.seal(h.enemy, 0, enemy[0]);
  h.seal(h.side, 1, own[1]);
  h.seal(h.enemy, 1, enemy[1]);
}

/** The public rule for "this card can execute reveal-Pos-P": what the card itself says, or credible curated evidence. */
function cardServes(card: { heroId: number; position: number; roleStatus: string }, position: number): boolean {
  if (card.roleStatus !== "UNRESOLVED") return card.position === position;
  return isCredibleForPosition(card.heroId, position as 1 | 2 | 3 | 4 | 5, POSITIONS);
}

// ---- the position rule -------------------------------------------------------------------------------------------
describe("isCredibleForPosition -- the approved admission policy, applied to every position", () => {
  test("documenta el defecto: el predicado heredado admite a un héroe cuyo Pos3 es el 12% de sus partidas; el creíble no", () => {
    expect(isCandidateAdmittedForPosition(12, 3, POSITIONS)).toBe(true); // "any curated presence" -- the RB-1 root cause
    expect(isCredibleForPosition(12, 3, POSITIONS)).toBe(false);
    expect(isCredibleForPosition(13, 3, POSITIONS)).toBe(false);
    expect(isCredibleForPosition(14, 4, POSITIONS)).toBe(false); // Invoker-like at Pos4
  });

  test("admite la posición dominante (empates incluidos) y la que alcanza la cuota ya aprobada (25%)", () => {
    expect(isCredibleForPosition(11, 3, POSITIONS)).toBe(true); // dominant, single position
    expect(isCredibleForPosition(15, 4, POSITIONS)).toBe(true); // dominant
    expect(isCredibleForPosition(17, 1, POSITIONS)).toBe(true); // 1400 of 2900 = 48% -- a real flex
    expect(isCredibleForPosition(15, 5, POSITIONS)).toBe(false); // 400 of 2400 = 17%
    expect(isCredibleForPosition(11, 4, POSITIONS)).toBe(false); // no presence at all
  });

  test("Mid delega intacto en el predicado de Mid (sigue exigiendo su piso absoluto de evidencia)", () => {
    const thin: HeroPositions = { 1: [{ position: 2, matches: 285 }] }; // a single survivor under the Mid floor
    expect(isCandidateAdmittedForPosition(1, 2, thin)).toBe(false);
    expect(isCredibleForPosition(1, 2, thin)).toBe(false);
    expect(isCredibleForPosition(30, 2, POSITIONS)).toBe(true);
  });

  test("el universo por posición sale sólo de la evidencia curada (nunca de un ranking)", () => {
    expect(credibleHeroesForPosition(3, POSITIONS)).toEqual([11, 18, 40]);
    expect(personalCandidateUniverse(3, POSITIONS)).toEqual([11, 18, 40]);
    expect(credibleHeroesForPosition(4, POSITIONS)).toEqual([15, 17]);
  });
});

// ---- RB-1: S12 / S04 / S13 ---------------------------------------------------------------------------------------
describe("RB-1 -- PersonalHeroView is position-valid (S12, S04, S13)", () => {
  test("S12: el ranking personal de Pos3 sólo contiene héroes admitidos en Pos3, aunque V6 puntúe más alto a los de soporte", async () => {
    const { ask, calls } = world({ scores: { 12: 90, 13: 80, 11: 10, 18: 9, 40: 8 } });
    const personal = (await ask(3))!.output!.personalHeroView!;
    expect(personal.heroes.length).toBeGreaterThan(0);
    for (const hero of personal.heroes) expect(isCredibleForPosition(hero.heroId, 3, POSITIONS)).toBe(true);
    expect(personal.heroes.map((hero) => hero.heroId)).not.toContain(12);
    expect(personal.heroes.map((hero) => hero.heroId)).not.toContain(13);
    // The universe was fixed BEFORE ranking (V6's own candidateHeroIds), not by trimming a finished list.
    const personalCall = calls.find((call) => call.targetPosition === 3)!;
    expect(personalCall.candidateHeroIds).toEqual([11, 18, 40]);
    expect(personalCall.teamOpening).toBe(false);
  });

  test("S04/S13: un Invoker (Pos2 dominante, Pos4 10%) no aparece en el ranking personal de Pos4", async () => {
    const { ask } = world({ scores: { 14: 95, 15: 10, 17: 9 } });
    const ids = (await ask(4))!.output!.personalHeroView!.heroes.map((hero) => hero.heroId);
    expect(ids).not.toContain(14);
    for (const id of ids) expect(isCredibleForPosition(id, 4, POSITIONS)).toBe(true);
  });

  test("el ranking personal sigue siendo independiente del shortlist del equipo (no es un filtro suyo)", async () => {
    const { ask, calls } = world({ scores: { 12: 90, 11: 10, 18: 9 } });
    await ask(3);
    const teamCall = calls.find((call) => call.targetPosition === undefined && call.candidateHeroIds === undefined)!;
    const personalCall = calls.find((call) => call.targetPosition === 3)!;
    expect(teamCall).toBeDefined();
    expect(personalCall).not.toBe(teamCall); // a separate V6 evaluation with its own universe
  });
});

describe("Personal-seat awareness -- 'Tu posición ya está cubierta'", () => {
  test("una posición que los picks propios ocupan en TODA asignación factible se marca cubierta y no lista héroes", async () => {
    const { h, ask } = world({ scores: { 16: 5, 15: 4 } });
    playRoundOne(h, [16, 20], [40, 41]); // hero 16 can only be Pos5
    const personal = (await ask(5))!.output!.personalHeroView!;
    expect(personal.seatCovered).toBe(true);
    expect(personal.heroes).toEqual([]);
    const open = (await ask(4))!.output!.personalHeroView!;
    expect(open.seatCovered).toBe(false);
  });

  test("con dudas NO se oculta: un héroe flexible que puede sentarse en otra posición no cubre ésta", () => {
    const beliefs = new Map([[15, computeRoleBelief({ heroId: 15, heroPositions: POSITIONS })]]);
    expect(isPersonalSeatCovered(beliefs, 4)).toBe(false); // 15 could also be Pos5
    expect(isPersonalSeatCovered(beliefs, 5)).toBe(false);
    expect(isPersonalSeatCovered(new Map([[16, computeRoleBelief({ heroId: 16, heroPositions: POSITIONS })]]), 5)).toBe(true);
    expect(isPersonalSeatCovered(undefined, 5)).toBe(false);
  });

  test("una asignación explícita del Player (CONFIRMED) cubre esa posición", () => {
    const beliefs = new Map([[15, computeRoleBelief({ heroId: 15, confirmedPosition: 4 })]]);
    expect(isPersonalSeatCovered(beliefs, 4)).toBe(true);
  });
});

// ---- RB-2: S01 / S09 ---------------------------------------------------------------------------------------------
describe("RB-2 -- Primary Action and shortlist agree (S01, S09)", () => {
  test("S09: si ningún héroe del ranking sirve a un soporte, la acción NO reclama Pos4/Pos5 (el prior cede)", async () => {
    const { ask } = world({ scores: { 20: 50, 21: 40, 30: 30, 31: 20, 22: 10, 23: 9 }, pool: [20, 21, 22, 23, 30, 31, 32, 11, 18] });
    const output = (await ask(5))!.output!;
    const strategy = output.primaryAction.strategy;
    expect(strategy.kind).toBe("REVEAL_POSITION");
    if (strategy.kind !== "REVEAL_POSITION") return;
    expect([4, 5]).not.toContain(strategy.position);
    expect(output.shortlist.length).toBeGreaterThan(0);
    expect(output.shortlist.every((card) => cardServes(card, strategy.position))).toBe(true);
  });

  test("S01: con REVEAL_POSITION(P) TODA tarjeta del shortlist sirve a P (nunca 0/5), y ninguna es de otra posición", async () => {
    const { ask } = world({ scores: { 20: 50, 15: 40, 17: 30, 21: 20, 12: 10, 14: 9 } });
    const output = (await ask(5))!.output!;
    const strategy = output.primaryAction.strategy;
    expect(strategy.kind).toBe("REVEAL_POSITION");
    if (strategy.kind !== "REVEAL_POSITION") return;
    expect(output.shortlist.length).toBeGreaterThan(0);
    for (const card of output.shortlist) expect(cardServes(card, strategy.position)).toBe(true);
    expect(output.shortlist.map((card) => card.heroId)).not.toContain(14); // Invoker-like never serves Pos4
  });

  test("el shortlist de 'revela Pos P' se llena desde un universo de P fijado antes de rankear (más de un héroe cuando existen)", async () => {
    const { ask, calls } = world({ scores: { 15: 50, 20: 40, 21: 30 } });
    const output = (await ask(5))!.output!;
    expect(output.primaryAction.strategy).toMatchObject({ kind: "REVEAL_POSITION", position: 4 });
    expect(calls.some((call) => call.candidateHeroIds?.join(",") === "15,17" && call.targetPosition === 4 && call.teamOpening === false)).toBe(true);
    expect(output.shortlist.map((card) => card.heroId).sort((a, b) => a - b)).toEqual([15, 17]);
  });

  test("la acción y su shortlist no cambian de forma con el pool personal (el equipo es independiente de la cuenta)", async () => {
    const a = world({ scores: { 15: 50, 20: 40 } });
    const b = world({ scores: { 15: 50, 20: 40 } });
    const outA = (await a.ask(2))!.output!;
    const outB = (await b.ask(5))!.output!;
    expect(outA.shortlist.map((card) => card.heroId)).toEqual(outB.shortlist.map((card) => card.heroId));
    expect(outA.primaryAction.label).toBe(outB.primaryAction.label);
  });
});

// ---- RB-3: badges --------------------------------------------------------------------------------------------------
describe("RB-3 -- badge semantics (Round 1 blind, S01)", () => {
  test("Round 1 a ciegas (0 rivales revelados): 0 insignias COUNTER, aunque `counter` aporte por alivio de baneo o estadística", async () => {
    const { ask } = world({ scores: { 15: 50, 17: 40, 20: 30 }, banReliefOnly: [15], statisticalCounter: [17, 20] });
    const output = (await ask(5))!.output!;
    expect(output.shortlist.length).toBeGreaterThan(0);
    expect(output.shortlist.flatMap((card) => card.badges)).not.toContain("COUNTER");
  });

  test("con un rival REVELADO, evidencia estadística real contra él sí puede dar COUNTER; el alivio de baneo solo, no", async () => {
    const { h, ask } = world({ scores: { 30: 50, 31: 40, 32: 30 }, banReliefOnly: [31], statisticalCounter: [30] });
    playRoundOne(h, [20, 11], [40, 41]);
    const shortlist = (await ask(2))!.output!.shortlist;
    const byHero = new Map(shortlist.map((card) => [card.heroId, card.badges]));
    expect(byHero.get(30)).toContain("COUNTER");
    expect(byHero.get(31)).not.toContain("COUNTER");
  });

  test("S15: rival revelado con ventaja estadística <= 0 compensada por alivio de baneo -> NO emite COUNTER", async () => {
    // Hero 31 tiene partidos reales vs rival revelado 40 (sampleSize: 50), ventaja estadística <= 0,
    // y alivio de baneo positivo que hace raw = 0.02 > 0 y weighted = 5 > 0.
    // Hero 30 tiene ventaja estadística positiva (+0.05 > 0) vs rival 40.
    const { h, ask } = world({ scores: { 30: 50, 31: 40, 32: 30 }, netNegativeWithBanRelief: [31], statisticalCounter: [30] });
    playRoundOne(h, [20, 11], [40, 41]);
    const shortlist = (await ask(2))!.output!.shortlist;
    const byHero = new Map(shortlist.map((card) => [card.heroId, card.badges]));
    expect(byHero.get(30)).toContain("COUNTER");
    // El loophole está cerrado: hero 31 NO emite COUNTER
    expect(byHero.get(31)).not.toContain("COUNTER");

    // Con evidencia curada positiva separada contra el rival 40, SÍ emite COUNTER
    const curated = new Map<number, CuratedCounter[]>([[40, [hard(31)]]]);
    const withCurated = world({ scores: { 30: 50, 31: 40, 32: 30 }, netNegativeWithBanRelief: [31], statisticalCounter: [30] }, curated);
    playRoundOne(withCurated.h, [20, 11], [40, 41]);
    const shortlistWithCurated = (await withCurated.ask(2))!.output!.shortlist;
    const byHeroWithCurated = new Map(shortlistWithCurated.map((card) => [card.heroId, card.badges]));
    expect(byHeroWithCurated.get(31)).toContain("COUNTER");
  });

  test("una relación curada contra un rival revelado da COUNTER aunque la señal no traiga partidas", async () => {
    const curated = new Map<number, CuratedCounter[]>([[40, [hard(31)]]]); // hero 31 is a listed counter of revealed hero 40
    const { h, ask } = world({ scores: { 30: 50, 31: 40, 32: 30 }, banReliefOnly: [31] }, curated);
    playRoundOne(h, [20, 11], [40, 41]);
    const card = (await ask(2))!.output!.shortlist.find((entry) => entry.heroId === 31)!;
    expect(card.badges).toContain("COUNTER");
  });

  test("POSITION_FIT no se muestra como insignia en ningún shortlist (sigue siendo señal interna)", async () => {
    const { h, ask } = world({ scores: { 30: 50, 31: 40, 32: 30 } });
    expect((await ask(5))!.output!.shortlist.flatMap((card) => card.badges)).not.toContain("POSITION_FIT");
    playRoundOne(h, [20, 11], [40, 41]);
    expect((await ask(2))!.output!.shortlist.flatMap((card) => card.badges)).not.toContain("POSITION_FIT");
  });

  test("la evidencia de Safe Core no cambia: sigue siendo su bloque aparte (COUNTER_RELIEF curado)", async () => {
    const counters = new Map<number, CuratedCounter[]>([[20, [hard(30), hard(31)]]]);
    const h = harness({ heroPositions: POSITIONS, pool: ALL_HEROES, sessionId: "safe-core-intact", bans: [30, 31], adapterKind: "manual" });
    const coach = createCoachRecommendations({ source: h.store, computeSuggestions: scriptedCompute({ scores: { 20: 90, 21: 10 } }), heroPositions: POSITIONS, heroCounters: counters });
    const output = (await coach.recommend(h.id, 1, ACCOUNT))!.output!;
    expect(output.opportunity).toMatchObject({ subtype: "SAFE_CORE", heroId: 20 });
    expect(output.opportunity!.counterEvidence.sourceType).toBe("CURATED");
  });
});

// ---- RB-4: S05 -----------------------------------------------------------------------------------------------------
describe("RB-4 -- revealed curated hard counters demote (S05: Meepo vs Axe)", () => {
  // Hero 30 (Meepo-like, V6 #1) is hard-countered by revealed hero 40 (Axe-like). 31 / 32 are valid mids with no such counter.
  const scores = { 30: 90, 31: 50, 32: 40 };
  const pool = [20, 11, 30, 31, 32, 40, 41]; // no supports available: nothing to pull the support-first prior away from the mids
  const curated = new Map<number, CuratedCounter[]>([[30, [hard(40)]]]);

  test("CONTROL: sin la evidencia curada, V6 deja al héroe counterado primero (el defecto que vio el juez)", async () => {
    const { h, ask } = world({ scores, pool });
    playRoundOne(h, [20, 11], [40, 41]);
    expect((await ask(5))!.output!.shortlist.map((card) => card.heroId)).toEqual([30, 31, 32]);
  });

  test("S05: con el counter duro curado REVELADO, el héroe counterado baja detrás de las alternativas válidas y no se descarta", async () => {
    const { h, ask } = world({ scores, pool }, curated);
    playRoundOne(h, [20, 11], [40, 41]);
    const output = (await ask(5))!.output!;
    expect(output.primaryAction.strategy).toMatchObject({ kind: "REVEAL_POSITION", position: 2 });
    expect(output.shortlist.map((card) => card.heroId)).toEqual([31, 32, 30]); // V6 order kept inside each group
  });

  test("un counter duro que el rival NO tiene revelado no demota (sólo lo visible cuenta)", async () => {
    const { h, ask } = world({ scores, pool: pool.filter((hero) => hero !== 41) }, curated); // 41 (a support) would legitimately pull the opening prior away
    h.seal(h.side, 0, 20);
    h.seal(h.enemy, 0, 40); // sealed by the enemy, still hidden: never a hero in the Player's view
    const ids = (await ask(5))!.output!.shortlist.map((card) => card.heroId);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.indexOf(30)).toBeLessThan(ids.indexOf(31));
  });

  test("medium no demota; si TODOS están counterados se conservan y el orden es el V6 (nunca una lista vacía)", async () => {
    const medium = new Map<number, CuratedCounter[]>([[30, [{ vs: 40, level: "medium", why: "fixture" }]]]);
    const a = world({ scores, pool }, medium);
    playRoundOne(a.h, [20, 11], [40, 41]);
    expect((await a.ask(5))!.output!.shortlist.map((card) => card.heroId)).toEqual([30, 31, 32]);

    const all = new Map<number, CuratedCounter[]>([[30, [hard(40)]], [31, [hard(40)]], [32, [hard(40)]]]);
    const b = world({ scores, pool }, all);
    playRoundOne(b.h, [20, 11], [40, 41]);
    expect((await b.ask(5))!.output!.shortlist.map((card) => card.heroId)).toEqual([30, 31, 32]);
  });

  test("la democión aplica también al ranking personal (mismo conjunto curado, sin reescritura)", async () => {
    const { h, ask } = world({ scores, pool }, curated);
    playRoundOne(h, [20, 11], [40, 41]);
    const ids = (await ask(2))!.output!.personalHeroView!.heroes.map((hero) => hero.heroId);
    expect(ids).toEqual([31, 32, 30]);
  });
});

// ---- RB-4: S14 (Real Production Curated Counter Catalog) -------------------------------------------------------------
describe("RB-4: S14 -- real production curated hard counter demotion (Anti-Mage vs Axe)", () => {
  // Real production catalog: hero-counters.json
  // - Hero 1 (Anti-Mage) is hard-countered by Hero 2 (Axe):
  //     { vs: 2, level: "hard", why: "Berserker's Call atraviesa Counterspell, impide Blink..." }
  // - Hero 8 (Juggernaut) has medium counter vs Axe (never demotes):
  //     { vs: 2, level: "medium", why: "Berserker's Call atraviesa Blade Fury..." }
  // - Hero 4 (Bloodseeker) has no counter vs Axe.
  // - All three (1, 4, 8) survive normal candidate admission for Pos 1.
  // - Hero 2 (Axe) is admitted for Pos 3 (enemy offlaner).
  const realCounters = loadHeroCounters();
  const s14Positions: HeroPositions = {
    ...POSITIONS,
    1: [{ position: 1, matches: 1409 }], // Anti-Mage (dominant Pos 1)
    2: [{ position: 3, matches: 4560 }], // Axe (dominant Pos 3)
    4: [{ position: 1, matches: 1200 }], // Bloodseeker (dominant Pos 1)
    8: [{ position: 1, matches: 3000 }], // Juggernaut (dominant Pos 1)
  };
  const pool = [1, 2, 4, 8, 11, 18, 41];
  const scores = { 1: 95, 4: 80, 8: 70 }; // V6 scores: Anti-Mage #1, Bloodseeker #2, Juggernaut #3

  test("S14: con Axe (2) REVELADO, Anti-Mage (1) baja categóricamente detrás de las alternativas válidas de su rol (4, 8)", async () => {
    const { h, ask } = world({ scores, pool }, realCounters, s14Positions);
    playRoundOne(h, [11, 18], [2, 41]); // Round 1: enemy reveals Axe (2) and support (41)
    const output = (await ask(1))!.output!;

    // 1. Hard-countered candidate (1) is categorically behind all non-hard-countered same-role alternatives (4, 8)
    const personalIds = output.personalHeroView!.heroes.map((card) => card.heroId);
    expect(personalIds.indexOf(1)).toBeGreaterThan(personalIds.indexOf(4));
    expect(personalIds.indexOf(1)).toBeGreaterThan(personalIds.indexOf(8));

    // 2. V6 relative ordering is preserved within each category
    // Non-hard-countered category: 4 (score 80) comes before 8 (score 70)
    expect(personalIds.indexOf(4)).toBeLessThan(personalIds.indexOf(8));
    // Overall order of Pos 1 carries: [4, 8, 1]
    expect(personalIds).toEqual([4, 8, 1]);

    // 3. Candidate is demoted, not silently deleted solely because of RB-4
    expect(personalIds).toContain(1);

    // 4. Safe Core and unrelated behavior remain unchanged
    expect(output.opportunity).toBeUndefined(); // Axe is not banned, no safe core
  });

  test("S14: un counter duro que el rival NO tiene revelado no demota a Anti-Mage (sólo lo visible cuenta)", async () => {
    const { h, ask } = world({ scores, pool }, realCounters, s14Positions);
    h.seal(h.side, 0, 11);
    h.seal(h.enemy, 0, 2); // Axe sealed by enemy, still hidden (not revealed)
    const output = (await ask(1))!.output!;
    const personalIds = output.personalHeroView!.heroes.map((card) => card.heroId);
    // Anti-Mage retains #1 because Axe is still hidden
    expect(personalIds[0]).toBe(1);
  });

  test("S14: un counter MEDIUM de producción (Juggernaut vs Axe) nunca demota", async () => {
    // Si Anti-Mage no está en pool, Juggernaut (8, score 90) y Bloodseeker (4, score 70)
    const scoresNoAm = { 8: 90, 4: 70 };
    const poolNoAm = [2, 4, 8, 11, 18, 41];
    const { h, ask } = world({ scores: scoresNoAm, pool: poolNoAm }, realCounters, s14Positions);
    playRoundOne(h, [11, 18], [2, 41]); // Axe (2) revealed
    const output = (await ask(1))!.output!;
    const personalIds = output.personalHeroView!.heroes.map((card) => card.heroId);
    // Juggernaut (8) is medium-countered by Axe, but medium NEVER demotes, so Juggernaut stays #1
    expect(personalIds).toEqual([8, 4]);
  });
});
