import type { DraftState, HeroId, TeamSide } from "@/features/draft/types";
import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";

export type ProtocolStatus = "ACTIVE" | "UNCONFIRMED_STATE" | "WAITING_FOR_COLLISION_AUTHORITY" | "COMPLETE" | "DEGRADED";
export type RankedApPhase = "BAN_RESOLUTION" | "PICK_ROUND_1" | "PICK_ROUND_2" | "PICK_ROUND_3" | "COMPLETE";

export type PerspectiveHeroSlot =
  | { visibility: "KNOWN"; heroId: HeroId }
  | { visibility: "REVEALED"; heroId: HeroId }
  | { visibility: "HIDDEN" };

export interface ProtocolPerspectiveView {
  schema: "draft-protocol-perspective/v1";
  sessionId: string;
  status: ProtocolStatus;
  viewerSide: TeamSide;
  bannedHeroes: HeroId[];
  ownPicks: PerspectiveHeroSlot[];
  enemyPicks: PerspectiveHeroSlot[];
  rankedAp: { phase: RankedApPhase; banResolutionComplete: boolean };
}

export type ProtocolLegalAction =
  | { type: "RECORD_RESOLVED_BANS" }
  | { type: "BAN_RESOLUTION_COMPLETE" }
  | { type: "SUBMIT_SEALED_SELECTION"; side: TeamSide; slotIndex: number };

export interface ProtocolSnapshot {
  view: ProtocolPerspectiveView;
  legalActions: ProtocolLegalAction[];
}

type ProtocolCommand =
  | { type: "RECORD_RESOLVED_BANS"; heroes: HeroId[] }
  | { type: "BAN_RESOLUTION_COMPLETE" }
  | { type: "SUBMIT_SEALED_SELECTION"; side: TeamSide; slotIndex: number; heroId: HeroId };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHeroId(value: unknown): value is HeroId {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSlot(value: unknown): value is PerspectiveHeroSlot {
  if (!isRecord(value)) return false;
  if (value.visibility === "HIDDEN") return value.heroId === undefined;
  return (value.visibility === "KNOWN" || value.visibility === "REVEALED") && isHeroId(value.heroId);
}

function parseSnapshot(value: unknown): ProtocolSnapshot | null {
  if (!isRecord(value) || !isRecord(value.view) || !Array.isArray(value.legalActions)) return null;
  const view = value.view;
  if (view.schema !== "draft-protocol-perspective/v1") return null;
  if (typeof view.sessionId !== "string") return null;
  if (view.viewerSide !== "radiant" && view.viewerSide !== "dire") return null;
  if (!Array.isArray(view.bannedHeroes) || !view.bannedHeroes.every(isHeroId)) return null;
  if (!Array.isArray(view.ownPicks) || !view.ownPicks.every(isSlot)) return null;
  if (!Array.isArray(view.enemyPicks) || !view.enemyPicks.every(isSlot)) return null;
  if (!isRecord(view.rankedAp) || typeof view.rankedAp.phase !== "string") return null;
  return value as unknown as ProtocolSnapshot;
}

async function readSnapshot(response: Response): Promise<ProtocolSnapshot> {
  if (!response.ok) throw new Error(`protocol request failed (${response.status})`);
  const parsed = parseSnapshot(await response.json());
  if (!parsed) throw new Error("invalid protocol response");
  return parsed;
}

export async function createSimulatorProtocolSession(
  patch: string,
  localSide: TeamSide,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rulesetId: "dota2/ranked-all-pick",
      patch,
      localSide,
      adapterKind: "simulator",
      partyContext: {
        partySize: 5,
        side: localSide,
        controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: localSide, slotIndex, controllerId: `simulator-local-${slotIndex}` })),
      },
    }),
  });
  if (!response.ok) throw new Error(`protocol session creation failed (${response.status})`);
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.sessionId !== "string" || body.sessionId.length === 0) throw new Error("invalid protocol session response");
  return body.sessionId;
}

export function submitProtocolCommand(
  sessionId: string,
  command: ProtocolCommand,
  fetchImpl: typeof fetch = fetch,
): Promise<ProtocolSnapshot> {
  return fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command }),
  }).then(readSnapshot);
}

export function requestBotSelection(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<ProtocolSnapshot> {
  return fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/bot-selection`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }).then(readSnapshot);
}

export function resolveSimulatorAuthority(sessionId: string, seed: string, fetchImpl: typeof fetch = fetch): Promise<ProtocolSnapshot> {
  return fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/simulator-authority`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed }),
  }).then(readSnapshot);
}

function visibleHeroIds(slots: readonly PerspectiveHeroSlot[]): HeroId[] {
  return slots.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
}

export function protocolViewToDraftState(view: ProtocolPerspectiveView, patch: string): DraftState {
  const own = visibleHeroIds(view.ownPicks);
  const enemy = visibleHeroIds(view.enemyPicks);
  return {
    sessionId: view.sessionId,
    schema: "draft-state/v1",
    format: "all_pick",
    patch,
    localSide: view.viewerSide,
    phase: view.status === "COMPLETE" ? "complete" : "active",
    banned: [...view.bannedHeroes],
    picks: view.viewerSide === "radiant" ? { radiant: own, dire: enemy } : { radiant: enemy, dire: own },
    lastSeq: own.length + enemy.length + view.bannedHeroes.length,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: view.status === "DEGRADED" ? "degraded" : "ok" },
    updatedAt: new Date().toISOString(),
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    turn: null,
  };
}
