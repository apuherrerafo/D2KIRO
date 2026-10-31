import type { CaptainsModeTurnTable } from "../draft/draft-format-turns";
import { isValidHeroId } from "../draft-protocol/hero-id";
import { CURATED_HERO_IDS } from "../signals/curated-hero-ids";
import { canonicalSourceMatchId } from "./match-id";
import {
  DRAFT_HISTORY_SCHEMA_VERSION,
  MAX_BANS,
  MAX_PICKS_PER_SIDE,
  MAX_REJECTIONS_PER_RESULT,
  type BanKnowledge,
  type CaptainsModeAction,
  type CaptainsModeRecord,
  type DraftFormatKind,
  type DraftHistoryRecord,
  type EvidenceClass,
  type DraftHistoryObservation,
  type HeroId,
  type MatchOutcome,
  type PatchState,
  type PositionBasis,
  type PositionClaim,
  type PositionNumber,
  type Provenance,
  type ProvenanceSource,
  type Rejection,
  type RejectionCode,
  type Side,
  type UnorderedDraftRecord,
  type UnorderedSidePicks,
  type ValidationResult,
} from "./types";

// V7 PR-1 (TSK-248): validador del registro canónico y de la observación. Función pura, sin I/O,
// sin reloj. Reglas que lo distinguen de un "parse y a rezar":
// - ESQUEMA CERRADO: un campo no declarado se rechaza (`UNKNOWN_FIELD`); los que huelen a dato
//   personal (`account_id`, `raw_json`, ...) se rechazan con su propio código (`FORBIDDEN_FIELD`).
// - NUNCA lanza: una entrada hostil (getter que explota, objeto raro) termina en un rechazo.
// - NUNCA repite el valor recibido: un rechazo es `{ code, path }`. Un `account_id` colado en un
//   registro no puede terminar en un log, un ticket ni un mensaje de error.
// - La salida es una COPIA nueva con sólo los campos conocidos (sin alias con la entrada).
// - Convención interna: un lector que recibe `undefined` devuelve `undefined` sin agregar nada --
//   el campo faltante ya se reportó como `MISSING_FIELD` donde se lo pidió.

/**
 * Universo de héroes jugables. Por defecto `CURATED_HERO_IDS` (127 héroes del censo activo); es
 * inyectable (mismo patrón que `captainsModeTable`) para que las pruebas usen un universo fixture
 * y nunca dependan del dato curado real, que se regenera por parche.
 */
export const DEFAULT_HERO_UNIVERSE: ReadonlySet<number> = CURATED_HERO_IDS;

export interface ValidateObservationOptions {
  heroUniverse?: ReadonlySet<number>;
}

export interface ValidateRecordOptions extends ValidateObservationOptions {
  /**
   * Tabla de Captain's Mode (`parseCaptainsModeTurnTable` sobre `draft-format-turns.json`),
   * inyectada. Su largo lo fija ella -- este validador no conoce el número 24. `null` = no se pudo
   * cargar: los registros Captain's Mode se rechazan (`CM_TABLE_UNAVAILABLE`), el resto sigue.
   */
  captainsModeTable: CaptainsModeTurnTable | null;
}

type PlainObject = Record<string, unknown>;

class Collector {
  readonly rejections: Rejection[] = [];
  errorCount = 0;

  constructor(readonly heroUniverse: ReadonlySet<number>) {}

  add(code: RejectionCode, path: string): void {
    this.errorCount += 1;
    if (this.rejections.length < MAX_REJECTIONS_PER_RESULT) this.rejections.push({ code, path });
  }
}

// ---------------------------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------------------------

const FORBIDDEN_KEYS = new Set([
  "accountid",
  "steamid",
  "steam32",
  "steam64",
  "steamid64",
  "personaname",
  "playername",
  "nickname",
  "rawjson",
  "rawmatch",
  "email",
]);

const SAFE_SEGMENT = /^[A-Za-z0-9_]{1,40}$/;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(obj: PlainObject, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function req(obj: PlainObject, key: string, path: string, c: Collector): unknown {
  const value = own(obj, key);
  if (value === undefined) c.add("MISSING_FIELD", `${path}.${key}`);
  return value;
}

function checkKeys(obj: PlainObject, allowed: readonly string[], path: string, c: Collector): void {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const segment = SAFE_SEGMENT.test(key) ? key : "<key>";
    c.add(FORBIDDEN_KEYS.has(normalized) ? "FORBIDDEN_FIELD" : "UNKNOWN_FIELD", `${path}.${segment}`);
  }
}

function readObject(
  value: unknown,
  allowed: readonly string[],
  path: string,
  c: Collector,
  code: RejectionCode = "INVALID_FIELD",
): PlainObject | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    c.add(code, path);
    return undefined;
  }
  checkKeys(value, allowed, path, c);
  return value;
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  c: Collector,
  code: RejectionCode = "INVALID_FIELD",
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  c.add(code, path);
  return undefined;
}

function readBoolean(value: unknown, path: string, c: Collector): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  c.add("INVALID_FIELD", path);
  return undefined;
}

// HeroID EXACTO: entero positivo. Ni coerción de "12", ni redondeo, ni búsqueda por nombre/rol.
function readHeroId(value: unknown, path: string, c: Collector): HeroId | undefined {
  if (value === undefined) return undefined;
  if (!isValidHeroId(value)) {
    c.add("INVALID_HERO_ID", path);
    return undefined;
  }
  if (!c.heroUniverse.has(value)) {
    c.add("HERO_OUT_OF_UNIVERSE", path);
    return undefined;
  }
  return value;
}

function readHeroList(value: unknown, max: number, path: string, c: Collector): HeroId[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    c.add("INVALID_FIELD", path);
    return undefined;
  }
  if (value.length > max) {
    c.add("TOO_MANY_ENTRIES", path);
    return undefined;
  }
  const out: HeroId[] = [];
  const seen = new Set<HeroId>();
  let valid = true;
  for (let i = 0; i < value.length; i += 1) {
    const item: unknown = value[i];
    if (!isValidHeroId(item)) {
      c.add("INVALID_HERO_ID", `${path}[${i}]`);
      valid = false;
    } else if (!c.heroUniverse.has(item)) {
      c.add("HERO_OUT_OF_UNIVERSE", `${path}[${i}]`);
      valid = false;
    } else if (seen.has(item)) {
      c.add("DUPLICATE_HERO", `${path}[${i}]`);
      valid = false;
    } else {
      seen.add(item);
      out.push(item);
    }
  }
  return valid ? out : undefined;
}

function ascending(ids: readonly HeroId[]): HeroId[] {
  return [...ids].sort((a, b) => a - b);
}

// Los rechazos citan el índice de la ENTRADA; la normalización a ascendente se aplica recién al
// construir la salida, para que un `path` siempre señale el elemento tal como llegó.
function sortedBans(bans: BanKnowledge): BanKnowledge {
  return bans.status === "unknown" ? bans : { status: bans.status, heroIds: ascending(bans.heroIds) };
}

function sortedPicks(picks: UnorderedSidePicks): UnorderedSidePicks {
  return { heroIds: ascending(picks.heroIds), complete: picks.complete };
}

function otherSide(side: Side): Side {
  return side === "radiant" ? "dire" : "radiant";
}

const SIDES = ["radiant", "dire"] as const satisfies readonly Side[];
const DRAFT_FORMATS = ["captains_mode", "ranked_all_pick", "unknown"] as const satisfies readonly DraftFormatKind[];

// ---------------------------------------------------------------------------------------------
// Procedencia, parche, bans, posiciones
// ---------------------------------------------------------------------------------------------

const PROVENANCE_SOURCES = [
  "opendota_match",
  "opendota_league",
  "manual_curated",
] as const satisfies readonly ProvenanceSource[];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function readProvenance(value: unknown, path: string, c: Collector): Provenance | undefined {
  const obj = readObject(value, ["source", "sourceMatchId", "fetchedAt"], path, c, "INVALID_PROVENANCE");
  if (!obj) return undefined;
  const source = readEnum(req(obj, "source", path, c), PROVENANCE_SOURCES, `${path}.source`, c, "INVALID_PROVENANCE");
  const matchId = req(obj, "sourceMatchId", path, c);
  const fetchedAt = req(obj, "fetchedAt", path, c);

  // El id se valida contra el espacio de SU fuente. Sin fuente válida (ya reportado) no hay espacio.
  let sourceMatchId: string | undefined;
  if (matchId !== undefined && source !== undefined) {
    const canonical = canonicalSourceMatchId(source, matchId);
    if (canonical !== null) sourceMatchId = canonical;
    else c.add("INVALID_PROVENANCE", `${path}.sourceMatchId`);
  }

  let fetched: string | null | undefined;
  if (fetchedAt === null) {
    fetched = null;
  } else if (fetchedAt !== undefined) {
    if (typeof fetchedAt === "string" && ISO_UTC.test(fetchedAt) && Number.isFinite(Date.parse(fetchedAt))) {
      fetched = fetchedAt;
    } else {
      c.add("INVALID_PROVENANCE", `${path}.fetchedAt`);
    }
  }

  if (source === undefined || sourceMatchId === undefined || fetched === undefined) return undefined;
  return { source, sourceMatchId, fetchedAt: fetched };
}

const EVIDENCE_CLASSES = ["professional", "ranked"] as const satisfies readonly EvidenceClass[];

function readOutcome(value: unknown, path: string, c: Collector): MatchOutcome | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    c.add("INVALID_FIELD", path);
    return undefined;
  }
  const rawStatus = own(value, "status");
  if (rawStatus === undefined) c.add("MISSING_FIELD", `${path}.status`);
  const status = readEnum(rawStatus, ["unknown", "known"] as const, `${path}.status`, c);
  if (status === "known") {
    checkKeys(value, ["status", "winner"], path, c);
    const winner = readEnum(req(value, "winner", path, c), SIDES, `${path}.winner`, c);
    return winner === undefined ? undefined : { status, winner };
  }
  checkKeys(value, ["status"], path, c);
  return status === "unknown" ? { status } : undefined;
}

const PATCH_STATES = ["exact", "source_id_only", "unknown"] as const;
const PATCH_LABEL = /^\d{1,3}\.\d{1,3}[a-z]{0,3}$/;
const SOURCE_PATCH_ID = /^[A-Za-z0-9_.-]{1,32}$/;

function readPatch(value: unknown, path: string, c: Collector): PatchState | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    c.add("INVALID_PATCH", path);
    return undefined;
  }
  const state = readEnum(own(value, "state"), PATCH_STATES, `${path}.state`, c, "INVALID_PATCH");
  if (own(value, "state") === undefined) c.add("MISSING_FIELD", `${path}.state`);
  if (state === "exact") {
    checkKeys(value, ["state", "label"], path, c);
    const label = req(value, "label", path, c);
    if (label === undefined) return undefined;
    if (typeof label === "string" && PATCH_LABEL.test(label)) return { state, label };
    c.add("INVALID_PATCH", `${path}.label`);
    return undefined;
  }
  if (state === "source_id_only") {
    checkKeys(value, ["state", "sourceId"], path, c);
    const sourceId = req(value, "sourceId", path, c);
    if (sourceId === undefined) return undefined;
    if (typeof sourceId === "string" && SOURCE_PATCH_ID.test(sourceId)) return { state, sourceId };
    c.add("INVALID_PATCH", `${path}.sourceId`);
    return undefined;
  }
  checkKeys(value, ["state"], path, c);
  return state === "unknown" ? { state } : undefined;
}

const BAN_STATUSES = ["unknown", "confirmed_visible"] as const;

function readBans(value: unknown, path: string, c: Collector): BanKnowledge | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    c.add("INVALID_FIELD", path);
    return undefined;
  }
  const rawStatus = own(value, "status");
  if (rawStatus === undefined) c.add("MISSING_FIELD", `${path}.status`);
  const status = readEnum(rawStatus, BAN_STATUSES, `${path}.status`, c);
  if (status === "confirmed_visible") {
    checkKeys(value, ["status", "heroIds"], path, c);
    const heroIds = readHeroList(req(value, "heroIds", path, c), MAX_BANS, `${path}.heroIds`, c);
    return heroIds === undefined ? undefined : { status, heroIds };
  }
  checkKeys(value, ["status"], path, c);
  return status === "unknown" ? { status } : undefined;
}

const POSITIONS = [1, 2, 3, 4, 5] as const satisfies readonly PositionNumber[];
const POSITION_BASES = ["source_reported", "source_estimated"] as const satisfies readonly PositionBasis[];
const MAX_POSITION_CLAIMS = 10;

function readPositions(
  value: unknown,
  pickedBySide: ReadonlyMap<HeroId, Side> | undefined,
  path: string,
  c: Collector,
): PositionClaim[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    c.add("INVALID_FIELD", path);
    return undefined;
  }
  if (value.length > MAX_POSITION_CLAIMS) {
    c.add("TOO_MANY_ENTRIES", path);
    return undefined;
  }
  const claims: PositionClaim[] = [];
  const claimedHeroes = new Set<HeroId>();
  const claimedSlots = new Set<string>();
  const errorsBefore = c.errorCount;
  for (let i = 0; i < value.length; i += 1) {
    const itemPath = `${path}[${i}]`;
    const item = readObject(value[i], ["heroId", "side", "position", "basis"], itemPath, c);
    if (!item) continue;
    const heroId = readHeroId(req(item, "heroId", itemPath, c), `${itemPath}.heroId`, c);
    const side = readEnum(req(item, "side", itemPath, c), SIDES, `${itemPath}.side`, c);
    const rawPosition = req(item, "position", itemPath, c);
    let position: PositionNumber | undefined;
    if (rawPosition !== undefined) {
      const match = POSITIONS.find((candidate) => candidate === rawPosition);
      if (match === undefined) c.add("INVALID_FIELD", `${itemPath}.position`);
      position = match;
    }
    const basis = readEnum(req(item, "basis", itemPath, c), POSITION_BASES, `${itemPath}.basis`, c);
    if (heroId === undefined || side === undefined || position === undefined || basis === undefined) continue;

    if (claimedHeroes.has(heroId)) c.add("DUPLICATE_HERO", `${itemPath}.heroId`);
    claimedHeroes.add(heroId);
    const slot = `${side}:${position}`;
    if (claimedSlots.has(slot)) c.add("POSITION_CONFLICT", `${itemPath}.position`);
    claimedSlots.add(slot);
    if (pickedBySide !== undefined && pickedBySide.get(heroId) !== side) {
      c.add("POSITION_UNKNOWN_HERO", `${itemPath}.heroId`);
    }
    claims.push({ heroId, side, position, basis });
  }
  return c.errorCount === errorsBefore ? claims : undefined;
}

// ---------------------------------------------------------------------------------------------
// Registro canónico
// ---------------------------------------------------------------------------------------------

const COMMON_KEYS = [
  "schemaVersion",
  "format",
  "provenance",
  "evidenceClass",
  "outcome",
  "patch",
  "sourceGameMode",
  "positions",
] as const;
const CM_KEYS = [...COMMON_KEYS, "firstActionSide", "completeness", "actions"] as const;
const UNORDERED_KEYS = [...COMMON_KEYS, "picks", "bans"] as const;
const ALL_RECORD_KEYS = [...new Set<string>([...CM_KEYS, ...UNORDERED_KEYS])];
const MAX_SOURCE_GAME_MODE = 1000;

interface RecordBase {
  provenance: Provenance;
  evidenceClass: EvidenceClass;
  outcome: MatchOutcome;
  patch: PatchState;
  sourceGameMode: number | null;
}

export function validateDraftHistoryRecord(
  raw: unknown,
  options: ValidateRecordOptions,
): ValidationResult<DraftHistoryRecord> {
  const c = new Collector(options.heroUniverse ?? DEFAULT_HERO_UNIVERSE);
  let value: DraftHistoryRecord | undefined;
  try {
    value = readRecord(raw, options, c);
  } catch {
    c.add("INVALID_FIELD", "$");
  }
  return finish(c, value);
}

function finish<T>(c: Collector, value: T | undefined): ValidationResult<T> {
  if (c.errorCount === 0 && value !== undefined) return { ok: true, value };
  if (c.rejections.length === 0) c.add("INVALID_FIELD", "$");
  return { ok: false, rejections: c.rejections };
}

function readSchemaVersion(obj: PlainObject, c: Collector): boolean {
  const version = req(obj, "schemaVersion", "$", c);
  if (version === undefined) return false;
  if (version === DRAFT_HISTORY_SCHEMA_VERSION) return true;
  c.add("UNSUPPORTED_SCHEMA_VERSION", "$.schemaVersion");
  return false;
}

function readRecord(raw: unknown, options: ValidateRecordOptions, c: Collector): DraftHistoryRecord | undefined {
  if (!isPlainObject(raw)) {
    c.add("NOT_AN_OBJECT", "$");
    return undefined;
  }
  const rawFormat = req(raw, "format", "$", c);
  const format = readEnum(rawFormat, DRAFT_FORMATS, "$.format", c);
  const allowed = format === undefined ? ALL_RECORD_KEYS : format === "captains_mode" ? CM_KEYS : UNORDERED_KEYS;
  checkKeys(raw, allowed, "$", c);

  const versionOk = readSchemaVersion(raw, c);
  const provenance = readProvenance(req(raw, "provenance", "$", c), "$.provenance", c);
  const evidenceClass = readEnum(req(raw, "evidenceClass", "$", c), EVIDENCE_CLASSES, "$.evidenceClass", c);
  // Una liga profesional no puede declararse Ranked: la clase no se deja contradecir a la fuente.
  if (provenance?.source === "opendota_league" && evidenceClass === "ranked") {
    c.add("EVIDENCE_CLASS_MISMATCH", "$.evidenceClass");
  }
  const outcome = readOutcome(req(raw, "outcome", "$", c), "$.outcome", c);
  const patch = readPatch(req(raw, "patch", "$", c), "$.patch", c);
  const sourceGameMode = readSourceGameMode(req(raw, "sourceGameMode", "$", c), c);
  if (
    !versionOk ||
    format === undefined ||
    !provenance ||
    !evidenceClass ||
    !outcome ||
    !patch ||
    sourceGameMode === undefined
  ) {
    return undefined;
  }
  const base: RecordBase = { provenance, evidenceClass, outcome, patch, sourceGameMode };
  const rawPositions = req(raw, "positions", "$", c);

  if (format === "captains_mode") {
    return readCaptainsMode(raw, base, rawPositions, options.captainsModeTable, c);
  }
  return readUnordered(raw, format, base, rawPositions, c);
}

function readSourceGameMode(value: unknown, c: Collector): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SOURCE_GAME_MODE) {
    return value;
  }
  c.add("INVALID_FIELD", "$.sourceGameMode");
  return undefined;
}

const COMPLETENESS = ["complete", "prefix"] as const;

function readCaptainsMode(
  raw: PlainObject,
  base: RecordBase,
  rawPositions: unknown,
  table: CaptainsModeTurnTable | null,
  c: Collector,
): CaptainsModeRecord | undefined {
  if (table === null) {
    c.add("CM_TABLE_UNAVAILABLE", "$.actions");
    return undefined;
  }
  const firstActionSide = readEnum(req(raw, "firstActionSide", "$", c), SIDES, "$.firstActionSide", c);
  const completeness = readEnum(req(raw, "completeness", "$", c), COMPLETENESS, "$.completeness", c);
  const actions = readCaptainsModeActions(req(raw, "actions", "$", c), firstActionSide, table, c);

  if (actions !== undefined && completeness !== undefined) {
    const isFull = actions.length === table.turns.length;
    if (completeness === "complete" ? !isFull : isFull) c.add("COMPLETENESS_MISMATCH", "$.completeness");
  }

  let pickedBySide: Map<HeroId, Side> | undefined;
  if (actions !== undefined) {
    pickedBySide = new Map();
    for (const action of actions) {
      if (action.action === "pick") pickedBySide.set(action.heroId, action.side);
    }
  }
  const positions = readPositions(rawPositions, pickedBySide, "$.positions", c);

  if (firstActionSide === undefined || completeness === undefined || !actions || !positions) return undefined;
  return { schemaVersion: DRAFT_HISTORY_SCHEMA_VERSION, format: "captains_mode", ...base, positions, firstActionSide, completeness, actions };
}

function readCaptainsModeActions(
  value: unknown,
  firstActionSide: Side | undefined,
  table: CaptainsModeTurnTable,
  c: Collector,
): CaptainsModeAction[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    c.add("INVALID_FIELD", "$.actions");
    return undefined;
  }
  if (value.length > table.turns.length) {
    c.add("TOO_MANY_ENTRIES", "$.actions");
    return undefined;
  }
  const out: CaptainsModeAction[] = [];
  const seen = new Map<HeroId, "ban" | "pick">();
  const errorsBefore = c.errorCount;
  for (let i = 0; i < value.length; i += 1) {
    const path = `$.actions[${i}]`;
    const item = readObject(value[i], ["order", "action", "side", "heroId"], path, c);
    const turn = table.turns[i];
    if (!item || !turn) continue;

    const rawOrder = req(item, "order", path, c);
    if (rawOrder !== undefined && rawOrder !== i) c.add("CM_ORDER_INVALID", `${path}.order`);

    const action = readEnum(req(item, "action", path, c), ["ban", "pick"] as const, `${path}.action`, c);
    if (action !== undefined && action !== turn.action) c.add("CM_SEQUENCE_MISMATCH", `${path}.action`);

    const side = readEnum(req(item, "side", path, c), SIDES, `${path}.side`, c);
    if (side !== undefined && firstActionSide !== undefined) {
      const expected = turn.team === "first" ? firstActionSide : otherSide(firstActionSide);
      if (side !== expected) c.add("CM_SEQUENCE_MISMATCH", `${path}.side`);
    }

    const heroId = readHeroId(req(item, "heroId", path, c), `${path}.heroId`, c);
    if (heroId !== undefined) {
      const previous = seen.get(heroId);
      if (previous !== undefined) {
        c.add(action !== undefined && previous !== action ? "BAN_PICK_OVERLAP" : "DUPLICATE_HERO", `${path}.heroId`);
      } else if (action !== undefined) {
        seen.set(heroId, action);
      }
    }
    if (action !== undefined && side !== undefined && heroId !== undefined) {
      out.push({ order: i, action, side, heroId });
    }
  }
  return c.errorCount === errorsBefore && out.length === value.length ? out : undefined;
}

function readUnordered(
  raw: PlainObject,
  format: "ranked_all_pick" | "unknown",
  base: RecordBase,
  rawPositions: unknown,
  c: Collector,
): UnorderedDraftRecord | undefined {
  const picks = readUnorderedPicks(req(raw, "picks", "$", c), c);
  const bans = readBans(req(raw, "bans", "$", c), "$.bans", c);

  let pickedBySide: Map<HeroId, Side> | undefined;
  if (picks !== undefined) {
    pickedBySide = new Map();
    for (const side of SIDES) {
      for (const heroId of picks[side].heroIds) {
        if (pickedBySide.has(heroId)) c.add("DUPLICATE_HERO", `$.picks.${side}.heroIds`);
        pickedBySide.set(heroId, side);
      }
    }
    if (bans?.status === "confirmed_visible") {
      for (const heroId of bans.heroIds) {
        if (pickedBySide.has(heroId)) c.add("BAN_PICK_OVERLAP", "$.bans.heroIds");
      }
    }
  }
  const positions = readPositions(rawPositions, pickedBySide, "$.positions", c);

  if (!picks || !bans || !positions) return undefined;
  return {
    schemaVersion: DRAFT_HISTORY_SCHEMA_VERSION,
    format,
    ...base,
    positions,
    picks: { radiant: sortedPicks(picks.radiant), dire: sortedPicks(picks.dire) },
    bans: sortedBans(bans),
  };
}

function readUnorderedPicks(value: unknown, c: Collector): Record<Side, UnorderedSidePicks> | undefined {
  const obj = readObject(value, SIDES, "$.picks", c);
  if (!obj) return undefined;
  const radiant = readSidePicks(req(obj, "radiant", "$.picks", c), "$.picks.radiant", c);
  const dire = readSidePicks(req(obj, "dire", "$.picks", c), "$.picks.dire", c);
  return radiant && dire ? { radiant, dire } : undefined;
}

function readSidePicks(value: unknown, path: string, c: Collector): UnorderedSidePicks | undefined {
  const obj = readObject(value, ["heroIds", "complete"], path, c);
  if (!obj) return undefined;
  const heroIds = readHeroList(req(obj, "heroIds", path, c), MAX_PICKS_PER_SIDE, `${path}.heroIds`, c);
  const complete = readBoolean(req(obj, "complete", path, c), `${path}.complete`, c);
  if (heroIds === undefined || complete === undefined) return undefined;
  if (complete !== (heroIds.length === MAX_PICKS_PER_SIDE)) {
    c.add("COMPLETENESS_MISMATCH", `${path}.complete`);
    return undefined;
  }
  return { heroIds, complete };
}

// ---------------------------------------------------------------------------------------------
// Observación
// ---------------------------------------------------------------------------------------------

const OBSERVATION_KEYS = [
  "schemaVersion",
  "perspective",
  "format",
  "patch",
  "allyHeroIds",
  "revealedEnemyHeroIds",
  "bans",
] as const;

export function validateDraftObservation(
  raw: unknown,
  options: ValidateObservationOptions = {},
): ValidationResult<DraftHistoryObservation> {
  const c = new Collector(options.heroUniverse ?? DEFAULT_HERO_UNIVERSE);
  let value: DraftHistoryObservation | undefined;
  try {
    value = readObservation(raw, c);
  } catch {
    c.add("INVALID_FIELD", "$");
  }
  return finish(c, value);
}

function readObservation(raw: unknown, c: Collector): DraftHistoryObservation | undefined {
  if (!isPlainObject(raw)) {
    c.add("NOT_AN_OBJECT", "$");
    return undefined;
  }
  checkKeys(raw, OBSERVATION_KEYS, "$", c);
  const versionOk = readSchemaVersion(raw, c);
  const perspective = readEnum(req(raw, "perspective", "$", c), SIDES, "$.perspective", c);
  const format = readEnum(req(raw, "format", "$", c), DRAFT_FORMATS, "$.format", c);
  const patch = readPatch(req(raw, "patch", "$", c), "$.patch", c);
  const allies = readHeroList(req(raw, "allyHeroIds", "$", c), MAX_PICKS_PER_SIDE, "$.allyHeroIds", c);
  const enemies = readHeroList(
    req(raw, "revealedEnemyHeroIds", "$", c),
    MAX_PICKS_PER_SIDE,
    "$.revealedEnemyHeroIds",
    c,
  );
  const bans = readBans(req(raw, "bans", "$", c), "$.bans", c);

  if (allies !== undefined && enemies !== undefined) {
    const allySet = new Set(allies);
    enemies.forEach((heroId, i) => {
      if (allySet.has(heroId)) c.add("ENEMY_ALLY_OVERLAP", `$.revealedEnemyHeroIds[${i}]`);
    });
  }
  if (allies !== undefined && enemies !== undefined && bans?.status === "confirmed_visible") {
    const taken = new Set([...allies, ...enemies]);
    bans.heroIds.forEach((heroId, i) => {
      if (taken.has(heroId)) c.add("BAN_PICK_OVERLAP", `$.bans.heroIds[${i}]`);
    });
  }

  if (!versionOk || !perspective || !format || !patch || !allies || !enemies || !bans) return undefined;
  return {
    schemaVersion: DRAFT_HISTORY_SCHEMA_VERSION,
    perspective,
    format,
    patch,
    allyHeroIds: ascending(allies),
    revealedEnemyHeroIds: ascending(enemies),
    bans: sortedBans(bans),
  };
}
