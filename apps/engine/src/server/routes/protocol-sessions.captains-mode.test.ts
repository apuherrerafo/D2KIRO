import { describe, expect, test } from "bun:test";
import { computeEligibilityContentHash, legalActions, type CmHeroEligibilitySnapshot } from "../../draft-protocol";
import type { CaptainsModeOutput } from "../../coach";
import type { FunctionalRecommendationEvidence } from "../../recommendation/evidence";
import type { CuratedCounter } from "../../signals/hero-counters";
import type { HeroPositions } from "../../signals/hero-positions";
import type { SuggestionSet } from "../../signals/mix";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes, type ComputeSuggestionsForDraftState } from "./protocol-sessions";

// CONTRATO DE ELEGIBILIDAD en Captains Mode, de punta a punta por la ruta HTTP (dueño del producto, 2026-11-04): `GET .../recommendations?format=cm`
// con un store y un kernel reales, y un V6 de mentira que solo sabe de posición. Fixtures inline: ningún dato curado real, cero red, cero SQLite.

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

const UNIVERSE = 30;

function eligibility(count: number): CmHeroEligibilitySnapshot {
  const value: Omit<CmHeroEligibilitySnapshot, "contentHash"> = {
    schema: "cm-hero-eligibility/v1",
    appId: 570,
    patch: "7.41e",
    buildId: "build-123",
    depotManifests: { "570": "manifest-123" },
    sourceHashes: { npc_heroes: "source-hash" },
    provenance: { kind: "OFFICIAL_DEPOT", appId: 570, buildId: "build-123", depotId: "570", manifestId: "manifest-123", sourcePath: "scripts/npc/npc_heroes.txt", sourceHash: "source-hash" },
    heroIds: Array.from({ length: count }, (_, index) => index + 1),
  };
  return { ...value, contentHash: computeEligibilityContentHash(value) };
}

const HERO_POSITIONS: HeroPositions = Object.fromEntries(Array.from({ length: UNIVERSE }, (_, index) => [index + 1, [{ position: 1, matches: 3000 }]]));

/** Un V6 de mentira: rankea TODO el universo legal que se le pide, y de cada héroe solo sabe su posición. Anota los `limit` que recibe. */
function positionOnlyCompute(seenLimits: (number | undefined)[]): ComputeSuggestionsForDraftState {
  return async (_state, _accountId, options) => {
    seenLimits.push(options?.limit);
    const heroes = [...(options?.candidateHeroIds ?? [])];
    const functionalEvidence: FunctionalRecommendationEvidence = {
      metaIsStale: false,
      signalEvidence: heroes.map((hero) => ({ hero, signals: [] })),
      heroPositions: [],
      teamOpening: null,
      partyPreferredPositions: [],
    };
    const set: SuggestionSet = {
      schema: "suggestions/v1",
      sessionId: "preview",
      basedOnSeq: 0,
      decisionContext: "team_opening",
      suggestions: heroes.map((hero, index) => ({
        hero,
        rank: (Math.min(index + 1, 6)) as 1 | 2 | 3 | 4 | 5 | 6,
        score: 100 - index,
        signals: [{ signal: "position_fit", raw: 0.9, normalized: 90, evidenceConfidence: 1, weighted: 100 - index, explanation: "Evidencia sólida de que funciona como carry (50.000 partidas de alto MMR)", sampleSize: 50_000 }],
        reason: "Posición y momento del pick: muy jugado como carry en alto MMR",
        confidence: "alta" as const,
        evidenceCoverage: 1,
        guessingIndex: 0,
      })),
      comparison: null,
      degraded: [],
      computedInMs: 0,
      functionalEvidence,
    };
    return set;
  };
}

type Routes = ReturnType<typeof createProtocolSessionRoutes>;

async function cmSession(routes: Routes): Promise<string> {
  const created = await routes.post(jsonRequest({
    rulesetId: "dota2/captains-mode",
    patch: "7.41e",
    localSide: "radiant",
    adapterKind: "simulator",
    partyContext: { partySize: 5, side: "radiant", controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: `p${slotIndex}` })) },
  }));
  const { sessionId } = (await created.json()) as { sessionId: string };
  await routes.postCommand(jsonRequest({ command: { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" } }), sessionId);
  return sessionId;
}

const revealedHeroes = (slots: readonly { visibility: string; heroId?: number }[]): number[] => slots.flatMap((slot) => (slot.visibility !== "HIDDEN" && slot.heroId !== undefined ? [slot.heroId] : []));

/** Juega los pasos hasta que le toca a `radiant` un PICK con al menos `enemyPicks` picks rivales ya revelados (el bot juega el otro lado). */
async function advanceToLocalPick(store: ProtocolSessionStore, routes: Routes, sessionId: string, enemyPicks: number): Promise<void> {
  for (let guard = 0; guard < 30; guard += 1) {
    const action = legalActions(store.get(sessionId)!).find((candidate) => candidate.type === "CM_ACTION");
    if (!action || action.type !== "CM_ACTION") throw new Error("missing legal CM action");
    const seen = revealedHeroes(store.view(sessionId)!.enemyPicks).length;
    if (action.absoluteSide === "radiant" && action.kind === "PICK" && seen >= enemyPicks) return;
    if (action.absoluteSide === "radiant") await routes.postCommand(jsonRequest({ command: { type: "CM_ACTION", actor: action.actor, kind: action.kind, heroId: action.eligibleHeroIds[0]! } }), sessionId);
    else await routes.postBotSelection(jsonRequest({}), sessionId);
  }
  throw new Error("no local pick reached");
}

const cmUrl = (sessionId: string, format: string) => new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=${format}`);
const outputOf = async (routes: Routes, sessionId: string): Promise<CaptainsModeOutput> => ((await (await routes.getRecommendations(sessionId, cmUrl(sessionId, "cm"))).json()) as { output: CaptainsModeOutput }).output;

describe("GET .../recommendations?format=cm -- contrato de elegibilidad", () => {
  test("en un BAN con un V6 que solo sabe de posición no sale ningún héroe y no viaja el desglose crudo de V6", async () => {
    const limits: (number | undefined)[] = [];
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: positionOnlyCompute(limits), trustedEligibility: () => eligibility(UNIVERSE), heroPositions: HERO_POSITIONS, heroCounters: new Map(), heroSynergies: new Map(), heroCapabilities: [] });
    const sessionId = await cmSession(routes);

    const output = await outputOf(routes, sessionId);
    expect(output.schema).toBe("recommendation-output/cm-v1");
    expect(output.actionKind).toBe("BAN");
    expect(output.bans).toEqual([]);
    expect(output.picks).toEqual([]);
    expect(output.primaryHeroId).toBeNull();
    const text = JSON.stringify(output);
    for (const forbidden of ["position_fit", "Posición y momento", "signalsByHero", "alta"]) expect(text).not.toContain(forbidden);
    // El Coach pide un universo ancho para filtrar DESPUÉS de rankear (no se queda con el top de siempre).
    expect(limits[0]).toBeGreaterThanOrEqual(UNIVERSE);
  });

  test("en un PICK: sin fundamento no sale nadie; con un counter curado con porqué contra un rival ya revelado sale ESE héroe, fuerte y recomendado", async () => {
    const store = new ProtocolSessionStore();
    const make = (heroCounters: ReadonlyMap<number, readonly CuratedCounter[]>): Routes => createProtocolSessionRoutes({
      store, computeSuggestions: positionOnlyCompute([]), trustedEligibility: () => eligibility(UNIVERSE), heroPositions: HERO_POSITIONS, heroCounters, heroSynergies: new Map(), heroCapabilities: [],
    });
    const bare = make(new Map());
    const sessionId = await cmSession(bare);
    await advanceToLocalPick(store, bare, sessionId, 1);

    const empty = await outputOf(bare, sessionId);
    expect(empty.actionKind).toBe("PICK");
    expect(empty.picks).toEqual([]);
    expect(empty.primaryHeroId).toBeNull();

    // Un pick rival ya revelado y un héroe libre que le gana con porqué (datos curados inyectados, nunca el archivo real).
    const view = store.view(sessionId)!;
    const enemy = revealedHeroes(view.enemyPicks)[0]!;
    const taken = new Set([...revealedHeroes(view.enemyPicks), ...revealedHeroes(view.ownPicks), ...view.bannedHeroes]);
    const counterer = Array.from({ length: UNIVERSE }, (_, index) => index + 1).find((hero) => !taken.has(hero))!;
    const withData = make(new Map([[enemy, [{ vs: counterer, level: "hard" as const, why: "Orchid lo silencia y no puede hacer nada" }]]]));
    const full = await outputOf(withData, sessionId);
    expect(full.picks.map((card) => card.heroId)).toEqual([counterer]);
    expect(full.picks[0]?.evidenceStrength).toBe("STRONG");
    expect(full.primaryHeroId).toBe(counterer);
  });

  test("format=cm sobre un draft que NO es Captains Mode responde 422 (no hay un camino paralelo)", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: positionOnlyCompute([]) });
    const created = await routes.post(jsonRequest({ rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "manual", partyContext: { partySize: 5, side: "radiant", controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: `p${slotIndex}` })) } }));
    const { sessionId } = (await created.json()) as { sessionId: string };
    expect((await routes.getRecommendations(sessionId, cmUrl(sessionId, "cm"))).status).toBe(422);
  });
});
