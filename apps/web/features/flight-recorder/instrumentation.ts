import type { CurrentDecisionOutput } from "@/features/random-draft-simulator/coach-client";
import type { ProtocolSnapshot } from "@/features/random-draft-simulator/protocol-client";
import type { DraftConfig, HeroId } from "@/features/random-draft-simulator/types";
import type { TeamCoachBoardData } from "@/features/team-coach/types";
import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";
import { deriveEffectivePools, parsePersonalPool, parsePoolGroups } from "./pools";
import { flightRecorder } from "./recorder";
import { summarizeBoard, summarizeConfig, summarizeDecision, summarizeSnapshot } from "./summaries";
import type { ResponseDisposition } from "./types";

// Superficie que `use-random-draft-session.ts` llama. Cada función es OBSERVADORA: no devuelve nada que el hook use
// para decidir, y con la grabadora desarmada (producción) termina en la primera línea. Ninguna puede lanzar.

/** La grabadora jamás puede alterar el draft: cualquier fallo propio se traga aquí. */
function observe(action: () => void): void {
  if (!flightRecorder.isArmed()) return;
  try {
    action();
  } catch {
    // observer only: a recorder failure must not reach the draft.
  }
}

export interface EngineRequestToken {
  /** Última transición del draft conocida cuando se EMITIÓ el pedido: a qué estado respondía el motor. */
  afterTransitionSeq: number;
  startedAtMs: number;
}

export function beginEngineRequest(): EngineRequestToken | null {
  if (!flightRecorder.isArmed()) return null;
  return { afterTransitionSeq: flightRecorder.lastTransitionSeq(), startedAtMs: performance.now() };
}

function latencyOf(token: EngineRequestToken): number {
  return Math.round(performance.now() - token.startedAtMs);
}

export function recordBoardResponse(token: EngineRequestToken | null, board: TeamCoachBoardData, disposition: ResponseDisposition): void {
  if (token === null) return;
  observe(() => {
    flightRecorder.record("engine_team_board", {
      disposition,
      requestedAfterTransitionSeq: token.afterTransitionSeq,
      latencyMs: latencyOf(token),
      board: summarizeBoard(board),
    });
  });
}

export function recordDecisionResponse(token: EngineRequestToken | null, output: CurrentDecisionOutput, disposition: ResponseDisposition, requestedTarget: number | null): void {
  if (token === null) return;
  observe(() => {
    flightRecorder.record("engine_current_decision", {
      disposition,
      requestedAfterTransitionSeq: token.afterTransitionSeq,
      latencyMs: latencyOf(token),
      requestedTarget,
      decision: summarizeDecision(output),
    });
  });
}

/** Sólo el mensaje del error: jamás el cuerpo de la respuesta ni cabeceras. */
export function recordEngineError(endpoint: "team_board" | "current_decision", token: EngineRequestToken | null, error: unknown): void {
  if (token === null) return;
  observe(() => {
    flightRecorder.record("engine_error", {
      endpoint,
      requestedAfterTransitionSeq: token.afterTransitionSeq,
      latencyMs: latencyOf(token),
      message: error instanceof Error ? error.message : "unknown error",
    });
  });
}

export function recordTransition(source: string, snapshot: ProtocolSnapshot, extra: Record<string, unknown> = {}): void {
  observe(() => {
    flightRecorder.record("transition", { source, ...extra, view: summarizeSnapshot(snapshot) });
  });
}

/** Un hecho de la partida que no es un snapshot nuevo (apertura de intento, ronda revelada). Cuenta como transición. */
export function recordGameEvent(source: string, detail: Record<string, unknown>): void {
  observe(() => {
    flightRecorder.record("transition", { source, ...detail });
  });
}

export function recordUserAction(action: string, detail: Record<string, unknown>): void {
  observe(() => {
    flightRecorder.record("user_action", { action, ...detail });
  });
}

export function recordLockPick(heroId: HeroId, position: number, slotIndex: number): void {
  recordUserAction("lock_pick", { heroId, position, slotIndex });
}

async function readJson(fetchImpl: typeof fetch, path: string): Promise<unknown> {
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return response.json();
}

async function recordEffectivePools(config: DraftConfig, fetchImpl: typeof fetch): Promise<void> {
  try {
    const [groupsBody, poolBody] = await Promise.all([readJson(fetchImpl, "/api/team-groups"), readJson(fetchImpl, "/api/hero-pool")]);
    const groups = parsePoolGroups(groupsBody);
    const personalPool = parsePersonalPool(poolBody);
    if (groups === null || personalPool === null) throw new Error("unexpected pool payload shape");
    flightRecorder.record("pools_effective", {
      derivedBy: "browser",
      authority: "engine decides; see poolState/poolOwner/poolMembership in each engine_current_decision",
      pools: deriveEffectivePools({ config, groups, personalPool }),
    });
  } catch (error) {
    observe(() => {
      flightRecorder.record("pools_unavailable", { message: error instanceof Error ? error.message : "unknown error" });
    });
  }
}

/** Arranca la grabación de una partida: configuración, semilla y pools efectivos. Los pools se leen aparte, sin bloquear el draft. */
export function recordSessionStart(config: DraftConfig, mode: string, fetchImpl: typeof fetch): void {
  observe(() => {
    flightRecorder.record("session_start", { config: summarizeConfig(config, mode) });
    void recordEffectivePools(config, fetchImpl);
  });
}
