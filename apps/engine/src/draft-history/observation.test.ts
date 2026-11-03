import { describe, expect, test } from "bun:test";
import { OUT_OF_UNIVERSE_HERO, TEST_HERO_UNIVERSE } from "./fixtures";
import type { DraftHistoryObservation, Rejection, RejectionCode } from "./types";
import { validateDraftObservation } from "./validator";

const UNIVERSE = { heroUniverse: TEST_HERO_UNIVERSE };

function observation(overrides: Partial<DraftHistoryObservation> = {}): DraftHistoryObservation {
  return {
    schemaVersion: 1,
    perspective: "radiant",
    format: "ranked_all_pick",
    patch: { state: "exact", label: "7.41e" },
    allyHeroIds: [11, 12],
    revealedEnemyHeroIds: [21],
    bans: { status: "confirmed_visible", heroIds: [31, 32] },
    ...overrides,
  };
}

function rejectionsOf(raw: unknown): Rejection[] {
  const result = validateDraftObservation(raw, UNIVERSE);
  if (result.ok) throw new Error("se esperaba un rechazo");
  return result.rejections;
}

function expectRejected(raw: unknown, code: RejectionCode, path: string): void {
  expect(rejectionsOf(raw)).toContainEqual({ code, path });
}

describe("contrato de observación (lado consulta)", () => {
  test("observación parcial válida: aliados y enemigos revelados quedan en campos separados", () => {
    const result = validateDraftObservation(observation(), UNIVERSE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allyHeroIds).toEqual([11, 12]);
    expect(result.value.revealedEnemyHeroIds).toEqual([21]);
  });

  test("draft vacío (inicio, sin bans leídos) es válido: nada que fabricar", () => {
    const result = validateDraftObservation(
      observation({ allyHeroIds: [], revealedEnemyHeroIds: [], bans: { status: "unknown" }, patch: { state: "unknown" } }),
      UNIVERSE,
    );
    expect(result.ok).toBe(true);
  });

  test("format 'unknown' es un estado legítimo de la observación", () => {
    expect(validateDraftObservation(observation({ format: "unknown" }), UNIVERSE).ok).toBe(true);
  });

  test("el mismo héroe como aliado y como enemigo -> ENEMY_ALLY_OVERLAP (no se mezclan los bandos)", () => {
    expectRejected(
      observation({ allyHeroIds: [11, 12], revealedEnemyHeroIds: [12] }),
      "ENEMY_ALLY_OVERLAP",
      "$.revealedEnemyHeroIds[0]",
    );
  });

  test("un ban confirmado que choca con un pick visible -> BAN_PICK_OVERLAP", () => {
    expectRejected(
      observation({ bans: { status: "confirmed_visible", heroIds: [31, 21] } }),
      "BAN_PICK_OVERLAP",
      "$.bans.heroIds[1]",
    );
  });

  test("bans es obligatorio y explícito: ausente no equivale a 'unknown' ni a 'sin bans'", () => {
    const { bans: _omitted, ...withoutBans } = observation();
    expectRejected(withoutBans, "MISSING_FIELD", "$.bans");
  });

  test("más de 5 aliados o 5 enemigos revelados -> TOO_MANY_ENTRIES", () => {
    expectRejected(observation({ allyHeroIds: [1, 2, 3, 4, 5, 6] }), "TOO_MANY_ENTRIES", "$.allyHeroIds");
    expectRejected(observation({ revealedEnemyHeroIds: [1, 2, 3, 4, 5, 6] }), "TOO_MANY_ENTRIES", "$.revealedEnemyHeroIds");
  });

  test("HeroID exacto: nombres, strings y no enteros se rechazan sin coerción", () => {
    const bad = { ...observation(), allyHeroIds: ["axe", "12", 3.5, 0] } as unknown;
    const rejections = rejectionsOf(bad);
    expect(rejections.map((rejection) => rejection.code)).toEqual([
      "INVALID_HERO_ID",
      "INVALID_HERO_ID",
      "INVALID_HERO_ID",
      "INVALID_HERO_ID",
    ]);
  });

  test("héroe repetido dentro de un mismo bando -> DUPLICATE_HERO", () => {
    expectRejected(observation({ allyHeroIds: [11, 11] }), "DUPLICATE_HERO", "$.allyHeroIds[1]");
  });

  test("no hay dónde colar posiciones, roles ni enemigos ocultos: esos campos no existen", () => {
    for (const field of ["positions", "enemyPositions", "hiddenEnemyHeroIds", "roles"]) {
      expectRejected({ ...observation(), [field]: [] }, "UNKNOWN_FIELD", `$.${field}`);
    }
  });

  test("sin datos personales: account_id -> FORBIDDEN_FIELD y el valor jamás aparece en el rechazo", () => {
    const raw = { ...observation(), account_id: 424242424 };
    expectRejected(raw, "FORBIDDEN_FIELD", "$.account_id");
    expect(JSON.stringify(rejectionsOf(raw))).not.toContain("424242424");
  });

  test("perspective fuera de la unión, versión de esquema distinta y entradas no-objeto se rechazan", () => {
    expectRejected({ ...observation(), perspective: "spectator" }, "INVALID_FIELD", "$.perspective");
    expectRejected({ ...observation(), schemaVersion: 2 }, "UNSUPPORTED_SCHEMA_VERSION", "$.schemaVersion");
    expect(rejectionsOf(null)).toEqual([{ code: "NOT_AN_OBJECT", path: "$" }]);
  });

  test("la salida normaliza a ascendente y es una copia", () => {
    const input = observation({ allyHeroIds: [12, 11], revealedEnemyHeroIds: [23, 21] });
    const result = validateDraftObservation(input, UNIVERSE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allyHeroIds).toEqual([11, 12]);
    expect(result.value.revealedEnemyHeroIds).toEqual([21, 23]);
    input.allyHeroIds.push(99);
    expect(result.value.allyHeroIds).toEqual([11, 12]);
  });
});


describe("universo de héroes (observación)", () => {
  test("héroes dentro del universo inyectado son válidos", () => {
    expect(validateDraftObservation(observation(), UNIVERSE).ok).toBe(true);
  });

  test("un HeroID entero fuera del universo se rechaza en aliados, enemigos revelados y bans", () => {
    expectRejected(observation({ allyHeroIds: [11, OUT_OF_UNIVERSE_HERO] }), "HERO_OUT_OF_UNIVERSE", "$.allyHeroIds[1]");
    expectRejected(
      observation({ revealedEnemyHeroIds: [OUT_OF_UNIVERSE_HERO] }),
      "HERO_OUT_OF_UNIVERSE",
      "$.revealedEnemyHeroIds[0]",
    );
    expectRejected(
      observation({ bans: { status: "confirmed_visible", heroIds: [OUT_OF_UNIVERSE_HERO] } }),
      "HERO_OUT_OF_UNIVERSE",
      "$.bans.heroIds[0]",
    );
  });

  test("el rechazo no repite el HeroID recibido", () => {
    const rejections = rejectionsOf(observation({ allyHeroIds: [OUT_OF_UNIVERSE_HERO] }));
    expect(JSON.stringify(rejections)).not.toContain(String(OUT_OF_UNIVERSE_HERO));
  });

  test("sin universo inyectado rige el curado por defecto: un id absurdo se rechaza (sin atarse a su contenido)", () => {
    const result = validateDraftObservation(observation({ allyHeroIds: [2_000_000] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections).toContainEqual({ code: "HERO_OUT_OF_UNIVERSE", path: "$.allyHeroIds[0]" });
  });
});
