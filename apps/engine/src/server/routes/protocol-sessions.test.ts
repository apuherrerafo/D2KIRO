import { describe, expect, test } from "bun:test";
import type { SuggestionSet } from "../../signals/mix";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes } from "./protocol-sessions";

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

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

describe("createProtocolSessionRoutes -- S2 HTTP surface", () => {
  test("POST create -> 201 con sessionId y ruleset; GET view devuelve la vista + legalActions", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([]) });

    const createResponse = await routes.post(jsonRequest({ rulesetId: "dota2/ranked-all-pick", patch: "7.41e" }));
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { sessionId: string };
    expect(typeof created.sessionId).toBe("string");

    const viewResponse = routes.get(created.sessionId, new URL(`http://127.0.0.1/api/session/protocol/${created.sessionId}?side=radiant`));
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
      jsonRequest({ rulesetId: "dota2/captains-mode", patch: "7.40", partyContext: { partySize: 3, side: "radiant", controlledSlots: [] } }),
    );
    expect(response.status).toBe(422);
    expect(store.size).toBe(0);
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
    store.create({ sessionId: "sim-auth", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    const response = await routes.postSimulatorAuthority(jsonRequest({ seed: "SEEDSEED" }), "sim-auth");
    expect(response.status).toBe(409);
  });

  test("postBotSelection elige la primera sugerencia disponible que no está tomada y la sella", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({
      store,
      computeSuggestions: async () => fakeSuggestions([7, 8, 9]),
    });
    store.create({ sessionId: "bot", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    store.apply("bot", { type: "BAN_RESOLUTION_COMPLETE" });

    const response = await routes.postBotSelection(jsonRequest({ side: "dire" }), "bot");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { accepted: boolean; heroId: number };
    expect(body.accepted).toBe(true);
    expect(body.heroId).toBe(7);
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
    store.create({ sessionId: "hidden-bot", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    store.apply("hidden-bot", { type: "BAN_RESOLUTION_COMPLETE" });
    // Radiant (the human) seals a pick this round BEFORE the bot (dire) acts.
    store.apply("hidden-bot", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 99 });

    await routes.postBotSelection(jsonRequest({ side: "dire" }), "hidden-bot");
    expect(observedPicksInComputeCall).not.toContain(99);
  });

  test("postBotSelection sin slots abiertos para ese lado -> 409", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([1]) });
    store.create({ sessionId: "no-slot", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    // Still in BAN_RESOLUTION -- no round, no open slots yet.
    const response = await routes.postBotSelection(jsonRequest({ side: "radiant" }), "no-slot");
    expect(response.status).toBe(409);
  });
});
