import { describe, expect, test } from "bun:test";
import { GOLDEN_SCHEMA_VERSION, loadGoldenDataset, toGradedMap, toMetricLabels } from "./golden";

const STATE = {
  schema: "draft-state/v1",
  format: "captains_mode",
  patch: "60",
  localSide: "radiant",
  phase: "active",
  banned: [1, 2],
  picks: { radiant: [10], dire: [20] },
  lastSeq: 8,
};

function validCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "c1",
    source: { kind: "replay", matchId: "M1", turnIndex: 8 },
    state: STATE,
    side: "radiant",
    decisionContext: "response_pick",
    strata: ["hard_counter"],
    labels: {
      excellent: [{ hero: 31, why: "domina el matchup revelado" }],
      acceptable: [{ hero: 32, why: "opción segura" }],
      bad: [{ hero: 33, why: "countereado por el pick rival" }],
    },
    reasoningTags: ["counter", "tempo"],
    labeledAt: "2026-08-29T00:00:00Z",
    labeledBy: "julio",
    ...overrides,
  };
}

function file(cases: unknown[]): unknown {
  return { schemaVersion: GOLDEN_SCHEMA_VERSION, cases };
}

describe("loadGoldenDataset — S17", () => {
  test("caso válido pasa; los helpers derivan bien las etiquetas", () => {
    const { cases, rejected } = loadGoldenDataset(file([validCase()]));
    expect(rejected).toHaveLength(0);
    expect(cases).toHaveLength(1);

    expect(toMetricLabels(cases[0]!)).toEqual({ excellent: [31], acceptable: [32], bad: [33] });
    expect(toGradedMap(cases[0]!).get(31)).toBe(2);
    expect(toGradedMap(cases[0]!).get(33)).toBe(0);
  });

  test("descarta el CASO (no el archivo) por cada tipo de malformación, con motivo", () => {
    const { cases, rejected } = loadGoldenDataset(
      file([
        validCase({ id: "ok" }),
        validCase({ id: "unknown-hero", labels: { excellent: [{ hero: 999, why: "x" }], acceptable: [], bad: [] } }),
        validCase({
          id: "dup-list",
          labels: {
            excellent: [{ hero: 40, why: "a" }],
            acceptable: [{ hero: 40, why: "b" }],
            bad: [],
          },
        }),
        validCase({ id: "empty-excellent", labels: { excellent: [], acceptable: [{ hero: 41, why: "x" }], bad: [] } }),
        validCase({ id: "bad-state", state: { ...STATE, schema: "nope" } }),
        validCase({ id: "empty-strata", strata: [] }),
      ]),
      { knownHeroIds: new Set([31, 32, 33, 40, 41, 10, 20, 1, 2]) },
    );

    expect(cases.map((c) => c.id)).toEqual(["ok"]);
    const byId = Object.fromEntries(rejected.map((r) => [r.id, r.reason]));
    expect(byId["unknown-hero"]).toContain("malformada");
    expect(byId["dup-list"]).toContain("está en labels.excellent y labels.acceptable");
    expect(byId["empty-excellent"]).toContain("excellent vacío");
    expect(byId["bad-state"]).toContain("schema inesperado");
    expect(byId["empty-strata"]).toContain("strata");
  });

  test("id duplicado -> el segundo se descarta", () => {
    const { cases, rejected } = loadGoldenDataset(file([validCase({ id: "dup" }), validCase({ id: "dup" })]));
    expect(cases).toHaveLength(1);
    expect(rejected[0]).toEqual({ id: "dup", reason: "id duplicado" });
  });

  test("JSON roto en la raíz -> {cases:[], rejected:[...]}, sin excepción", () => {
    const res = loadGoldenDataset("{ esto no es json");
    expect(res.cases).toHaveLength(0);
    expect(res.rejected[0]!.reason).toContain("JSON inválido");
  });

  test("schemaVersion desconocida -> rechazada sin excepción", () => {
    const res = loadGoldenDataset({ schemaVersion: 99, cases: [] });
    expect(res.cases).toHaveLength(0);
    expect(res.rejected[0]!.reason).toContain("schemaVersion desconocida");
  });

  test("raíz que no es objeto / cases que no es lista -> rechazo, sin excepción", () => {
    expect(loadGoldenDataset(42).rejected[0]!.reason).toContain("no es un objeto");
    expect(loadGoldenDataset({ schemaVersion: 1, cases: "x" }).rejected[0]!.reason).toContain("no es una lista");
  });

  test("string JSON válido también se acepta", () => {
    const { cases } = loadGoldenDataset(JSON.stringify(file([validCase()])));
    expect(cases).toHaveLength(1);
  });

  test("sin knownHeroIds sólo se exige entero > 0 (no hay catálogo)", () => {
    const { cases } = loadGoldenDataset(
      file([validCase({ labels: { excellent: [{ hero: 12345, why: "héroe futuro" }], acceptable: [], bad: [] } })]),
    );
    expect(cases).toHaveLength(1);
  });
});
