// Fase 3D · prototipo aislado. Presentación pura: NO calcula rankings, scores ni razones; solo decide cómo dibujar sin duplicar.
//
// Problema: una columna del tablero trae DOS listas (`top` y `poolTop`) y un mismo héroe puede estar en las dos. Dibujar las dos
// listas tal cual repite tarjetas (el mismo héroe dos veces en la misma columna). Dibujar solo `top` pierde a los héroes de tu pool
// que están en `poolTop` pero no en `top` (`top` ≤ 5, `poolTop` ≤ 3 y filtra solo IN_POOL).
//
// Hechos verificados en el motor (apps/engine/src/coach/current-human-decision.ts:243-245, team-coach-board.ts:200-203, 384-385):
//   · `rank` de `top`     = posición en la lista general (index + 1, ANTES de mover al primario al frente).
//   · `rank` de `poolTop` = posición DENTRO DEL POOL (se numera después de filtrar IN_POOL) -> un mismo héroe puede ser #3 en `top` y #1 en `poolTop`.
//   · `risks` solo viene en el primer elemento de CADA lista (index === 0) -> la copia de `top` y la de `poolTop` pueden diferir.
//   · `isPrimary` solo se aplica a `top`; en `poolTop` es siempre false.
// Por eso la fusión conserva los DOS números por separado y nunca reutiliza uno como si fuera el otro.

import type { TeamCoachCandidate, TeamCoachColumn } from "@/features/team-coach/types";

export interface ColumnCandidate {
  /** Copia canónica del candidato: la de `top` si existe (única con `isPrimary` real); si no, la de `poolTop`. `risks` se completa con el de la otra copia si esta no lo trae. */
  candidate: TeamCoachCandidate;
  /** `rank` tal cual lo entregó `top`. null = el héroe NO está en `top` (no existe un puesto general). */
  generalRank: number | null;
  /** `rank` tal cual lo entregó `poolTop` (puesto dentro de tu pool). null = no está en `poolTop`. */
  poolRank: number | null;
}

export interface MergedColumn {
  /** Exactamente `top`, en el orden en que llegó (primario al frente si el motor lo puso así). */
  general: ColumnCandidate[];
  /** Exactamente los de `poolTop` que no están en `top`, en el orden de `poolTop`. Nunca se mezclan dentro de `general`. */
  poolOnly: ColumnCandidate[];
}

function withBorrowedRisks(base: TeamCoachCandidate, other: TeamCoachCandidate | undefined): TeamCoachCandidate {
  const baseHasRisks = (base.risks?.length ?? 0) > 0;
  if (baseHasRisks || other === undefined || (other.risks?.length ?? 0) === 0) return base;
  return { ...base, risks: other.risks };
}

export function mergeColumnCandidates(column: Pick<TeamCoachColumn, "top" | "poolTop">): MergedColumn {
  const poolList = column.poolTop ?? [];
  const poolById = new Map(poolList.map((candidate) => [candidate.heroId, candidate]));
  const topIds = new Set(column.top.map((candidate) => candidate.heroId));

  const general = column.top.map((candidate): ColumnCandidate => {
    const pool = poolById.get(candidate.heroId);
    return { candidate: withBorrowedRisks(candidate, pool), generalRank: candidate.rank, poolRank: pool === undefined ? null : pool.rank };
  });
  const poolOnly = poolList
    .filter((candidate) => !topIds.has(candidate.heroId))
    .map((candidate): ColumnCandidate => ({ candidate, generalRank: null, poolRank: candidate.rank }));

  return { general, poolOnly };
}
