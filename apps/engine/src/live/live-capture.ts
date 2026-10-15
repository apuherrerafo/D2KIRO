import { applyProtocolCommand, createProtocolState, legalActions, type PartyContextInput } from "../draft-protocol";
import type { DraftProtocolState, HeroId, RejectionReasonV2, RulesetId, TeamSide } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { DraftEvent } from "../draft/reducer";
import type { OwnPickPositionBinding } from "../server/protocol-session";
import { EMPTY_LIVE_POSITION_RESOLUTION, resolveLiveOwnPositions, type LiveOwnPositionResolution } from "./live-position-resolver";

// Live Dota capture -- the observed FACTS of a real draft, and the one function that turns them into a
// kernel state.
//
// The source of truth in live mode is the game (Overwolf GEP) or the Player reporting by hand when the
// capture degrades. Both only ever state facts: "this hero was banned", "this side picked this hero
// (for this position)", "that pick was reverted". The draft state is a PURE FUNCTION of those facts:
// `replayLiveFacts` starts from an empty Ranked All Pick state and replays every fact through the
// kernel (`applyProtocolCommand`), asking the kernel (`legalActions`) which round slot is open for each
// pick. No All Pick rule (round capacity, reveal, collision) is re-implemented here -- the kernel keeps
// them. A revert simply removes a fact and the state is rebuilt, so nothing is ever "un-applied".
//
// POSITION != PICK ORDER != SLOT: a pick's position comes only from the fact (the game's roster role,
// or the Player's manual report), never from the slot the kernel happened to open for it.

export interface LivePickFact {
  side: TeamSide;
  heroId: HeroId;
  /** Position when the source knew it (only ever used for own-side picks); `null` otherwise. */
  position: Position | null;
}

export interface LiveFacts {
  /** Hero selection began (the game entered DOTA_GAMERULES_STATE_HERO_SELECTION, or the Player said so). */
  started: boolean;
  patch: string;
  localSide: TeamSide | null;
  bans: HeroId[];
  /** Explicit "the ban phase is over" (manual fallback). A first pick closes it implicitly. */
  bansClosed: boolean;
  /** In observed order. A hero appears at most once across both sides. */
  picks: LivePickFact[];
  /**
   * The hero the game says is the LOCAL PLAYER's right now (GSI `hero.id`), or null while it says none. Current state,
   * not history: a new value REPLACES the old one, so a binding is never left on two heroes. It is evidence of
   * identity -- it never adds a pick by itself (the pick fact does that).
   */
  localHeroId: HeroId | null;
  /**
   * The hero whose pick fact exists ONLY because GSI named it as the local Player's hero -- no draft block, visual
   * capture or manual report ever stated it. A different local hero replaces it (X -> Y never leaves both as own picks
   * from that one source); any other source stating the same pick corroborates it and clears this.
   */
  localOnlyPick: HeroId | null;
}

export type LiveObservation =
  | { type: "draft_started"; patch: string }
  | { type: "side"; side: TeamSide }
  | { type: "ban"; heroId: HeroId }
  /** Correction: the Player reported a ban by mistake. */
  | { type: "unban"; heroId: HeroId }
  | { type: "bans_closed" }
  | { type: "pick"; side: TeamSide; heroId: HeroId; position: Position | null; /** The pick is GSI's local-hero report (`hero.id`), not a draft-block or visual fact. */ viaLocalHero?: true }
  | { type: "revert"; side: TeamSide; heroId: HeroId }
  /** GSI's word on which hero is the local Player's (null: it names none). Only GSI states it; never a client body. */
  | { type: "local_hero"; heroId: HeroId | null };

export type LiveIgnoredReason = "invalid_hero" | "already_banned" | "already_picked" | "picked_by_other_side" | "banned_hero" | "unknown_pick" | "unknown_ban" | "no_change" | "draft_full";

/**
 * Upper bounds of a legal Ranked All Pick draft: 10 players x up to 4 ban nominations, 5 heroes a side.
 * Facts beyond them are ignored, so no source (a buggy capture, a hostile payload) can make a rebuild
 * more expensive than a real draft (Sentinel TSK-219, finding 2).
 */
export const MAX_LIVE_BANS = 40;
export const MAX_LIVE_PICKS_PER_SIDE = 5;
const MAX_HERO_ID = 999;

export interface LiveFactOutcome {
  facts: LiveFacts;
  changed: boolean;
  ignored?: LiveIgnoredReason;
  /** The pick this observation added (or completed with a position), for the "TEAM PICK DETECTED" notice. */
  detectedPick?: LivePickFact;
}

export function emptyLiveFacts(patch: string): LiveFacts {
  return { started: false, patch, localSide: null, bans: [], bansClosed: false, picks: [], localHeroId: null, localOnlyPick: null };
}

function isHeroId(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_HERO_ID;
}

function unchanged(facts: LiveFacts, ignored: LiveIgnoredReason): LiveFactOutcome {
  return { facts, changed: false, ignored };
}

/** The earlier local-only pick, removed when a local-hero report names a different hero (same facts object when there is none). */
function withoutStaleLocalPick(facts: LiveFacts, observation: Extract<LiveObservation, { type: "pick" }>): LiveFacts {
  const stale = facts.localOnlyPick;
  if (stale === null || stale === observation.heroId) return facts;
  return { ...facts, picks: facts.picks.filter((pick) => pick.heroId !== stale), localOnlyPick: null };
}

function applyPick(facts: LiveFacts, observation: Extract<LiveObservation, { type: "pick" }>): LiveFactOutcome {
  if (!isHeroId(observation.heroId)) return unchanged(facts, "invalid_hero");
  if (facts.bans.includes(observation.heroId)) return unchanged(facts, "banned_hero");
  const existing = facts.picks.find((pick) => pick.heroId === observation.heroId);
  if (existing && existing.side !== observation.side) return unchanged(facts, "picked_by_other_side");
  if (existing) {
    // Another source stating a pick that only the local-hero report had named corroborates it: it is a real pick now.
    const corroborated = observation.viaLocalHero !== true && facts.localOnlyPick === observation.heroId;
    const base = corroborated ? { ...facts, localOnlyPick: null } : facts;
    // Same hero, same side: only a newly known position completes the fact; anything else is a repeat.
    if (existing.position !== null || observation.position === null) return corroborated ? { facts: base, changed: true } : unchanged(facts, "already_picked");
    const completed = { ...existing, position: observation.position };
    return { facts: { ...base, picks: base.picks.map((pick) => (pick === existing ? completed : pick)) }, changed: true, detectedPick: completed };
  }
  if (facts.picks.filter((pick) => pick.side === observation.side).length >= MAX_LIVE_PICKS_PER_SIDE) return unchanged(facts, "draft_full");
  // The position is kept as observed; only own-side picks ever turn it into a binding (replayLiveFacts),
  // so a pick that arrives before the game reports our side does not lose it.
  const pick: LivePickFact = { side: observation.side, heroId: observation.heroId, position: observation.position };
  const localOnlyPick = observation.viaLocalHero === true ? observation.heroId : facts.localOnlyPick;
  return { facts: { ...facts, picks: [...facts.picks, pick], localOnlyPick }, changed: true, detectedPick: pick };
}

/** Pure. Duplicate observations are no-ops (`changed: false`), so a repeated capture update never doubles a pick. */
export function applyLiveObservation(facts: LiveFacts, observation: LiveObservation): LiveFactOutcome {
  switch (observation.type) {
    case "draft_started":
      if (facts.started && facts.patch === observation.patch) return unchanged(facts, "no_change");
      return { facts: { ...facts, started: true, patch: observation.patch }, changed: true };
    case "side":
      if (facts.localSide === observation.side) return unchanged(facts, "no_change");
      return { facts: { ...facts, localSide: observation.side }, changed: true };
    case "bans_closed":
      if (facts.bansClosed) return unchanged(facts, "no_change");
      return { facts: { ...facts, bansClosed: true }, changed: true };
    case "local_hero":
      if (observation.heroId !== null && !isHeroId(observation.heroId)) return unchanged(facts, "invalid_hero");
      if (facts.localHeroId === observation.heroId) return unchanged(facts, "no_change");
      return { facts: { ...facts, localHeroId: observation.heroId }, changed: true };
    case "ban": {
      if (!isHeroId(observation.heroId)) return unchanged(facts, "invalid_hero");
      if (facts.bans.includes(observation.heroId)) return unchanged(facts, "already_banned");
      if (facts.picks.some((pick) => pick.heroId === observation.heroId)) return unchanged(facts, "already_picked");
      if (facts.bans.length >= MAX_LIVE_BANS) return unchanged(facts, "draft_full");
      return { facts: { ...facts, bans: [...facts.bans, observation.heroId] }, changed: true };
    }
    case "pick": {
      // A local-hero report that names a DIFFERENT hero than the one it named before replaces that earlier local-only pick.
      const current = observation.viaLocalHero === true ? withoutStaleLocalPick(facts, observation) : facts;
      const outcome = applyPick(current, observation);
      if (current !== facts && !outcome.changed) return { facts: current, changed: true };
      return outcome;
    }
    case "unban": {
      if (!facts.bans.includes(observation.heroId)) return unchanged(facts, "unknown_ban");
      return { facts: { ...facts, bans: facts.bans.filter((heroId) => heroId !== observation.heroId) }, changed: true };
    }
    case "revert": {
      const existing = facts.picks.find((pick) => pick.heroId === observation.heroId && pick.side === observation.side);
      if (!existing) return unchanged(facts, "unknown_pick");
      const localOnlyPick = facts.localOnlyPick === observation.heroId ? null : facts.localOnlyPick;
      return { facts: { ...facts, picks: facts.picks.filter((pick) => pick !== existing), localOnlyPick }, changed: true };
    }
  }
}

function isPosition(value: unknown): value is Position {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

/**
 * A draft-event/v1 payload as a live observation. `capture_health`/`session_ended` describe the capture,
 * not the draft, and return null (the registry tracks them). `hero_picked` may carry an optional
 * own-team `position` (additive field, validated at the edge).
 */
export function observationFromDraftEvent(event: DraftEvent & { position?: unknown }): LiveObservation | null {
  switch (event.type) {
    case "session_started":
      return event.format === "all_pick" ? { type: "draft_started", patch: event.patch } : null;
    case "local_side_identified":
      return { type: "side", side: event.side };
    case "hero_banned":
      return { type: "ban", heroId: event.hero };
    case "hero_picked":
      return { type: "pick", side: event.side, heroId: event.hero, position: isPosition(event.position) ? event.position : null };
    case "pick_reverted":
      return { type: "revert", side: event.side, heroId: event.hero };
    default:
      return null;
  }
}

export interface LiveReplayBase {
  sessionId: string;
  rulesetId: RulesetId;
  /** The live session's PartyContext shape; its side is re-pointed at the facts' local side. */
  partyContext: PartyContextInput | null;
  /** Side used until the game reports one. */
  defaultSide: TeamSide;
  /**
   * The position the Player declared for themselves ("I am Pos N"), or null. With GSI's local hero
   * (`facts.localHeroId`) it is the only thing, besides a stated position, that binds a hero to a position.
   */
  humanPosition?: Position | null;
}

export interface LiveReplay {
  state: DraftProtocolState;
  localSide: TeamSide;
  ownBindings: OwnPickPositionBinding[];
  /** How every own SEALED pick resolved to a position (provenance included); see live-position-resolver.ts. */
  ownPositions: LiveOwnPositionResolution;
  /** Picks the kernel had no open slot for yet (e.g. the other side's round picks are not revealed). Kept as facts, replayed next time. */
  deferred: LivePickFact[];
  /** Facts the kernel refused; never forced. */
  rejected: { heroId: HeroId; reason: RejectionReasonV2 }[];
}

/**
 * Pure: the kernel state these facts produce from an empty Ranked All Pick draft. Bans first (one
 * resolved set), then -- once picking began -- ban resolution closes and every pick is sealed into the
 * open slot the kernel itself advertises for its side. A pick with no open slot yet is retried after
 * each accepted seal (a round resolving opens the next one); whatever is still waiting is `deferred`.
 * Null when the party shape is refused by the kernel.
 */
export function replayLiveFacts(facts: LiveFacts, base: LiveReplayBase): LiveReplay | null {
  const localSide = facts.localSide ?? base.defaultSide;
  const partyContext = base.partyContext
    ? { ...base.partyContext, side: localSide, controlledSlots: base.partyContext.controlledSlots.map((slot) => ({ ...slot, side: localSide })) }
    : undefined;
  const created = createProtocolState(base.sessionId, base.rulesetId, { partyContext });
  if (!created.ok) return null;
  let state = created.state;
  const rejected: LiveReplay["rejected"] = [];

  if (facts.bans.length > 0) {
    const result = applyProtocolCommand(state, { type: "RECORD_RESOLVED_BANS", heroes: facts.bans });
    if (result.rejected) for (const heroId of facts.bans) rejected.push({ heroId, reason: result.rejected });
    else state = result.state;
  }
  const picking = facts.started && (facts.bansClosed || facts.bans.length > 0 || facts.picks.length > 0);
  if (!picking) return { state, localSide, ownBindings: [], ownPositions: EMPTY_LIVE_POSITION_RESOLUTION, deferred: [...facts.picks], rejected };
  state = applyProtocolCommand(state, { type: "BAN_RESOLUTION_COMPLETE" }).state;

  const ownSeals: { heroId: HeroId; round: 1 | 2 | 3; slotIndex: number; position: Position | null }[] = [];
  let pending = [...facts.picks];
  let progressed = true;
  while (progressed && pending.length > 0) {
    progressed = false;
    for (const pick of pending) {
      const slot = legalActions(state)
        .flatMap((action) => (action.type === "SUBMIT_SEALED_SELECTION" && action.side === pick.side ? [action.slotIndex] : []))
        .sort((a, b) => a - b)[0];
      if (slot === undefined) continue;
      const round = state.rankedAp?.round?.round;
      const result = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: pick.side, slotIndex: slot, heroId: pick.heroId });
      pending = pending.filter((candidate) => candidate !== pick);
      progressed = true;
      if (result.rejected) {
        rejected.push({ heroId: pick.heroId, reason: result.rejected });
        break;
      }
      state = result.state;
      if (pick.side === localSide && round !== undefined) ownSeals.push({ heroId: pick.heroId, round, slotIndex: slot, position: pick.position });
      break;
    }
  }
  // POSITION != SLOT: the (round, slotIndex) only says WHERE the kernel sealed the hero; the position comes from the
  // fact itself (EXPLICIT) or from the Player's own seat (LOCAL_PLAYER), never from the slot.
  const ownPositions = resolveLiveOwnPositions({
    ownPicks: ownSeals.map((seal) => ({ heroId: seal.heroId, explicitPosition: seal.position })),
    localPlayer: { position: base.humanPosition ?? null, heroId: facts.localHeroId },
  });
  const ownBindings: OwnPickPositionBinding[] = ownSeals.flatMap((seal, index) => {
    const resolved = ownPositions.heroes[index];
    if (!resolved || resolved.position === null) return [];
    return [{ round: seal.round, slotIndex: seal.slotIndex, assignedPosition: resolved.position, provenance: resolved.provenance }];
  });
  return { state, localSide, ownBindings, ownPositions, deferred: pending, rejected };
}
