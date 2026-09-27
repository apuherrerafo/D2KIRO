import { describe, expect, test } from "bun:test";
import type { RecommendationOutputV3 } from "../../coach";
import type { RecommendationSetV2 } from "../../recommendation";
import type { FunctionalRecommendationEvidence } from "../../recommendation/evidence";
import type { SuggestionSet } from "../../signals/mix";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes } from "./protocol-sessions";

// AP Ranked Roles V1 / Wave 2 -- `GET .../recommendations?format=v3`: the Coach over the HTTP surface.
// The plain V2 response must stay exactly what it was (RecommendationSetV2 consumers are unchanged).

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

const CREATE_BODY = {
  rulesetId: "dota2/ranked-all-pick",
  patch: "7.41e",
  localSide: "radiant",
  adapterKind: "simulator",
  humanPosition: 2,
  simulatorSeed: "COACH001",
  // PD-026/PD-027: Own Team truth is `controlledPositions`, never chronological roster seats.
  partyContext: { partySize: 5, side: "radiant", controlledSlots: [] },
  controlledPositions: [1, 2, 3, 4, 5],
} as const;

function fakeSuggestions(heroIds: number[]): SuggestionSet {
  const functionalEvidence: FunctionalRecommendationEvidence = {
    metaIsStale: false,
    signalEvidence: heroIds.map((hero) => ({ hero, signals: [] })),
    heroPositions: [],
    teamOpening: null,
    partyPreferredPositions: [],
  };
  return {
    schema: "suggestions/v1",
    sessionId: "preview",
    basedOnSeq: 0,
    decisionContext: "team_opening",
    suggestions: heroIds.map((hero, index) => ({
      hero,
      rank: Math.min(index + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6,
      score: 100 - index,
      signals: [{ signal: "position_fit" as const, raw: 0.5, normalized: 50, evidenceConfidence: 1, weighted: 100 - index, explanation: "fixture", sampleSize: 50 }],
      reason: "fixture",
      confidence: "alta" as const,
      evidenceCoverage: 1,
      guessingIndex: 0,
    })),
    comparison: null,
    degraded: [],
    computedInMs: 0,
    functionalEvidence,
  };
}

async function setup(heroIds: number[] = [1, 2, 3, 4, 5, 6]) {
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions(heroIds) });
  const created = await routes.post(jsonRequest(CREATE_BODY));
  const { sessionId } = (await created.json()) as { sessionId: string };
  store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  const url = (query = "") => new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations${query}`);
  return { store, routes, sessionId, url };
}

// Wave 4A -- the Safe Core opportunity over HTTP. Curated positions and counters are INLINE fixtures injected
// through the route deps: nothing here reads hero-positions.json or hero-counters.json.
describe("GET .../recommendations?format=v3 -- opportunity (Safe Core)", () => {
  const HARD_COUNTER = 7;
  const HARD_COUNTER_B = 8; // Safe Core needs >= 2 curated hard counters (MIN_CURATED_HARD_COUNTER_COVERAGE)
  async function setupWithCounters(bans: number[], hardCounters: number[] = [HARD_COUNTER, HARD_COUNTER_B]) {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({
      store,
      computeSuggestions: async () => fakeSuggestions([1, 2, 3, 4, 5, 6]),
      // Pre-staging hardening (isCredibleForPosition): hero 1's antiguo "pos5: 200" era sólo presencia
      // curada residual (16.7% share, no dominante) -- bajo la regla endurecida ya no es creíble en
      // Pos 5, así que ni entraba al slot de la ronda 1 ni podía ser el top candidate que Safe Core
      // evalúa. Safe Core exige un CORE resuelto (Pos 1-3, safe-core.ts's CORE_POSITIONS) -- hero 1
      // pasa a ser un flex genuino Pos 1 / Pos 5 (60/40, ambos por encima del piso de credibilidad)
      // en vez de un Pos 5 puro: sigue siendo admisible en el slot de Pos 5 de esta ronda y su
      // belief de rol resuelve a Pos 1 (core), restaurando el escenario que este test certifica.
      heroPositions: { 1: [{ position: 1, matches: 600 }, { position: 5, matches: 400 }], 2: [{ position: 1, matches: 1000 }], 3: [{ position: 4, matches: 1000 }], 4: [{ position: 2, matches: 1000 }], 5: [{ position: 3, matches: 1000 }], 6: [{ position: 3, matches: 1000 }] },
      heroCounters: new Map([[1, hardCounters.map((vs) => ({ vs, level: "hard" as const, why: "fixture" }))]]),
    });
    const created = await routes.post(jsonRequest(CREATE_BODY));
    const { sessionId } = (await created.json()) as { sessionId: string };
    store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: bans }, { type: "BAN_RESOLUTION_COMPLETE" }]);
    const url = new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=v3`);
    return { routes, sessionId, url };
  }

  test("counter duro curado baneado -> el JSON trae `opportunity` con procedencia CURATED; la acción primaria sigue presente", async () => {
    const { routes, sessionId, url } = await setupWithCounters([HARD_COUNTER, HARD_COUNTER_B]);
    const body = (await (await routes.getRecommendations(sessionId, url)).json()) as { output: RecommendationOutputV3 };
    expect(body.output.opportunity).toMatchObject({ subtype: "SAFE_CORE", heroId: 1, counterEvidence: { sourceType: "CURATED", totalHardCounters: 2 } });
    expect(body.output.primaryAction.label.length).toBeGreaterThan(0);
  });

  test("un héroe con UN solo counter duro curado, ya baneado -> el campo `opportunity` no existe en el JSON (piso de cobertura)", async () => {
    const { routes, sessionId, url } = await setupWithCounters([HARD_COUNTER], [HARD_COUNTER]);
    const raw = await (await routes.getRecommendations(sessionId, url)).text();
    expect(raw).not.toContain('"opportunity"');
  });

  test("counter duro disponible -> el campo `opportunity` no existe en el JSON", async () => {
    const { routes, sessionId, url } = await setupWithCounters([]);
    const raw = await (await routes.getRecommendations(sessionId, url)).text();
    expect(raw).not.toContain('"opportunity"');
  });
});

describe("GET .../recommendations?format=v3", () => {
  test("devuelve { output: RecommendationOutputV3, recommendationSet: RecommendationSetV2 } con una acción primaria antes del primer pick", async () => {
    const { routes, sessionId, url } = await setup();
    const response = await routes.getRecommendations(sessionId, url("?format=v3"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { output: RecommendationOutputV3; recommendationSet: RecommendationSetV2 };
    expect(body.output.schema).toBe("recommendation-output/v3");
    expect(body.output.primaryAction.label.length).toBeGreaterThan(0);
    expect(body.output.meta.trigger).toBe("DRAFT_PICKS_STARTED");
    expect(body.recommendationSet.schema).toBe("recommendation-set/v2");
    expect(body.output.meta.basedOn.stateIdentity).toBe(body.recommendationSet.basedOn.stateIdentity);
  });

  test("COMPATIBILIDAD: sin ?format el cuerpo sigue siendo un RecommendationSetV2 plano (sin `output`)", async () => {
    const { routes, sessionId, url } = await setup();
    const body = (await (await routes.getRecommendations(sessionId, url())).json()) as Record<string, unknown>;
    expect(body.schema).toBe("recommendation-set/v2");
    expect(body).not.toHaveProperty("output");
  });

  test("el set embebido en v3 viene del camino SEGURO: mismas recomendaciones que el V2 legacy, sin lookahead (NOT_COMPUTED) ni seed del Simulator", async () => {
    // Pre-staging hardening (isCredibleForPosition): `buildV2ForSession` (el camino V2 plano) nunca
    // recibe `deps.heroPositions` -- siempre usa el `hero-positions.json` real (gap pre-existente,
    // fuera de alcance de este hardening). Un `heroPositions` inyectado aquí sólo llegaría al camino
    // del Coach, rompiendo la comparación en vez de arreglarla. Con las curated REALES, ninguno de
    // los héroes 1-6 es creíble en Pos 4 bajo la regla ya endurecida -- el par R1 nunca existe y
    // ambos caminos divergirían (V2 sin fallback de un solo paso vs. Coach con el de Wave 4A). Se
    // usan dos héroes genuinamente dominantes en Pos 4 y Pos 5 en los datos curados reales (9 y 3)
    // como los de mayor score, para que el par compuesto normal exista en ambos caminos por igual --
    // restaura el escenario que este test certifica sin inventar credibilidad ni tocar producción.
    const { routes, sessionId, url } = await setup([9, 3, 4, 5, 6, 7]);
    const plain = (await (await routes.getRecommendations(sessionId, url())).json()) as RecommendationSetV2;
    const embedded = ((await (await routes.getRecommendations(sessionId, url("?format=v3"))).json()) as { recommendationSet: RecommendationSetV2 }).recommendationSet;
    expect(embedded.recommendations).toEqual(plain.recommendations);
    expect(embedded.decision).toEqual(plain.decision);
    expect(embedded.deferred).toEqual({ opponentResponse: "NOT_COMPUTED", steal: "NOT_COMPUTED", lookahead: "NOT_COMPUTED", counterfactual: "NOT_COMPUTED" });
    expect(plain.basedOn.seed).toBe("COACH001"); // legacy path keeps threading the session seed
    expect(embedded.basedOn.seed).toBeNull(); // the Coach path never receives it
  });

  test("tras un pick propio, la siguiente petición recomputa con OWN_PICK_CONFIRMED y nueva identidad de estado", async () => {
    const { routes, store, sessionId, url } = await setup();
    const first = (await (await routes.getRecommendations(sessionId, url("?format=v3"))).json()) as { output: RecommendationOutputV3 };
    store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 });
    const second = (await (await routes.getRecommendations(sessionId, url("?format=v3"))).json()) as { output: RecommendationOutputV3 };
    expect(second.output.meta.trigger).toBe("OWN_PICK_CONFIRMED");
    expect(second.output.meta.basedOn.stateIdentity).not.toBe(first.output.meta.basedOn.stateIdentity);
    expect(second.output.meta.revision).toBeGreaterThan(first.output.meta.revision);
  });

  test("la perspectiva ajena sigue prohibida también en v3", async () => {
    const { routes, sessionId, url } = await setup();
    const response = await routes.getRecommendations(sessionId, url("?format=v3&side=dire"));
    expect(response.status).toBe(403);
  });

  test("el Coach es sólo de Ranked All Pick: una sesión de Captain's Mode responde 422, no un consejo inventado", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([1, 2, 3]) });
    const created = await routes.post(
      jsonRequest({
        rulesetId: "dota2/captains-mode",
        patch: "7.41e",
        localSide: "radiant",
        adapterKind: "manual",
        partyContext: { partySize: 5, side: "radiant", controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: `p${slotIndex}` })) },
      }),
    );
    const { sessionId } = (await created.json()) as { sessionId: string };
    const response = await routes.getRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=v3`));
    expect(response.status).toBe(422);
  });

  test("sin decisión abierta (draft completo) output es null, nunca una acción inventada", async () => {
    const { routes, store, sessionId, url } = await setup();
    // Fill every seat of every round for both sides -> COMPLETE.
    const fill = (round: number[], radiant: number[], dire: number[]) => {
      round.forEach((slotIndex, index) => store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId: radiant[index]! }));
      round.forEach((slotIndex, index) => store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex, heroId: dire[index]! }));
    };
    fill([0, 1], [11, 12], [21, 22]);
    fill([0, 1], [13, 14], [23, 24]);
    fill([0], [15], [25]);
    expect(store.get(sessionId)!.status).toBe("COMPLETE");
    const body = (await (await routes.getRecommendations(sessionId, url("?format=v3"))).json()) as { output: unknown };
    expect(body.output).toBeNull();
  });

  test("position assignment rejects a revealed enemy hero", async () => {
    const { routes, store, sessionId } = await setup();
    store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 });
    store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 2 });
    store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 3 });
    store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 4 });
    const response = await routes.postPositionAssignment(jsonRequest({ heroId: 3, position: 3 }), sessionId);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "own_team_assignment_only" });
  });
});
