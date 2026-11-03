import { readFileSync, statSync } from "node:fs";
import {
  DRAFT_HISTORY_SCHEMA_VERSION,
  type DraftHistoryRecord,
  type Rejection,
} from "./types";
import { matchKey } from "./match-id";
import { validateDraftHistoryRecord, type ValidateRecordOptions } from "./validator";

// V7 PR-1 (TSK-248): cargador seguro. Un archivo de historial es INPUT EXTERNO (invariantes.md): se
// valida en el borde, y lo que no pasa se descarta con motivo -- mismo criterio que S17 (un caso
// malformado se descarta, el archivo entero nunca tira el runner) y que `loadCalibration()` /
// `loadHeroCounters()`. Nunca lanza. Sin red, sin SQLite, sin escritura: sólo lee.
//
// No fija ninguna ruta por defecto: este PR no crea datos, y un default implicaría una ubicación
// que ningún PR aprobó. El llamador pasa el path (o el texto/objeto ya leído).
//
// Contenedor: `{ "schemaVersion": 1, "records": [ ...DraftHistoryRecord ] }`, esquema cerrado.

export const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_RECORDS = 50_000;
// Cota de memoria del reporte, no de los registros válidos: el conteo exacto está en `rejectedCount`.
export const MAX_REPORTED_REJECTED_RECORDS = 100;

export type DraftHistoryLoadStatus =
  | "ok"
  | "unreadable"
  | "too_large"
  | "malformed_json"
  | "malformed_container"
  | "unsupported_schema_version";

export interface RejectedRecord {
  /** Posición del registro en `records` del archivo. Nunca su contenido. */
  index: number;
  rejections: Rejection[];
}

export interface LoadedDraftHistory {
  /**
   * `ok` = el contenedor era válido; aun así algunos registros pueden haberse descartado (ver
   * `rejectedCount`). Cualquier otro estado = `records: []`, el llamador sigue sin historial.
   */
  status: DraftHistoryLoadStatus;
  records: DraftHistoryRecord[];
  rejectedCount: number;
  rejected: RejectedRecord[];
  /** `true` = el archivo traía más de `maxRecords`; se procesaron sólo los primeros. */
  truncated: boolean;
}

export interface LoadDraftHistoryOptions extends ValidateRecordOptions {
  maxRecords?: number;
  maxBytes?: number;
}

function failed(status: Exclude<DraftHistoryLoadStatus, "ok">): LoadedDraftHistory {
  return { status, records: [], rejectedCount: 0, rejected: [], truncated: false };
}

/**
 * Identidad de un registro = `matchKey` de su procedencia (espacio de `match_id` de Valve,
 * compartido entre `opendota_match` y `opendota_league`; `manual_curated` tiene el suyo). Dos registros con la misma llave no
 * conviven en un contenedor: se conserva el PRIMERO y el repetido se descarta como
 * `DUPLICATE_RECORD`. Es dedupe intra-contenedor, no ingesta ni deduplicación masiva.
 */
export function draftHistoryRecordKey(record: DraftHistoryRecord): string {
  return matchKey(record.provenance);
}

export function parseDraftHistory(raw: unknown, options: LoadDraftHistoryOptions): LoadedDraftHistory {
  try {
    return parseContainer(raw, options);
  } catch {
    return failed("malformed_container");
  }
}

function parseContainer(raw: unknown, options: LoadDraftHistoryOptions): LoadedDraftHistory {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return failed("malformed_container");
  const keys = Object.keys(raw);
  if (keys.length !== 2 || !keys.includes("schemaVersion") || !keys.includes("records")) {
    return failed("malformed_container");
  }
  const container = raw as { schemaVersion: unknown; records: unknown };
  if (container.schemaVersion !== DRAFT_HISTORY_SCHEMA_VERSION) return failed("unsupported_schema_version");
  if (!Array.isArray(container.records)) return failed("malformed_container");

  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  const candidates: unknown[] = container.records;
  const truncated = candidates.length > maxRecords;
  const limit = Math.min(candidates.length, maxRecords);

  const records: DraftHistoryRecord[] = [];
  const rejected: RejectedRecord[] = [];
  const seenKeys = new Set<string>();
  let rejectedCount = 0;

  const reject = (index: number, rejections: Rejection[]): void => {
    rejectedCount += 1;
    if (rejected.length < MAX_REPORTED_REJECTED_RECORDS) rejected.push({ index, rejections });
  };

  for (let index = 0; index < limit; index += 1) {
    const result = validateDraftHistoryRecord(candidates[index], options);
    if (!result.ok) {
      reject(index, result.rejections);
      continue;
    }
    const key = draftHistoryRecordKey(result.value);
    if (seenKeys.has(key)) {
      reject(index, [{ code: "DUPLICATE_RECORD", path: "$.provenance" }]);
      continue;
    }
    seenKeys.add(key);
    records.push(result.value);
  }

  return { status: "ok", records, rejectedCount, rejected, truncated };
}

export function loadDraftHistoryFromText(text: string, options: LoadDraftHistoryOptions): LoadedDraftHistory {
  if (Buffer.byteLength(text, "utf-8") > (options.maxBytes ?? DEFAULT_MAX_FILE_BYTES)) {
    return failed("too_large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return failed("malformed_json");
  }
  return parseDraftHistory(parsed, options);
}

/** Lectura de sólo lectura. Archivo ausente, ilegible o gigante -> estado explícito, nunca excepción. */
export function loadDraftHistoryFromFile(path: string, options: LoadDraftHistoryOptions): LoadedDraftHistory {
  let text: string;
  try {
    if (statSync(path).size > (options.maxBytes ?? DEFAULT_MAX_FILE_BYTES)) return failed("too_large");
    text = readFileSync(path, "utf-8");
  } catch {
    return failed("unreadable");
  }
  return loadDraftHistoryFromText(text, options);
}
