/**
 * R3.1 -- cobertura SEMANTICA contra las rutas reales. La elegibilidad la declara el FIXTURE (un counter curado inyectado contra un
 * ban resuelto), nunca la respuesta del Coach: con fundamento la tarjeta es obligatoria en las 5 posiciones; sin fundamento (counters
 * vacios inyectados, hermetico) `[]` es una abstencion valida y no se fuerza nada.
 *
 * Por que existe: la matriz del generador solo produce tarjetas cuando la posicion 1 esta abierta (su fixture de sugerencias lista primero
 * a los heroes de posicion 1, y los heroes 100-129 coinciden con ids reales que traen counters curados). Posiciones 2-5 salen con cero
 * tarjetas en esa matriz, y eso NO es una abstencion demostrada: es un limite del fixture. Estas sondas cubren las 5 posiciones.
 *
 * Independencia: igual que el resto de qa/**, no importa logica de decision de coach/ ni recommendation/; maneja las rutas publicas.
 */
import { describe, expect, test } from "bun:test";
import { createProtocolSessionRoutes } from "../../apps/engine/src/server/routes/protocol-sessions";
import { ProtocolSessionStore } from "../../apps/engine/src/server/protocol-session";
import type { SuggestionSet } from "../../apps/engine/src/signals/mix";
import { HERO_POSITIONS, heroUniverseFor, type Position } from "../scenarios/generate";
import { classifyProbe, semanticCoverageProblems, type SemanticProbe } from "./matrix-coverage";

const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];
const BANNED_THREAT = 2; // heroe del universo del fixture (relleno 1..48), baneado en la variante con fundamento

async function probeShortlist(position: Position, grounded: boolean): Promise<number> {
  const hero = position * 100; // heroe de ESA posicion en HERO_POSITIONS (unico candidato que ofrece el fixture)
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({
    store,
    heroPositions: HERO_POSITIONS,
    heroUniverse: async () => heroUniverseFor(HERO_POSITIONS),
    // Hermetico: Map vacio inyectado = ningun counter curado (ni los reales) -> sin fundamento. Con fundamento: un counter duro contra el ban.
    heroCounters: grounded ? new Map([[hero, [{ vs: BANNED_THREAT, level: "hard" as const, why: "QA fixture" }]]]) : new Map(),
    computeSuggestions: async (state): Promise<SuggestionSet> => ({
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: state.lastSeq,
      decisionContext: "team_opening",
      suggestions: [{ hero, rank: 1, score: 100, signals: [], reason: "QA semantic probe", confidence: "alta", evidenceCoverage: 1, guessingIndex: 0 }],
      comparison: null,
      degraded: [],
      computedInMs: 0,
      functionalEvidence: { metaIsStale: false, signalEvidence: [], heroPositions: [], teamOpening: null, partyPreferredPositions: [] },
    }),
  });
  const created = await routes.post(
    new Request("http://qa.local/session/protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rulesetId: "dota2/ranked-all-pick",
        patch: "7.41f",
        localSide: "radiant",
        adapterKind: "simulator",
        partyContext: { partySize: 1, side: "radiant", controlledSlots: [] },
        controlledPositions: [position],
        humanPosition: position,
        simulatorSeed: "QAP00001",
      }),
    }),
  );
  expect(created.status).toBe(201);
  const { sessionId } = (await created.json()) as { sessionId: string };
  store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: grounded ? [BANNED_THREAT] : [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  expect(store.humanOpenPositions(sessionId)).toEqual([position]);
  const response = await routes.getRecommendations(sessionId, new URL(`http://qa.local/${sessionId}/recommendations?format=v3`));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { output: { shortlist: { heroId: number }[] } | null };
  const heroes = body.output?.shortlist.map((card) => card.heroId) ?? [];
  if (grounded && heroes.length > 0) expect(heroes).toEqual([hero]);
  return heroes.length;
}

describe("cobertura semantica: fundamento declarado => tarjeta; sin fundamento => abstencion valida", () => {
  test("las 5 posiciones, con y sin fundamento declarado por el fixture", async () => {
    const probes: SemanticProbe[] = [];
    for (const position of POSITIONS) {
      probes.push({ label: `pos${position}-con-fundamento`, position, grounded: true, shortlistLength: await probeShortlist(position, true) });
      probes.push({ label: `pos${position}-sin-fundamento`, position, grounded: false, shortlistLength: await probeShortlist(position, false) });
    }
    expect(semanticCoverageProblems(probes)).toEqual([]);
    expect(probes.filter((probe) => classifyProbe(probe) === "EXPECTED_COVERAGE")).toHaveLength(5);
    expect(probes.filter((probe) => classifyProbe(probe) === "VALID_ABSTENTION")).toHaveLength(5);
  });
});
