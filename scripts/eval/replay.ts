// Fase 9.0, costura S15 — reconstruye casos de evaluación desde una secuencia de turnos de
// draft profesional. Función PURA: sin I/O, sin reloj, sin red. La lee un runner (TSK-200) que
// sí abre pro-drafts.sqlite en readonly; este módulo nunca la toca.
//
// Contrato (SPEC.md §15.4.2):
//   - `state` es el estado ANTES del turno `turnIndex` — prefijo EXACTO `[0, turnIndex)`.
//     Ningún turno >= turnIndex puede filtrarse (única fuga posible; se prueba explícitamente).
//   - `state.localSide` = el equipo que actúa en `turnIndex`, para que observedDraftFacts()
//     devuelva ownPicks/revealedEnemyPicks correctos sin tocar el motor.
//   - 9.0 sólo emite ReplayCase para los turnos `isPick` (los bans alimentan state.banned pero
//     no se predicen — el motor no recomienda bans con el flag apagado).
//   - Draft con shape inválido -> se descarta con motivo, nunca se repara.

import { createIdleDraftState, type DraftState, type HeroId } from "../../apps/engine/src/draft/reducer";
import { deriveDecisionContext } from "../../apps/engine/src/drafter/decision-context";
import type { BuildReplayResult, ProDraftTurn, ReplayCase, ReplayMeta } from "./types";

const TURNS_PER_DRAFT = 24;

function sideOf(team: 0 | 1): "radiant" | "dire" {
  return team === 0 ? "radiant" : "dire";
}

/**
 * SPEC §16.4 — el `patchOverride` para el backtest: la moda de los `patch` no vacíos de
 * `hero_patch_stats` (hoy `"7.41e"`). El corpus tiene `patch = "60"` (id numérico de OpenDota)
 * que nunca matchea, dejando `patch_meta` 100% null. Devuelve `undefined` si no hay ningún patch
 * no vacío (entonces no se fuerza nada).
 */
export function dominantPatch(patchStats: Record<number, { patch: string }[]>): string | undefined {
  const counts = new Map<string, number>();
  for (const rows of Object.values(patchStats)) {
    for (const r of rows) {
      if (r.patch && r.patch.trim() !== "") counts.set(r.patch, (counts.get(r.patch) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [p, n] of counts) {
    if (n > bestN) {
      best = p;
      bestN = n;
    }
  }
  return best;
}

/** Valida la forma de un draft. Devuelve el motivo si es inválido, o null si está bien. */
function shapeError(turns: ProDraftTurn[]): string | null {
  if (turns.length !== TURNS_PER_DRAFT) {
    return `se esperaban ${TURNS_PER_DRAFT} turnos, llegaron ${turns.length}`;
  }
  const orders = new Set<number>();
  const pickedHeroes = new Set<HeroId>();
  for (const t of turns) {
    if (!Number.isInteger(t.order) || t.order < 0 || t.order > TURNS_PER_DRAFT - 1) {
      return `draft_order fuera de rango: ${t.order}`;
    }
    if (orders.has(t.order)) return `draft_order duplicado: ${t.order}`;
    orders.add(t.order);
    if (t.team !== 0 && t.team !== 1) return `team fuera de {0,1}: ${String(t.team)}`;
    if (!Number.isInteger(t.hero) || t.hero <= 0) return `hero_id inválido: ${String(t.hero)}`;
    if (t.isPick) {
      if (pickedHeroes.has(t.hero)) return `héroe pickeado dos veces: ${t.hero}`;
      pickedHeroes.add(t.hero);
    }
  }
  return null;
}

/**
 * Reconstruye el `DraftState` justo antes del turno `upTo` a partir del prefijo `[0, upTo)`.
 * `sortedTurns` debe venir ordenado por `order` ascendente.
 */
function stateBefore(sortedTurns: ProDraftTurn[], upTo: number, meta: ReplayMeta, actingTeam: 0 | 1): DraftState {
  const state = createIdleDraftState(meta.matchId);
  state.format = "captains_mode";
  state.phase = "active";
  state.patch = meta.patchOverride ?? meta.patch;
  state.localSide = sideOf(actingTeam);
  state.lastSeq = upTo;

  for (let i = 0; i < upTo; i++) {
    const t = sortedTurns[i]!;
    if (t.isPick) {
      state.picks[sideOf(t.team)].push(t.hero);
    } else {
      state.banned.push(t.hero);
    }
  }
  return state;
}

export function buildReplayCases(turns: ProDraftTurn[], meta: ReplayMeta): BuildReplayResult {
  const err = shapeError(turns);
  if (err !== null) {
    return { cases: [], skipped: [{ matchId: meta.matchId, reason: err }] };
  }

  const sorted = [...turns].sort((a, b) => a.order - b.order);
  const cases: ReplayCase[] = [];

  for (let idx = 0; idx < sorted.length; idx++) {
    const turn = sorted[idx]!;
    if (!turn.isPick) continue; // 9.0: sólo se predicen picks

    const state = stateBefore(sorted, idx, meta, turn.team);

    // teamOpening se deriva del estado, no de un flag externo: es "opening" sólo cuando ninguno
    // de los dos equipos tiene un pick en el tablero todavía. Así el corpus produce los 4
    // buckets de decisionContext (team_opening / blind_second_pick / response_pick / closing_pick)
    // en vez de colapsar los primeros picks en "blind".
    const noPicksYet = state.picks.radiant.length === 0 && state.picks.dire.length === 0;
    const decisionContext = deriveDecisionContext(state, noPicksYet);

    cases.push({
      matchId: meta.matchId,
      leagueId: meta.leagueId,
      tier: meta.tier,
      turnIndex: idx,
      state,
      side: sideOf(turn.team),
      actualHero: turn.hero,
      action: "pick",
      decisionContext,
    });
  }

  return { cases, skipped: [] };
}
