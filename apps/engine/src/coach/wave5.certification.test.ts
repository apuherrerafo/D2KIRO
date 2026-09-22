import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import type { Suggestion } from "../signals/mix";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import { createCoachRecommendations } from "../server/routes/coach-recommendations";
import { fakeCompute, harness, stripSession, type Harness } from "./session-harness.fixtures";

// AP Ranked Roles V1 / WAVE 5 -- PRODUCT CERTIFICATION (release-level engine proofs). Nothing here adds behaviour:
// it re-proves, in ONE place and across ALL Coach-visible surfaces at once, the properties the MVP is sold on.
//
// Real: the kernel, the ProtocolSessionStore (session metadata, seed, registration ledger), the perspective
// projection, the perspective-safe recommendation builder, the Coach orchestrator and the coach-recommendations
// route entry point. Only V6's scorer is the deterministic fixture used by every other coach/*.test.ts, and the
// curated data (positions, counters) is INLINE -- no real JSON, no SQLite (invariantes.md).
//
// The same properties are exercised over the REAL scorer + REAL curated data at scale by
// `bun scripts/wave5-certification.ts` (docs/diagnostics/WAVE5_AUTOMATED_EVIDENCE.md).

// Fixture world. Hero 1 is V6's top and a resolved Carry; heroes 7/8 hard-counter it (curated), hero 4 medium.
// Hero 6 is an own-team FLEX (Pos 2/3); hero 9 is a public enemy FLEX (Pos 1/2).
const POSITIONS: HeroPositions = {
  1: [{ position: 1, matches: 1000 }],
  2: [{ position: 5, matches: 1000 }],
  3: [{ position: 4, matches: 1000 }],
  4: [{ position: 2, matches: 1000 }],
  5: [{ position: 3, matches: 1000 }],
  6: [{ position: 2, matches: 600 }, { position: 3, matches: 400 }],
  7: [{ position: 3, matches: 1000 }],
  8: [{ position: 4, matches: 1000 }],
  9: [{ position: 1, matches: 700 }, { position: 2, matches: 500 }],
  10: [{ position: 5, matches: 1000 }],
  11: [{ position: 2, matches: 1000 }],
  12: [{ position: 1, matches: 1000 }],
  13: [{ position: 3, matches: 1000 }],
  14: [{ position: 4, matches: 1000 }],
};
const POOL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const CARRY = 1;
const HARD_A = 7;
const HARD_B = 8;
const MEDIUM = 4;
const FLEX_OWN = 6;
const FLEX_ENEMY = 9;
const curated = (level: CuratedCounter["level"], vs: number): CuratedCounter => ({ vs, level, why: `fixture ${vs}` });
const COUNTERS = new Map<number, CuratedCounter[]>([[CARRY, [curated("hard", HARD_A), curated("hard", HARD_B), curated("medium", MEDIUM)]]]);
const BANS = [HARD_A, HARD_B]; // both hard counters of the Carry are banned -> Safe Core is ACTIVE in every world below
const PERSONAL = 2 as const;
const PERSONAL_POOL = [4, FLEX_OWN, 11];

function world(options: { seed: string; side?: "radiant" | "dire"; id?: string }): Harness {
  return harness({
    sessionId: options.id ?? "wave5",
    seed: options.seed,
    side: options.side,
    bans: BANS,
    heroCounters: COUNTERS,
    heroPositions: POSITIONS,
    pool: POOL,
    humanPosition: PERSONAL,
  });
}

/** Coach computed with a personal position and a configured Hero Pool (the fullest output the product can show). */
async function fullCoach(h: Harness) {
  return h.coach.recompute({ context: h.store.perspectiveRecommendationContext(h.id)!, playerPersonalPosition: PERSONAL, config: { heroPool: PERSONAL_POOL } });
}
const full = async (h: Harness): Promise<string> => JSON.stringify(await fullCoach(h), (key, value) => (key === "sessionId" ? undefined : value));

describe("WAVE 5 / hidden information -- worlds that differ ONLY in what the Player may not know", () => {
  // World A: enemy seals FIRST (registration ledger: enemy ordinal 1), hidden heroes 12+13, seed SEEDAAAA.
  // World C: same order as A but different hidden heroes (10+14) and seed -- compared with A at round start.
  // World B: the Player seals first (ledger: own ordinal 1) and the enemy commits afterwards (heroes 10+14, seed
  // SEEDBBBB) -- compared with A once both have the same number of hidden enemy seats. The COUNT of sealed enemy
  // seats is itself visible to the Player (HIDDEN placeholders), so it is held equal: only identities, seeds,
  // private positions and arrival order differ -- everything the Player may not know.
  test("R1 -- start, after own pick #1 (a FLEX hero), and after assigning it: byte-identical on EVERY Coach surface", async () => {
    const a = world({ seed: "SEEDAAAA", id: "w5-r1" });
    const b = world({ seed: "SEEDBBBB", id: "w5-r1" });
    const c = world({ seed: "SEEDCCCC", id: "w5-r1" });
    a.seal(a.enemy, 0, 12);
    a.seal(a.enemy, 1, 13);
    c.seal(c.enemy, 0, 10);
    c.seal(c.enemy, 1, 14);
    expect(await full(a)).toBe(await full(c)); // (1) round start: primary action, shortlist, personal view, beliefs, Safe Core, badges, provenance

    await full(b); // the Coach keeps per-session revision memory: both worlds make the same number of Coach calls
    a.seal(a.side, 0, FLEX_OWN);
    b.seal(b.side, 0, FLEX_OWN);
    b.seal(b.enemy, 0, 10); // B's enemy only now commits its hidden picks (after the Player): the ledger order differs
    b.seal(b.enemy, 1, 14);
    const afterOwn = await full(a);
    expect(afterOwn).toBe(await full(b)); // (2) after own pick #1, nothing revealed

    for (const h of [a, b]) await h.coach.onPlayerPositionAssigned({ context: h.store.perspectiveRecommendationContext(h.id)!, playerPersonalPosition: PERSONAL, config: { heroPool: PERSONAL_POOL } }, FLEX_OWN, 3);
    expect(await full(a)).toBe(await full(b)); // (3) after the Player resolved the Flex slot, still hidden

    const parsed = JSON.parse(afterOwn).output;
    expect(parsed.opportunity).toMatchObject({ subtype: "SAFE_CORE", heroId: CARRY }); // Safe Core is part of what was compared
    expect(parsed.personalHeroView.heroes.length).toBeGreaterThan(0); // ...and so is the personal view
    expect(parsed.roleBeliefs.own.length).toBe(1);
    expect(parsed.roleBeliefs.enemy).toEqual([]); // nothing to believe about a hidden hero
    expect(afterOwn).not.toMatch(/"heroId":(12|13|10|14)[,}]/); // no hidden identity is serialised anywhere
  });

  test("R2 -- same revealed R1, different hidden R2 (with a revealed enemy FLEX in play): identical output; the reveal then legally diverges", async () => {
    const a = world({ seed: "SEEDAAAA", id: "w5-r2" });
    const b = world({ seed: "SEEDBBBB", id: "w5-r2" });
    for (const h of [a, b]) {
      h.seal(h.enemy, 0, FLEX_ENEMY); // revealed at the end of R1: a public enemy Flex hero
      h.seal(h.enemy, 1, 11);
      h.seal(h.side, 0, FLEX_OWN);
      h.seal(h.side, 1, 2);
    }
    const startA = await full(a);
    expect(startA).toBe(await full(b)); // R2 start: same public information, different seeds
    const before = JSON.parse(startA).output;
    expect(before.roleBeliefs.enemy.map((belief: { heroId: number }) => belief.heroId).sort((x: number, y: number) => x - y)).toEqual([FLEX_ENEMY, 11]);

    a.seal(a.enemy, 0, 12); // hidden in R2, world A
    a.seal(a.enemy, 1, 13);
    b.seal(b.enemy, 0, 10); // hidden in R2, world B
    b.seal(b.enemy, 1, 14);
    for (const h of [a, b]) h.seal(h.side, 0, 3);
    expect(await full(a)).toBe(await full(b)); // own R2 pick #1 done, R2 still hidden

    for (const h of [a, b]) h.seal(h.side, 1, 5); // closes R2 -> the enemy's R2 identities become LEGAL information
    const revealedRawA = await full(a);
    expect(revealedRawA).not.toBe(await full(b));
    const revealedA = JSON.parse(revealedRawA).output;
    expect(revealedA.roleBeliefs.enemy.map((belief: { heroId: number }) => belief.heroId)).toEqual(expect.arrayContaining([12, 13]));
  });

  test("Dire is the same product: the R1 matrix holds from the other side", async () => {
    const a = world({ seed: "SEEDAAAA", side: "dire", id: "w5-dire" });
    const b = world({ seed: "SEEDBBBB", side: "dire", id: "w5-dire" });
    a.seal(a.enemy, 0, 12);
    a.seal(a.enemy, 1, 13);
    b.seal(b.enemy, 0, 10);
    b.seal(b.enemy, 1, 14);
    a.seal(a.side, 0, FLEX_OWN);
    b.seal(b.side, 0, FLEX_OWN);
    expect(await full(a)).toBe(await full(b));
    expect(JSON.parse(await full(a)).output.opportunity).toMatchObject({ subtype: "SAFE_CORE", heroId: CARRY });
  });
});

describe("WAVE 5 / Team vs Personal separation -- two Hero Pools, identical visible draft", () => {
  test("team primary action, shortlist, Safe Core, badges and beliefs are identical; only the personal view may differ", async () => {
    const h = world({ seed: "SEED0001", id: "w5-pool" });
    h.seal(h.side, 0, FLEX_OWN);
    h.seal(h.enemy, 0, 12);

    const baseline = fakeCompute(POOL, POSITIONS);
    const withPool: ComputeSuggestionsForRecommendation = async (state: DraftState, accountId, options) => {
      const set = await baseline(state, accountId, options);
      if (accountId === null) return set;
      const pool = accountId === 101 ? [4, 11] : [5, 13]; // two different personal pools (Steam32 stand-ins: never real accounts)
      return {
        ...set,
        suggestions: set.suggestions.map((suggestion): Suggestion => !pool.includes(suggestion.hero) ? suggestion : {
          ...suggestion,
          signals: [...suggestion.signals, { signal: "hero_pool_fit" as const, raw: 1, normalized: 100, evidenceConfidence: 1, weighted: 1, explanation: "En tu pool", sampleSize: 1 }],
        }),
      };
    };
    const coach = createCoachRecommendations({ source: h.store, computeSuggestions: withPool, heroPositions: POSITIONS, heroCounters: COUNTERS });
    const teamSurface = (result: Awaited<ReturnType<typeof coach.recommend>>) => JSON.stringify({
      primaryAction: result!.output!.primaryAction,
      shortlist: result!.output!.shortlist, // includes each card's badges and their ORDER
      opportunity: result!.output!.opportunity,
      roleBeliefs: result!.output!.roleBeliefs,
      basedOn: result!.output!.meta.basedOn,
      confidence: result!.output!.meta.confidence,
      decisionContext: result!.output!.meta.decisionContext,
      teamSet: result!.recommendationSet,
    });

    const a = await coach.recommend(h.id, PERSONAL, 101);
    const b = await coach.recommend(h.id, PERSONAL, 202);
    const anonymous = await coach.recommend(h.id, PERSONAL, null);
    expect(teamSurface(a)).toBe(teamSurface(b));
    expect(teamSurface(a)).toBe(teamSurface(anonymous));
    expect(a!.output!.opportunity).toMatchObject({ subtype: "SAFE_CORE" }); // Safe Core is inside the compared surface
    expect(a!.output!.shortlist.flatMap((card) => card.badges)).not.toContain("YOUR_POOL"); // the team list never carries a pool badge

    // ...while the personal view is where the pools legitimately show up.
    const poolHeroes = (result: typeof a) => result!.output!.personalHeroView!.heroes.filter((hero) => hero.isFromPool).map((hero) => hero.heroId);
    expect(poolHeroes(a)).toContain(4);
    expect(poolHeroes(b)).not.toContain(4);
    expect(JSON.stringify(a!.output!.personalHeroView)).not.toBe(JSON.stringify(b!.output!.personalHeroView));
  });
});

describe("WAVE 5 / Flex", () => {
  function contextOf(h: Harness) {
    return { context: h.store.perspectiveRecommendationContext(h.id)!, playerPersonalPosition: PERSONAL, config: { heroPool: PERSONAL_POOL } };
  }
  const ownBelief = (output: NonNullable<Awaited<ReturnType<Harness["compute"]>>["output"]>, heroId: number) => output.roleBeliefs.own.find((belief) => belief.heroId === heroId);

  test("OWN FLEX: stays compatible with several positions; the Player assigns a compatible one; an incompatible one fails safely; the Coach recomputes", async () => {
    const h = world({ seed: "SEED0002", id: "w5-flex-own" });
    h.seal(h.side, 0, FLEX_OWN);
    const before = (await fullCoach(h)).output!;
    expect(ownBelief(before, FLEX_OWN)).toMatchObject({ status: "LIKELY", positions: [2, 3] }); // FLEX 2/3, not forced

    const incompatible = await h.coach.onPlayerPositionAssigned(contextOf(h), FLEX_OWN, 5); // Pos5 is not a curated position of hero 6
    expect(ownBelief(incompatible.output!, FLEX_OWN)).toMatchObject({ status: "LIKELY", positions: [2, 3] }); // ignored: no throw, no corruption
    expect(incompatible.output!.meta.trigger).toBe("PLAYER_POSITION_ASSIGNED");

    const assigned = await h.coach.onPlayerPositionAssigned(contextOf(h), FLEX_OWN, 3);
    expect(ownBelief(assigned.output!, FLEX_OWN)).toMatchObject({ status: "CONFIRMED", positions: [3] });
    expect(assigned.output!.meta.trigger).toBe("PLAYER_POSITION_ASSIGNED");
    expect(assigned.output!.meta.revision).toBeGreaterThan(before.meta.revision);
    expect(assigned.output!.meta.basedOn.stateIdentity).toBe(before.meta.basedOn.stateIdentity); // same draft; the difference is the Player's own declaration
    expect(JSON.stringify(assigned.output)).not.toBe(JSON.stringify(before)); // Coach recomputed

    const cleared = await h.coach.onPlayerPositionCleared(contextOf(h), FLEX_OWN);
    expect(ownBelief(cleared.output!, FLEX_OWN)).toMatchObject({ status: "LIKELY", positions: [2, 3] }); // back to observable inference
  });

  test("OWN FLEX: a stranger's hero id cannot be 'assigned' (enemy / unknown ids are ignored)", async () => {
    const h = world({ seed: "SEED0002", id: "w5-flex-stranger" });
    h.seal(h.side, 0, FLEX_OWN);
    h.seal(h.enemy, 0, FLEX_ENEMY);
    h.seal(h.enemy, 1, 11);
    h.seal(h.side, 1, 2); // round closes: hero 9 is now a REVEALED enemy
    const before = (await fullCoach(h)).output!;
    const after = (await h.coach.onPlayerPositionAssigned(contextOf(h), FLEX_ENEMY, 1)).output!;
    expect(after.roleBeliefs.enemy.find((belief) => belief.heroId === FLEX_ENEMY)).toEqual(before.roleBeliefs.enemy.find((belief) => belief.heroId === FLEX_ENEMY));
    expect(after.roleBeliefs.enemy.find((belief) => belief.heroId === FLEX_ENEMY)!.status).not.toBe("CONFIRMED");
  });

  test("ENEMY FLEX: visible uncertainty stays uncertainty, never becomes a hard position, and does not drift or feed back", async () => {
    const h = world({ seed: "SEED0003", id: "w5-flex-enemy" });
    h.seal(h.enemy, 0, FLEX_ENEMY);
    h.seal(h.enemy, 1, 11);
    h.seal(h.side, 0, FLEX_OWN);
    h.seal(h.side, 1, 2);
    const first = (await fullCoach(h)).output!;
    const belief = first.roleBeliefs.enemy.find((entry) => entry.heroId === FLEX_ENEMY)!;
    expect(belief.status).toBe("LIKELY"); // public evidence only: never CONFIRMED (that is reserved for a Player declaration)
    expect(belief.positions.length).toBeGreaterThan(1); // both plausible positions remain visible
    expect(first.roleBeliefs.enemy.every((entry) => entry.status !== "CONFIRMED")).toBe(true);

    // Idempotence: recomputing many times must not harden the soft belief (LIKELY -> occupied -> LIKELY loop, STOP 10).
    let latest = first;
    for (let i = 0; i < 5; i += 1) latest = (await fullCoach(h)).output!;
    expect(JSON.stringify(latest.roleBeliefs)).toBe(JSON.stringify(first.roleBeliefs));

    // The enemy's soft belief does not constrain OUR team: the own Flex belief is identical with or without the enemy Flex.
    const control = world({ seed: "SEED0003", id: "w5-flex-control" });
    control.seal(control.enemy, 0, 10);
    control.seal(control.enemy, 1, 14);
    control.seal(control.side, 0, FLEX_OWN);
    control.seal(control.side, 1, 2);
    expect(JSON.stringify(first.roleBeliefs.own)).toBe(JSON.stringify((await fullCoach(control)).output!.roleBeliefs.own));
  });

  test("OWN FLEX beliefs are a function of the visible picks, not of the order they were sealed in", async () => {
    const x = world({ seed: "SEED0004", id: "w5-order" });
    const y = world({ seed: "SEED0004", id: "w5-order" });
    x.seal(x.side, 0, FLEX_OWN);
    x.seal(x.side, 1, CARRY);
    y.seal(y.side, 0, CARRY);
    y.seal(y.side, 1, FLEX_OWN);
    for (const h of [x, y]) {
      h.seal(h.enemy, 0, 12);
      h.seal(h.enemy, 1, 13);
    }
    expect(JSON.stringify((await fullCoach(x)).output!.roleBeliefs.own)).toBe(JSON.stringify((await fullCoach(y)).output!.roleBeliefs.own));
  });
});
