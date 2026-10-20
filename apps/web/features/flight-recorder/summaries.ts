import type { CurrentDecisionOutput } from "@/features/random-draft-simulator/coach-client";
import type { ProtocolSnapshot } from "@/features/random-draft-simulator/protocol-client";
import type { DraftConfig } from "@/features/random-draft-simulator/types";
import type { TeamCoachBoardData } from "@/features/team-coach/types";
import { scrubPerspectiveSlots, shortSessionRef } from "./sanitize";

// Resúmenes por lista blanca: se graba lo que sirve para diagnosticar, nada más. Los candidatos se copian ENTEROS
// (heroId, rank, score, reasons/badges/rationale ... y cualquier campo extra que el motor agregue mañana).

/** Configuración de la partida. Los nombres de los integrantes del equipo no se graban: sólo su id y su posición. */
export function summarizeConfig(config: DraftConfig, mode: string): Record<string, unknown> {
  return {
    mode,
    draftSeed: config.draftSeed,
    userSide: config.userSide,
    playerPosition: config.playerPosition,
    partySize: config.partySize,
    partyPositions: config.partyPositions ?? null,
    personalBanList: config.personalBanList,
    patch: config.patch,
    teamGroupId: config.teamGroupId ?? null,
    teamAssignment: config.teamAssignment ?? null,
  };
}

/** Qué ve este jugador del draft. Un pick enemigo oculto se cuenta, jamás se nombra. */
export function summarizeSnapshot(snapshot: ProtocolSnapshot): Record<string, unknown> {
  const { view } = snapshot;
  return {
    session: shortSessionRef(view.sessionId),
    status: view.status,
    viewerSide: view.viewerSide,
    phase: view.rankedAp?.phase ?? null,
    banned: view.bannedHeroes,
    ownPicks: scrubPerspectiveSlots(view.ownPicks),
    enemyPicks: scrubPerspectiveSlots(view.enemyPicks),
    enemyHiddenCount: view.enemyPicks.filter((slot) => slot.visibility === "HIDDEN").length,
    ownAssignedPositions: snapshot.ownAssignedPositions,
    humanActionability: snapshot.humanActionability ?? null,
    openOwnSlots: snapshot.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === view.viewerSide).length,
    canYield: snapshot.canYield,
  };
}

/** El tablero tal como lo devolvió el motor: una columna por posición con su `top` completo. */
export function summarizeBoard(board: TeamCoachBoardData): Record<string, unknown> {
  return {
    stateIdentity: board.stateIdentity,
    currentDecision: board.currentDecision,
    unboundOwnHeroIds: board.unboundOwnHeroIds,
    positions: board.positions.map((column) => ({
      position: column.position,
      state: column.state,
      eligibleNow: column.eligibleNow,
      alreadyFilled: column.alreadyFilled,
      filledHeroId: column.filledHeroId,
      primaryHeroId: column.primaryHeroId,
      stateIdentity: column.stateIdentity,
      note: column.note,
      topCount: column.top.length,
      top: column.top,
    })),
  };
}

/** La decisión V4 tal como la devolvió el motor. */
export function summarizeDecision(output: CurrentDecisionOutput): Record<string, unknown> {
  const { decision, meta } = output;
  const header = {
    stateIdentity: meta.basedOn.stateIdentity,
    evidenceVersion: meta.basedOn.evidenceVersion,
    revision: meta.revision,
    trigger: meta.trigger,
    round: meta.round,
    phase: meta.phase,
    decisionContext: meta.decisionContext,
    readiness: meta.readiness ?? null,
    roleCollisionInfeasible: output.roleCollision?.infeasible ?? false,
    kind: decision.kind,
  };
  if (decision.kind === "NO_HUMAN_ACTION") return { ...header, reason: decision.reason };
  return {
    ...header,
    actionablePositions: decision.actionablePositions,
    roundCapacity: decision.roundCapacity,
    targetPosition: decision.targetPosition,
    targetBasis: decision.targetBasis,
    targetRationale: decision.targetRationale,
    viewedPosition: decision.viewedPosition,
    personalPoolApplied: decision.personalPoolApplied,
    poolState: decision.poolState,
    poolOwner: decision.poolOwner,
    candidates: decision.candidates,
  };
}
