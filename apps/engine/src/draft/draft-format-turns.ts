import rawTurnData from "./draft-format-turns.json";

// TSK-071 (spec §2.1, specs/draft-native-experience.md): dato curado y versionado, mismo patrón
// que hero-positions.json/capabilities.json -- NO vive en SQLite, se valida en el borde al
// cargarlo, un archivo corrupto degrada a "sin datos de turno" en vez de tirar el motor.
//
// Fuente: investigación cruzada (parche 7.41e) verificada contra Liquipedia (Game Modes, Patch
// 7.40) y Valve (Gameplay Update 6.87) -- confianza alta en la estructura de Captain's Mode
// completa (24 acciones, 6 fases, orden F/S por fase, timers 15s/30s/130s de reserva). Para All
// Pick: el conteo de bans (16) y la estructura de picks (2/2/1 en rondas ocultas con reveal) está
// confirmado, pero el algoritmo interno exacto que convierte las preferencias de ban de cada
// jugador en los 16 bans finales NO está documentado públicamente con suficiente detalle --
// `banSource` se guarda como referencia, nunca como receta para reproducirlo.
//
// Hallazgo que cambia el alcance de TSK-072: Ranked All Pick NO es "A → B → A → B" -- los picks
// de una ronda son simultáneos y ocultos hasta el reveal conjunto, con lógica de conflicto si
// ambos equipos eligen el mismo héroe. Eso es un mecanismo distinto de "wrong_turn" (que asume
// una secuencia estrictamente alternada con un único lado activo por turno) -- `pickRounds` queda
// como dato de referencia para UI/timers, pero TSK-072 NO valida wrong_turn sobre picks de All
// Pick con este archivo. Ver turn-clock.ts.

export type RelativeTeam = "first" | "second";

export interface CaptainsModeTurn {
  action: "ban" | "pick";
  team: RelativeTeam;
  standardTimeMs: number;
}

export interface CaptainsModeTurnTable {
  reserveTimeMs: number;
  turns: CaptainsModeTurn[];
}

export interface AllPickPickRound {
  picksPerTeam: number;
  durationMs: number;
}

export interface AllPickTurnData {
  banCount: number;
  banSource: string;
  pickRounds: AllPickPickRound[];
}

export interface DraftFormatTurnData {
  captainsMode: CaptainsModeTurnTable | null;
  allPick: AllPickTurnData | null;
}

const VALID_ACTIONS = new Set(["ban", "pick"]);
const VALID_TEAMS = new Set(["first", "second"]);

function isValidTurn(value: unknown): value is CaptainsModeTurn {
  if (typeof value !== "object" || value === null) return false;
  const turn = value as Record<string, unknown>;
  return (
    VALID_ACTIONS.has(turn.action as string) &&
    VALID_TEAMS.has(turn.team as string) &&
    Number.isInteger(turn.standardTimeMs) &&
    (turn.standardTimeMs as number) > 0
  );
}

// Un archivo corrupto (fase malformada, tiempo negativo, un turno con team/action inválido)
// degrada a "sin tabla de Captain's Mode" -- nunca tira el motor. Exportada por separado para
// probarla con fixtures sintéticos, nunca contra el archivo real (costura S10, mismo criterio que
// `parseHeroPositions`: el archivo real se puede regenerar por parche, un test atado a su
// contenido exacto se rompería en silencio con cada corrección).
export function parseCaptainsModeTurnTable(raw: unknown): CaptainsModeTurnTable | null {
  if (typeof raw !== "object" || raw === null) return null;
  const table = raw as Record<string, unknown>;
  if (!Number.isInteger(table.reserveTimeMs) || (table.reserveTimeMs as number) <= 0) return null;
  if (!Array.isArray(table.turns) || table.turns.length === 0) return null;
  if (!table.turns.every(isValidTurn)) return null;
  return { reserveTimeMs: table.reserveTimeMs as number, turns: table.turns as CaptainsModeTurn[] };
}

function isValidPickRound(value: unknown): value is AllPickPickRound {
  if (typeof value !== "object" || value === null) return false;
  const round = value as Record<string, unknown>;
  return (
    Number.isInteger(round.picksPerTeam) &&
    (round.picksPerTeam as number) > 0 &&
    Number.isInteger(round.durationMs) &&
    (round.durationMs as number) > 0
  );
}

export function parseAllPickTurnData(raw: unknown): AllPickTurnData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (!Number.isInteger(data.banCount) || (data.banCount as number) <= 0) return null;
  if (typeof data.banSource !== "string" || data.banSource.length === 0) return null;
  if (!Array.isArray(data.pickRounds) || data.pickRounds.length === 0) return null;
  if (!data.pickRounds.every(isValidPickRound)) return null;
  return { banCount: data.banCount as number, banSource: data.banSource as string, pickRounds: data.pickRounds as AllPickPickRound[] };
}

export function parseDraftFormatTurnData(raw: unknown): DraftFormatTurnData {
  if (typeof raw !== "object" || raw === null) return { captainsMode: null, allPick: null };
  const data = raw as Record<string, unknown>;
  return {
    captainsMode: parseCaptainsModeTurnTable(data.captainsMode),
    allPick: parseAllPickTurnData(data.allPick),
  };
}

export function loadDraftFormatTurnData(): DraftFormatTurnData {
  return parseDraftFormatTurnData(rawTurnData);
}
