import type { CaptainsModeTurnTable } from "../../apps/engine/src/draft/draft-format-turns";
import {
  canonicalMatchId,
  matchKey,
  validateDraftHistoryRecord,
  type CaptainsModeAction,
  type DraftHistoryRecord,
  type MatchOutcome,
  type PatchState,
  type PositionClaim,
  type PositionNumber,
  type Rejection,
  type Side,
} from "../../apps/engine/src/draft-history";

// V7 PR-3A: puente de confianza OFFLINE entre una partida de OpenDota y el historial canónico.
// Función pura: sin red, sin SQLite, sin reloj propio (`fetchedAt` se inyecta), sin checkpoints. NO
// reutiliza `normalizeDraft` de `ingest-drafts.ts` -- ese transformador ya perdió la distinción entre
// dato real y valor fabricado (ganador ausente -> Dire, `team ?? 0`, tier tomado del propio payload).
//
// Reglas que hace cumplir:
// - `opendota_league` sólo se escribe tras certificar la liga POR `leagueid` contra una entrada real
//   del catálogo inyectado, con tier premium/professional. El `league.tier` del payload no certifica.
// - Los tres IDs de liga (resumen, detalle, `detail.league`) deben coincidir; si no, cuarentena.
// - Nada se fabrica: ganador no booleano -> unknown; parche numérico -> `source_id_only`; sin
//   posiciones -> []; una secuencia que no calza con la tabla de CM se rechaza, nunca se repara.
// - La evidencia de certificación vive APARTE del registro (esquema cerrado de PR #49).
// - La salida jamás copia campos del payload que no sean los explícitamente leídos: ni `account_id`,
//   ni nombres, ni `raw_json`. Un motivo lleva código y ruta, nunca el valor recibido.

export interface LeagueCatalog {
  readonly source: "opendota_leagues";
  readonly entries: ReadonlyMap<number, { readonly tier: string | null } | { readonly conflict: true }>;
}

export interface BuiltLeagueCatalog {
  readonly catalog: LeagueCatalog;
  /** Filas descartadas por malformadas (sin `leagueid` entero positivo). */
  readonly invalidRows: number;
}

export interface CertifyInput {
  /** Detalle de la partida (`GET /matches/{id}`), sólo se leen los campos mínimos. */
  readonly match: unknown;
  /** Fila de `proMatches`, opcional: sólo aporta identidad (match_id, leagueid) para contrastar. */
  readonly summary?: unknown;
}

export interface CertifyContext {
  readonly catalog: LeagueCatalog;
  readonly captainsModeTable: CaptainsModeTurnTable | null;
  /** ISO-8601 UTC (`...Z`) inyectado: cuándo se obtuvo y verificó el dato. */
  readonly fetchedAt: string;
  readonly heroUniverse?: ReadonlySet<number>;
}

/** Evidencia mínima y auditable. NO es parte del registro canónico. */
export interface LeagueCertification {
  readonly matchId: string;
  readonly leagueId: number;
  readonly tier: "premium" | "professional";
  readonly source: "opendota_leagues_catalog";
  readonly verifiedAt: string;
}

export type CertificationFailureCode =
  | "INVALID_INPUT"
  | "FETCHED_AT_INVALID"
  | "MATCH_ID_MISSING"
  | "MATCH_ID_INVALID"
  | "MATCH_ID_CONTRADICTION"
  | "LEAGUE_ID_MISSING"
  | "LEAGUE_ID_INVALID"
  | "LEAGUE_ID_CONTRADICTION"
  | "NOT_A_LEAGUE_MATCH"
  | "LEAGUE_NOT_IN_CATALOG"
  | "LEAGUE_CATALOG_CONFLICT"
  | "LEAGUE_TIER_NOT_ELIGIBLE"
  | "LEAGUE_TIER_CONTRADICTION"
  | "GAME_MODE_NOT_CAPTAINS_MODE"
  | "PATCH_BEFORE_CURRENT"
  | "MATCH_BEFORE_CURRENT_PATCH"
  | "PATCH_UNVERIFIABLE"
  | "CM_TABLE_UNAVAILABLE"
  | "PICKS_BANS_MISSING"
  | "CM_SEQUENCE_INVALID"
  | "RECORD_VALIDATION_FAILED";

export type CertifyFailure = {
  /** `rejected`: la partida no es elegible (definitivo). `quarantined`: dato roto o contradictorio. */
  readonly status: "rejected" | "quarantined";
  readonly code: CertificationFailureCode;
  /** `match_id` público de Valve si se pudo leer; nunca un id de cuenta. */
  readonly matchId: string | null;
  /** Sólo con `RECORD_VALIDATION_FAILED`: códigos y rutas del validador de PR #49. */
  readonly validatorRejections?: readonly Rejection[];
};

export type CertifyResult =
  | { readonly status: "certified"; readonly record: DraftHistoryRecord; readonly certification: LeagueCertification }
  | CertifyFailure;

// ---------------------------------------------------------------------------------------------
// Catálogo de ligas
// ---------------------------------------------------------------------------------------------

const ELIGIBLE_TIERS = new Set(["premium", "professional"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLeagueIdValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** `rows` = respuesta de `GET /leagues`. Se valida en el borde: lo malformado se descarta y se cuenta. */
export function buildLeagueCatalog(rows: unknown): BuiltLeagueCatalog {
  const entries = new Map<number, { tier: string | null } | { conflict: true }>();
  if (!Array.isArray(rows)) return { catalog: { source: "opendota_leagues", entries }, invalidRows: 1 };
  let invalidRows = 0;
  for (const row of rows) {
    const leagueId = isRecord(row) ? row.leagueid : undefined;
    if (!isLeagueIdValue(leagueId) || leagueId === 0) {
      invalidRows += 1;
      continue;
    }
    const tier = typeof (row as Record<string, unknown>).tier === "string" ? ((row as Record<string, unknown>).tier as string) : null;
    const existing = entries.get(leagueId);
    if (existing === undefined) entries.set(leagueId, { tier });
    else if ("conflict" in existing || existing.tier !== tier) entries.set(leagueId, { conflict: true });
  }
  return { catalog: { source: "opendota_leagues", entries }, invalidRows };
}

// ---------------------------------------------------------------------------------------------
// Lectores defensivos
// ---------------------------------------------------------------------------------------------

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CAPTAINS_MODE = 2;
const POSITIONS: readonly PositionNumber[] = [1, 2, 3, 4, 5];

class Stop extends Error {
  constructor(readonly failure: CertifyFailure) {
    super("certification stopped");
  }
}

function fail(
  status: CertifyFailure["status"],
  code: CertificationFailureCode,
  matchId: string | null,
  validatorRejections?: readonly Rejection[],
): never {
  throw new Stop(validatorRejections === undefined ? { status, code, matchId } : { status, code, matchId, validatorRejections });
}

function field(source: unknown, key: string): unknown {
  return isRecord(source) ? source[key] : undefined;
}

const absent = (value: unknown): boolean => value === undefined || value === null;

function readMatchId(detail: unknown, summary: unknown): string {
  const candidates: unknown[] = [field(detail, "match_id"), field(summary, "match_id")].filter((value) => !absent(value));
  if (candidates.length === 0) fail("quarantined", "MATCH_ID_MISSING", null);
  const ids = candidates.map((value) => {
    if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? canonicalMatchId(String(value)) : null;
    return canonicalMatchId(value);
  });
  if (ids.some((id) => id === null)) fail("quarantined", "MATCH_ID_INVALID", null);
  if (new Set(ids).size > 1) fail("quarantined", "MATCH_ID_CONTRADICTION", null);
  return ids[0] as string;
}

function readLeagueId(detail: unknown, summary: unknown, matchId: string): number {
  const candidates = [field(summary, "leagueid"), field(detail, "leagueid"), field(field(detail, "league"), "leagueid")].filter(
    (value) => !absent(value),
  );
  if (candidates.length === 0) fail("quarantined", "LEAGUE_ID_MISSING", matchId);
  if (!candidates.every(isLeagueIdValue)) fail("quarantined", "LEAGUE_ID_INVALID", matchId);
  if (new Set(candidates).size > 1) fail("quarantined", "LEAGUE_ID_CONTRADICTION", matchId);
  const leagueId = candidates[0] as number;
  if (leagueId === 0) fail("rejected", "NOT_A_LEAGUE_MATCH", matchId);
  return leagueId;
}

function certifyLeague(
  leagueId: number,
  detail: unknown,
  catalog: LeagueCatalog,
  matchId: string,
): "premium" | "professional" {
  const entry = catalog.entries.get(leagueId);
  if (entry === undefined) fail("quarantined", "LEAGUE_NOT_IN_CATALOG", matchId);
  if ("conflict" in entry) fail("quarantined", "LEAGUE_CATALOG_CONFLICT", matchId);
  if (entry.tier === null || !ELIGIBLE_TIERS.has(entry.tier)) fail("rejected", "LEAGUE_TIER_NOT_ELIGIBLE", matchId);
  // El tier que trae el payload no certifica nada; sólo se contrasta. Si discrepa del catálogo, no
  // se elige a ojo: cuarentena.
  const declared = field(field(detail, "league"), "tier");
  if (!absent(declared) && declared !== entry.tier) fail("quarantined", "LEAGUE_TIER_CONTRADICTION", matchId);
  return entry.tier as "premium" | "professional";
}

function sideOfTeam(value: unknown): Side | null {
  if (value === 0) return "radiant";
  if (value === 1) return "dire";
  return null;
}

function readActions(detail: unknown, matchId: string): CaptainsModeAction[] {
  const raw = field(detail, "picks_bans");
  if (!Array.isArray(raw) || raw.length === 0) fail("quarantined", "PICKS_BANS_MISSING", matchId);
  const byOrder = new Map<number, CaptainsModeAction>();
  for (const turn of raw) {
    const order = field(turn, "order");
    const isPick = field(turn, "is_pick");
    const side = sideOfTeam(field(turn, "team"));
    if (!Number.isInteger(order) || (order as number) < 0 || typeof isPick !== "boolean" || side === null) {
      fail("quarantined", "CM_SEQUENCE_INVALID", matchId);
    }
    if (byOrder.has(order as number)) fail("quarantined", "CM_SEQUENCE_INVALID", matchId);
    // `heroId` se pasa tal cual: el validador de PR #49 decide si es un HeroId válido del universo.
    byOrder.set(order as number, { order: order as number, action: isPick ? "pick" : "ban", side, heroId: field(turn, "hero_id") as number });
  }
  const actions: CaptainsModeAction[] = [];
  for (let i = 0; i < byOrder.size; i += 1) {
    const action = byOrder.get(i);
    if (action === undefined) fail("quarantined", "CM_SEQUENCE_INVALID", matchId); // hueco: no se repara
    actions.push(action);
  }
  return actions;
}

function readOutcome(detail: unknown): MatchOutcome {
  const radiantWin = field(detail, "radiant_win");
  if (radiantWin === true) return { status: "known", winner: "radiant" };
  if (radiantWin === false) return { status: "known", winner: "dire" };
  return { status: "unknown" };
}

// Sólo entran partidas del parche vigente en adelante: 7.41 (id 60 en OpenDota/dotaconstants), lanzado
// el 2026-03-24. Una partida de un parche anterior no es evidencia del meta actual: se rechaza.
const MIN_PATCH_ID = 60;
const MIN_START_TIME_S = Date.parse("2026-03-24T00:00:00Z") / 1000;

function isPatchIdValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isStartTimeValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** El parche y la fecha se contrastan por separado: cualquiera de los dos que diga "antes de 7.41" rechaza.
 *  Si no hay ninguno de los dos, no se puede saber si es del meta actual: cuarentena (nunca se supone). */
function checkCurrentPatch(detail: unknown, matchId: string): void {
  const patch = field(detail, "patch");
  const startTime = field(detail, "start_time");
  const hasPatch = isPatchIdValue(patch);
  const hasStart = isStartTimeValue(startTime);
  if (hasPatch && patch < MIN_PATCH_ID) fail("rejected", "PATCH_BEFORE_CURRENT", matchId);
  if (hasStart && startTime < MIN_START_TIME_S) fail("rejected", "MATCH_BEFORE_CURRENT_PATCH", matchId);
  if (!hasPatch && !hasStart) fail("quarantined", "PATCH_UNVERIFIABLE", matchId);
}

/** Cuándo se JUGÓ la partida (`start_time` de OpenDota, segundos Unix) como ISO UTC. Sin fecha legible: nada (desconocido, nunca inventado). */
function playedAtOf(detail: unknown): { playedAt: string } | Record<string, never> {
  const startTime = field(detail, "start_time");
  if (!isStartTimeValue(startTime)) return {};
  const date = new Date(startTime * 1000);
  return Number.isFinite(date.getTime()) ? { playedAt: date.toISOString().replace(/\.\d{3}Z$/, "Z") } : {};
}

// OpenDota sólo da un id numérico de parche. Una etiqueta ("7.41e") no se deduce de él.
function readPatch(detail: unknown): PatchState {
  const patch = field(detail, "patch");
  if (typeof patch === "number" && Number.isSafeInteger(patch) && patch >= 0) return { state: "source_id_only", sourceId: String(patch) };
  return { state: "unknown" };
}

function playerSide(player: unknown): Side | null {
  const isRadiant = field(player, "isRadiant");
  if (isRadiant === true) return "radiant";
  if (isRadiant === false) return "dire";
  const slot = field(player, "player_slot");
  if (typeof slot === "number" && Number.isInteger(slot)) {
    if (slot >= 0 && slot <= 4) return "radiant";
    if (slot >= 128 && slot <= 132) return "dire";
  }
  return null; // sin `team ?? 0`: un jugador sin bando verificable no aporta posición
}

function readPositions(detail: unknown, actions: readonly CaptainsModeAction[]): PositionClaim[] {
  const players = field(detail, "players");
  if (!Array.isArray(players)) return [];
  const pickedBy = new Map<number, Side>();
  for (const action of actions) if (action.action === "pick") pickedBy.set(action.heroId, action.side);
  const bySide: Record<Side, PositionClaim[]> = { radiant: [], dire: [] };
  for (const player of players) {
    const side = playerSide(player);
    const heroId = field(player, "hero_id");
    const position = POSITIONS.find((candidate) => candidate === field(player, "position_est"));
    if (side === null || position === undefined || typeof heroId !== "number" || pickedBy.get(heroId) !== side) continue;
    bySide[side].push({ heroId, side, position, basis: "source_estimated" });
  }
  const claims: PositionClaim[] = [];
  for (const side of ["radiant", "dire"] as const) {
    const sideClaims = bySide[side];
    const ambiguous =
      new Set(sideClaims.map((claim) => claim.position)).size !== sideClaims.length ||
      new Set(sideClaims.map((claim) => claim.heroId)).size !== sideClaims.length;
    if (!ambiguous) claims.push(...sideClaims); // un bando ambiguo se descarta entero, no se adivina
  }
  return claims;
}

// ---------------------------------------------------------------------------------------------
// Certificación
// ---------------------------------------------------------------------------------------------

export function certifyProMatch(input: CertifyInput, context: CertifyContext): CertifyResult {
  try {
    return certify(input, context);
  } catch (error) {
    if (error instanceof Stop) return error.failure;
    return { status: "quarantined", code: "INVALID_INPUT", matchId: null };
  }
}

function certify(input: CertifyInput, context: CertifyContext): CertifyResult {
  const detail = input.match;
  const summary = input.summary;
  if (!isRecord(detail)) fail("quarantined", "INVALID_INPUT", null);
  if (typeof context.fetchedAt !== "string" || !ISO_UTC.test(context.fetchedAt) || !Number.isFinite(Date.parse(context.fetchedAt))) {
    fail("quarantined", "FETCHED_AT_INVALID", null);
  }

  const matchId = readMatchId(detail, summary);
  const leagueId = readLeagueId(detail, summary, matchId);
  const tier = certifyLeague(leagueId, detail, context.catalog, matchId);

  if (detail.game_mode !== CAPTAINS_MODE) fail("rejected", "GAME_MODE_NOT_CAPTAINS_MODE", matchId);
  checkCurrentPatch(detail, matchId);
  const table = context.captainsModeTable;
  if (table === null) fail("quarantined", "CM_TABLE_UNAVAILABLE", matchId);

  const actions = readActions(detail, matchId);
  const first = actions[0] as CaptainsModeAction;

  const candidate = {
    schemaVersion: 1,
    format: "captains_mode",
    provenance: {
      source: "opendota_league",
      sourceMatchId: matchId,
      fetchedAt: context.fetchedAt,
      ...playedAtOf(detail),
      // El sello que el índice exige para considerar elegible la partida: la liga se contrastó con el catálogo de OpenDota.
      leagueCertification: { leagueId, tier, verifiedAt: context.fetchedAt },
    },
    evidenceClass: "professional",
    outcome: readOutcome(detail),
    patch: readPatch(detail),
    sourceGameMode: CAPTAINS_MODE,
    positions: readPositions(detail, actions),
    firstActionSide: first.side,
    // La completitud la fija el LARGO contra la tabla, nunca la fuente: un prefijo no se declara completo.
    completeness: actions.length === table.turns.length ? "complete" : "prefix",
    actions,
  };

  const validated = validateDraftHistoryRecord(candidate, { captainsModeTable: table, heroUniverse: context.heroUniverse });
  if (!validated.ok) fail("quarantined", "RECORD_VALIDATION_FAILED", matchId, validated.rejections);

  return {
    status: "certified",
    record: validated.value,
    certification: { matchId, leagueId, tier, source: "opendota_leagues_catalog", verifiedAt: context.fetchedAt },
  };
}

// ---------------------------------------------------------------------------------------------
// Lote: una partida cuenta una sola vez
// ---------------------------------------------------------------------------------------------

export interface CertifiedMatch {
  readonly record: DraftHistoryRecord;
  readonly certification: LeagueCertification;
}

export interface CertifyBatchResult {
  readonly certified: CertifiedMatch[];
  readonly notCertified: CertifyFailure[];
  /** Repetidas con contenido idéntico: se cuentan una vez. */
  readonly duplicatesDropped: number;
  /** `matchKey` de partidas repetidas con contenido DISTINTO: se descartan enteras, no se elige una. */
  readonly conflictingDuplicates: string[];
}

export function certifyProMatches(inputs: readonly CertifyInput[], context: CertifyContext): CertifyBatchResult {
  const chosen = new Map<string, { entry: CertifiedMatch; fingerprint: string }>();
  const conflicting = new Set<string>();
  const notCertified: CertifyFailure[] = [];
  let duplicatesDropped = 0;
  for (const input of inputs) {
    const result = certifyProMatch(input, context);
    if (result.status !== "certified") {
      notCertified.push(result);
      continue;
    }
    const key = matchKey(result.record.provenance);
    const fingerprint = JSON.stringify(result);
    if (conflicting.has(key)) continue;
    const existing = chosen.get(key);
    if (existing === undefined) {
      chosen.set(key, { entry: { record: result.record, certification: result.certification }, fingerprint });
    } else if (existing.fingerprint === fingerprint) {
      duplicatesDropped += 1;
    } else {
      chosen.delete(key);
      conflicting.add(key);
    }
  }
  return {
    certified: [...chosen.values()].map(({ entry }) => entry),
    notCertified,
    duplicatesDropped,
    conflictingDuplicates: [...conflicting],
  };
}
