// apps/web/features/random-draft-simulator/types.ts
// Tipos de dominio del modo Random Draft Simulator (Ranked All Pick aleatorio).
// HeroId y TeamSide se importan desde el feature de draft existente para evitar duplicación.

import type { HeroId, TeamSide } from "@/features/draft/types";

// Re-export para que los consumidores del feature no dependan de paths internos.
export type { HeroId, TeamSide };

// ---------------------------------------------------------------------------
// Interfaces de datos
// ---------------------------------------------------------------------------

export interface PicksByRound {
  userPicks: HeroId[];
  botPicks: HeroId[];
}

/** Estado completo serializable de una Draft_Session (Req. 10.1). */
export interface DraftSessionSnapshot {
  /** 8 chars A-Z0-9 */
  draftSeed: string;
  /** Lado del usuario */
  userSide: "radiant" | "dire";
  /** 0-4 héroes */
  personalBanList: HeroId[];
  /** Hasta 20 HeroId (normalmente 16, puede ser menos si el pool es pequeño) */
  resolvedBans: HeroId[];
  /** Exactamente 3 entradas, una por ronda */
  picksByRound: [PicksByRound, PicksByRound, PicksByRound];
  /** Picks del bot pre-calculados pero aún no revelados (en la ronda activa) */
  hiddenBotPicks: HeroId[];
}

/** Configuración inicial de una Draft_Session. */
export interface DraftConfig {
  /** 8 chars A-Z0-9 */
  draftSeed: string;
  userSide: TeamSide;
  /**
   * AP Ranked Roles V1: posición PERSONAL del Player (1 carry ... 5 hard support). Requerida.
   * Identifica cuál de sus 5 roles es el suyo; nunca decide cuándo se pica ese héroe.
   */
  playerPosition: 1 | 2 | 3 | 4 | 5;
  personalBanList: HeroId[];
  patch: string;
  // R1 S7 (Blocker 2): tamaño de la party declarada al ProtocolSession -- 4 nunca es una opción
  // real (Dota no tiene cola de 4 en Ranked All Pick), el motor la rechaza con INVALID_PARTY_SIZE
  // (party-context.ts, autoridad real). Default 5 (comportamiento idéntico al de antes de esta
  // fase para cualquier config ya persistida).
  partySize: 1 | 2 | 3 | 5;
  /** Posiciones asignadas a la party del jugador (deben ser exactamente partySize). */
  partyPositions?: (1 | 2 | 3 | 4 | 5)[];
}

// ---------------------------------------------------------------------------
// Modo de sesión (MVP P0.1 -- Live Companion)
// ---------------------------------------------------------------------------

/**
 * SIMULATION: comportamiento actual, sin cambios -- el motor conduce al Enemy Bot vía auto-drive.
 * LIVE_COMPANION: sin Enemy Bot. El Player es el único observador de un draft REAL y reporta a
 * mano los bans y los picks (propios Y rivales) a medida que los ve en su cliente de Dota 2.
 * Los dos modos comparten el mismo kernel de protocolo -- nunca lo duplican (spec de la tarea).
 */
export type SessionMode = "simulation" | "live_companion";

// ---------------------------------------------------------------------------
// Fase de draft (Zustand store)
// ---------------------------------------------------------------------------

export interface DraftSummary {
  draftSeed: string;
  userSide: TeamSide;
  personalBanList: HeroId[];
  resolvedBans: HeroId[];
  picksByRound: PicksByRound[];
}

export type DraftPhase =
  | { type: "idle" }
  // Fail closed: la resolución de bans falló -> NO se entra a Round 1; se puede reintentar.
  | { type: "ban_failed"; message: string }
  | { type: "ban_phase_complete"; resolvedBans: HeroId[] }
  | {
      type: "blind_round";
      round: 1 | 2 | 3;
      /** Tiempo base que queda (ms). Al llegar a 0 NO se asigna ningún héroe: sólo empieza la penalización. */
      timerRemainingMs: number;
      timerDurationMs: number;
      /** Héroes ya sellados por el Player en este intento de la ronda. */
      pendingUserPicks: HeroId[];
      /** Asientos (0..4) que el Player debe llenar en este intento (2, 2, 1 -- o menos tras una colisión). */
      attemptSeats: number[];
      /** Asientos que siguen sin elegir. */
      pendingSeats: number[];
      /** Oro perdido por asiento (0..4), base del servidor. */
      goldPenaltyBySlot: number[];
      penaltyRatePerSecond: number;
      /** Ms transcurridos desde el vencimiento (sólo visual; el servidor es la fuente de verdad). */
      penaltyElapsedMs: number;
      conflictBans: HeroId[];
      conflictCount: number;
      /** Se incrementa en cada intento (ronda inicial y cada repick por colisión): remonta el timer visual. */
      attemptId: number;
      /** Aviso visible de colisión / rechazo (nunca un estado silencioso). */
      notice: string | null;
    }
  | {
      type: "round_revealed";
      round: 1 | 2 | 3;
      userPicks: HeroId[];
      botPicks: HeroId[];
      conflictBans: HeroId[];
    }
  // LIVE_COMPANION -- el Player reporta a mano los bans observados en el draft REAL antes de
  // que el kernel abra la Ronda 1. Ningún timer, ninguna resolución simulada: exactamente los
  // héroes que el Player escribió, ni uno más.
  | { type: "live_ban_entry"; observedBans: HeroId[]; error: string | null }
  // LIVE_COMPANION -- esperando que el Player reporte el próximo hecho observado (un pick propio
  // o rival de los asientos hoy abiertos). `openSlots` viene tal cual de legalActions del motor
  // (ya incluye AMBOS lados en un adapterKind "manual") -- esta pantalla nunca decide por su
  // cuenta qué asiento está abierto.
  | {
      type: "live_pending";
      round: 1 | 2 | 3;
      openSlots: { side: TeamSide; slotIndex: number }[];
      notice: string | null;
    }
  // Colisión de 3er orden dentro de la misma ronda: el kernel exige una autoridad externa
  // (APPLY_AUTHORITATIVE_COLLISION_RESOLUTION) que este MVP todavía no expone -- caso raro, fuera
  // de alcance de P0.1 (documentado). Nunca queda en silencio: se explica y no se puede avanzar.
  | { type: "live_collision_unsupported" }
  | { type: "complete"; summary: DraftSummary };

// ---------------------------------------------------------------------------
// Resultado de validación (Req. 10.4)
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; value: DraftSessionSnapshot }
  | { ok: false; field: string; reason: string };

// ---------------------------------------------------------------------------
// Constantes de validación (interna — el patrón público vive en constants.ts)
// ---------------------------------------------------------------------------

const SEED_REGEX = /^[A-Z0-9]{8}$/;
const MAX_PERSONAL_BAN_LIST = 4;
const MAX_RESOLVED_BANS = 20;
const MAX_HIDDEN_BOT_PICKS = 10;
const PICKS_BY_ROUND_LENGTH = 3;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isHeroIdArray(value: unknown): value is HeroId[] {
  return Array.isArray(value) && value.every(isPositiveInteger);
}

function isPicksByRound(value: unknown): value is PicksByRound {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return isHeroIdArray(obj["userPicks"]) && isHeroIdArray(obj["botPicks"]);
}

// ---------------------------------------------------------------------------
// validateDraftSessionSnapshot (Req. 10.1, 10.4)
// ---------------------------------------------------------------------------

/**
 * Valida un objeto desconocido contra el contrato de DraftSessionSnapshot.
 * Retorna el primer campo que falla la validación, identificándolo por nombre.
 * Si todos los campos son válidos, retorna { ok: true, value }.
 */
export function validateDraftSessionSnapshot(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, field: "root", reason: "El valor no es un objeto" };
  }

  const obj = raw as Record<string, unknown>;

  // draftSeed: string de exactamente 8 chars A-Z0-9
  if (typeof obj["draftSeed"] !== "string") {
    return { ok: false, field: "draftSeed", reason: "Debe ser un string" };
  }
  if (!SEED_REGEX.test(obj["draftSeed"])) {
    return { ok: false, field: "draftSeed", reason: "Debe tener exactamente 8 caracteres alfanuméricos en mayúscula (A-Z0-9)" };
  }

  // userSide: "radiant" | "dire"
  if (obj["userSide"] !== "radiant" && obj["userSide"] !== "dire") {
    return { ok: false, field: "userSide", reason: 'Debe ser "radiant" o "dire"' };
  }

  // personalBanList: HeroId[], 0-4 elementos
  if (!isHeroIdArray(obj["personalBanList"])) {
    return { ok: false, field: "personalBanList", reason: "Debe ser un array de enteros positivos" };
  }
  if (obj["personalBanList"].length > MAX_PERSONAL_BAN_LIST) {
    return { ok: false, field: "personalBanList", reason: `No puede tener más de ${MAX_PERSONAL_BAN_LIST} elementos` };
  }

  // resolvedBans: HeroId[], hasta 20 elementos
  if (!isHeroIdArray(obj["resolvedBans"])) {
    return { ok: false, field: "resolvedBans", reason: "Debe ser un array de enteros positivos" };
  }
  if (obj["resolvedBans"].length > MAX_RESOLVED_BANS) {
    return { ok: false, field: "resolvedBans", reason: `No puede tener más de ${MAX_RESOLVED_BANS} elementos` };
  }

  // picksByRound: exactamente 3 entradas PicksByRound
  if (!Array.isArray(obj["picksByRound"])) {
    return { ok: false, field: "picksByRound", reason: "Debe ser un array" };
  }
  if (obj["picksByRound"].length !== PICKS_BY_ROUND_LENGTH) {
    return { ok: false, field: "picksByRound", reason: `Debe tener exactamente ${PICKS_BY_ROUND_LENGTH} entradas` };
  }
  for (let i = 0; i < PICKS_BY_ROUND_LENGTH; i++) {
    if (!isPicksByRound(obj["picksByRound"][i])) {
      return {
        ok: false,
        field: `picksByRound[${i}]`,
        reason: "Cada entrada debe tener userPicks y botPicks como arrays de enteros positivos",
      };
    }
  }

  // hiddenBotPicks: HeroId[], hasta 10 elementos
  if (!isHeroIdArray(obj["hiddenBotPicks"])) {
    return { ok: false, field: "hiddenBotPicks", reason: "Debe ser un array de enteros positivos" };
  }
  if (obj["hiddenBotPicks"].length > MAX_HIDDEN_BOT_PICKS) {
    return { ok: false, field: "hiddenBotPicks", reason: `No puede tener más de ${MAX_HIDDEN_BOT_PICKS} elementos` };
  }

  const value: DraftSessionSnapshot = {
    draftSeed: obj["draftSeed"],
    userSide: obj["userSide"],
    personalBanList: obj["personalBanList"],
    resolvedBans: obj["resolvedBans"],
    picksByRound: obj["picksByRound"] as [PicksByRound, PicksByRound, PicksByRound],
    hiddenBotPicks: obj["hiddenBotPicks"],
  };

  return { ok: true, value };
}
