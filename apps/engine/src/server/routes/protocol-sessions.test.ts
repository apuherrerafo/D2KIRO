import { describe, expect, test } from "bun:test";
import { computeEligibilityContentHash, legalActions, type CmHeroEligibilitySnapshot } from "../../draft-protocol";
import type { SuggestionSet } from "../../signals/mix";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes } from "./protocol-sessions";

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

const CREATE_BODY = {
  rulesetId: "dota2/ranked-all-pick",
  patch: "7.41e",
  localSide: "radiant",
  adapterKind: "simulator",
  partyContext: {
    partySize: 5,
    side: "radiant",
    controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: `p${slotIndex}` })),
  },
} as const;

function fakeSuggestions(heroIds: number[]): SuggestionSet {
  return {
    schema: "suggestions/v1",
    sessionId: "preview",
    basedOnSeq: 0,
    decisionContext: "blind_second_pick",
    suggestions: heroIds.map((hero, index) => ({
      hero,
      rank: (Math.min(index + 1, 6)) as 1 | 2 | 3 | 4 | 5 | 6,
      score: 100 - index,
      signals: [],
      reason: "fixture",
      confidence: "alta" as const,
      evidenceCoverage: 1,
      guessingIndex: 0,
    })),
    comparison: null,
    degraded: [],
    computedInMs: 0,
  };
}

function officialEligibility(count = 30): CmHeroEligibilitySnapshot {
  const value: Omit<CmHeroEligibilitySnapshot, "contentHash"> = {
    schema: "cm-hero-eligibility/v1",
    appId: 570,
    patch: "7.41e",
    buildId: "build-123",
    depotManifests: { "570": "manifest-123" },
    sourceHashes: { npc_heroes: "source-hash" },
    provenance: {
      kind: "OFFICIAL_DEPOT",
      appId: 570,
      buildId: "build-123",
      depotId: "570",
      manifestId: "manifest-123",
      sourcePath: "scripts/npc/npc_heroes.txt",
      sourceHash: "source-hash",
    },
    heroIds: Array.from({ length: count }, (_, index) => index + 1),
  };
  return { ...value, contentHash: computeEligibilityContentHash(value) };
}

describe("createProtocolSessionRoutes -- S2 HTTP surface", () => {
  test("POST create -> 201 con sessionId y ruleset; GET view devuelve la vista + legalActions", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });

    const createResponse = await routes.post(jsonRequest(CREATE_BODY));
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { sessionId: string };
    expect(typeof created.sessionId).toBe("string");

    const viewResponse = routes.get(created.sessionId, new URL(`http://127.0.0.1/api/session/protocol/${created.sessionId}`));
    expect(viewResponse.status).toBe(200);
    const viewBody = (await viewResponse.json()) as { view: { viewerSide: string }; legalActions: unknown[] };
    expect(viewBody.view.viewerSide).toBe("radiant");
    expect(viewBody.legalActions.length).toBeGreaterThan(0);
  });

  test("POST create con body inválido -> 400, nunca crea sesión", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });
    const response = await routes.post(jsonRequest({ rulesetId: "not-a-ruleset" }));
    expect(response.status).toBe(400);
    expect(store.size).toBe(0);
  });

  test("POST create con partySize 4 se rechaza en la validación de borde (400) -- nunca llega a store.create", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });
    const response = await routes.post(
      jsonRequest({ rulesetId: "dota2/ranked-all-pick", patch: "7.41e", partyContext: { partySize: 4, side: "radiant", controlledSlots: [] } }),
    );
    expect(response.status).toBe(400);
    expect(store.size).toBe(0);
  });

  test("POST create con Captain's Mode y party size 3 -- pasa la validación de borde pero el store lo rechaza (422)", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });
    const response = await routes.post(
      jsonRequest({ rulesetId: "dota2/captains-mode", patch: "7.40", localSide: "radiant", adapterKind: "manual", partyContext: { partySize: 3, side: "radiant", controlledSlots: [] } }),
    );
    expect(response.status).toBe(422);
    expect(store.size).toBe(0);
  });

  test("POST create de Captain's Mode sin PartyContext falla cerrado", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });
    const response = await routes.post(jsonRequest({
      rulesetId: "dota2/captains-mode",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "simulator",
    }));
    expect(response.status).toBe(400);
    expect(store.size).toBe(0);
  });

  test("Captain's Mode completo atraviesa create/command/bot routes y el kernel decide los 24 pasos", async () => {
    const store = new ProtocolSessionStore();
    // La elegibilidad llega por el lado servidor (artefacto aprobado), nunca por el body del
    // cliente -- ese es justamente el camino que esta ruta ya no acepta.
    const routes = createProtocolSessionRoutes({
      store,
      computeSuggestions: async () => fakeSuggestions([]),
      trustedEligibility: () => officialEligibility(),
    });
    const createResponse = await routes.post(jsonRequest({
      rulesetId: "dota2/captains-mode",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "simulator",
      partyContext: {
        partySize: 5,
        side: "radiant",
        controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: `p${slotIndex}` })),
      },
    }));
    expect(createResponse.status).toBe(201);
    const { sessionId, eligibilityCertified } = (await createResponse.json()) as { sessionId: string; eligibilityCertified: boolean };
    expect(eligibilityCertified).toBe(true);
    await routes.postCommand(jsonRequest({ command: { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" } }), sessionId);

    for (let guard = 0; guard < 30 && store.get(sessionId)!.status !== "COMPLETE"; guard += 1) {
      const action = legalActions(store.get(sessionId)!).find((candidate) => candidate.type === "CM_ACTION");
      if (!action || action.type !== "CM_ACTION") throw new Error("missing legal CM action");
      const response = action.absoluteSide === "radiant"
        ? await routes.postCommand(jsonRequest({ command: { type: "CM_ACTION", actor: action.actor, kind: action.kind, heroId: action.eligibleHeroIds[0]! } }), sessionId)
        : await routes.postBotSelection(jsonRequest({}), sessionId);
      expect(response.status).toBe(action.absoluteSide === "radiant" ? 202 : 200);
    }

    const final = store.get(sessionId)!;
    expect(final.status).toBe("COMPLETE");
    expect(final.captainsMode!.history).toHaveLength(24);
    expect(final.eventLog.filter((event) => event.command.type === "CM_ACTION")).toHaveLength(24);
  });

  test("GET view para sesión inexistente -> 404", () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });
    const response = routes.get("ghost", new URL("http://127.0.0.1/api/session/protocol/ghost"));
    expect(response.status).toBe(404);
  });

  test("postCommand aplica el comando y devuelve la vista proyectada al viewerSide pedido", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });
    store.create({ sessionId: "cmd", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });

    const response = await routes.postCommand(jsonRequest({ command: { type: "BAN_RESOLUTION_COMPLETE" }, viewerSide: "radiant" }), "cmd");
    expect(response.status).toBe(202);
    const body = (await response.json()) as { accepted: boolean; view: { rankedAp: { phase: string } } };
    expect(body.accepted).toBe(true);
    expect(body.view.rankedAp.phase).toBe("PICK_ROUND_1");
  });

  test("una sesión Radiant no puede pedir perspectiva Dire", () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });
    store.create({ sessionId: "perspective", rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant" });
    const response = routes.get("perspective", new URL("http://127.0.0.1/api/session/protocol/perspective?side=dire"));
    expect(response.status).toBe(403);
  });

  test("una sesión Radiant no puede actuar como Dire", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });
    store.create({ sessionId: "action-side", rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant" });
    store.apply("action-side", { type: "BAN_RESOLUTION_COMPLETE" });
    const response = await routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 9 } }), "action-side");
    expect(response.status).toBe(403);
    expect(store.get("action-side")!.rankedAp!.round!.sealed).toHaveLength(0);
  });

  test("postCommand con comando inválido -> 400, sesión no cambia", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });
    store.create({ sessionId: "bad-cmd", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    const before = store.get("bad-cmd");

    const response = await routes.postCommand(jsonRequest({ command: { type: "TELEPORT" } }), "bad-cmd");
    expect(response.status).toBe(400);
    expect(store.get("bad-cmd")).toBe(before);
  });

  test("postSimulatorAuthority sin colisión pendiente -> 409, no aplica nada", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });
    store.create({ sessionId: "sim-auth", rulesetId: "dota2/ranked-all-pick", patch: "7.41e", adapterKind: "simulator" });
    const response = await routes.postSimulatorAuthority(jsonRequest({ seed: "SEEDSEED" }), "sim-auth");
    expect(response.status).toBe(409);
  });

  test("tercera colisión atraviesa bot route, pausa en WAITING y solo simulator-authority la resuelve", async () => {
    const queuedBotHeroes = [401, 902, 402, 403];
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({
      store,
      computeSuggestions: async () => fakeSuggestions([queuedBotHeroes.shift()!]),
    });
    store.create({
      sessionId: "third-collision-route",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "simulator",
    });
    await routes.postCommand(jsonRequest({ command: { type: "BAN_RESOLUTION_COMPLETE" } }), "third-collision-route");

    const submitLocal = (slotIndex: number, heroId: number) => routes.postCommand(
      jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId } }),
      "third-collision-route",
    );
    await submitLocal(0, 401);
    await submitLocal(1, 901);
    await routes.postBotSelection(jsonRequest({}), "third-collision-route");
    await routes.postBotSelection(jsonRequest({}), "third-collision-route");
    expect(store.get("third-collision-route")!.rankedAp!.bannedHeroes).toContain(401);

    await submitLocal(0, 402);
    await routes.postBotSelection(jsonRequest({}), "third-collision-route");
    expect(store.get("third-collision-route")!.rankedAp!.bannedHeroes).toContain(402);

    await submitLocal(0, 403);
    await routes.postBotSelection(jsonRequest({}), "third-collision-route");
    expect(store.get("third-collision-route")!.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");

    const authority = await routes.postSimulatorAuthority(jsonRequest({ seed: "ABCDEFGH" }), "third-collision-route");
    expect(authority.status).toBe(200);
    expect(store.get("third-collision-route")!.status).toBe("ACTIVE");
    expect(store.get("third-collision-route")!.eventLog.at(-1)?.command.type).toBe("APPLY_AUTHORITATIVE_COLLISION_RESOLUTION");
    expect(store.get("third-collision-route")!.rankedAp!.bannedHeroes).not.toContain(403);
  });

  test("postBotSelection elige la primera sugerencia disponible que no está tomada y la sella", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({
      store,
      computeSuggestions: async () => fakeSuggestions([7, 8, 9]),
    });
    store.create({ sessionId: "bot", rulesetId: "dota2/ranked-all-pick", patch: "7.41e", adapterKind: "simulator" });
    store.apply("bot", { type: "BAN_RESOLUTION_COMPLETE" });

    const response = await routes.postBotSelection(jsonRequest({}), "bot");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { accepted: boolean; heroId?: number };
    expect(body.accepted).toBe(true);
    expect(body.heroId).toBeUndefined();
    expect(store.get("bot")!.rankedAp!.round!.sealed.some((s) => s.side === "dire" && s.heroId === 7)).toBe(true);
  });

  test("postBotSelection nunca ve picks propios sellados del jugador humano en el mismo round (perspectiva)", async () => {
    let observedPicksInComputeCall: number[] = [];
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({
      store,
      computeSuggestions: async (state) => {
        observedPicksInComputeCall = [...state.picks.radiant, ...state.picks.dire];
        return fakeSuggestions([55]);
      },
    });
    store.create({ sessionId: "hidden-bot", rulesetId: "dota2/ranked-all-pick", patch: "7.41e", adapterKind: "simulator" });
    store.apply("hidden-bot", { type: "BAN_RESOLUTION_COMPLETE" });
    // Radiant (the human) seals a pick this round BEFORE the bot (dire) acts.
    store.apply("hidden-bot", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 99 });

    const response = await routes.postBotSelection(jsonRequest({}), "hidden-bot");
    expect(observedPicksInComputeCall).not.toContain(99);
    const responseBody = (await response.json()) as { heroId?: number; view: { enemyPicks: unknown[] } };
    expect(responseBody.heroId).toBeUndefined();
    expect(responseBody.view.enemyPicks).toEqual([{ visibility: "HIDDEN" }]);
  });

  test("hidden twins siguen indistinguibles por la superficie pública aunque el bot selle héroes distintos", async () => {
    const buildTwin = (botHeroId: number) => {
      const store = new ProtocolSessionStore();
      const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([botHeroId]) });
      store.create({
        sessionId: "public-hidden-twin",
        rulesetId: "dota2/ranked-all-pick",
        patch: "7.41e",
        localSide: "radiant",
        adapterKind: "simulator",
      });
      store.apply("public-hidden-twin", { type: "BAN_RESOLUTION_COMPLETE" });
      store.apply("public-hidden-twin", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 99 });
      return { store, routes };
    };
    const left = buildTwin(55);
    const right = buildTwin(77);
    await left.routes.postBotSelection(jsonRequest({}), "public-hidden-twin");
    await right.routes.postBotSelection(jsonRequest({}), "public-hidden-twin");

    const leftPublic = await left.routes.get("public-hidden-twin", new URL("http://127.0.0.1/api/session/protocol/public-hidden-twin")).json() as { view: { enemyPicks: unknown[] }; legalActions: unknown[] };
    const rightPublic = await right.routes.get("public-hidden-twin", new URL("http://127.0.0.1/api/session/protocol/public-hidden-twin")).json() as { view: { enemyPicks: unknown[] }; legalActions: unknown[] };
    expect(leftPublic).toEqual(rightPublic);
    expect(leftPublic.view.enemyPicks).toEqual([{ visibility: "HIDDEN" }]);
  });

  test("postBotSelection sin slots abiertos para ese lado -> 409", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([1]) });
    store.create({ sessionId: "no-slot", rulesetId: "dota2/ranked-all-pick", patch: "7.41e", adapterKind: "simulator" });
    // Still in BAN_RESOLUTION -- no round, no open slots yet.
    const response = await routes.postBotSelection(jsonRequest({}), "no-slot");
    expect(response.status).toBe(409);
  });
});

// R1 S7 (machine-certification closure) -- TEST-ONLY forced-bot-selection mechanism: lets a
// deterministic E2E force the simulator bot's hero (per postBotSelection call, matched to whatever
// the human just clicked) through the SAME real kernel command (SUBMIT_SEALED_SELECTION), never a
// fabricated state. Gated on ALLOW_TEST_FORCED_BOT_SELECTION, which production (Railway) never
// sets -- every test here restores the env var afterwards so it never leaks into an unrelated test.
describe("postBotSelection forcedHeroId -- TEST-ONLY, gated on ALLOW_TEST_FORCED_BOT_SELECTION", () => {
  async function withForcedBotSelectionAllowed<T>(fn: () => Promise<T>): Promise<T> {
    const before = process.env.ALLOW_TEST_FORCED_BOT_SELECTION;
    process.env.ALLOW_TEST_FORCED_BOT_SELECTION = "1";
    try {
      return await fn();
    } finally {
      if (before === undefined) delete process.env.ALLOW_TEST_FORCED_BOT_SELECTION;
      else process.env.ALLOW_TEST_FORCED_BOT_SELECTION = before;
    }
  }

  test("gate apagado (default de producción): forcedHeroId en el body se ignora, el bot sigue usando V6", async () => {
    expect(process.env.ALLOW_TEST_FORCED_BOT_SELECTION).toBeUndefined();
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([7]) });
    store.create({ sessionId: "gate-off", rulesetId: "dota2/ranked-all-pick", patch: "7.41e", adapterKind: "simulator" });
    store.apply("gate-off", { type: "BAN_RESOLUTION_COMPLETE" });

    await routes.postBotSelection(jsonRequest({ forcedHeroId: 999 }), "gate-off");
    const sealed = store.get("gate-off")!.rankedAp!.round!.sealed;
    expect(sealed.some((s) => s.side === "dire" && s.heroId === 7)).toBe(true);
    expect(sealed.some((s) => s.heroId === 999)).toBe(false);
  });

  test("gate encendido: el bot sella el heroId forzado en vez de llamar a V6", async () => {
    await withForcedBotSelectionAllowed(async () => {
      const store = new ProtocolSessionStore();
      let computeSuggestionsCalled = false;
      const routes = createProtocolSessionRoutes({
        store,
        computeSuggestions: async () => {
          computeSuggestionsCalled = true;
          return fakeSuggestions([7]);
        },
      });
      store.create({ sessionId: "gate-on", rulesetId: "dota2/ranked-all-pick", patch: "7.41e", adapterKind: "simulator" });
      store.apply("gate-on", { type: "BAN_RESOLUTION_COMPLETE" });

      const response = await routes.postBotSelection(jsonRequest({ forcedHeroId: 42 }), "gate-on");
      expect(response.status).toBe(200);
      expect(computeSuggestionsCalled).toBe(false);
      const sealed = store.get("gate-on")!.rankedAp!.round!.sealed;
      expect(sealed.some((s) => s.side === "dire" && s.heroId === 42)).toBe(true);
    });
  });

  test("heroId forzado ya tomado: cae de vuelta a V6 en vez de intentar sellar algo ilegal", async () => {
    await withForcedBotSelectionAllowed(async () => {
      const store = new ProtocolSessionStore();
      const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([7]) });
      store.create({ sessionId: "gate-taken", rulesetId: "dota2/ranked-all-pick", patch: "7.41e", adapterKind: "simulator" });
      // Hero 401 is already banned -- the "taken" set the real bot path always checks.
      store.apply("gate-taken", { type: "RECORD_RESOLVED_BANS", heroes: [401] });
      store.apply("gate-taken", { type: "BAN_RESOLUTION_COMPLETE" });

      const response = await routes.postBotSelection(jsonRequest({ forcedHeroId: 401 }), "gate-taken");
      expect(response.status).toBe(200);
      const sealed = store.get("gate-taken")!.rankedAp!.round!.sealed;
      expect(sealed.some((s) => s.side === "dire" && s.heroId === 7)).toBe(true);
      expect(sealed.some((s) => s.heroId === 401)).toBe(false);
    });
  });

  test("cada llamada consume su propio forcedHeroId -- la segunda selección del bot, sin el campo, usa V6", async () => {
    await withForcedBotSelectionAllowed(async () => {
      const store = new ProtocolSessionStore();
      const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([7]) });
      store.create({ sessionId: "gate-percall", rulesetId: "dota2/ranked-all-pick", patch: "7.41e", adapterKind: "simulator" });
      store.apply("gate-percall", { type: "BAN_RESOLUTION_COMPLETE" });

      await routes.postBotSelection(jsonRequest({ forcedHeroId: 42 }), "gate-percall");
      await routes.postBotSelection(jsonRequest({}), "gate-percall");
      const sealed = store.get("gate-percall")!.rankedAp!.round!.sealed;
      expect(sealed.filter((s) => s.side === "dire").map((s) => s.heroId).sort((a, b) => a - b)).toEqual([7, 42]);
    });
  });
});

// R1 S3 (final trust-boundary repair) -- the client is not an authority on its own eligibility.
// These lock the BOUNDARY, not the payload shape: a refusal must hold for snapshots that are
// perfectly well-formed, because "well-formed" is something an attacker controls completely.
describe("CM eligibility -- TRUSTED_SERVER_ONLY boundary", () => {
  const CM_CREATE_BODY = {
    rulesetId: "dota2/captains-mode",
    patch: "7.41e",
    localSide: "radiant",
    adapterKind: "manual",
    partyContext: {
      partySize: 5,
      side: "radiant",
      controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: `p${slotIndex}` })),
    },
  } as const;

  /** A snapshot whose every field is invented but internally consistent -- exactly what a client can always produce. */
  function forgedOfficial(heroIds: number[]): CmHeroEligibilitySnapshot {
    const value: Omit<CmHeroEligibilitySnapshot, "contentHash"> = {
      schema: "cm-hero-eligibility/v1",
      appId: 570,
      patch: "7.41e",
      buildId: "TOTALMENTE-INVENTADO",
      depotManifests: { "570": "MANIFIESTO-FALSO" },
      sourceHashes: { npc_heroes: "HASH-FALSO" },
      provenance: {
        kind: "OFFICIAL_DEPOT",
        appId: 570,
        buildId: "TOTALMENTE-INVENTADO",
        depotId: "DEPOT-FALSO",
        manifestId: "MANIFIESTO-FALSO",
        sourcePath: "scripts/npc/npc_heroes.txt",
        sourceHash: "HASH-FALSO",
      },
      heroIds,
    };
    return { ...value, contentHash: computeEligibilityContentHash(value) };
  }

  function withProvenance(kind: "DEMO_FIXTURE" | "SYNTHETIC_TEST"): CmHeroEligibilitySnapshot {
    const base = officialEligibility();
    const value = { ...base, provenance: { kind, label: "fixture" } } as Omit<CmHeroEligibilitySnapshot, "contentHash">;
    return { ...value, contentHash: computeEligibilityContentHash(value) };
  }

  async function createCmSession(routes: ReturnType<typeof createProtocolSessionRoutes>) {
    const response = await routes.post(jsonRequest(CM_CREATE_BODY));
    expect(response.status).toBe(201);
    return (await response.json()) as { sessionId: string; eligibilityCertified: boolean };
  }

  function bareRoutes(store: ProtocolSessionStore) {
    // Sin `trustedEligibility`: ninguna sesión arranca certificada, que es el default real.
    return createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]), trustedEligibility: () => null });
  }

  test("la ruta pública de comandos rechaza LOAD_CM_ELIGIBILITY aunque el snapshot sea impecable", async () => {
    const store = new ProtocolSessionStore();
    const routes = bareRoutes(store);
    const { sessionId, eligibilityCertified } = await createCmSession(routes);
    expect(eligibilityCertified).toBe(false);

    const response = await routes.postCommand(
      jsonRequest({ command: { type: "LOAD_CM_ELIGIBILITY", snapshot: officialEligibility() } }),
      sessionId,
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe("admin_command_forbidden");
    expect(store.get(sessionId)!.captainsMode!.eligibilitySnapshot).toBeNull();
  });

  test("un payload OFFICIAL_DEPOT fabricado con héroes inexistentes no entra por la ruta cliente", async () => {
    const store = new ProtocolSessionStore();
    const routes = bareRoutes(store);
    const { sessionId } = await createCmSession(routes);

    const response = await routes.postCommand(
      jsonRequest({ command: { type: "LOAD_CM_ELIGIBILITY", snapshot: forgedOfficial([777, 888, 999]) } }),
      sessionId,
    );

    expect(response.status).toBe(403);
    expect(store.get(sessionId)!.captainsMode!.eligibilitySnapshot).toBeNull();
  });

  test.each(["DEMO_FIXTURE", "SYNTHETIC_TEST"] as const)(
    "provenance %s tampoco se cuela por la ruta cliente",
    async (kind) => {
      const store = new ProtocolSessionStore();
      const routes = bareRoutes(store);
      const { sessionId } = await createCmSession(routes);

      const response = await routes.postCommand(
        jsonRequest({ command: { type: "LOAD_CM_ELIGIBILITY", snapshot: withProvenance(kind) } }),
        sessionId,
      );

      expect(response.status).toBe(403);
      expect(store.get(sessionId)!.captainsMode!.eligibilitySnapshot).toBeNull();
    },
  );

  test("la superficie pública no ANUNCIA LOAD_CM_ELIGIBILITY como acción legal", async () => {
    const store = new ProtocolSessionStore();
    const routes = bareRoutes(store);
    const { sessionId } = await createCmSession(routes);

    const body = (await routes.get(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}`)).json()) as {
      legalActions: { type: string }[];
    };

    expect(body.legalActions.some((action) => action.type === "LOAD_CM_ELIGIBILITY")).toBe(false);
    // El kernel sí la considera disponible -- la diferencia es exactamente el filtro de frontera.
    expect(legalActions(store.get(sessionId)!).some((action) => action.type === "LOAD_CM_ELIGIBILITY")).toBe(true);
  });

  test("sin artefacto confiable, el gameplay CM sigue fail-closed", async () => {
    const store = new ProtocolSessionStore();
    const routes = bareRoutes(store);
    const { sessionId } = await createCmSession(routes);
    await routes.postCommand(jsonRequest({ command: { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" } }), sessionId);

    const response = await routes.postCommand(
      jsonRequest({ command: { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 1 } }),
      sessionId,
    );

    // La ruta ni siquiera llega al kernel: sin snapshot no hay CM_ACTION legal, así que la
    // autorización por lado/acción ya la rechaza.
    expect(response.status).toBe(403);
    // Y el kernel es fail-closed por su cuenta, no por gracia del guard de la ruta -- sin esta
    // segunda aserción, quitar el snapshot del gate del kernel dejaría el test en verde.
    expect(store.apply(sessionId, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 1 })?.rejected)
      .toBe("ELIGIBILITY_UNVERIFIED");
    expect(store.get(sessionId)!.captainsMode!.picks.radiant).toHaveLength(0);
    expect(store.get(sessionId)!.captainsMode!.bannedHeroes).toHaveLength(0);
  });

  test("el artefacto confiable del servidor SÍ certifica, y el mismo snapshot por ruta cliente no", async () => {
    const trustedStore = new ProtocolSessionStore();
    const trustedRoutes = createProtocolSessionRoutes({
      store: trustedStore,
      computeSuggestions: async () => fakeSuggestions([]),
      trustedEligibility: () => officialEligibility(),
    });
    const trusted = await createCmSession(trustedRoutes);
    expect(trusted.eligibilityCertified).toBe(true);
    expect(trustedStore.get(trusted.sessionId)!.captainsMode!.eligibilitySnapshot!.heroIds).toHaveLength(30);

    const clientStore = new ProtocolSessionStore();
    const clientRoutes = bareRoutes(clientStore);
    const client = await createCmSession(clientRoutes);
    expect(client.eligibilityCertified).toBe(false);
    expect(clientStore.get(client.sessionId)!.captainsMode!.eligibilitySnapshot).toBeNull();
  });
});
