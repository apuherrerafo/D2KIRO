import { describe, expect, test } from "bun:test";
import { CURATED_HERO_IDS } from "../signals/curated-hero-ids";
import { captainsModeRecord, LONG_TABLE, OUT_OF_UNIVERSE_HERO, TEST_HERO_UNIVERSE, rankedAllPickRecord, SHORT_TABLE, validProvenance } from "./fixtures";
import type { Rejection, RejectionCode } from "./types";
import { DEFAULT_HERO_UNIVERSE, validateDraftHistoryRecord, type ValidateRecordOptions } from "./validator";

const WITH_SHORT: ValidateRecordOptions = { captainsModeTable: SHORT_TABLE, heroUniverse: TEST_HERO_UNIVERSE };
const WITH_LONG: ValidateRecordOptions = { captainsModeTable: LONG_TABLE, heroUniverse: TEST_HERO_UNIVERSE };
const NO_TABLE: ValidateRecordOptions = { captainsModeTable: null, heroUniverse: TEST_HERO_UNIVERSE };

function rejectionsOf(raw: unknown, options: ValidateRecordOptions = WITH_SHORT): Rejection[] {
  const result = validateDraftHistoryRecord(raw, options);
  if (result.ok) throw new Error("se esperaba un rechazo");
  return result.rejections;
}

function expectRejected(raw: unknown, code: RejectionCode, path: string, options?: ValidateRecordOptions): void {
  expect(rejectionsOf(raw, options)).toContainEqual({ code, path });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("Captain's Mode: la secuencia sale de la tabla inyectada, no de un número fijo", () => {
  test("la tabla de 24 acciones valida un registro de 24", () => {
    const record = captainsModeRecord(LONG_TABLE);
    expect(record.actions).toHaveLength(24);
    const result = validateDraftHistoryRecord(record, WITH_LONG);
    expect(result.ok).toBe(true);
  });

  test("una tabla de 6 acciones valida un registro de 6: no se impone 24 turnos", () => {
    const record = captainsModeRecord(SHORT_TABLE);
    expect(record.actions).toHaveLength(6);
    const result = validateDraftHistoryRecord(record, WITH_SHORT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(record);
  });

  test("los primeros 6 turnos de una secuencia de 24, declarados 'complete', no se aceptan: la tabla manda", () => {
    const full = captainsModeRecord(LONG_TABLE);
    const truncated = captainsModeRecord(LONG_TABLE, "radiant", { actions: full.actions.slice(0, 6) });
    expectRejected(truncated, "COMPLETENESS_MISMATCH", "$.completeness", WITH_LONG);
  });

  test("una secuencia de otra tabla no calza con la inyectada (CM_SEQUENCE_MISMATCH), no se 'adapta'", () => {
    expect(rejectionsOf(captainsModeRecord(SHORT_TABLE), WITH_LONG).every((r) => r.code === "CM_SEQUENCE_MISMATCH")).toBe(true);
  });

  test("firstActionSide=dire invierte los lados esperados y sigue siendo válido", () => {
    const record = captainsModeRecord(SHORT_TABLE, "dire");
    expect(record.actions[0]?.side).toBe("dire");
    expect(validateDraftHistoryRecord(record, WITH_SHORT).ok).toBe(true);
  });

  test("lados correctos para radiant pero declarando firstActionSide=dire -> CM_SEQUENCE_MISMATCH", () => {
    const record = clone(captainsModeRecord(SHORT_TABLE, "radiant"));
    record.firstActionSide = "dire";
    expectRejected(record, "CM_SEQUENCE_MISMATCH", "$.actions[0].side");
  });

  test("un ban donde la tabla pide pick -> CM_SEQUENCE_MISMATCH en esa posición", () => {
    const record = clone(captainsModeRecord(SHORT_TABLE));
    const third = record.actions[2];
    if (!third) throw new Error("fixture");
    third.action = "ban";
    expectRejected(record, "CM_SEQUENCE_MISMATCH", "$.actions[2].action");
  });

  test("un lado que no alterna como manda la tabla -> CM_SEQUENCE_MISMATCH", () => {
    const record = clone(captainsModeRecord(SHORT_TABLE));
    const fourth = record.actions[3];
    if (!fourth) throw new Error("fixture");
    fourth.side = "radiant"; // la tabla pide 'second' = dire
    expectRejected(record, "CM_SEQUENCE_MISMATCH", "$.actions[3].side");
  });

  test("order fuera de secuencia -> CM_ORDER_INVALID", () => {
    const record = clone(captainsModeRecord(SHORT_TABLE));
    const second = record.actions[1];
    if (!second) throw new Error("fixture");
    second.order = 5;
    expectRejected(record, "CM_ORDER_INVALID", "$.actions[1].order");
  });

  test("más acciones de las que fija la tabla -> TOO_MANY_ENTRIES", () => {
    const record = clone(captainsModeRecord(SHORT_TABLE));
    record.actions.push({ order: 6, action: "ban", side: "dire", heroId: 99 });
    expectRejected(record, "TOO_MANY_ENTRIES", "$.actions");
  });

  test("prefijo observado: 3 de 6 acciones, declarado 'prefix', es válido", () => {
    const full = captainsModeRecord(SHORT_TABLE);
    const prefix = captainsModeRecord(SHORT_TABLE, "radiant", {
      completeness: "prefix",
      actions: full.actions.slice(0, 3),
    });
    expect(validateDraftHistoryRecord(prefix, WITH_SHORT).ok).toBe(true);
  });

  test("prefijo declarado 'complete' -> COMPLETENESS_MISMATCH; completo declarado 'prefix' también", () => {
    const full = captainsModeRecord(SHORT_TABLE);
    const lyingComplete = captainsModeRecord(SHORT_TABLE, "radiant", { actions: full.actions.slice(0, 3) });
    expectRejected(lyingComplete, "COMPLETENESS_MISMATCH", "$.completeness");
    const lyingPrefix = captainsModeRecord(SHORT_TABLE, "radiant", { completeness: "prefix" });
    expectRejected(lyingPrefix, "COMPLETENESS_MISMATCH", "$.completeness");
  });

  test("sin tabla cargada, un Captain's Mode se rechaza (CM_TABLE_UNAVAILABLE) y no se adivina la secuencia", () => {
    expectRejected(captainsModeRecord(SHORT_TABLE), "CM_TABLE_UNAVAILABLE", "$.actions", NO_TABLE);
  });

  test("sin tabla, Ranked All Pick sigue validando: la tabla sólo le importa a Captain's Mode", () => {
    expect(validateDraftHistoryRecord(rankedAllPickRecord(), NO_TABLE).ok).toBe(true);
  });

  test("héroe repetido en la secuencia -> DUPLICATE_HERO; banear y pickear el mismo -> BAN_PICK_OVERLAP", () => {
    const dup = clone(captainsModeRecord(SHORT_TABLE));
    const dupTarget = dup.actions[1];
    if (!dupTarget) throw new Error("fixture");
    dupTarget.heroId = 1; // acción 0 es ban de 1; acción 1 es ban -> mismo tipo
    expectRejected(dup, "DUPLICATE_HERO", "$.actions[1].heroId");

    const overlap = clone(captainsModeRecord(SHORT_TABLE));
    const overlapTarget = overlap.actions[2];
    if (!overlapTarget) throw new Error("fixture");
    overlapTarget.heroId = 1; // acción 2 es pick; acción 0 baneó a 1
    expectRejected(overlap, "BAN_PICK_OVERLAP", "$.actions[2].heroId");
  });
});

describe("Ranked All Pick y 'unknown': conjuntos observados, sin orden individual", () => {
  test("registro completo válido", () => {
    expect(validateDraftHistoryRecord(rankedAllPickRecord(), WITH_SHORT).ok).toBe(true);
  });

  test("el orden de entrada no se conserva: los conjuntos salen ascendentes (nadie puede leerlos como orden de pick)", () => {
    const shuffled = rankedAllPickRecord({
      picks: {
        radiant: { heroIds: [15, 11, 14, 12, 13], complete: true },
        dire: { heroIds: [25, 21, 24, 22, 23], complete: true },
      },
      bans: { status: "confirmed_visible", heroIds: [33, 31, 32] },
    });
    const result = validateDraftHistoryRecord(shuffled, WITH_SHORT);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.format === "captains_mode") throw new Error("forma");
    expect(result.value.picks.radiant.heroIds).toEqual([11, 12, 13, 14, 15]);
    expect(result.value.picks.dire.heroIds).toEqual([21, 22, 23, 24, 25]);
    expect(result.value.bans).toEqual({ status: "confirmed_visible", heroIds: [31, 32, 33] });
  });

  test("roster enemigo parcial: complete=false con 2 héroes, bans desconocidos -> válido, no se completa nada", () => {
    const partial = rankedAllPickRecord({
      picks: {
        radiant: { heroIds: [11, 12, 13, 14, 15], complete: true },
        dire: { heroIds: [21, 22], complete: false },
      },
      bans: { status: "unknown" },
    });
    const result = validateDraftHistoryRecord(partial, WITH_SHORT);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.format === "captains_mode") throw new Error("forma");
    expect(result.value.picks.dire).toEqual({ heroIds: [21, 22], complete: false });
    expect(result.value.bans).toEqual({ status: "unknown" });
  });

  test("complete=true con 4 héroes, o complete=false con 5 -> COMPLETENESS_MISMATCH", () => {
    const four = rankedAllPickRecord({
      picks: { radiant: { heroIds: [11, 12, 13, 14], complete: true }, dire: { heroIds: [21], complete: false } },
    });
    expectRejected(four, "COMPLETENESS_MISMATCH", "$.picks.radiant.complete");
    const five = rankedAllPickRecord({
      picks: {
        radiant: { heroIds: [11, 12, 13, 14, 15], complete: false },
        dire: { heroIds: [21], complete: false },
      },
    });
    expectRejected(five, "COMPLETENESS_MISMATCH", "$.picks.radiant.complete");
  });

  test("más de 5 héroes en un lado -> TOO_MANY_ENTRIES", () => {
    const six = rankedAllPickRecord({
      picks: {
        radiant: { heroIds: [11, 12, 13, 14, 15, 16], complete: true },
        dire: { heroIds: [21], complete: false },
      },
    });
    expectRejected(six, "TOO_MANY_ENTRIES", "$.picks.radiant.heroIds");
  });

  test("bans: 'unknown' y 'confirmed_visible con []' son estados distintos y ambos válidos", () => {
    const unknown = validateDraftHistoryRecord(rankedAllPickRecord({ bans: { status: "unknown" } }), WITH_SHORT);
    const none = validateDraftHistoryRecord(
      rankedAllPickRecord({ bans: { status: "confirmed_visible", heroIds: [] } }),
      WITH_SHORT,
    );
    expect(unknown.ok && none.ok).toBe(true);
    if (unknown.ok && none.ok) expect(unknown.value).not.toEqual(none.value);
  });

  test("bans 'unknown' no puede traer heroIds (no se esconden bans sin confirmar)", () => {
    const record = clone(rankedAllPickRecord()) as unknown as { bans: Record<string, unknown> };
    record.bans = { status: "unknown", heroIds: [31] };
    expectRejected(record, "UNKNOWN_FIELD", "$.bans.heroIds");
  });

  test("bans sin 'status' no se asume 'unknown': MISSING_FIELD", () => {
    const record = clone(rankedAllPickRecord()) as unknown as { bans: Record<string, unknown> };
    record.bans = {};
    expectRejected(record, "MISSING_FIELD", "$.bans.status");
  });

  test("el mismo héroe en ambos equipos -> DUPLICATE_HERO", () => {
    const record = rankedAllPickRecord({
      picks: {
        radiant: { heroIds: [11, 12, 13, 14, 15], complete: true },
        dire: { heroIds: [11, 22, 23, 24, 25], complete: true },
      },
    });
    expectRejected(record, "DUPLICATE_HERO", "$.picks.dire.heroIds");
  });

  test("un héroe baneado y pickeado a la vez -> BAN_PICK_OVERLAP", () => {
    const record = rankedAllPickRecord({ bans: { status: "confirmed_visible", heroIds: [31, 21] } });
    expectRejected(record, "BAN_PICK_OVERLAP", "$.bans.heroIds");
  });

  test("format 'unknown' es legítimo y tiene la misma forma de conjuntos", () => {
    const record = rankedAllPickRecord({ format: "unknown", sourceGameMode: null });
    expect(validateDraftHistoryRecord(record, WITH_SHORT).ok).toBe(true);
  });

  test("un format fuera de la unión no es alias de 'unknown'", () => {
    const record = { ...clone(rankedAllPickRecord()), format: "all_pick" };
    expectRejected(record, "INVALID_FIELD", "$.format");
  });

  test("un registro de conjuntos no admite 'actions' ni uno de secuencia admite 'picks'", () => {
    const withActions = { ...clone(rankedAllPickRecord()), actions: [] };
    expectRejected(withActions, "UNKNOWN_FIELD", "$.actions");
    const withPicks = { ...clone(captainsModeRecord(SHORT_TABLE)), picks: {} };
    expectRejected(withPicks, "UNKNOWN_FIELD", "$.picks");
  });
});

describe("HeroID exacto", () => {
  const BAD_IDS: unknown[] = [0, -1, 1.5, "12", NaN, Infinity, null, true, {}];

  test.each(BAD_IDS.map((bad) => [bad]))("%p no es un HeroID: INVALID_HERO_ID, sin coerción", (bad) => {
    const record = clone(rankedAllPickRecord()) as unknown as {
      picks: { radiant: { heroIds: unknown[] } };
    };
    record.picks.radiant.heroIds = [11, 12, 13, 14, bad];
    expectRejected(record, "INVALID_HERO_ID", "$.picks.radiant.heroIds[4]");
  });

  test("un nombre o un rol en lugar del id no se resuelve a ningún héroe", () => {
    const record = clone(rankedAllPickRecord()) as unknown as { bans: { heroIds: unknown[] } };
    record.bans.heroIds = ["antimage", "carry"];
    const codes = rejectionsOf(record).map((rejection) => rejection.code);
    expect(codes).toEqual(["INVALID_HERO_ID", "INVALID_HERO_ID"]);
  });
});

describe("parche: tres estados explícitos", () => {
  function withPatch(patch: unknown): unknown {
    return { ...clone(rankedAllPickRecord()), patch };
  }

  test("exact / source_id_only / unknown son válidos y se conservan tal cual", () => {
    const patches: unknown[] = [
      { state: "exact", label: "7.41e" },
      { state: "exact", label: "7.40" },
      { state: "source_id_only", sourceId: "60" },
      { state: "unknown" },
    ];
    for (const patch of patches) {
      const result = validateDraftHistoryRecord(withPatch(patch), WITH_SHORT);
      expect(result.ok).toBe(true);
      if (result.ok) expect<unknown>(result.value.patch).toEqual(patch);
    }
  });

  test("un id de la fuente NO se acepta como etiqueta: '60' en 'exact' -> INVALID_PATCH", () => {
    expectRejected(withPatch({ state: "exact", label: "60" }), "INVALID_PATCH", "$.patch.label");
  });

  test("patch ausente -> MISSING_FIELD (no se asume 'unknown'); estado inventado -> INVALID_PATCH", () => {
    const record = clone(rankedAllPickRecord()) as unknown as Record<string, unknown>;
    delete record.patch;
    expectRejected(record, "MISSING_FIELD", "$.patch");
    expectRejected(withPatch({ state: "latest" }), "INVALID_PATCH", "$.patch.state");
    expectRejected(withPatch("7.41e"), "INVALID_PATCH", "$.patch");
  });

  test("'unknown' no admite campos extra", () => {
    expectRejected(withPatch({ state: "unknown", label: "7.41e" }), "UNKNOWN_FIELD", "$.patch.label");
  });
});

describe("procedencia", () => {
  function withProvenance(provenance: unknown): unknown {
    return { ...clone(rankedAllPickRecord()), provenance };
  }

  test("fetchedAt=null es válido (la fuente no lo dijo) y se conserva null", () => {
    const result = validateDraftHistoryRecord(
      withProvenance({ ...validProvenance(), fetchedAt: null }),
      WITH_SHORT,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.provenance.fetchedAt).toBeNull();
  });

  test("fuente fuera de la unión, id raro y fecha imposible -> INVALID_PROVENANCE", () => {
    expectRejected(withProvenance({ ...validProvenance(), source: "scraper" }), "INVALID_PROVENANCE", "$.provenance.source");
    expectRejected(
      withProvenance({ ...validProvenance(), sourceMatchId: "7 000; DROP" }),
      "INVALID_PROVENANCE",
      "$.provenance.sourceMatchId",
    );
    expectRejected(
      withProvenance({ ...validProvenance(), fetchedAt: "2026-13-45T99:00:00Z" }),
      "INVALID_PROVENANCE",
      "$.provenance.fetchedAt",
    );
    expectRejected(withProvenance(null), "INVALID_PROVENANCE", "$.provenance");
  });

  test("procedencia ausente -> MISSING_FIELD", () => {
    const record = clone(rankedAllPickRecord()) as unknown as Record<string, unknown>;
    delete record.provenance;
    expectRejected(record, "MISSING_FIELD", "$.provenance");
  });
});

describe("posiciones: sólo las que la fuente dio, nunca fabricadas", () => {
  test("lista vacía = desconocidas, y sigue vacía", () => {
    const result = validateDraftHistoryRecord(rankedAllPickRecord(), WITH_SHORT);
    expect(result.ok && result.value.positions).toEqual([]);
  });

  test("claims válidos con basis de la fuente", () => {
    const record = rankedAllPickRecord({
      positions: [
        { heroId: 11, side: "radiant", position: 1, basis: "source_estimated" },
        { heroId: 21, side: "dire", position: 1, basis: "source_reported" },
      ],
    });
    expect(validateDraftHistoryRecord(record, WITH_SHORT).ok).toBe(true);
  });

  test("posición de un héroe no pickeado por ese lado -> POSITION_UNKNOWN_HERO (baneado, o del otro equipo)", () => {
    const banned = rankedAllPickRecord({
      positions: [{ heroId: 31, side: "radiant", position: 1, basis: "source_reported" }],
    });
    expectRejected(banned, "POSITION_UNKNOWN_HERO", "$.positions[0].heroId");
    const wrongSide = rankedAllPickRecord({
      positions: [{ heroId: 21, side: "radiant", position: 1, basis: "source_reported" }],
    });
    expectRejected(wrongSide, "POSITION_UNKNOWN_HERO", "$.positions[0].heroId");
  });

  test("dos héroes en la misma posición del mismo equipo -> POSITION_CONFLICT", () => {
    const record = rankedAllPickRecord({
      positions: [
        { heroId: 11, side: "radiant", position: 2, basis: "source_estimated" },
        { heroId: 12, side: "radiant", position: 2, basis: "source_estimated" },
      ],
    });
    expectRejected(record, "POSITION_CONFLICT", "$.positions[1].position");
  });

  test("posición 6, basis 'inferred' y claims con campos extra se rechazan", () => {
    const base = { heroId: 11, side: "radiant", position: 1, basis: "source_reported" };
    expectRejected({ ...clone(rankedAllPickRecord()), positions: [{ ...base, position: 6 }] }, "INVALID_FIELD", "$.positions[0].position");
    expectRejected({ ...clone(rankedAllPickRecord()), positions: [{ ...base, basis: "inferred" }] }, "INVALID_FIELD", "$.positions[0].basis");
    expectRejected({ ...clone(rankedAllPickRecord()), positions: [{ ...base, role: "carry" }] }, "UNKNOWN_FIELD", "$.positions[0].role");
  });

  test("en Captain's Mode las posiciones también deben apuntar a un PICK de ese lado", () => {
    const record = captainsModeRecord(SHORT_TABLE);
    const pick = record.actions.find((action) => action.action === "pick");
    const ban = record.actions.find((action) => action.action === "ban");
    if (!pick || !ban) throw new Error("fixture");
    const ok = { ...record, positions: [{ heroId: pick.heroId, side: pick.side, position: 3 as const, basis: "source_reported" as const }] };
    expect(validateDraftHistoryRecord(ok, WITH_SHORT).ok).toBe(true);
    const onBan = { ...record, positions: [{ heroId: ban.heroId, side: ban.side, position: 3 as const, basis: "source_reported" as const }] };
    expectRejected(onBan, "POSITION_UNKNOWN_HERO", "$.positions[0].heroId", WITH_SHORT);
  });
});

describe("sin datos personales: esquema cerrado", () => {
  test("account_id / raw_json / steamId, en cualquier nivel -> FORBIDDEN_FIELD", () => {
    const top = { ...clone(rankedAllPickRecord()), account_id: 424242 };
    expectRejected(top, "FORBIDDEN_FIELD", "$.account_id");
    const camel = { ...clone(rankedAllPickRecord()), accountId: 424242 };
    expectRejected(camel, "FORBIDDEN_FIELD", "$.accountId");
    const raw = { ...clone(rankedAllPickRecord()), raw_json: "{}" };
    expectRejected(raw, "FORBIDDEN_FIELD", "$.raw_json");
    const nested = { ...clone(rankedAllPickRecord()), provenance: { ...validProvenance(), steamId: "x" } };
    expectRejected(nested, "FORBIDDEN_FIELD", "$.provenance.steamId");
    const inPosition = {
      ...clone(rankedAllPickRecord()),
      positions: [{ heroId: 11, side: "radiant", position: 1, basis: "source_reported", account_id: 1 }],
    };
    expectRejected(inPosition, "FORBIDDEN_FIELD", "$.positions[0].account_id");
  });

  test("cualquier otro campo no declarado -> UNKNOWN_FIELD; '__proto__' de JSON.parse también", () => {
    expectRejected({ ...clone(rankedAllPickRecord()), notes: "x" }, "UNKNOWN_FIELD", "$.notes");
    // JSON.parse crea '__proto__' como clave PROPIA (no toca el prototipo); el esquema cerrado la rechaza.
    const withProto = JSON.parse(`{"schemaVersion":1,"format":"unknown","__proto__":{"x":1}}`) as unknown;
    expectRejected(withProto, "UNKNOWN_FIELD", "$.__proto__");
  });

  test("un rechazo nunca repite el valor recibido (ni el id de cuenta, ni el contenido del campo extra)", () => {
    const record = {
      ...clone(rankedAllPickRecord()),
      account_id: 424242424,
      "weird key 31337 value": "SENTINEL-PII",
      provenance: { ...validProvenance(), sourceMatchId: "SENTINEL-PII ;;" },
    };
    const serialized = JSON.stringify(rejectionsOf(record));
    expect(serialized).not.toContain("424242424");
    expect(serialized).not.toContain("SENTINEL-PII");
    expect(serialized).not.toContain("31337");
    expect(serialized).toContain("<key>"); // la clave rara se anonimiza
  });

  test("la salida es una copia: mutar la entrada después no altera el registro validado", () => {
    const input = clone(rankedAllPickRecord());
    const result = validateDraftHistoryRecord(input, WITH_SHORT);
    if (!result.ok || result.value.format === "captains_mode") throw new Error("forma");
    input.picks.radiant.heroIds.push(999);
    input.provenance.sourceMatchId = "mutado";
    expect(result.value.picks.radiant.heroIds).toEqual([11, 12, 13, 14, 15]);
    expect(result.value.provenance.sourceMatchId).toBe("7000000002");
  });
});

describe("robustez: nunca lanza", () => {
  test("entradas que no son objeto -> NOT_AN_OBJECT", () => {
    for (const garbage of [null, undefined, 7, "x", [], true]) {
      expect(rejectionsOf(garbage)).toEqual([{ code: "NOT_AN_OBJECT", path: "$" }]);
    }
  });

  test("schemaVersion distinto de 1 -> UNSUPPORTED_SCHEMA_VERSION", () => {
    expectRejected({ ...clone(rankedAllPickRecord()), schemaVersion: 2 }, "UNSUPPORTED_SCHEMA_VERSION", "$.schemaVersion");
    expectRejected({ ...clone(rankedAllPickRecord()), schemaVersion: "1" }, "UNSUPPORTED_SCHEMA_VERSION", "$.schemaVersion");
  });

  test("un getter que explota termina en un rechazo, no en una excepción", () => {
    const hostile = clone(rankedAllPickRecord()) as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, "patch", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const result = validateDraftHistoryRecord(hostile, WITH_SHORT);
    expect(result.ok).toBe(false);
  });

  test("el reporte de rechazos está acotado", () => {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < 500; i += 1) record[`k${i}`] = i;
    expect(rejectionsOf(record).length).toBeLessThanOrEqual(32);
  });

  test("es determinista: misma entrada -> misma salida", () => {
    const input = captainsModeRecord(LONG_TABLE, "dire");
    expect(validateDraftHistoryRecord(input, WITH_LONG)).toEqual(validateDraftHistoryRecord(input, WITH_LONG));
  });
});


describe("universo de héroes (registro)", () => {
  test("el universo por defecto ES el conjunto curado exportado (sin atarse a su contenido)", () => {
    expect(DEFAULT_HERO_UNIVERSE).toBe(CURATED_HERO_IDS);
  });

  test("Captain's Mode: un héroe fuera del universo, en ban o en pick -> HERO_OUT_OF_UNIVERSE", () => {
    for (const index of [0, 2]) {
      // en SHORT_TABLE: 0 = ban, 2 = pick
      const record = clone(captainsModeRecord(SHORT_TABLE));
      const action = record.actions[index];
      if (!action) throw new Error("fixture");
      action.heroId = OUT_OF_UNIVERSE_HERO;
      expectRejected(record, "HERO_OUT_OF_UNIVERSE", `$.actions[${index}].heroId`);
    }
  });

  test("All Pick: fuera del universo en picks aliados (radiant), enemigos (dire) y bans", () => {
    const radiant = clone(rankedAllPickRecord());
    radiant.picks.radiant.heroIds = [11, 12, 13, 14, OUT_OF_UNIVERSE_HERO];
    expectRejected(radiant, "HERO_OUT_OF_UNIVERSE", "$.picks.radiant.heroIds[4]");

    const dire = clone(rankedAllPickRecord());
    dire.picks.dire.heroIds = [OUT_OF_UNIVERSE_HERO, 22, 23, 24, 25];
    expectRejected(dire, "HERO_OUT_OF_UNIVERSE", "$.picks.dire.heroIds[0]");

    const bans = rankedAllPickRecord({ bans: { status: "confirmed_visible", heroIds: [31, OUT_OF_UNIVERSE_HERO] } });
    expectRejected(bans, "HERO_OUT_OF_UNIVERSE", "$.bans.heroIds[1]");
  });

  test("una posición apuntando a un héroe fuera del universo también se rechaza", () => {
    const record = clone(rankedAllPickRecord());
    record.positions = [{ heroId: OUT_OF_UNIVERSE_HERO, side: "radiant", position: 1, basis: "source_reported" }];
    expectRejected(record, "HERO_OUT_OF_UNIVERSE", "$.positions[0].heroId");
  });

  test("el rechazo no repite el HeroID recibido y los registros válidos siguen pasando", () => {
    const record = clone(rankedAllPickRecord());
    record.picks.radiant.heroIds = [11, 12, 13, 14, OUT_OF_UNIVERSE_HERO];
    expect(JSON.stringify(rejectionsOf(record))).not.toContain(String(OUT_OF_UNIVERSE_HERO));
    expect(validateDraftHistoryRecord(rankedAllPickRecord(), WITH_SHORT).ok).toBe(true);
  });

  test("sin universo inyectado rige el curado por defecto: un id absurdo se rechaza", () => {
    const record = clone(rankedAllPickRecord());
    record.picks.radiant.heroIds = [11, 12, 13, 14, 2_000_000];
    const result = validateDraftHistoryRecord(record, { captainsModeTable: SHORT_TABLE });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toContainEqual({ code: "HERO_OUT_OF_UNIVERSE", path: "$.picks.radiant.heroIds[4]" });
    }
  });
});

describe("match_id canónico en la procedencia", () => {
  function withMatchId(sourceMatchId: unknown): unknown {
    return { ...clone(rankedAllPickRecord()), provenance: { ...validProvenance(), sourceMatchId } };
  }

  test("entero positivo seguro, sin ceros a la izquierda: válido", () => {
    for (const id of ["1", "7000000001", "9007199254740991"]) {
      expect(validateDraftHistoryRecord(withMatchId(id), WITH_SHORT).ok).toBe(true);
    }
  });

  test("ambiguos o fuera de rango -> INVALID_PROVENANCE", () => {
    const bad: unknown[] = [
      "0", "-5", "007", "07000000001", "+7", "7.0", "7e9", "0x10", " 7", "7 ", "", "9007199254740992",
      "99999999999999999", 7000000001, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null, {}, [],
    ];
    for (const id of bad) {
      expect(rejectionsOf(withMatchId(id))).toContainEqual({
        code: "INVALID_PROVENANCE",
        path: "$.provenance.sourceMatchId",
      });
    }
  });

  test("el rechazo de un match_id no repite el valor recibido", () => {
    const rejections = rejectionsOf(withMatchId("9007199254740992"));
    expect(JSON.stringify(rejections)).not.toContain("9007199254740992");
  });

  test("sourceMatchId ausente -> MISSING_FIELD, no se fabrica", () => {
    const record = clone(rankedAllPickRecord()) as unknown as { provenance: Record<string, unknown> };
    delete record.provenance.sourceMatchId;
    expectRejected(record, "MISSING_FIELD", "$.provenance.sourceMatchId");
  });

  test("fetchedAt ausente NO se rellena (MISSING_FIELD); 'desconocido' se escribe explícito como null", () => {
    const record = clone(rankedAllPickRecord()) as unknown as { provenance: Record<string, unknown> };
    delete record.provenance.fetchedAt;
    expectRejected(record, "MISSING_FIELD", "$.provenance.fetchedAt");
  });
});

describe("identidad: match_id de Valve vs id propio de manual_curated", () => {
  function withSource(source: string, sourceMatchId: string): unknown {
    return { ...clone(rankedAllPickRecord()), provenance: { source, sourceMatchId, fetchedAt: null } };
  }

  test("manual_curated acepta un id propio (con letra) y lo conserva intacto", () => {
    const result = validateDraftHistoryRecord(withSource("manual_curated", "case_final_2026"), WITH_SHORT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.provenance.sourceMatchId).toBe("case_final_2026");
  });

  test("manual_curated con un id numérico se rechaza: no se hace pasar por un match_id", () => {
    expectRejected(withSource("manual_curated", "7000000001"), "INVALID_PROVENANCE", "$.provenance.sourceMatchId");
  });

  test("opendota_* con un id propio se rechaza: un match de Valve sólo lleva su match_id canónico", () => {
    expectRejected(withSource("opendota_match", "case_1"), "INVALID_PROVENANCE", "$.provenance.sourceMatchId");
    expectRejected(withSource("opendota_league", "case_1"), "INVALID_PROVENANCE", "$.provenance.sourceMatchId");
  });
});

describe("clasificación: evidencia profesional vs Ranked, formato y resultado", () => {
  function mutate(base: unknown, patch: Record<string, unknown>): unknown {
    return { ...(clone(base) as Record<string, unknown>), ...patch };
  }

  test("evidenceClass es obligatorio y explícito: ausente -> MISSING_FIELD, jamás se infiere", () => {
    const record = clone(rankedAllPickRecord()) as unknown as Record<string, unknown>;
    delete record.evidenceClass;
    expectRejected(record, "MISSING_FIELD", "$.evidenceClass");
  });

  test("sólo 'professional' | 'ranked'", () => {
    expectRejected(mutate(rankedAllPickRecord(), { evidenceClass: "pub" }), "INVALID_FIELD", "$.evidenceClass");
    expectRejected(mutate(rankedAllPickRecord(), { evidenceClass: "unknown" }), "INVALID_FIELD", "$.evidenceClass");
  });

  test("ambas clases se conservan tal cual en el registro", () => {
    const pro = validateDraftHistoryRecord(captainsModeRecord(SHORT_TABLE), WITH_SHORT);
    const ranked = validateDraftHistoryRecord(rankedAllPickRecord(), WITH_SHORT);
    expect(pro.ok && pro.value.evidenceClass).toBe("professional");
    expect(ranked.ok && ranked.value.evidenceClass).toBe("ranked");
  });

  test("una partida de opendota_league no puede declararse Ranked", () => {
    const record = mutate(rankedAllPickRecord(), {
      provenance: { source: "opendota_league", sourceMatchId: "7000000002", fetchedAt: null },
      evidenceClass: "ranked",
    });
    expectRejected(record, "EVIDENCE_CLASS_MISMATCH", "$.evidenceClass");
  });

  test("la clase es independiente del formato: profesional con All Pick sigue siendo válido", () => {
    const record = mutate(rankedAllPickRecord(), { evidenceClass: "professional" });
    const result = validateDraftHistoryRecord(record, WITH_SHORT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.format).toBe("ranked_all_pick");
  });

  test("Captain's Mode y All Pick siguen siendo formatos distintos, cada uno con su forma", () => {
    const cm = validateDraftHistoryRecord(captainsModeRecord(SHORT_TABLE), WITH_SHORT);
    const ap = validateDraftHistoryRecord(rankedAllPickRecord(), WITH_SHORT);
    expect(cm.ok && cm.value.format).toBe("captains_mode");
    expect(ap.ok && ap.value.format).toBe("ranked_all_pick");
    // Un CM con la forma de AP (conjuntos sin orden) no pasa por la puerta de AP, y viceversa.
    expectRejected(mutate(rankedAllPickRecord(), { format: "captains_mode" }), "UNKNOWN_FIELD", "$.picks");
    expectRejected(mutate(captainsModeRecord(SHORT_TABLE), { format: "ranked_all_pick" }), "UNKNOWN_FIELD", "$.actions");
  });

  test("resultado conocido: conserva el ganador", () => {
    const result = validateDraftHistoryRecord(
      mutate(rankedAllPickRecord(), { outcome: { status: "known", winner: "dire" } }),
      WITH_SHORT,
    );
    expect(result.ok && result.value.outcome).toEqual({ status: "known", winner: "dire" });
  });

  test("resultado desconocido es explícito y no inventa ganador", () => {
    const result = validateDraftHistoryRecord(rankedAllPickRecord(), WITH_SHORT);
    expect(result.ok && result.value.outcome).toEqual({ status: "unknown" });
    expectRejected(
      mutate(rankedAllPickRecord(), { outcome: { status: "unknown", winner: "radiant" } }),
      "UNKNOWN_FIELD",
      "$.outcome.winner",
    );
  });

  test("resultado: ausente, sin ganador, ganador raro o estado raro se rechazan", () => {
    const record = clone(rankedAllPickRecord()) as unknown as Record<string, unknown>;
    delete record.outcome;
    expectRejected(record, "MISSING_FIELD", "$.outcome");
    expectRejected(mutate(rankedAllPickRecord(), { outcome: { status: "known" } }), "MISSING_FIELD", "$.outcome.winner");
    expectRejected(
      mutate(rankedAllPickRecord(), { outcome: { status: "known", winner: "draw" } }),
      "INVALID_FIELD",
      "$.outcome.winner",
    );
    expectRejected(mutate(rankedAllPickRecord(), { outcome: { status: "won" } }), "INVALID_FIELD", "$.outcome.status");
    expectRejected(mutate(rankedAllPickRecord(), { outcome: "radiant" }), "INVALID_FIELD", "$.outcome");
  });
});
