// Fase 4B · Live Draft en Canonical Light. Decisiones de PRESENTACIÓN (puras): qué columnas se ven, cómo se llama la posición propia y qué se calla.
// Todo sale de campos reales del tablero y del estado de captura que entrega el motor; nada se calcula, se infiere ni se promueve.
// El tablero se dibuja con el MISMO `SimulatorLightBoard` que el Simulador: aquí solo se decide qué se le entrega.

import { teamPositionName } from "@/features/team-coach/constants";
import type { LiveLocalPlayer, LiveTeamContext, TeamCoachBoardData, TeamPosition } from "@/features/team-coach/types";

export type LiveLightMode = "solo" | "party5";

/** `undeclared` = el jugador no dijo cuál es su posición · `declared` = la dijo pero el motor no ligó su héroe · `confirmed` = el motor ligó su héroe a esa posición. */
export type LiveSeat = "undeclared" | "declared" | "confirmed";

export type LiveLightView =
  /** Solo sin posición declarada: no hay columna que mostrar; se pide Pos 1–5 por el flujo Live existente. */
  | { kind: "pick-seat" }
  /** Solo sin posición declarada y el draft ya terminó: no hay pick que hacer, así que tampoco se pide posición (solo se avisa que terminó). */
  | { kind: "ended-without-seat" }
  /** El jugador declaró una posición pero el motor no entregó esa columna (no se inventa otra). */
  | { kind: "missing-column"; position: TeamPosition }
  | {
      kind: "board";
      mode: LiveLightMode;
      /** Tablero con SOLO las columnas visibles. Las columnas, candidatos y razones son las del motor, verbatim. */
      board: TeamCoachBoardData;
      humanPosition: TeamPosition | null;
      seat: LiveSeat;
      /** Solo: la decisión del equipo apunta a una posición que no es la tuya. Se dice como dato del equipo; jamás como «ELIGE AHORA» tuyo. */
      priorityElsewhere: TeamPosition | null;
    };

const POSITIONS: readonly TeamPosition[] = [1, 2, 3, 4, 5];

/**
 * Party 5 existe cuando el MOTOR confirma un preset aplicado (`teamGroupId` + al menos un pool activo): es el mismo criterio con que el panel de preset
 * dice «Party 5: <nombre>». El motor rechaza el preset si las posiciones de los compañeros no están confirmadas, así que un preset aplicado ya implica
 * que las cinco posiciones del equipo son conocidas. Sin eso, Live es Solo: jamás se supone un equipo.
 */
export function liveModeOf(teamContext: LiveTeamContext | undefined): LiveLightMode {
  if (teamContext === undefined || teamContext.teamGroupId === null) return "solo";
  const active = POSITIONS.some((position) => teamContext.positions[String(position) as keyof LiveTeamContext["positions"]] === true);
  if (!active) return "solo";
  return "party5";
}

export function liveSeatOf(localPlayer: LiveLocalPlayer | undefined): LiveSeat {
  if (localPlayer === undefined || localPlayer.position === null) return "undeclared";
  if (localPlayer.bound) return "confirmed";
  return "declared";
}

/** Con el draft terminado queda la última lectura SOLO como referencia: ni «ELIGE AHORA» ni decisión del equipo (no hay pick que hacer). */
export function asReference(board: TeamCoachBoardData): TeamCoachBoardData {
  return { ...board, currentDecision: { ...board.currentDecision, recommendedPosition: null, recommendedHeroId: null, targetBasis: null, reason: "" } };
}

export interface LiveLightInput {
  board: TeamCoachBoardData;
  localPlayer: LiveLocalPlayer | undefined;
  teamContext: LiveTeamContext | undefined;
  draftEnded: boolean;
}

export function liveLightViewOf({ board, localPlayer, teamContext, draftEnded }: LiveLightInput): LiveLightView {
  const mode = liveModeOf(teamContext);
  const declared = localPlayer?.position ?? null;
  const seat = liveSeatOf(localPlayer);
  const source = draftEnded ? asReference(board) : board;
  if (mode === "party5") {
    return { kind: "board", mode, board: source, humanPosition: declared, seat, priorityElsewhere: null };
  }
  if (declared === null && draftEnded) return { kind: "ended-without-seat" };
  if (declared === null) return { kind: "pick-seat" };
  const mine = source.positions.filter((column) => column.position === declared);
  if (mine.length === 0) return { kind: "missing-column", position: declared };
  const decided = source.currentDecision.recommendedPosition;
  const elsewhere = decided !== null && decided !== declared ? decided : null;
  return { kind: "board", mode, board: { ...source, positions: mine }, humanPosition: declared, seat, priorityElsewhere: elsewhere };
}

const SEAT_WORD: Record<LiveSeat, string> = { undeclared: "sin declarar", declared: "declarada, sin confirmar", confirmed: "confirmada" };

/** Línea bajo el título: modo + posición propia (declarada ≠ confirmada). */
export function liveHeadlineOf(mode: LiveLightMode, humanPosition: TeamPosition | null, seat: LiveSeat): string {
  const lead = mode === "party5" ? "Party 5 · Pos 1 a Pos 5" : "Solo";
  if (humanPosition === null) return `${lead} · Tu posición: ${SEAT_WORD.undeclared}`;
  return `${lead} · Tú: ${teamPositionName(humanPosition)} (${SEAT_WORD[seat]})`;
}

export function mineRelationOf(seat: LiveSeat): "mine" | "mine-unconfirmed" {
  if (seat === "confirmed") return "mine";
  return "mine-unconfirmed";
}

export const LIVE_FOOT_NOTE = "Abrir el análisis no elige el héroe ni envía nada a Dota. El pick lo haces tú dentro de Dota.";
export const LIVE_EMPTY_COLUMN_COPY = "Sin recomendaciones disponibles con la información actual. Cuando Dota informe más del draft, esta columna se recalcula sola.";
export const LIVE_BLOCKED_COPY = "Sin recomendaciones por ahora: la captura del draft está incompleta y D2KIRO no recomienda sobre un draft a medias. En cuanto Dota informe lo que falta, el tablero aparece solo.";
export const LIVE_PICK_SEAT_COPY = "Elige tu posición para ver tu columna. Se guarda en tu draft en vivo y D2KIRO no supone cuál eres.";
