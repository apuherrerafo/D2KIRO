import { describe, expect, test } from "bun:test";
import { fetchCaptainsModeOutput, parseCaptainsModeOutput } from "./cm-client";

// Contrato de elegibilidad en Captains Mode: el cliente solo acepta la salida ya filtrada del motor (`format=cm`). Fixtures inline, cero red real.

const OUTPUT = {
  schema: "recommendation-output/cm-v1",
  sessionId: "s1",
  actionKind: "PICK",
  step: 8,
  picks: [{ heroId: 7, position: 1, roleStatus: "LIKELY", confidence: "media", badges: ["COUNTER"], rationale: "", hideRationale: true, evidenceStrength: "STRONG", score: 10, isFromPool: false }],
  bans: [],
  primaryHeroId: 7,
};

function fetchReturning(body: unknown, status = 200): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

describe("cm-client", () => {
  test("pide SOLO el formato del contrato (format=cm) y devuelve la salida validada", async () => {
    const { impl, calls } = fetchReturning({ output: OUTPUT });
    const result = await fetchCaptainsModeOutput("s1", impl);
    expect(calls[0]).toContain("/api/session/protocol/s1/recommendations?format=cm");
    expect(result.picks.map((pick) => pick.heroId)).toEqual([7]);
    expect(result.primaryHeroId).toBe(7);
  });

  test("el V2 crudo (la respuesta de siempre de /recommendations) NO es una salida válida de Captains Mode", async () => {
    await expect(fetchCaptainsModeOutput("s1", fetchReturning({ schema: "recommendation-set/v2", sessionId: "s1", recommendations: [] }).impl)).rejects.toThrow("invalid captains mode");
    expect(parseCaptainsModeOutput({ ...OUTPUT, schema: "recommendation-set/v2" })).toBeNull();
  });

  test("forma inválida o error del motor: falla en voz alta, nunca una lista a medias", async () => {
    expect(parseCaptainsModeOutput({ ...OUTPUT, picks: [{ heroId: "x" }] })).toBeNull();
    expect(parseCaptainsModeOutput({ ...OUTPUT, bans: [{ heroId: 3, evidenceStrength: "MAYBE", score: 1, beatsYourPicks: [], pairsWithTheirPicks: [] }] })).toBeNull();
    expect(parseCaptainsModeOutput({ ...OUTPUT, primaryHeroId: "7" })).toBeNull();
    await expect(fetchCaptainsModeOutput("s1", fetchReturning({ error: "x" }, 422).impl)).rejects.toThrow("failed (422)");
  });
});
