// V7 PR-1 (TSK-248): contrato canónico del historial de drafts. Sólo tipos y constantes -- sin
// búsqueda, recuperación, scoring ni actualizaciones en vivo; esos PRs consumen este contrato.
//
// Principios (no negociables, los hace cumplir `validator.ts`):
// - El historial profesional es EVIDENCIA, no una orden para las recomendaciones.
// - Héroes SÓLO por `HeroId` entero exacto. Nunca se sustituye un héroe por otro "del mismo rol".
// - Aliados y enemigos se mantienen separados (en el registro, por `Side`; en la observación, por
//   campo). Una coincidencia parcial entre una observación y un registro es legítima.
// - "Desconocido" se escribe explícito (`null`, `{ state: "unknown" }`, `{ status: "unknown" }`,
//   `[]`) y nunca se rellena: ni posiciones, ni bans, ni picks enemigos ocultos.
// - Esquema CERRADO: sin `account_id`, `raw_json` ni dato personal. Un campo no declarado se rechaza.
//
// Vive junto a (no dentro de) `draft/` y `draft-protocol/`: reutiliza `isValidHeroId` y la forma de
// la tabla de Captain's Mode, pero no modifica ninguno de los dos.

import type { HeroId } from "../draft-protocol/types";

export type { HeroId };

export const DRAFT_HISTORY_SCHEMA_VERSION = 1;
export type DraftHistorySchemaVersion = typeof DRAFT_HISTORY_SCHEMA_VERSION;

export type Side = "radiant" | "dire";

// Los mismos nombres que `RulesetId` del kernel ("dota2/captains-mode", "dota2/ranked-all-pick"),
// más `unknown`: un formato que la fuente no declaró es un estado legítimo, igual que en el
// reductor del motor -- el registro sigue siendo evidencia, sólo sin pretensión de secuencia.
export type DraftFormatKind = "captains_mode" | "ranked_all_pick" | "unknown";

// ---------------------------------------------------------------------------------------------
// Procedencia y parche
// ---------------------------------------------------------------------------------------------

// Unión cerrada: una fuente nueva exige subir `schemaVersion`, no colarse como string libre.
export type ProvenanceSource = "opendota_match" | "opendota_league" | "manual_curated";

export interface Provenance {
  source: ProvenanceSource;
  /**
   * Identidad dentro del espacio de la fuente (`matchKey` en `match-id.ts`). `opendota_*`: el
   * `match_id` canónico de Valve (entero decimal positivo y seguro, sin ceros a la izquierda ni
   * signo). `manual_curated`: un id propio, en un espacio APARTE y que empieza con letra, así que
   * nunca puede confundirse con un `match_id`. Nunca un id de cuenta.
   */
  sourceMatchId: string;
  /** ISO-8601 UTC (`...Z`). `null` = la fuente no dijo cuándo se obtuvo. */
  fetchedAt: string | null;
}

// El parche tiene TRES estados porque el repo ya tropezó con eso (SPEC §16.4: el corpus guarda
// `patch = "60"`, un id de la fuente, mientras el motor compara contra la etiqueta "7.41e").
// Un id de la fuente NO es comparable con una etiqueta: no se convierte ni se adivina.
export type PatchState =
  | { state: "exact"; label: string }
  | { state: "source_id_only"; sourceId: string }
  | { state: "unknown" };

// Clase de evidencia: qué tipo de partida es. Es un campo APARTE del formato y de la fuente -- un
// draft profesional y uno de Ranked pueden compartir formato, y una fuente curada a mano puede
// traer cualquiera de los dos. Nunca se infiere del `game_mode`.
export type EvidenceClass = "professional" | "ranked";

// Resultado de la partida. `unknown` NO es "perdió": la fuente no lo dijo (p. ej. un prefijo de
// draft, o una partida sin terminar).
export type MatchOutcome = { status: "unknown" } | { status: "known"; winner: Side };

// ---------------------------------------------------------------------------------------------
// Posiciones (opcionales, nunca fabricadas)
// ---------------------------------------------------------------------------------------------

export type PositionNumber = 1 | 2 | 3 | 4 | 5;

// No existe un `basis` "inferido por nosotros": si la fuente no reportó ni estimó la posición, la
// lista queda vacía. `roles[]` de OpenDota NO son posiciones (invariantes.md) y no entran acá.
export type PositionBasis = "source_reported" | "source_estimated";

export interface PositionClaim {
  heroId: HeroId;
  side: Side;
  position: PositionNumber;
  basis: PositionBasis;
}

// ---------------------------------------------------------------------------------------------
// Bans
// ---------------------------------------------------------------------------------------------

// `unknown` = los bans no se leyeron/no se confirmaron como visibles. NO es "cero bans":
// `confirmed_visible` con `heroIds: []` es "se vio y no hubo ninguno" (live-contract V4).
export type BanKnowledge =
  | { status: "unknown" }
  | { status: "confirmed_visible"; heroIds: HeroId[] };

// ---------------------------------------------------------------------------------------------
// Registro canónico
// ---------------------------------------------------------------------------------------------

interface DraftHistoryRecordBase {
  schemaVersion: DraftHistorySchemaVersion;
  provenance: Provenance;
  evidenceClass: EvidenceClass;
  outcome: MatchOutcome;
  patch: PatchState;
  /** `game_mode` crudo de la fuente (informativo). `null` = la fuente no lo dio. */
  sourceGameMode: number | null;
  /** `[]` = posiciones desconocidas. Cada claim apunta a un héroe PICKEADO por ese `side`. */
  positions: PositionClaim[];
}

export interface CaptainsModeAction {
  /** Índice 0-based en la secuencia; debe ser contiguo desde 0. */
  order: number;
  action: "ban" | "pick";
  side: Side;
  heroId: HeroId;
}

// La secuencia se valida contra la tabla documentada (`draft/draft-format-turns.json`, inyectada
// al validador). Su largo lo fija esa tabla, no este tipo: `prefix` es una secuencia que la fuente
// entregó incompleta (se conserva lo observado, sin inventar el resto).
export interface CaptainsModeRecord extends DraftHistoryRecordBase {
  format: "captains_mode";
  /** Quién ejecuta la acción 0 -- ancla las posiciones relativas "first"/"second" de la tabla. */
  firstActionSide: Side;
  completeness: "complete" | "prefix";
  actions: CaptainsModeAction[];
}

// El orden del array `heroIds` NO significa orden de selección: el validador lo normaliza a
// ascendente justamente para que nadie lo lea como tal.
export interface UnorderedSidePicks {
  heroIds: HeroId[];
  /** `true` = la fuente entregó el roster completo (exactamente 5). `false` = lo que se observó. */
  complete: boolean;
}

// Ranked All Pick (picks simultáneos y ocultos hasta el reveal) y `unknown`: conjuntos observados,
// sin orden individual ni turnos.
export interface UnorderedDraftRecord extends DraftHistoryRecordBase {
  format: "ranked_all_pick" | "unknown";
  picks: Record<Side, UnorderedSidePicks>;
  bans: BanKnowledge;
}

export type DraftHistoryRecord = CaptainsModeRecord | UnorderedDraftRecord;

// ---------------------------------------------------------------------------------------------
// Contrato de observación (lado consulta, para PRs futuros)
// ---------------------------------------------------------------------------------------------

// Lo que un draft en curso puede afirmar con certeza. (No es el `DraftObservation` de `live/`: aquél
// es UN hecho de captura -- un pick o ban visto --; éste es la consulta completa contra el historial.) No hay campo de posiciones ni de enemigos
// ocultos a propósito: no existe nada que fabricar. `revealedEnemyHeroIds` son sólo los enemigos
// ya revelados -- una lista corta NO significa "el rival aún no eligió".
export interface DraftHistoryObservation {
  schemaVersion: DraftHistorySchemaVersion;
  /** Lado del observador: mapea `allyHeroIds` al `Side` de un registro. */
  perspective: Side;
  format: DraftFormatKind;
  patch: PatchState;
  allyHeroIds: HeroId[];
  revealedEnemyHeroIds: HeroId[];
  bans: BanKnowledge;
}

// ---------------------------------------------------------------------------------------------
// Rechazos
// ---------------------------------------------------------------------------------------------

// Un motivo lleva el CÓDIGO y la RUTA, nunca el valor recibido: un `account_id` colado en un
// registro no debe terminar en un log, un ticket ni un mensaje de error (security.md).
export type RejectionCode =
  | "NOT_AN_OBJECT"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "MISSING_FIELD"
  | "INVALID_FIELD"
  | "UNKNOWN_FIELD"
  | "FORBIDDEN_FIELD"
  | "INVALID_HERO_ID"
  | "HERO_OUT_OF_UNIVERSE"
  | "DUPLICATE_HERO"
  | "TOO_MANY_ENTRIES"
  | "INVALID_PROVENANCE"
  | "INVALID_PATCH"
  | "BAN_PICK_OVERLAP"
  | "ENEMY_ALLY_OVERLAP"
  | "COMPLETENESS_MISMATCH"
  | "EVIDENCE_CLASS_MISMATCH"
  | "CM_TABLE_UNAVAILABLE"
  | "CM_ORDER_INVALID"
  | "CM_SEQUENCE_MISMATCH"
  | "POSITION_UNKNOWN_HERO"
  | "POSITION_CONFLICT"
  | "DUPLICATE_RECORD";

export interface Rejection {
  code: RejectionCode;
  /** Ruta JSON-ish desde la raíz, p. ej. `$.actions[3].side`. Sólo nombres de campo e índices. */
  path: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; rejections: Rejection[] };

// Cotas defensivas contra entrada hostil/enorme -- NO son reglas del juego.
export const MAX_PICKS_PER_SIDE = 5;
export const MAX_BANS = 32;
export const MAX_REJECTIONS_PER_RESULT = 32;
