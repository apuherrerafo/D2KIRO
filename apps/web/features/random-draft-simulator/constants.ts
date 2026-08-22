// apps/web/features/random-draft-simulator/constants.ts
// Constantes del feature random-draft-simulator.

// ---------------------------------------------------------------------------
// Seed pattern
// ---------------------------------------------------------------------------

/** Patrón de validación para draftSeed: exactamente 8 caracteres A-Z0-9. */
export const SEED_PATTERN = /^[A-Z0-9]{8}$/;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Clave de localStorage para la configuración persistida del usuario. */
export const STORAGE_KEY = "dota2coach.random-draft.config";

// ---------------------------------------------------------------------------
// Blind Round specs
// ---------------------------------------------------------------------------

export interface BlindRoundSpec {
  round: 1 | 2 | 3;
  picksPerTeam: 1 | 2;
  timerMs: number;
}

/**
 * Distribución de picks por ronda de Ranked All Pick (7.35d–7.37):
 * - Ronda 1: 2 picks por equipo, 25 s
 * - Ronda 2: 2 picks por equipo, 25 s
 * - Ronda 3: 1 pick por equipo, 20 s
 */
export const BLIND_ROUND_SPECS: BlindRoundSpec[] = [
  { round: 1, picksPerTeam: 2, timerMs: 25000 },
  { round: 2, picksPerTeam: 2, timerMs: 25000 },
  { round: 3, picksPerTeam: 1, timerMs: 20000 },
];
