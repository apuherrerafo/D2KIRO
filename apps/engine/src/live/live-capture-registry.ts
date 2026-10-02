import type { HeroId, TeamSide } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { DraftEventEnvelope } from "../draft/reducer";
import type { ProtocolSessionStore } from "../server/protocol-session";
import { observationsFromGsi, type GsiDraftCapabilities, type GsiPhase, type GsiUpdate } from "./gsi-normalize";
import { applyLiveObservation, emptyLiveFacts, observationFromDraftEvent, replayLiveFacts, type LiveFacts, type LiveIgnoredReason, type LiveObservation } from "./live-capture";

// Live Dota capture sessions: the bridge between observed facts (Dota GSI through the link-authenticated
// `/api/live/gsi/<liveId>` (TSK-219), the local Overwolf capturer through the token-authenticated
// `/ingest/draft-event`, or the Player's manual fallback) and the canonical protocol session the Team
// Coach Board reads.
//
//   observation -> LiveFacts (dedupe, pure) -> replayLiveFacts (kernel, pure) -> store.installLiveState
//
// There is ONE draft state per live session: the protocol session. This registry only keeps the facts
// it is derived from plus capture health for the status line -- never a second draft state. In-memory,
// like the session stores; no hero, side or account ever goes to a log from here.

export const LIVE_RULESET_ID = "dota2/ranked-all-pick" as const;
/** Party5 is the critical path of live capture: the five own positions are human-controlled. */
export const LIVE_CONTROLLED_POSITIONS: Position[] = [1, 2, 3, 4, 5];
/** No capture event (heartbeats included) for this long -> the capturer is considered gone. */
export const LIVE_STALE_AFTER_MS = 15_000;
const MAX_REMEMBERED_EVENT_IDS = 4_096;

export type LiveCaptureHealth = "unknown" | "ok" | "degraded" | "lost";
export type LiveObservationSource = "gsi" | "overwolf" | "manual";
/** Partial GSI draft capture: the client sends no draft block (only our side / our hero). */
export const GSI_DRAFT_PARTIAL = "GSI_DRAFT_PARTIAL";

export interface LiveDetectedPick {
  side: TeamSide;
  heroId: HeroId;
  position: Position | null;
  source: LiveObservationSource;
  at: string;
}

/** What the player's own Dota client actually reports (capability discovery, never values). */
export interface LiveGsiStatus {
  gameState: string | null;
  phase: GsiPhase;
  /** Accumulated over the current draft: did the client EVER send each draft field? */
  draft: GsiDraftCapabilities;
  /** Match telemetry capability labels observed so far (presence only). */
  telemetry: string[];
}

export interface LiveCaptureStatus {
  schema: "live-capture-status/v1";
  sessionId: string;
  /** Is the capturer talking to the engine (any event, heartbeats included, recently)? */
  connection: "waiting" | "connected" | "stale";
  lastEventAt: string | null;
  captureHealth: LiveCaptureHealth;
  /** Machine-readable capture problem, e.g. DOTA_CAPTURE_NOT_ENABLED. */
  captureDetail: string | null;
  draftPhase: "waiting" | "hero_selection" | "ended";
  localSide: TeamSide | null;
  /** Last OWN-team pick (captured or manual) -- the "TEAM PICK DETECTED" notice. */
  lastDetectedPick: LiveDetectedPick | null;
  bans: number;
  picks: number;
  /** Picks the kernel has no open slot for yet. */
  deferredPicks: number;
  rejectedFacts: number;
  /** Present once Dota GSI has spoken to this session. */
  gsi: LiveGsiStatus | null;
}

interface LiveEntry {
  facts: LiveFacts;
  eventIds: Set<string>;
  eventOrder: string[];
  lastEventAt: number | null;
  captureHealth: LiveCaptureHealth;
  captureDetail: string | null;
  ended: boolean;
  lastDetectedPick: LiveDetectedPick | null;
  deferredPicks: number;
  rejectedFacts: number;
  gsi: LiveGsiStatus | null;
  /** Hash of the match the current facts belong to (GSI `map.matchid`, one-way). */
  matchKey: string | null;
  /**
   * Facts the Player removed by hand in THIS draft (`ban:<hero>`, `pick:<side>:<hero>`). GSI repeats the
   * whole state on every update, so without this a correction would be undone by the next update.
   */
  suppressed: Set<string>;
}

function factKey(observation: LiveObservation): string | null {
  switch (observation.type) {
    case "ban":
    case "unban":
      return `ban:${observation.heroId}`;
    case "pick":
    case "revert":
      return `pick:${observation.side}:${observation.heroId}`;
    default:
      return null;
  }
}

export interface LiveCaptureRegistryDeps {
  store: ProtocolSessionStore;
  defaultPatch: string;
  now?: () => number;
}

export type LiveIngestResult =
  | { accepted: true; changed: boolean; ignored?: LiveIgnoredReason | "duplicate_event"; status: LiveCaptureStatus }
  | { accepted: false; reason: "session_unavailable" | "not_live_capture"; status: LiveCaptureStatus | null };

export class LiveCaptureRegistry {
  private readonly entries = new Map<string, LiveEntry>();
  private readonly now: () => number;

  constructor(private readonly deps: LiveCaptureRegistryDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * The live protocol session for `sessionId`, created on first use (by the capturer or by the
   * Player's browser, whichever arrives first). `ownerAccountId` claims an unowned session; returns
   * false when the session exists but is not a live capture session or belongs to someone else.
   */
  ensureSession(sessionId: string, ownerAccountId: number | null = null): boolean {
    const metadata = this.deps.store.metadata(sessionId);
    if (metadata && metadata.liveCapture !== true) return false;
    if (!metadata) {
      const created = this.deps.store.create({
        sessionId,
        rulesetId: LIVE_RULESET_ID,
        patch: this.deps.defaultPatch,
        ownerAccountId,
        localSide: "radiant",
        adapterKind: "manual",
        liveCapture: true,
        partyContext: { partySize: 5, side: "radiant", controlledSlots: [] },
        controlledPositions: [...LIVE_CONTROLLED_POSITIONS],
      }, this.now());
      if (!created.ok) return false;
      // A store eviction (TTL) forgot the old draft: the facts go with it -- and so do those of every
      // other session the store already evicted (bounded memory, swept only when a session is created).
      for (const known of this.entries.keys()) if (!this.deps.store.metadata(known)) this.entries.delete(known);
      this.entries.set(sessionId, this.freshEntry());
    }
    if (!this.entries.has(sessionId)) this.entries.set(sessionId, this.freshEntry());
    return ownerAccountId === null ? true : this.deps.store.claimOwner(sessionId, ownerAccountId);
  }

  /** A rotated or revoked Dota link: its capture history is dropped at once (the session itself ages out). */
  forget(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  isLive(sessionId: string): boolean {
    return this.deps.store.metadata(sessionId)?.liveCapture === true;
  }

  /** A draft-event/v1 envelope from the token-authenticated capturer. Idempotent per eventId. */
  ingestEnvelope(envelope: DraftEventEnvelope & { payload: { position?: unknown } }): LiveIngestResult {
    if (!this.ensureSession(envelope.sessionId)) {
      return { accepted: false, reason: this.deps.store.metadata(envelope.sessionId) ? "not_live_capture" : "session_unavailable", status: this.status(envelope.sessionId) };
    }
    const entry = this.entries.get(envelope.sessionId)!;
    entry.lastEventAt = this.now();
    if (entry.eventIds.has(envelope.eventId)) return { accepted: true, changed: false, ignored: "duplicate_event", status: this.status(envelope.sessionId)! };
    this.rememberEventId(entry, envelope.eventId);

    const payload = envelope.payload;
    if (payload.type === "capture_health") {
      entry.captureHealth = payload.status;
      entry.captureDetail = payload.detail ?? null;
      return { accepted: true, changed: false, status: this.status(envelope.sessionId)! };
    }
    if (payload.type === "session_ended") {
      entry.ended = true;
      return { accepted: true, changed: false, status: this.status(envelope.sessionId)! };
    }
    const observation = observationFromDraftEvent(payload);
    if (!observation) return { accepted: true, changed: false, ignored: "no_change", status: this.status(envelope.sessionId)! };
    return this.applyObservation(envelope.sessionId, observation, "overwolf");
  }

  /** The Player's manual fallback (validated at the route). Same facts, same rebuild as the capturer. */
  observe(sessionId: string, observation: LiveObservation): LiveIngestResult {
    if (!this.isLive(sessionId) || !this.ensureSession(sessionId)) return { accepted: false, reason: "not_live_capture", status: this.status(sessionId) };
    const result = this.applyObservation(sessionId, observation, "manual");
    // The Player's word wins over the capture for the rest of this draft: a removal sticks, and stating
    // the fact again by hand lifts it.
    const key = factKey(observation);
    const entry = this.entries.get(sessionId);
    if (result.accepted && key !== null && entry) {
      if (observation.type === "unban" || observation.type === "revert") {
        if (result.changed) entry.suppressed.add(key);
      } else {
        entry.suppressed.delete(key);
      }
    }
    return result;
  }

  /**
   * One Dota GSI update (already authenticated and normalized). GSI sends the whole state every time,
   * so the same update twice is a no-op, and a reconnect simply resumes. One kernel rebuild per update.
   */
  ingestGsi(sessionId: string, update: GsiUpdate): LiveIngestResult {
    if (!this.isLive(sessionId) || !this.entries.has(sessionId)) return { accepted: false, reason: "not_live_capture", status: this.status(sessionId) };
    let entry = this.entries.get(sessionId)!;
    // A different match (re-queue, next game) while the previous draft's facts are still here: start over.
    const newMatch = update.phase === "draft" && update.matchKey !== null && entry.matchKey !== null && update.matchKey !== entry.matchKey;
    if (newMatch || (update.phase === "draft" && entry.ended)) entry = this.restart(sessionId, entry);
    entry.lastEventAt = this.now();
    // A heartbeat keeps the live session alive (protocol store TTL) while Dota sits in the menu.
    this.deps.store.get(sessionId, entry.lastEventAt);
    if (update.phase === "draft" && update.matchKey !== null) entry.matchKey = update.matchKey;
    // Leaving hero selection (into the match, or back to the menu after an abandoned draft) ends this draft.
    if ((update.phase === "match" || update.phase === "idle") && entry.facts.started) entry.ended = true;
    const gsi = mergeGsiStatus(entry.gsi, update);
    entry.gsi = gsi;
    if (update.phase === "draft") {
      // Honest capture state: without a draft block the game only told us our side and our hero.
      const partial = !gsi.draft.draftBlock;
      entry.captureHealth = partial ? "degraded" : "ok";
      entry.captureDetail = partial ? GSI_DRAFT_PARTIAL : null;
    } else if (entry.captureDetail === GSI_DRAFT_PARTIAL || entry.captureHealth === "unknown") {
      entry.captureHealth = "ok";
      entry.captureDetail = null;
    }
    let changed = false;
    for (const observation of observationsFromGsi(update, this.deps.defaultPatch)) {
      const current = this.entries.get(sessionId)!;
      // GSI repeats "hero selection" in every update. A new draft was already decided above (match key /
      // ended), so a repeat never restarts -- not even once the kernel state reached COMPLETE.
      if (observation.type === "draft_started" && current.facts.started) continue;
      const key = factKey(observation);
      if (key !== null && current.suppressed.has(key)) continue;
      changed = this.applyFact(sessionId, current, observation, "gsi").changed || changed;
    }
    if (changed) this.rebuild(sessionId, this.entries.get(sessionId)!);
    return { accepted: true, changed, status: this.status(sessionId)! };
  }

  status(sessionId: string): LiveCaptureStatus | null {
    const entry = this.entries.get(sessionId);
    if (!entry || !this.isLive(sessionId)) return null;
    const now = this.now();
    const connection = entry.lastEventAt === null ? "waiting" : now - entry.lastEventAt <= LIVE_STALE_AFTER_MS ? "connected" : "stale";
    return {
      schema: "live-capture-status/v1",
      sessionId,
      connection,
      lastEventAt: entry.lastEventAt === null ? null : new Date(entry.lastEventAt).toISOString(),
      captureHealth: entry.captureHealth,
      captureDetail: entry.captureDetail,
      draftPhase: entry.ended ? "ended" : entry.facts.started ? "hero_selection" : "waiting",
      localSide: entry.facts.localSide,
      lastDetectedPick: entry.lastDetectedPick,
      bans: entry.facts.bans.length,
      picks: entry.facts.picks.length,
      deferredPicks: entry.deferredPicks,
      rejectedFacts: entry.rejectedFacts,
      gsi: entry.gsi === null ? null : { ...entry.gsi, draft: { ...entry.gsi.draft }, telemetry: [...entry.gsi.telemetry] },
    };
  }

  private applyObservation(sessionId: string, observation: LiveObservation, source: LiveObservationSource): LiveIngestResult {
    const outcome = this.applyFact(sessionId, this.entries.get(sessionId)!, observation, source);
    if (!outcome.changed) return { accepted: true, changed: false, ignored: outcome.ignored, status: this.status(sessionId)! };
    this.rebuild(sessionId, this.entries.get(sessionId)!);
    return { accepted: true, changed: true, status: this.status(sessionId)! };
  }

  /** Updates the facts only; the caller rebuilds the kernel state (once per batch). */
  private applyFact(sessionId: string, current: LiveEntry, observation: LiveObservation, source: LiveObservationSource): { changed: boolean; ignored?: LiveIgnoredReason } {
    let entry = current;
    // A new match on the same live session: the previous draft finished (or the capturer said it ended), start over.
    if (observation.type === "draft_started" && (entry.ended || this.deps.store.get(sessionId)?.status === "COMPLETE")) entry = this.restart(sessionId, entry);
    const outcome = applyLiveObservation(entry.facts, observation);
    if (!outcome.changed) return { changed: false, ignored: outcome.ignored };
    entry.facts = outcome.facts;
    if (observation.type === "draft_started") entry.ended = false;
    // "TEAM PICK DETECTED" is about OUR team: an enemy reveal never replaces the last own pick notice.
    const ownPick = outcome.detectedPick && (entry.facts.localSide === null || outcome.detectedPick.side === entry.facts.localSide);
    if (outcome.detectedPick && ownPick) entry.lastDetectedPick = { ...outcome.detectedPick, source, at: new Date(this.now()).toISOString() };
    return { changed: true };
  }

  /** Same live session, fresh draft: keeps the connection, dedupe memory and capture health. */
  private restart(sessionId: string, entry: LiveEntry): LiveEntry {
    const restarted = this.freshEntry();
    restarted.lastEventAt = entry.lastEventAt;
    restarted.eventIds = entry.eventIds;
    restarted.eventOrder = entry.eventOrder;
    restarted.captureHealth = entry.captureHealth;
    restarted.captureDetail = entry.captureDetail;
    restarted.gsi = entry.gsi === null ? null : { ...entry.gsi, draft: noDraftCapabilities() };
    this.entries.set(sessionId, restarted);
    return restarted;
  }

  private rebuild(sessionId: string, entry: LiveEntry): void {
    const state = this.deps.store.get(sessionId);
    const metadata = this.deps.store.metadata(sessionId);
    if (!state || !metadata) return;
    const party = metadata.partyContext;
    const replay = replayLiveFacts(entry.facts, {
      sessionId,
      rulesetId: state.ruleset.id,
      partyContext: party ? { partySize: party.partySize, side: party.side, controlledSlots: party.controlledSlots } : null,
      defaultSide: metadata.localSide,
    });
    if (!replay) return;
    this.deps.store.installLiveState(sessionId, { state: replay.state, localSide: replay.localSide, patch: entry.facts.patch, ownBindings: replay.ownBindings }, this.now());
    entry.deferredPicks = replay.deferred.length;
    entry.rejectedFacts = replay.rejected.length;
  }

  private rememberEventId(entry: LiveEntry, eventId: string): void {
    entry.eventIds.add(eventId);
    entry.eventOrder.push(eventId);
    if (entry.eventOrder.length > MAX_REMEMBERED_EVENT_IDS) entry.eventIds.delete(entry.eventOrder.shift()!);
  }

  private freshEntry(): LiveEntry {
    return {
      facts: emptyLiveFacts(this.deps.defaultPatch),
      eventIds: new Set(),
      eventOrder: [],
      lastEventAt: null,
      captureHealth: "unknown",
      captureDetail: null,
      ended: false,
      lastDetectedPick: null,
      deferredPicks: 0,
      rejectedFacts: 0,
      gsi: null,
      matchKey: null,
      suppressed: new Set(),
    };
  }
}

function noDraftCapabilities(): GsiDraftCapabilities {
  return { draftBlock: false, side: false, ownHero: false, bans: false, allyPicks: false, enemyPicks: false };
}

function mergeGsiStatus(previous: LiveGsiStatus | null, update: GsiUpdate): LiveGsiStatus {
  const draft = previous?.draft ?? noDraftCapabilities();
  // Draft capabilities only count while drafting; match telemetry accumulates across the match.
  const seen = update.phase === "draft" ? update.capabilities : noDraftCapabilities();
  const telemetry = new Set(previous?.telemetry ?? []);
  for (const label of update.telemetry) telemetry.add(label);
  return {
    gameState: update.gameState,
    phase: update.phase,
    draft: {
      draftBlock: draft.draftBlock || seen.draftBlock,
      side: draft.side || seen.side,
      ownHero: draft.ownHero || seen.ownHero,
      bans: draft.bans || seen.bans,
      allyPicks: draft.allyPicks || seen.allyPicks,
      enemyPicks: draft.enemyPicks || seen.enemyPicks,
    },
    telemetry: [...telemetry].sort(),
  };
}
