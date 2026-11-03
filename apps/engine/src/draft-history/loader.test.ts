import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captainsModeRecord, rankedAllPickRecord, SHORT_TABLE, TEST_HERO_UNIVERSE, validProvenance } from "./fixtures";
import {
  draftHistoryRecordKey,
  loadDraftHistoryFromFile,
  loadDraftHistoryFromText,
  MAX_REPORTED_REJECTED_RECORDS,
  parseDraftHistory,
  type LoadDraftHistoryOptions,
} from "./loader";

const OPTIONS: LoadDraftHistoryOptions = { captainsModeTable: SHORT_TABLE, heroUniverse: TEST_HERO_UNIVERSE };

function container(records: unknown[]): unknown {
  return { schemaVersion: 1, records };
}

function apWithId(sourceMatchId: string) {
  return rankedAllPickRecord({ provenance: validProvenance(sourceMatchId) });
}

describe("parseDraftHistory: un registro malo se descarta con motivo, el archivo no cae", () => {
  test("mezcla de válidos e inválidos: conserva los válidos y reporta índice + motivo", () => {
    const bad = { ...apWithId("7000000010"), account_id: 424242 };
    const loaded = parseDraftHistory(
      container([apWithId("7000000009"), bad, captainsModeRecord(SHORT_TABLE)]),
      OPTIONS,
    );
    expect(loaded.status).toBe("ok");
    expect(loaded.records).toHaveLength(2);
    expect(loaded.rejectedCount).toBe(1);
    expect(loaded.rejected).toEqual([{ index: 1, rejections: [{ code: "FORBIDDEN_FIELD", path: "$.account_id" }] }]);
    expect(JSON.stringify(loaded.rejected)).not.toContain("424242");
  });

  test("dos registros con la misma procedencia: el segundo se descarta como DUPLICATE_RECORD", () => {
    const loaded = parseDraftHistory(container([apWithId("7000000011"), apWithId("7000000011")]), OPTIONS);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.rejected).toEqual([{ index: 1, rejections: [{ code: "DUPLICATE_RECORD", path: "$.provenance" }] }]);
  });

  test("un caso manual vive en su espacio: id propio, jamás choca con un match_id de Valve", () => {
    const other = rankedAllPickRecord({
      provenance: { source: "manual_curated", sourceMatchId: "case_7000000012", fetchedAt: null },
    });
    const loaded = parseDraftHistory(container([apWithId("7000000012"), other]), OPTIONS);
    expect(loaded.records.map(draftHistoryRecordKey)).toEqual(["valve:7000000012", "manual:case_7000000012"]);
  });

  test("un id numérico en manual_curated se descarta (parecería un match_id real de Valve)", () => {
    const numericManual = rankedAllPickRecord({
      provenance: { source: "manual_curated", sourceMatchId: "7000000012", fetchedAt: null },
    });
    const loaded = parseDraftHistory(container([apWithId("7000000012"), numericManual]), OPTIONS);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.rejected).toEqual([
      { index: 1, rejections: [{ code: "INVALID_PROVENANCE", path: "$.provenance.sourceMatchId" }] },
    ]);
  });

  test("opendota_match y opendota_league comparten espacio: la misma partida por dos vías conserva la primera", () => {
    const viaLeague = rankedAllPickRecord({
      provenance: { source: "opendota_league", sourceMatchId: "7000000012", fetchedAt: null },
      evidenceClass: "professional",
      patch: { state: "unknown" },
    });
    const loaded = parseDraftHistory(container([apWithId("7000000012"), viaLeague]), OPTIONS);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0]?.provenance.source).toBe("opendota_match");
    expect(loaded.rejected).toEqual([{ index: 1, rejections: [{ code: "DUPLICATE_RECORD", path: "$.provenance" }] }]);
    expect(JSON.stringify(loaded.rejected)).not.toContain("7000000012");
  });

  test("un match_id mal formado se descarta como inválido (no entra ni se cuenta como duplicado)", () => {
    const loaded = parseDraftHistory(container([apWithId("7000000012"), apWithId("07000000012")]), OPTIONS);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.rejected).toEqual([
      { index: 1, rejections: [{ code: "INVALID_PROVENANCE", path: "$.provenance.sourceMatchId" }] },
    ]);
  });

  test("sin tabla de Captain's Mode cargada: esos registros se descartan y los demás sobreviven", () => {
    const loaded = parseDraftHistory(container([captainsModeRecord(SHORT_TABLE), apWithId("7000000013")]), {
      captainsModeTable: null,
      heroUniverse: TEST_HERO_UNIVERSE,
    });
    expect(loaded.status).toBe("ok");
    expect(loaded.records).toHaveLength(1);
    expect(loaded.rejected[0]).toEqual({ index: 0, rejections: [{ code: "CM_TABLE_UNAVAILABLE", path: "$.actions" }] });
  });

  test("contenedor vacío es ok con cero registros", () => {
    expect(parseDraftHistory(container([]), OPTIONS)).toEqual({
      status: "ok",
      records: [],
      rejectedCount: 0,
      rejected: [],
      truncated: false,
    });
  });

  test("maxRecords corta el procesamiento y lo declara (truncated)", () => {
    const loaded = parseDraftHistory(container([apWithId("7000000014"), apWithId("7000000015"), apWithId("7000000016")]), {
      ...OPTIONS,
      maxRecords: 2,
    });
    expect(loaded.truncated).toBe(true);
    expect(loaded.records).toHaveLength(2);
  });

  test("el reporte de descartados está acotado pero el conteo es exacto", () => {
    const junk = Array.from({ length: MAX_REPORTED_REJECTED_RECORDS + 20 }, () => null);
    const loaded = parseDraftHistory(container(junk), OPTIONS);
    expect(loaded.rejectedCount).toBe(MAX_REPORTED_REJECTED_RECORDS + 20);
    expect(loaded.rejected).toHaveLength(MAX_REPORTED_REJECTED_RECORDS);
  });

  test("es determinista", () => {
    const raw = container([apWithId("7000000017"), captainsModeRecord(SHORT_TABLE), { nope: 1 }]);
    expect(parseDraftHistory(raw, OPTIONS)).toEqual(parseDraftHistory(raw, OPTIONS));
  });
});

describe("contenedor y archivo: degradan, nunca lanzan", () => {
  test("contenedor mal formado -> malformed_container con records vacío", () => {
    for (const raw of [null, [], "x", 3, { records: [] }, { schemaVersion: 1 }, { schemaVersion: 1, records: {} }]) {
      const loaded = parseDraftHistory(raw, OPTIONS);
      expect(loaded.status).toBe("malformed_container");
      expect(loaded.records).toEqual([]);
    }
  });

  test("contenedor con un campo extra (esquema cerrado) -> malformed_container", () => {
    const loaded = parseDraftHistory({ schemaVersion: 1, records: [], account_id: 1 }, OPTIONS);
    expect(loaded.status).toBe("malformed_container");
  });

  test("schemaVersion desconocida -> unsupported_schema_version", () => {
    expect(parseDraftHistory({ schemaVersion: 2, records: [] }, OPTIONS).status).toBe("unsupported_schema_version");
  });

  test("texto que no es JSON -> malformed_json; con BOM válido sí carga", () => {
    expect(loadDraftHistoryFromText("{no es json", OPTIONS).status).toBe("malformed_json");
    const withBom = `﻿${JSON.stringify(container([apWithId("7000000018")]))}`;
    expect(loadDraftHistoryFromText(withBom, OPTIONS).records).toHaveLength(1);
  });

  test("texto por encima de maxBytes -> too_large sin parsear", () => {
    const text = JSON.stringify(container([apWithId("7000000019")]));
    expect(loadDraftHistoryFromText(text, { ...OPTIONS, maxBytes: 16 }).status).toBe("too_large");
  });

  describe("archivo", () => {
    const dir = mkdtempSync(join(tmpdir(), "draft-history-test-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test("ida y vuelta: un archivo escrito por la prueba carga igual que el texto", () => {
      const path = join(dir, "history.json");
      writeFileSync(path, JSON.stringify(container([apWithId("7000000020"), captainsModeRecord(SHORT_TABLE)])));
      const loaded = loadDraftHistoryFromFile(path, OPTIONS);
      expect(loaded.status).toBe("ok");
      expect(loaded.records).toHaveLength(2);
    });

    test("archivo ausente -> unreadable, sin excepción", () => {
      expect(loadDraftHistoryFromFile(join(dir, "no-existe.json"), OPTIONS).status).toBe("unreadable");
    });

    test("un directorio no es un archivo legible -> unreadable", () => {
      expect(loadDraftHistoryFromFile(dir, OPTIONS).status).toBe("unreadable");
    });

    test("archivo corrupto -> malformed_json", () => {
      const path = join(dir, "corrupt.json");
      writeFileSync(path, "{ \"schemaVersion\": 1, \"records\": [");
      expect(loadDraftHistoryFromFile(path, OPTIONS).status).toBe("malformed_json");
    });

    test("archivo por encima de maxBytes -> too_large antes de leerlo", () => {
      const path = join(dir, "big.json");
      writeFileSync(path, JSON.stringify(container([apWithId("7000000021")])));
      expect(loadDraftHistoryFromFile(path, { ...OPTIONS, maxBytes: 8 }).status).toBe("too_large");
    });
  });
});
