import { describe, expect, test } from "bun:test";
import { fetchRecommendationsWithCoach, parseCoachOutput } from "./coach-client";

// AP Ranked Roles V1 / Wave 2 -- the browser trusts the engine's Coach output only after validating it.

function coachBody(overrides: Record<string, unknown> = {}) {
  return {
    schema: "recommendation-output/v3",
    sessionId: "s1",
    primaryAction: { strategy: { kind: "REVEAL_POSITION", position: 5, rationale: "prior" }, label: "Sugerencia: revela Hard support (Pos 5)" },
    shortlist: [{ heroId: 7, position: 5, roleStatus: "LIKELY", confidence: "media", badges: ["COUNTER"], rationale: "r", score: 12, isFromPool: false }],
    meta: {
      round: 1,
      phase: "PICK_ROUND_1",
      ownPicksRemaining: 5,
      confidence: "media",
      decisionContext: "team_opening",
      trigger: "DRAFT_PICKS_STARTED",
      revision: 1,
      basedOn: { stateIdentity: "abc", evidenceVersion: "v" },
    },
    ...overrides,
  };
}

const V2 = {
  schema: "recommendation-set/v2",
  sessionId: "s1",
  decision: { actor: "radiant", actionKind: "PICK", controlledSlots: [], actionCount: 1 },
  recommendations: [],
  degradations: [],
  deferred: { opponentResponse: "NOT_COMPUTED", steal: "NOT_COMPUTED", lookahead: "NOT_COMPUTED" },
  decisionContext: "team_opening",
};

function fetchReturning(body: unknown, status = 200) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("parseCoachOutput", () => {
  test("acepta una salida válida, incluida una acción a nivel de posición SIN heroId", () => {
    const parsed = parseCoachOutput(coachBody());
    expect(parsed?.primaryAction.strategy.kind).toBe("REVEAL_POSITION");
    expect(parsed?.primaryAction.strategy).not.toHaveProperty("heroId");
  });

  test("rechaza formas inválidas: tipo de estrategia desconocido, posición fuera de 1..5, insignia desconocida, sin meta", () => {
    expect(parseCoachOutput(coachBody({ primaryAction: { strategy: { kind: "REVEAL_SUPPORT_EARLY", rationale: "x" }, label: "x" } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ primaryAction: { strategy: { kind: "REVEAL_POSITION", position: 6, rationale: "x" }, label: "x" } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ shortlist: [{ heroId: 7, position: 5, roleStatus: "LIKELY", confidence: "media", badges: ["SAFE"], rationale: "r", score: 1, isFromPool: false }] }))).toBeNull();
    expect(parseCoachOutput(coachBody({ meta: undefined }))).toBeNull();
    expect(parseCoachOutput({ schema: "other" })).toBeNull();
  });

  test("personalHeroView: acepta seatCovered booleano (o ausente) y rechaza cualquier otro tipo", () => {
    const view = (extra: Record<string, unknown>) => coachBody({ personalHeroView: { position: 2, positionLabel: "TU MID AHORA", heroes: [], ...extra } });
    expect(parseCoachOutput(view({ seatCovered: true }))?.personalHeroView?.seatCovered).toBe(true);
    expect(parseCoachOutput(view({}))).not.toBeNull();
    expect(parseCoachOutput(view({ seatCovered: "yes" }))).toBeNull();
  });

  test("REVEAL_HERO exige heroId; REVEAL_FLEX exige al menos una posición", () => {
    expect(parseCoachOutput(coachBody({ primaryAction: { strategy: { kind: "REVEAL_HERO", position: 2, rationale: "x" }, label: "x" } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ primaryAction: { strategy: { kind: "REVEAL_HERO", heroId: 3, position: 2, rationale: "x" }, label: "x" } }))).not.toBeNull();
    expect(parseCoachOutput(coachBody({ primaryAction: { strategy: { kind: "REVEAL_FLEX", possiblePositions: [], rationale: "x" }, label: "x" } }))).toBeNull();
  });
});

describe("parseCoachOutput -- opportunity (Safe Core, Wave 4A)", () => {
  const OPPORTUNITY = {
    subtype: "SAFE_CORE",
    label: "Ventana de core: 2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)",
    heroId: 1,
    evidence: "2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)",
    counterEvidence: {
      kind: "COUNTER_RELIEF",
      sourceType: "CURATED",
      relieved: [{ heroId: 7, level: "hard", status: "BANNED" }, { heroId: 8, level: "hard", status: "BANNED" }],
      totalHardCounters: 2,
    },
  };

  test("una salida sin opportunity sigue siendo válida (el bloque es ausente por defecto)", () => {
    const parsed = parseCoachOutput(coachBody());
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("opportunity");
  });

  test("acepta un opportunity SAFE_CORE bien formado y conserva su procedencia", () => {
    const parsed = parseCoachOutput(coachBody({ opportunity: OPPORTUNITY }));
    expect(parsed?.opportunity?.heroId).toBe(1);
    expect(parsed?.opportunity?.counterEvidence.sourceType).toBe("CURATED");
  });

  test("rechaza STATISTICAL: no existe evidencia estadística aprobada en V1 (falla cerrado, como cualquier opportunity malformado)", () => {
    const statistical = { ...OPPORTUNITY, counterEvidence: { ...OPPORTUNITY.counterEvidence, sourceType: "STATISTICAL" } };
    expect(parseCoachOutput(coachBody({ opportunity: statistical }))).toBeNull();
  });

  test("rechaza una procedencia desconocida, ausente o de otro tipo", () => {
    const withSource = (sourceType: unknown) => ({ ...OPPORTUNITY, counterEvidence: { ...OPPORTUNITY.counterEvidence, sourceType } });
    for (const sourceType of ["VERIFIED_7_41F", "curated", "", null, 7, undefined]) {
      expect(parseCoachOutput(coachBody({ opportunity: withSource(sourceType) }))).toBeNull();
    }
    const withoutSource = { kind: "COUNTER_RELIEF", relieved: OPPORTUNITY.counterEvidence.relieved, totalHardCounters: 2 };
    expect(parseCoachOutput(coachBody({ opportunity: { ...OPPORTUNITY, counterEvidence: withoutSource } }))).toBeNull();
  });

  test("rechaza un opportunity malformado: sin heroId, subtipo desconocido, sin evidencia de alivio, null", () => {
    expect(parseCoachOutput(coachBody({ opportunity: { ...OPPORTUNITY, heroId: undefined } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ opportunity: { ...OPPORTUNITY, subtype: "STEAL" } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ opportunity: { ...OPPORTUNITY, counterEvidence: undefined } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ opportunity: null }))).toBeNull();
  });
});

describe("fetchRecommendationsWithCoach", () => {
  test("pide ?format=v3 con sólo el sessionId y devuelve V2 + Coach", async () => {
    const { impl, calls } = fetchReturning({ output: coachBody(), recommendationSet: V2 });
    const result = await fetchRecommendationsWithCoach("s1", impl);
    expect(calls[0]).toContain("/api/session/protocol/s1/recommendations?format=v3");
    expect(result.recommendationSet.schema).toBe("recommendation-set/v2");
    expect(result.coach?.meta.revision).toBe(1);
  });

  test("output null (sin asiento abierto) -> coach null, nunca una acción inventada", async () => {
    const { impl } = fetchReturning({ output: null, recommendationSet: V2 });
    expect((await fetchRecommendationsWithCoach("s1", impl)).coach).toBeNull();
  });

  test("un cuerpo V2 plano (motor viejo) sigue aceptándose: sin sección de Coach", async () => {
    const { impl } = fetchReturning(V2);
    const result = await fetchRecommendationsWithCoach("s1", impl);
    expect(result.coach).toBeNull();
    expect(result.recommendationSet.schema).toBe("recommendation-set/v2");
  });

  test("un Coach malformado o un HTTP de error se rechazan (nunca se renderiza un consejo no validado)", async () => {
    await expect(fetchRecommendationsWithCoach("s1", fetchReturning({ output: { schema: "recommendation-output/v3" }, recommendationSet: V2 }).impl)).rejects.toThrow("invalid coach response");
    await expect(fetchRecommendationsWithCoach("s1", fetchReturning({ error: "x" }, 500).impl)).rejects.toThrow("failed (500)");
  });
});

describe("parseCoachOutput -- optional readiness and degradations structural validation (PB-R2)", () => {
  const VALID_READINESS = {
    rulesetTarget: "7.41f",
    empiricalPatchClaim: { patch: "7.41e", verified: false, basis: "unverified" },
    syncFreshness: { syncedAt: "2026-09-21T00:00:00Z", syncAgeMs: 5000, isFresh: true, isStale: false },
    patchCompatibility: "compatible" as const,
    patchMeta: { ready: true, nonVotingReason: null },
    metaIsStale: false,
  };

  const VALID_DEGRADATIONS = [
    { reason: "patch_meta_data_not_ready", detail: "V6 degraded flag: patch_meta_data_not_ready" },
    { reason: "custom_future_flag", detail: "some details" },
  ];

  test("accepts well-formed readiness in meta", () => {
    const parsed = parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: VALID_READINESS } }));
    expect(parsed).not.toBeNull();
    expect(parsed?.meta.readiness?.rulesetTarget).toBe("7.41f");
    expect(parsed?.meta.readiness?.syncFreshness.isFresh).toBe(true);
  });

  test("accepts well-formed degradations in meta, including forward-compatible unknown reasons", () => {
    const parsed = parseCoachOutput(coachBody({ meta: { ...coachBody().meta, degradations: VALID_DEGRADATIONS } }));
    expect(parsed).not.toBeNull();
    expect(parsed?.meta.degradations).toHaveLength(2);
    expect(parsed?.meta.degradations?.[1].reason).toBe("custom_future_flag");
  });

  test("rejects malformed readiness safely (fail-closed, not blindly trusted)", () => {
    // Non-record readiness
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: "not-a-record" } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: null } }))).toBeNull();

    // Invalid rulesetTarget
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: { ...VALID_READINESS, rulesetTarget: 123 } } }))).toBeNull();

    // Invalid empiricalPatchClaim
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: { ...VALID_READINESS, empiricalPatchClaim: { patch: 123, verified: false, basis: "x" } } } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: { ...VALID_READINESS, empiricalPatchClaim: { patch: "7.41e", verified: "yes", basis: "x" } } } }))).toBeNull();

    // Invalid syncFreshness
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: { ...VALID_READINESS, syncFreshness: { syncedAt: 123, syncAgeMs: 50, isFresh: true, isStale: false } } } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: { ...VALID_READINESS, syncFreshness: { syncedAt: null, syncAgeMs: "old", isFresh: false, isStale: true } } } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: { ...VALID_READINESS, syncFreshness: { syncedAt: null, syncAgeMs: null, isFresh: "true", isStale: false } } } }))).toBeNull();

    // Invalid patchCompatibility
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: { ...VALID_READINESS, patchCompatibility: "invalid_status" } } }))).toBeNull();

    // Invalid patchMeta
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: { ...VALID_READINESS, patchMeta: { ready: "yes", nonVotingReason: null } } } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: { ...VALID_READINESS, patchMeta: { ready: false, nonVotingReason: 123 } } } }))).toBeNull();

    // Invalid metaIsStale
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, readiness: { ...VALID_READINESS, metaIsStale: "false" } } }))).toBeNull();
  });

  test("rejects malformed degradations safely", () => {
    // Non-array
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, degradations: "not-array" } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, degradations: 123 } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, degradations: {} } }))).toBeNull();

    // Array with non-records or missing fields
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, degradations: [null] } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, degradations: [{ reason: 123, detail: "x" }] } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, degradations: [{ reason: "x" }] } }))).toBeNull();
    expect(parseCoachOutput(coachBody({ meta: { ...coachBody().meta, degradations: [{ reason: "x", detail: 123 }] } }))).toBeNull();
  });
});
