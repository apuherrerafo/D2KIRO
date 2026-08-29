import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProDrafterRoutes,
  handleLowConfidenceReport,
  isValidLowConfidenceReportRequest,
} from "./pro-drafter";
import type { HeroId } from "../../draft/reducer";

// Fase 2 (Performance & Resiliencia, sesión Gobernanza 2.0): cache-aside + fallback a v5. Nunca el
// corpus/hero-positions.json real acá (S9/S10, testing-seams.md) -- `runPipeline` inyectado
// también reemplaza `runProDrafterPipeline` real, así que ni siquiera importa qué haya en esos
// fixtures vacíos, solo evita tocar disco. **A propósito, sin importar tipos de `pipeline/` ni
// `signals/mix`**: el test de aislamiento (`run-pipeline.test.ts`) exige que SOLO
// `routes/pro-drafter.ts` importe de `pipeline/` -- los fixtures de abajo confían en el chequeo
// estructural de TypeScript (contextual typing contra `ProDrafterRouteDeps`), nunca en un import
// de tipo con nombre.

const EMPTY_BODY = {
  format: "all_pick" as const,
  patch: "7.41",
  localSide: "radiant" as const,
  banned: [] as HeroId[],
  picks: { radiant: [1, 2, 3] as HeroId[], dire: [4, 5, 6] as HeroId[] },
};

function fakeResult(heroId: HeroId) {
  return { heroId, score: 0.5, signals: [{ signal: "knn_similarity" as const, raw: 0.5 }] };
}

function fakeV5Suggestion(hero: HeroId, rank: 1 | 2 | 3 | 4 | 5) {
  // TSK-210 (Fase 9.1): Suggestion gana evidenceCoverage/guessingIndex -- este mock los fija en
  // los valores de "sin cobertura" (no se ejercitan en estas pruebas de cache-aside).
  return { hero, rank, score: 0.3, signals: [], reason: "v5-fallback-fixture", confidence: "media" as const, evidenceCoverage: 0, guessingIndex: 1 };
}

function fakeV5Set() {
  return {
    schema: "suggestions/v1" as const,
    sessionId: "pro-drafter-experimental",
    basedOnSeq: 0,
    decisionContext: "response_pick" as const,
    suggestions: [
      fakeV5Suggestion(101 as HeroId, 1),
      fakeV5Suggestion(102 as HeroId, 2),
      fakeV5Suggestion(103 as HeroId, 3),
      fakeV5Suggestion(104 as HeroId, 4),
      fakeV5Suggestion(105 as HeroId, 5),
    ],
    comparison: null,
    degraded: [],
    computedInMs: 1,
  };
}

function makeRequest(body: unknown = EMPTY_BODY): Request {
  return new Request("http://127.0.0.1/api/v1/draft/pro-recommendations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("createProDrafterRoutes -- cache-aside", () => {
  test("el fingerprint separa apertura de equipo del camino normal", async () => {
    let calls = 0;
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      runPipeline: () => {
        calls++;
        return [fakeResult(101 as HeroId)];
      },
      computeV5Fallback: async () => fakeV5Set(),
    });

    const normal = await routes.postRecommendations(makeRequest(EMPTY_BODY));
    const opening = await routes.postRecommendations(makeRequest({ ...EMPTY_BODY, teamOpening: true }));
    const normalBody = (await normal.json()) as { cache_hit: boolean };
    const openingBody = (await opening.json()) as { cache_hit: boolean };

    expect(calls).toBe(2);
    expect(normalBody.cache_hit).toBe(false);
    expect(openingBody.cache_hit).toBe(false);
  });
  test("primera solicitud es cache miss y calcula la matriz 5v5", async () => {
    let calls = 0;
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      runPipeline: () => {
        calls++;
        return [fakeResult(101 as HeroId)];
      },
    });

    const response = await routes.postRecommendations(makeRequest());
    const body = (await response.json()) as { cache_hit: boolean; fallback_applied: boolean; engine_version: string };

    expect(calls).toBe(1);
    expect(body.cache_hit).toBe(false);
    expect(body.fallback_applied).toBe(false);
    expect(body.engine_version).toBe("pro-drafter");
  });

  test("expone evidencia estructurada y no inventa counter sin matchup observado", async () => {
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      runPipeline: () => [fakeResult(101 as HeroId)],
      getMetaMatchups: async () => ({}),
    });

    const response = await routes.postRecommendations(makeRequest());
    const body = (await response.json()) as { suggestions: { evidence?: { observedEnemyCount: number; counterMatchups: number; synergy: string } }[] };
    expect(body.suggestions[0]?.evidence).toMatchObject({ observedEnemyCount: 3, counterMatchups: 0, synergy: "unavailable", synergyPairs: 0 });
  });

  test("expone sinergia solo con aliados confirmados y muestra suficiente", async () => {
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      runPipeline: () => [fakeResult(101 as HeroId)],
      getSynergies: async () => ({ 101: [{ withHero: 1, games: 100, wins: 60, expectedWinrate: 0.5 }] }),
    });

    const response = await routes.postRecommendations(makeRequest({ ...EMPTY_BODY, picks: { radiant: [1, 2, 3], dire: [4, 5, 6] } }));
    const body = (await response.json()) as { suggestions: { evidence?: { synergy: string; synergyPairs: number } }[] };
    expect(body.suggestions[0]?.evidence).toMatchObject({ synergy: "available", synergyPairs: 1 });
  });

  test("una solicitud idéntica repetida responde desde caché sin recalcular la matriz", async () => {
    let calls = 0;
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      runPipeline: () => {
        calls++;
        return [fakeResult(101 as HeroId)];
      },
    });

    await routes.postRecommendations(makeRequest());
    const second = await routes.postRecommendations(makeRequest());
    const body = (await second.json()) as { cache_hit: boolean };

    expect(calls).toBe(1); // la segunda vez NUNCA llamó al pipeline de nuevo
    expect(body.cache_hit).toBe(true);
  });

  test("un roster distinto (aunque comparta héroes en otro orden) no reusa el cache de otro fingerprint", async () => {
    let calls = 0;
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      runPipeline: () => {
        calls++;
        return [fakeResult(101 as HeroId)];
      },
    });

    await routes.postRecommendations(makeRequest(EMPTY_BODY));
    await routes.postRecommendations(makeRequest({ ...EMPTY_BODY, picks: { radiant: [7, 8, 9], dire: [4, 5, 6] } }));

    expect(calls).toBe(2);
  });

  test("el mismo conjunto de héroes en otro orden de pick SÍ reusa el cache (fingerprint ordena los ids)", async () => {
    let calls = 0;
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      runPipeline: () => {
        calls++;
        return [fakeResult(101 as HeroId)];
      },
    });

    await routes.postRecommendations(makeRequest({ ...EMPTY_BODY, picks: { radiant: [1, 2, 3], dire: [4, 5, 6] } }));
    await routes.postRecommendations(makeRequest({ ...EMPTY_BODY, picks: { radiant: [3, 1, 2], dire: [4, 5, 6] } }));

    expect(calls).toBe(1);
  });
});

describe("createProDrafterRoutes -- fallback transparente a v5", () => {
  test("el fallback conserva las cinco sugerencias cuando la solicitud es una apertura", async () => {
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      runPipeline: () => {
        throw new Error("fallo simulado");
      },
      computeV5Fallback: async () => fakeV5Set(),
    });

    const response = await routes.postRecommendations(makeRequest({ ...EMPTY_BODY, teamOpening: true }));
    const body = (await response.json()) as { suggestions: { rank: number }[] };

    expect(body.suggestions).toHaveLength(5);
    expect(body.suggestions.map((suggestion) => suggestion.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  test("propaga teamOpening, matchups y heroCapabilities al pipeline", async () => {
    let received: unknown;
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      heroCapabilities: [],
      getMetaMatchups: async () => ({ 101: [{ vsHero: 202, games: 400, wins: 300 }] }),
      runPipeline: (...args) => {
        received = args[6];
        return [fakeResult(101 as HeroId)];
      },
    });

    await routes.postRecommendations(makeRequest({ ...EMPTY_BODY, teamOpening: true }));

    expect(received).toEqual({
      teamOpening: true,
      targetPosition: undefined,
      topN: 5,
      matchups: { 101: [{ vsHero: 202, games: 400, wins: 300 }] },
      heroCapabilities: [],
    });
  });
  test("si Pro-Drafter lanza una excepción, cae a v5 con fallback_applied:true y sin 500", async () => {
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      runPipeline: () => {
        throw new Error("fallo simulado del pipeline");
      },
      computeV5Fallback: async () => fakeV5Set(),
    });

    const response = await routes.postRecommendations(makeRequest());
    const body = (await response.json()) as { fallback_applied: boolean; engine_version: string; suggestions: { hero: HeroId }[] };

    expect(response.status).toBe(200);
    expect(body.fallback_applied).toBe(true);
    expect(body.engine_version).toBe("v5");
    expect(body.suggestions[0]?.hero).toBe(101 as HeroId);
  });

  test("si Pro-Drafter se pasa del presupuesto de 200ms, cae a v5 igual (nunca sirve una respuesta tardía)", async () => {
    let tick = 0;
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      now: () => {
        tick += 1;
        return tick === 1 ? 0 : 250; // start=0, después de la llamada ya "pasaron" 250ms
      },
      runPipeline: () => [fakeResult(101 as HeroId)], // el pipeline en sí no falla, solo tardó
      computeV5Fallback: async () => fakeV5Set(),
    });

    const response = await routes.postRecommendations(makeRequest());
    const body = (await response.json()) as { fallback_applied: boolean };

    expect(body.fallback_applied).toBe(true);
  });

  test("sin computeV5Fallback inyectado, el fallback responde con suggestions vacías -- nunca lanza", async () => {
    const routes = createProDrafterRoutes({
      corpus: [],
      heroPositions: {},
      runPipeline: () => {
        throw new Error("fallo simulado");
      },
    });

    const response = await routes.postRecommendations(makeRequest());
    const body = (await response.json()) as { fallback_applied: boolean; suggestions: unknown[] };

    expect(response.status).toBe(200);
    expect(body.fallback_applied).toBe(true);
    expect(body.suggestions).toEqual([]);
  });
});

describe("isValidLowConfidenceReportRequest -- validación en el borde", () => {
  test("rechaza un sessionId con caracteres fuera de [a-zA-Z0-9-] (nunca llega a formar una ruta de archivo)", () => {
    const withPathTraversal = {
      sessionId: "../../etc/passwd",
      patch: "7.41",
      entries: [{ hero: 1, heroName: "Anti-Mage", rank: 1 }],
    };
    expect(isValidLowConfidenceReportRequest(withPathTraversal)).toBe(false);
  });

  test("rechaza entries vacío -- un reporte sin héroes no tiene sentido, nunca se escribe", () => {
    expect(isValidLowConfidenceReportRequest({ sessionId: "abc-123", patch: "7.41", entries: [] })).toBe(false);
  });

  test("rechaza un rank fuera de 1|2|3", () => {
    const invalidRank = { sessionId: "abc-123", patch: "7.41", entries: [{ hero: 1, heroName: "Axe", rank: 4 }] };
    expect(isValidLowConfidenceReportRequest(invalidRank)).toBe(false);
  });

  test("acepta un request bien formado", () => {
    const valid = { sessionId: "abc-123", patch: "7.41", entries: [{ hero: 1, heroName: "Axe", rank: 1 }] };
    expect(isValidLowConfidenceReportRequest(valid)).toBe(true);
  });
});

describe("handleLowConfidenceReport -- escribe el reporte real a disco", () => {
  test("un request válido se escribe como JSON en el directorio inyectado, con generatedAt agregado", async () => {
    const dir = await mkdtemp(join(tmpdir(), "low-confidence-report-"));
    try {
      const request = new Request("http://127.0.0.1/api/pro-drafter/low-confidence-report", {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-abc", patch: "7.41", entries: [{ hero: 101, heroName: "Ancient Apparition", rank: 1 }] }),
      });

      const response = await handleLowConfidenceReport(request, dir);
      expect(response.status).toBe(201);

      const files = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: dir }));
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("session-abc");

      const written = JSON.parse(await readFile(join(dir, files[0]!), "utf8"));
      expect(written.sessionId).toBe("session-abc");
      expect(written.entries).toEqual([{ hero: 101, heroName: "Ancient Apparition", rank: 1 }]);
      expect(typeof written.generatedAt).toBe("string");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("un request inválido responde 400 y nunca toca el filesystem", async () => {
    const dir = await mkdtemp(join(tmpdir(), "low-confidence-report-"));
    try {
      const request = new Request("http://127.0.0.1/api/pro-drafter/low-confidence-report", {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-abc", patch: "7.41", entries: [] }),
      });

      const response = await handleLowConfidenceReport(request, dir);
      expect(response.status).toBe(400);

      const files = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: dir })).catch(() => []);
      expect(files).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
