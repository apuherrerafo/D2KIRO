import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, createProtocolState } from "../draft-protocol";
import { buildRecommendationSetV2 } from "../recommendation/build";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import { isHeroSelectableFrom, unavailableHeroesFrom } from "../recommendation/perspective-context";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createCoachRecommendations, type PerspectiveContextSource } from "../server/routes/coach-recommendations";
import { CoachOrchestrator } from "./orchestrator";
import { HERO_POSITIONS, fakeCompute, harness } from "./session-harness.fixtures";

// AP Ranked Roles V1 / Wave 2 (product review, issue 1) -- proof that the Coach recommendation path is
// STRUCTURALLY perspective-safe. Stronger than a behavioural hidden-twin: these tests pin what the
// perspective-safe input CAN hold, that authoritative state cannot be passed in, and that the only
// difference between two worlds that differ in hidden information is invisible at the input itself.

describe("1. authoritative state cannot enter the perspective-safe path", () => {
  test("el builder y el orquestador exigen un PerspectiveRecommendationContext: un DraftProtocolState es un error de TIPO", async () => {
    const created = createProtocolState("boundary", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    const authoritative = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;

    // @ts-expect-error -- a DraftProtocolState is not a PerspectiveRecommendationContext
    const attempt = buildRecommendationSetFromPerspective({ context: authoritative, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS });
    // ...and, if a caller defeats the types anyway, it fails CLOSED (no recommendation is produced from it).
    await expect(attempt).rejects.toThrow();

    const coach = new CoachOrchestrator({ buildRecommendationSet: async () => { throw new Error("unreachable"); } });
    // @ts-expect-error -- same for the orchestrator's input
    await expect(coach.recompute({ context: authoritative })).rejects.toThrow();
  });

  test("la entrada del Coach en el servidor (PerspectiveContextSource) no expone el estado autoritativo: sólo un contexto de perspectiva", () => {
    const store = new ProtocolSessionStore();
    const source: PerspectiveContextSource = store; // the store satisfies the narrow interface structurally...
    expect(typeof source.perspectiveRecommendationContext).toBe("function");
    // @ts-expect-error -- ...but through it, the authoritative accessor is not reachable
    void source.get;
    // createCoachRecommendations only takes that narrow source.
    expect(() => createCoachRecommendations({ source, computeSuggestions: fakeCompute() })).not.toThrow();
  });
});

describe("2. el contexto de perspectiva contiene lo legalmente observable", () => {
  test("tiene EXACTAMENTE: view, openOwnSlots, partyContext, patch -- y refleja selecciones propias, rivales revelados, bans y asientos abiertos", () => {
    const h = harness({ sessionId: "ctx", bans: [40, 41] });
    h.seal(h.enemy, 0, 9); // enemy sealed, hidden
    h.seal(h.side, 0, 3); // own sealed
    const context = h.store.perspectiveRecommendationContext(h.id)!;

    expect(Object.keys(context).sort()).toEqual(["openOwnSlots", "partyContext", "patch", "view"]);
    expect(context.view.bannedHeroes).toEqual([40, 41]); // confirmed bans
    expect(context.view.ownPicks).toEqual([{ visibility: "KNOWN", heroId: 3 }]); // own selection
    expect(context.view.enemyPicks).toEqual([{ visibility: "HIDDEN" }]); // enemy's sealed pick: no hero id
    expect(context.openOwnSlots).toEqual([{ side: h.side, slotIndex: 1 }]); // the one seat still open (client-visible legalActions)
    expect(context.patch).toBe("7.41e");

    // Perspective availability is DERIVED from it: bans + own picks are gone, the enemy's hidden pick is not.
    const gone = unavailableHeroesFrom(context.view);
    expect([...gone].sort((x, y) => x - y)).toEqual([3, 40, 41]);
    expect(isHeroSelectableFrom(context, 9, { side: h.side, slotIndex: 1 })).toBe(true); // a same-hero collision is legal
    expect(isHeroSelectableFrom(context, 3, { side: h.side, slotIndex: 1 })).toBe(false);
    expect(isHeroSelectableFrom(context, 5, { side: h.side, slotIndex: 0 })).toBe(false); // that seat is not open
  });

  test("NO puede contener: pick oculto del rival, posiciones internas del Enemy Bot, ledger de registros, seed ni verdad del Simulator", () => {
    const h = harness({ sessionId: "ctx-2", seed: "SECRETSEED" });
    h.seal(h.enemy, 0, 9);
    h.seal(h.enemy, 1, 10);
    h.seal(h.side, 0, 3);
    const text = JSON.stringify(h.store.perspectiveRecommendationContext(h.id));
    for (const forbidden of ["sealed", "registrations", "registrationEvidence", "internalPositionAssignments", "positionsByRosterSlot", "pendingSelections", "simulatorSeed", "SECRETSEED", "humanPosition", "authoritative"]) {
      expect(text).not.toContain(forbidden);
    }
    // The hidden enemy hero ids (9, 10) appear nowhere: the only ids present are our own pick.
    expect(JSON.stringify(h.store.perspectiveRecommendationContext(h.id)!.view.enemyPicks)).toBe('[{"visibility":"HIDDEN"},{"visibility":"HIDDEN"}]');
    expect(text).not.toMatch(/\b(9|10)\b/);
  });
});

describe("3-4. dos estados autoritativos que difieren sólo en la identidad oculta dan la MISMA entrada segura", () => {
  test("mismo estado visible, distinto héroe rival oculto, distinto seed del Simulator, distinto orden de registro y distinta posición personal -> contexto idéntico", () => {
    const a = harness({ sessionId: "twin", seed: "AAAA0001", humanPosition: 1 });
    const b = harness({ sessionId: "twin", seed: "ZZZZ9999", humanPosition: 5 });
    // world A: enemy seals slot 0 then slot 1 with (9, 10); world B: slot 1 first, then slot 0, with different heroes (12, 11).
    a.seal(a.enemy, 0, 9);
    a.seal(a.enemy, 1, 10);
    b.seal(b.enemy, 1, 12);
    b.seal(b.enemy, 0, 11);
    for (const h of [a, b]) h.seal(h.side, 0, 3);

    // The AUTHORITATIVE states really are different (the test would be vacuous otherwise)...
    expect(JSON.stringify(a.store.get("twin"))).not.toBe(JSON.stringify(b.store.get("twin")));
    // ...but the perspective-safe input is byte-identical.
    expect(JSON.stringify(a.store.perspectiveRecommendationContext("twin"))).toBe(JSON.stringify(b.store.perspectiveRecommendationContext("twin")));
  });

  test("y por tanto el conjunto de recomendaciones completo es idéntico; la orden de sellado del rival no lo mueve", async () => {
    const a = harness({ sessionId: "twin-2" });
    const b = harness({ sessionId: "twin-2" });
    a.seal(a.enemy, 0, 9);
    b.seal(b.enemy, 0, 30);
    for (const h of [a, b]) h.seal(h.side, 0, 3);
    const build = (h: typeof a) => buildRecommendationSetFromPerspective({ context: h.store.perspectiveRecommendationContext("twin-2")!, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS });
    expect(JSON.stringify(await build(a))).toBe(JSON.stringify(await build(b)));
  });
});

describe("5. una vez revelada, la identidad enemiga aparece en la entrada segura y puede afectar la recomendación", () => {
  test("al cerrarse la ronda el héroe rival entra en view.enemyPicks (REVEALED), en la disponibilidad y en las creencias del Coach; los mundos divergen", async () => {
    const a = harness({ sessionId: "reveal-ctx" });
    const b = harness({ sessionId: "reveal-ctx" });
    for (const [h, pair] of [[a, [9, 10]], [b, [11, 12]]] as const) {
      h.seal(h.enemy, 0, pair[0]);
      h.seal(h.enemy, 1, pair[1]);
      h.seal(h.side, 0, 3);
      h.seal(h.side, 1, 4);
    }
    const ctxA = a.store.perspectiveRecommendationContext("reveal-ctx")!;
    const ctxB = b.store.perspectiveRecommendationContext("reveal-ctx")!;
    expect(ctxA.view.enemyPicks.flatMap((slot) => (slot.visibility === "REVEALED" ? [slot.heroId] : [])).sort((x, y) => x - y)).toEqual([9, 10]);
    expect(ctxB.view.enemyPicks.flatMap((slot) => (slot.visibility === "REVEALED" ? [slot.heroId] : [])).sort((x, y) => x - y)).toEqual([11, 12]);
    expect(JSON.stringify(ctxA)).not.toBe(JSON.stringify(ctxB));
    expect([...unavailableHeroesFrom(ctxA.view)].sort((x, y) => x - y)).toEqual([3, 4, 9, 10]); // revealed picks are now unavailable

    const setA = await buildRecommendationSetFromPerspective({ context: ctxA, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS });
    const named = setA.recommendations.flatMap((r) => r.actions.map((action) => action.hero));
    expect(named).not.toContain(9);
    expect(named).not.toContain(10);
    // The revealed hero 9 is what makes hero 5 (the counter, in the fixture scorer) a data-backed option -- it may legally affect the result.
    const counter = setA.recommendations.find((r) => r.actions[0]!.hero === 5)?.signalsByHero[5]?.find((signal) => signal.signal === "counter");
    expect(counter?.raw).not.toBeNull();
  });
});

// design.md §15 caso 5 (Wave 5 Task 31): un héroe que el rival tiene sellado (HIDDEN) NO se excluye del pool
// del Coach -- es legalmente elegible para el Player y puede ser su mejor recomendación (Req 20.6).
describe("5b. un héroe sellado del rival sigue siendo recomendable (design.md §15-5)", () => {
  test("con el héroe #1 del scorer sellado por el rival, el Coach lo sigue recomendando; su identidad no mueve la salida", async () => {
    const TOP = 1; // fakeCompute ranks hero 1 first
    const hiddenTop = harness({ sessionId: "hidden-top" });
    const hiddenOther = harness({ sessionId: "hidden-top" });
    hiddenTop.seal(hiddenTop.enemy, 0, TOP);
    hiddenOther.seal(hiddenOther.enemy, 0, 30);
    const ctx = hiddenTop.store.perspectiveRecommendationContext("hidden-top")!;
    expect(ctx.view.enemyPicks).toEqual([{ visibility: "HIDDEN" }]);
    expect(unavailableHeroesFrom(ctx.view).has(TOP)).toBe(false);
    expect(isHeroSelectableFrom(ctx, TOP, ctx.openOwnSlots[0]!)).toBe(true);
    const withHidden = await hiddenTop.compute();
    // The hidden hero stays in V6's own ranking (asserted next). The Coach's shortlist only lists heroes that can
    // execute the primary action (RB-2), so whether TOP appears there depends on the action -- not on hidden data.
    expect(withHidden.output!.shortlist.length).toBeGreaterThan(0);
    expect(withHidden.recommendationSet.recommendations[0]!.actions.some((action) => action.hero === TOP)).toBe(true);
    expect(JSON.stringify(withHidden.output)).toBe(JSON.stringify((await hiddenOther.compute()).output)); // same visible state -> same advice
  });
});

describe("6. compatibilidad legacy: el camino V2 autoritativo sigue igual, y el camino seguro produce lo mismo salvo lo que no puede calcular", () => {
  test("sin información oculta en juego: decisión, recomendaciones, degradaciones y basedOn coinciden; sólo `deferred` (lookahead) es NOT_COMPUTED en el camino seguro", async () => {
    const h = harness({ sessionId: "parity" });
    h.seal(h.side, 0, 3); // no enemy selection exists at all: nothing hidden to differ on
    const context = h.store.perspectiveRecommendationContext("parity")!;
    const safe = await buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS });
    const legacy = await buildRecommendationSetV2({
      state: h.store.get("parity")!,
      view: h.store.view("parity")!,
      actor: h.side,
      patch: "7.41e",
      computeSuggestions: fakeCompute(),
      heroPositions: HERO_POSITIONS,
    });
    expect(JSON.stringify(safe.decision)).toBe(JSON.stringify(legacy.decision));
    expect(JSON.stringify(safe.recommendations)).toBe(JSON.stringify(legacy.recommendations));
    expect(JSON.stringify(safe.degradations)).toBe(JSON.stringify(legacy.degradations));
    expect(JSON.stringify(safe.basedOn)).toBe(JSON.stringify(legacy.basedOn));
    expect(safe.deferred).toEqual({ opponentResponse: "NOT_COMPUTED", steal: "NOT_COMPUTED", lookahead: "NOT_COMPUTED", counterfactual: "NOT_COMPUTED" });
  });

  test("con dos asientos abiertos (recomendación compuesta) el camino seguro también coincide con el legacy", async () => {
    const h = harness({ sessionId: "parity-2" });
    const context = h.store.perspectiveRecommendationContext("parity-2")!;
    const safe = await buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS });
    const legacy = await buildRecommendationSetV2({ state: h.store.get("parity-2")!, view: h.store.view("parity-2")!, actor: h.side, patch: "7.41e", computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS });
    expect(safe.decision.actionCount).toBe(2);
    expect(JSON.stringify(safe.recommendations)).toBe(JSON.stringify(legacy.recommendations));
  });

  test("el builder legacy sigue aceptando estado autoritativo (API intacta)", () => {
    expect(typeof buildRecommendationSetV2).toBe("function");
  });
});

describe("7. authenticated Hero Pool scope", () => {
  test("different personal pools leave team output identical beyond opening and may change personal badges", async () => {
    const h = harness({ sessionId: "personal-pool-scope" });
    const calls: { accountId: number | null; targetPosition?: number; teamOpening?: boolean }[] = [];
    const baseline = fakeCompute();
    const computeWithPersonalPool = async (state: Parameters<ReturnType<typeof fakeCompute>>[0], accountId: number | null, options?: Parameters<ReturnType<typeof fakeCompute>>[2]) => {
      calls.push({ accountId, targetPosition: options?.targetPosition, teamOpening: options?.teamOpening });
      const set = await baseline(state, accountId, options);
      if (accountId === null || options?.targetPosition !== 2) return set;
      const poolHero = accountId === 101 ? 4 : 6;
      return {
        ...set,
        suggestions: set.suggestions.map((suggestion) => suggestion.hero !== poolHero ? suggestion : {
          ...suggestion,
          signals: [...suggestion.signals, { signal: "hero_pool_fit" as const, raw: 1, normalized: 100, evidenceConfidence: 1, weighted: 1, explanation: "En tu pool", sampleSize: 1 }],
        }),
      };
    };
    const recommendations = createCoachRecommendations({ source: h.store, computeSuggestions: computeWithPersonalPool, heroPositions: HERO_POSITIONS });
    const teamOnly = (result: Awaited<ReturnType<typeof recommendations.recommend>>) => ({
      primaryAction: result?.output?.primaryAction,
      shortlist: result?.output?.shortlist,
      teamRecommendationSet: result?.recommendationSet,
    });

    const openingA = await recommendations.recommend(h.id, 2, 101);
    const openingB = await recommendations.recommend(h.id, 2, 202);
    expect(teamOnly(openingA)).toEqual(teamOnly(openingB));
    expect(openingA!.output!.personalHeroView!.heroes.find((hero) => hero.heroId === 4)!.isFromPool).toBe(true);
    expect(openingB!.output!.personalHeroView!.heroes.find((hero) => hero.heroId === 6)!.isFromPool).toBe(true);

    h.seal(h.side, 0, 1);
    const laterA = await recommendations.recommend(h.id, 2, 101);
    const laterB = await recommendations.recommend(h.id, 2, 202);
    expect(teamOnly(laterA)).toEqual(teamOnly(laterB));
    expect(calls.filter((call) => call.teamOpening === true).every((call) => call.accountId === null)).toBe(true);
    expect(calls.filter((call) => call.targetPosition === 2).map((call) => call.accountId).sort()).toEqual([101, 101, 202, 202]);
  });
});
