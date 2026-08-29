// Fase 9.0, costura S15 — contratos del replay de drafts profesionales.
// Ninguna prueba de Fase 9 abre pro-drafts.sqlite: estos tipos se llenan con fixtures inline.

import type { DraftState, HeroId } from "../../apps/engine/src/draft/reducer";
import type { DraftDecisionContext } from "../../apps/engine/src/drafter/decision-context";

/** Un turno de `pro_draft_turns` (schema: draft_order 0..23, is_pick 0|1, team 0|1). */
export interface ProDraftTurn {
  order: number;
  isPick: boolean;
  hero: HeroId;
  /** 0 = Radiant, 1 = Dire (convención de OpenDota / `pro_draft_slots.team`). */
  team: 0 | 1;
}

export interface ReplayMeta {
  matchId: string;
  leagueId: number;
  tier: "premium" | "professional" | "unknown";
  /** El parche del draft. Hoy el corpus es mono-parche ("60"); ver SPEC §15.1 C3. */
  patch: string;
}

/** Un caso de evaluación: el estado ANTES de un pick profesional + lo que el equipo eligió. */
export interface ReplayCase {
  matchId: string;
  leagueId: number;
  tier: ReplayMeta["tier"];
  /** `draft_order` del turno que se está prediciendo. */
  turnIndex: number;
  /** Estado del draft ANTES de aplicar el turno `turnIndex` (prefijo exacto `[0, turnIndex)`). */
  state: DraftState;
  /** Equipo que decide en este turno. Igual a `state.localSide`. */
  side: "radiant" | "dire";
  /** El héroe que el equipo profesional realmente eligió en `turnIndex`. */
  actualHero: HeroId;
  action: "pick" | "ban";
  decisionContext: DraftDecisionContext;
}

export interface BuildReplayResult {
  cases: ReplayCase[];
  /** Drafts descartados por shape inválido, con el motivo. Nunca se reparan. */
  skipped: { matchId: string; reason: string }[];
}
