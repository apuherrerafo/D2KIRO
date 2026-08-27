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
  /** Posición que el usuario jugará (1 carry ... 5 hard support). */
  playerPosition?: 1 | 2 | 3 | 4 | 5;
  personalBanList: HeroId[];
  patch: string;
}

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
  | { type: "ban_phase_complete"; resolvedBans: HeroId[] }
  | {
      type: "blind_round";
      round: 1 | 2 | 3;
      timerRemainingMs: number;
      pendingUserPicks: HeroId[];
      conflictBans: HeroId[];
      conflictCount: number;
    }
  | {
      type: "round_revealed";
      round: 1 | 2 | 3;
      userPicks: HeroId[];
      botPicks: HeroId[];
      conflictBans: HeroId[];
    }
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
