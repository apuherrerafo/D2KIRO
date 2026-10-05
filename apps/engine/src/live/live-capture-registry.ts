import type { HeroId, TeamSide } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { DraftEventEnvelope } from "../draft/reducer";
import type { ProtocolSessionStore } from "../server/protocol-session";
import { draftFactCount, observationsFromGsi, type GsiDraftCapabilities, type GsiPhase, type GsiUpdate } from "./gsi-normalize";
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

/** The automatic (Overwolf) capture went quiet while the draft was still running. */
export const OVERWOLF_LOST = "OVERWOLF_LOST";

/**
 * Overwolf GEP info keys that carried data this draft. PRESENCE only -- never a hero, a player or a value.
 * Reported by the adapter (it is the only one that sees the raw GEP update).
 */
export interface OverwolfPresence {
  roster: boolean;
  bans: boolean;
  draft: boolean;
  players: boolean;
}

export interface LiveOverwolfStatus extends OverwolfPresence {
  /** An authenticated adapter batch arrived within LIVE_STALE_AFTER_MS (server clock). */
  connected: boolean;
  /** Server clock: ms since the last adapter batch. */
  lastUpdateAgeMs: number;
  /**
   * Overwolf is the source of the FULL draft: connected, and it has stated draft heroes (`draft` or `players`).
   * While true, GSI never adds or removes a hero fact -- it only keeps telling side / lifecycle / telemetry.
   */
  authoritative: boolean;
}

/** Match telemetry label (diagnostics): the inventory changed between two GSI updates. */
export const GSI_ITEM_CHANGES = "item_changes";

/** What the player's own Dota client actually reports (capability discovery, never values). */
interface LiveGsiObserved {
  gameState: string | null;
  phase: GsiPhase;
  /** Accumulated over the current draft: did the client EVER send each draft field? */
  draft: GsiDraftCapabilities;
  /** This draft: an update stated MORE draft facts (bans + picks + own hero) than an earlier one. */
  draftProgression: boolean;
  /** Match telemetry capability labels observed so far (presence only). */
  telemetry: string[];
  /** Structural labels (gsi-normalize `GSI_STRUCTURE_LABELS`) observed so far: which sections / roster shapes Dota ever sent. */
  structure: string[];
}

export interface LiveGsiStatus extends LiveGsiObserved {
  /** Server clock: ms since the last GSI update (the browser's clock is never trusted for this). */
  lastPacketAgeMs: number;
  /**
   * A GSI update arrived within LIVE_STALE_AFTER_MS. GSI updates only ever reach the registry through the
   * link-authenticated `/api/live/gsi/<liveId>`, whose cfg URI is always https (lib/gsi-config.ts) --
   * so `active` IS "remote GSI over HTTPS is live".
   */
  active: boolean;
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
  /** The Party 5 team preset applied to this live session (which positions have a pool). Never hero ids or names. */
  teamContext: LiveTeamContextStatus;
  /** Present once the paired Overwolf adapter has spoken to this session. */
  overwolf: LiveOverwolfStatus | null;
}

export interface LiveTeamContextStatus {
  /** The account's own preset applied to this session, or null (no preset / missing / not applied). */
  teamGroupId: number | null;
  /** Which of the five positions carry a configured player pool. */
  positions: Record<"1" | "2" | "3" | "4" | "5", boolean>;
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
  gsi: LiveGsiObserved | null;
  /** Last GSI update (any phase, heartbeats included). Survives a draft restart: it is the connection. */
  lastGsiAt: number | null;
  /** Draft facts the last draft-phase GSI update stated; null before the first one of this draft. */
  gsiDraftFacts: number | null;
  /** Hash of the last inventory GSI reported (gsi-normalize `itemsKey`). */
  gsiItemsKey: string | null;
  /** Hash of the match the current facts belong to (GSI `map.matchid`, one-way). */
  matchKey: string | null;
  /**
   * Facts the Player removed by hand in THIS draft (`ban:<hero>`, `pick:<side>:<hero>`). GSI repeats the
   * whole state on every update, so without this a correction would be undone by the next update.
   */
  suppressed: Set<string>;
  /** Last batch of the paired Overwolf adapter; null until it first speaks. Presence is per draft (a restart clears it). */
  overwolf: { lastAt: number; presence: OverwolfPresence } | null;
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

  /**
   * Apply (or clear, with null) the account's Party 5 preset to its live session. The pools come from the
   * caller's server-side load of the account's OWN team group -- never from a client body. false when the
   * session is not a live session owned by `accountId`.
   */
  setTeamContext(sessionId: string, accountId: number, team: { teamGroupId: number; playerPoolsByPosition: Partial<Record<Position, readonly HeroId[]>> } | null): boolean {
    if (!this.isLive(sessionId)) return false;
    return this.deps.store.setLiveTeamContext(sessionId, accountId, { teamGroupId: team?.teamGroupId ?? null, playerPoolsByPosition: team?.playerPoolsByPosition ?? null });
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

  /**
   * One batch from the PAIRED Overwolf adapter (credential already verified, events already validated at the
   * route). The session is the credential's -- `ownerAccountId` must still own it, else nothing is applied.
   * Every event goes through the same dedupe as `ingestEnvelope`, so a repeated snapshot never doubles a fact.
   */
  ingestOverwolf(sessionId: string, ownerAccountId: number, events: DraftEventEnvelope[], presence: OverwolfPresence): LiveIngestResult {
    if (!this.ensureSession(sessionId, ownerAccountId)) return { accepted: false, reason: "not_live_capture", status: null };
    let changed = false;
    for (const event of events) {
      const outcome = this.ingestEnvelope({ ...event, sessionId, source: "overwolf" });
      if (outcome.accepted) changed = outcome.changed || changed;
    }
    const entry = this.entries.get(sessionId)!;
    const at = this.now();
    entry.lastEventAt = at;
    // Keep the live session alive (protocol store TTL) while the adapter only sends heartbeats.
    this.deps.store.get(sessionId, at);
    const seen = entry.overwolf?.presence ?? { roster: false, bans: false, draft: false, players: false };
    entry.overwolf = {
      lastAt: at,
      presence: { roster: seen.roster || presence.roster, bans: seen.bans || presence.bans, draft: seen.draft || presence.draft, players: seen.players || presence.players },
    };
    return { accepted: true, changed, status: this.status(sessionId)! };
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
    entry.lastGsiAt = entry.lastEventAt;
    // A heartbeat keeps the live session alive (protocol store TTL) while Dota sits in the menu.
    this.deps.store.get(sessionId, entry.lastEventAt);
    if (update.phase === "draft" && update.matchKey !== null) entry.matchKey = update.matchKey;
    // Leaving hero selection (into the match, or back to the menu after an abandoned draft) ends this draft.
    if ((update.phase === "match" || update.phase === "idle") && entry.facts.started) entry.ended = true;
    // Diagnostics only (presence, never values): did the draft advance / the inventory change between updates?
    const factCount = update.phase === "draft" ? draftFactCount(update) : null;
    const progressed = factCount !== null && entry.gsiDraftFacts !== null && factCount > entry.gsiDraftFacts;
    if (factCount !== null) entry.gsiDraftFacts = Math.max(factCount, entry.gsiDraftFacts ?? 0);
    const itemsChanged = update.itemsKey !== null && entry.gsiItemsKey !== null && update.itemsKey !== entry.gsiItemsKey;
    if (update.itemsKey !== null) entry.gsiItemsKey = update.itemsKey;
    const gsi = mergeGsiStatus(entry.gsi, update, progressed, itemsChanged);
    entry.gsi = gsi;
    if (update.phase === "draft") {
      // Honest capture state: without a draft block the game only told us our side and our hero.
      const partial = !gsi.draft.draftBlock && !this.overwolfAuthoritative(entry);
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
      // Overwolf states the full draft: GSI's own hero (or any pick/ban it might add) is only a repeat of it,
      // and -- if the two ever disagree -- never allowed to override it.
      if ((observation.type === "pick" || observation.type === "ban") && this.overwolfAuthoritative(current)) continue;
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
    const overwolf = overwolfStatusOf(entry, now);
    // Honest health: an automatic capture that went quiet mid-draft is reported, never papered over by GSI heartbeats.
    const lostOverwolf = overwolf !== null && !overwolf.connected && overwolf.authoritativeEver && entry.facts.started && !entry.ended;
    let captureHealth = entry.captureHealth;
    let captureDetail = entry.captureDetail;
    if (lostOverwolf) {
      captureHealth = "degraded";
      captureDetail = OVERWOLF_LOST;
    } else if (overwolf?.authoritative === true && captureDetail === GSI_DRAFT_PARTIAL) {
      captureHealth = "ok";
      captureDetail = null;
    }
    return {
      schema: "live-capture-status/v1",
      sessionId,
      connection,
      lastEventAt: entry.lastEventAt === null ? null : new Date(entry.lastEventAt).toISOString(),
      captureHealth,
      captureDetail,
      draftPhase: entry.ended ? "ended" : entry.facts.started ? "hero_selection" : "waiting",
      localSide: entry.facts.localSide,
      lastDetectedPick: entry.lastDetectedPick,
      bans: entry.facts.bans.length,
      picks: entry.facts.picks.length,
      deferredPicks: entry.deferredPicks,
      rejectedFacts: entry.rejectedFacts,
      gsi: gsiStatusOf(entry, now),
      teamContext: this.teamContextOf(sessionId),
      overwolf: overwolf === null ? null : { connected: overwolf.connected, roster: overwolf.roster, bans: overwolf.bans, draft: overwolf.draft, players: overwolf.players, lastUpdateAgeMs: overwolf.lastUpdateAgeMs, authoritative: overwolf.authoritative },
    };
  }

  private overwolfAuthoritative(entry: LiveEntry): boolean {
    const status = overwolfStatusOf(entry, this.now());
    return status !== null && status.authoritative;
  }

  private teamContextOf(sessionId: string): LiveTeamContextStatus {
    const metadata = this.deps.store.metadata(sessionId);
    const pools = metadata?.playerPoolsByPosition ?? null;
    const has = (position: Position): boolean => (pools?.[position]?.length ?? 0) > 0;
    return {
      teamGroupId: pools === null ? null : (metadata?.teamGroupId ?? null),
      positions: { "1": has(1), "2": has(2), "3": has(3), "4": has(4), "5": has(5) },
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
    restarted.gsi = entry.gsi === null ? null : { ...entry.gsi, draft: noDraftCapabilities(), draftProgression: false };
    restarted.lastGsiAt = entry.lastGsiAt;
    // The adapter is still there; what it stated about the PREVIOUS draft is not (presence restarts with the draft).
    restarted.overwolf = entry.overwolf === null ? null : { lastAt: entry.overwolf.lastAt, presence: { roster: false, bans: false, draft: false, players: false } };
    // A new match's first inventory is never compared with the previous match's (that is not an item change).
    restarted.gsiItemsKey = null;
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
      lastGsiAt: null,
      gsiDraftFacts: null,
      gsiItemsKey: null,
      matchKey: null,
      suppressed: new Set(),
      overwolf: null,
    };
  }
}

function overwolfStatusOf(entry: LiveEntry, now: number): (LiveOverwolfStatus & { authoritativeEver: boolean }) | null {
  if (entry.overwolf === null) return null;
  const lastUpdateAgeMs = Math.max(0, now - entry.overwolf.lastAt);
  const connected = lastUpdateAgeMs <= LIVE_STALE_AFTER_MS;
  const { presence } = entry.overwolf;
  const authoritativeEver = presence.draft || presence.players;
  return { ...presence, connected, lastUpdateAgeMs, authoritative: connected && authoritativeEver, authoritativeEver };
}

function noDraftCapabilities(): GsiDraftCapabilities {
  return { draftBlock: false, side: false, ownHero: false, bans: false, allyPicks: false, enemyPicks: false };
}

function gsiStatusOf(entry: LiveEntry, now: number): LiveGsiStatus | null {
  if (entry.gsi === null || entry.lastGsiAt === null) return null;
  const lastPacketAgeMs = Math.max(0, now - entry.lastGsiAt);
  return {
    ...entry.gsi,
    draft: { ...entry.gsi.draft },
    telemetry: [...entry.gsi.telemetry],
    structure: [...entry.gsi.structure],
    lastPacketAgeMs,
    active: lastPacketAgeMs <= LIVE_STALE_AFTER_MS,
  };
}

function mergeGsiStatus(previous: LiveGsiObserved | null, update: GsiUpdate, progressed: boolean, itemsChanged: boolean): LiveGsiObserved {
  const draft = previous?.draft ?? noDraftCapabilities();
  // Draft capabilities only count while drafting; match telemetry accumulates across the match.
  const seen = update.phase === "draft" ? update.capabilities : noDraftCapabilities();
  const telemetry = new Set(previous?.telemetry ?? []);
  for (const label of update.telemetry) telemetry.add(label);
  if (itemsChanged) telemetry.add(GSI_ITEM_CHANGES);
  const structure = new Set(previous?.structure ?? []);
  for (const label of update.structure) structure.add(label);
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
    draftProgression: (previous?.draftProgression ?? false) || progressed,
    telemetry: [...telemetry].sort(),
    structure: [...structure].sort(),
  };
}
