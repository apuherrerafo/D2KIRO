import { describe, expect, test } from "bun:test";
import { canonicalManualId, canonicalMatchId, canonicalSourceMatchId, matchKey } from "./match-id";

describe("canonicalMatchId", () => {
  test("acepta sólo el decimal canónico de un entero positivo seguro", () => {
    for (const id of ["1", "10", "7000000001", "9007199254740991"]) expect(canonicalMatchId(id)).toBe(id);
  });

  test("rechaza todo lo ambiguo, sin normalizarlo (007 no se vuelve 7)", () => {
    const bad: unknown[] = [
      "", "0", "00", "007", "-1", "+1", "1.0", "1e3", "0x1", " 1", "1 ", "1_000", "9007199254740992",
      "12345678901234567", 7, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER, null, undefined, {}, [],
    ];
    for (const id of bad) expect(canonicalMatchId(id)).toBeNull();
  });
});

describe("canonicalManualId / canonicalSourceMatchId", () => {
  test("un id manual empieza con letra: nunca es un match_id canónico", () => {
    for (const id of ["case_1", "A", "pro-final.2026_a"]) {
      expect(canonicalManualId(id)).toBe(id);
      expect(canonicalMatchId(id)).toBeNull();
    }
  });

  test("rechaza lo numérico, vacío, con separadores, demasiado largo o no-string", () => {
    const bad: unknown[] = ["7000000001", "1abc", "", "_x", "a b", "a;b", "a".repeat(65), 7, null, undefined, {}];
    for (const id of bad) expect(canonicalManualId(id)).toBeNull();
  });

  test("cada fuente acepta sólo el id de SU espacio", () => {
    expect(canonicalSourceMatchId("opendota_match", "7000000001")).toBe("7000000001");
    expect(canonicalSourceMatchId("opendota_league", "7000000001")).toBe("7000000001");
    expect(canonicalSourceMatchId("manual_curated", "case_1")).toBe("case_1");
    expect(canonicalSourceMatchId("opendota_match", "case_1")).toBeNull();
    expect(canonicalSourceMatchId("manual_curated", "7000000001")).toBeNull();
  });
});

describe("matchKey", () => {
  test("Valve (opendota match y league) comparte espacio; manual_curated es aparte", () => {
    const id = "7000000001";
    expect(matchKey({ source: "opendota_match", sourceMatchId: id })).toBe("valve:7000000001");
    expect(matchKey({ source: "opendota_league", sourceMatchId: id })).toBe("valve:7000000001");
    expect(matchKey({ source: "manual_curated", sourceMatchId: "case_1" })).toBe("manual:case_1");
  });

  test("los espacios no se pisan ni con el mismo texto de id", () => {
    expect(matchKey({ source: "manual_curated", sourceMatchId: "x" })).not.toBe(
      matchKey({ source: "opendota_match", sourceMatchId: "x" }),
    );
  });

  test("es estable: misma entrada, misma llave", () => {
    const p = { source: "opendota_match", sourceMatchId: "42" } as const;
    expect(matchKey(p)).toBe(matchKey({ ...p }));
  });
});
