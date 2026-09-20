import { resolveSimulatorCollisionAuthority } from "../../draft-protocol/adapters/simulator-authority";
import { lowestEligibleHeroIdStrategy } from "../../draft-protocol/adapters/cm-simulator";
import { perspectiveToLegacyDraftState } from "../../draft-protocol/adapters/suggestion-bridge";
import {
  isValidBotSelectionBody,
  isValidCreateProtocolSessionBody,
  isValidResolveBansBody,
  isValidSimulatorAuthorityBody,
  isValidSubmitProtocolCommandBody,
  isTeamSide,
} from "../../draft-protocol/validation";
import { isTrustedServerOnlyCommand, legalActions, loadTrustedEligibilityArtifact } from "../../draft-protocol";
import type { PerspectiveDraftView, TeamSide } from "../../draft-protocol";
import type { DraftPathArchetype } from "../../draft-paths/types";
import type { DraftState } from "../../draft/reducer";
import type { SuggestionSet } from "../../signals/mix";
import {
  AP_RECOMMENDATION_OUTPUT_LIMIT,
  buildRecommendationSetV2,
  translateRecommendationSetToLegacySuggestionSet,
  type RecommendationSetV2,
} from "../../recommendation";
import type { RecommendationOutputV3 } from "../../coach";
import { loadHeroPositions, type HeroPositions } from "../../signals/hero-positions";
import { rosterSlotForRoundSlot } from "../../simulator/ap-simulator-policy";
import {
  defaultBanResolutionPolicy,
  resolveSimulatorBans,
  type BanResolutionPolicy,
  type HeroUniverse,
} from "../../simulator/ban-resolution";
import { chooseEnemyBotHero, createEnemyBotConfig } from "../../simulator/enemy-bot";
import { isApSimulatorMetadata } from "../../simulator/session-config";
import { ProtocolSessionStore } from "../protocol-session";
import { createCoachRecommendations } from "./coach-recommendations";

// R1 S2/S3 -- HTTP surface for kernel-backed draft sessions: the flow the frozen contract for
// this wave mandates end to end --
//
//   adapter -> ProtocolKernel -> authoritative state -> project(viewer) -> legalGameplayActions
//
// Every route here reads/writes ONLY through ProtocolSessionStore (which itself only ever calls
// applyProtocolCommand -- kernel.ts's one authoritative mutation path). No route recomputes a
// protocol decision locally; a client only ever sees a PerspectiveDraftView, never authoritative
// hidden state. This is deliberately a SEPARATE session/route family from server/session.ts's
// legacy SessionStore -- see draft-protocol/types.ts's header comment and the design doc for why
// full legacy retirement is out of scope for a single slice, and .kiro/specs for the migration
// plan this file is step one of.

export type ComputeSuggestionsForDraftState = (
  state: DraftState,
  accountId: number | null,
  // R1 S5: widened to include teamOpening/diversitySeed -- app.ts's real
  // computeSuggestionsForState already accepts both (it forwards options straight into
  // buildSuggestions); this type only used to advertise archetypeIntent because bot-selection was
  // its only caller. recommendation/build.ts's buildRecommendationSetV2 is now a second real
  // caller and needs both to reach V6.
  options?: {
    archetypeIntent?: DraftPathArchetype;
    teamOpening?: boolean;
    targetPosition?: 1 | 2 | 3 | 4 | 5;
    diversitySeed?: string;
    // R1 S5 (blocker 3): the kernel's own certified legal hero universe, when the caller has one
    // (recommendation/build.ts, for Captain's Mode) -- forwarded verbatim into buildSuggestions.
    candidateHeroIds?: readonly number[];
  },
) => Promise<SuggestionSet>;

export interface ProtocolSessionRouteDeps {
  store: ProtocolSessionStore;
  computeSuggestions: ComputeSuggestionsForDraftState;
  /**
   * SERVER-SIDE source of the approved CM eligibility artifact -- the deployment-bootstrap hook.
   * Called once per Captain's Mode session creation; `null`/absent leaves the session with no
   * certified eligibility, i.e. fail-closed. Injectable so tests supply an inline fixture and
   * never read the real artifact (same seam discipline as heroPositions/heroCapabilities).
   * Defaults to the on-disk artifact, which is gitignored and absent unless an operator put it
   * there -- so the default behaviour is, and stays, fail-closed.
   */
  trustedEligibility?: () => unknown;
  /**
   * R1 S7 (final blocker repair, Blocker 1) -- TEST-ONLY construction-time seam. When (and only
   * when) `true`, postBotSelection honors a client-supplied `forcedHeroId` in the request body.
   * Absent/`false` -- what every production request path gets, unconditionally -- makes the field
   * structurally inert: no environment variable, however it is set, can turn this on, because
   * nothing in this route reads `process.env` for this decision anymore. `createApp()`
   * (server/app.ts) forwards this straight from `AppDeps.allowClientForcedBotSelection`, which
   * `index.ts` (the file Railway/`apps/engine`'s `start`/`dev` scripts actually run) never sets --
   * only `index.e2e.ts` (never wired to any production start path) hardcodes it to `true`.
   */
  allowClientForcedBotSelection?: boolean;
  /**
   * AP Simulator ban resolution needs the hero universe (every hero + how likely each is to be
   * banned). Server-side source, never client-supplied. Absent -> resolve-bans fails closed with
   * 503 and the session stays in ban configuration. Injectable so tests use a fixture (S2).
   */
  heroUniverse?: () => Promise<HeroUniverse>;
  /** Injectable ban policy (defaults to the product policy) -- lets tests prove the fail-closed path. */
  banResolutionPolicy?: BanResolutionPolicy;
  /** Curated position evidence for the Enemy Bot's seat-constrained candidate universe (S10). Never the real file in tests. */
  heroPositions?: HeroPositions;
  /**
   * TEST-ONLY construction-time seam (same pattern as allowClientForcedBotSelection). When true,
   * POST /:id/test-advance-clock can push the Simulator TIMER clock of a session forward so an
   * acceptance test crosses a round deadline without real waiting. Absent/false -- every production
   * path, unconditionally -- makes that route answer 404. Only index.e2e.ts ever sets it.
   */
  allowTestClockControl?: boolean;
}

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

function oppositeSide(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

/**
 * A seeded Simulator session is an AP Ranked Roles V1 session: Ranked All Pick, the Player controls
 * all five seats of their own side. Any side and any personal position are supported -- what is
 * rejected is only a shape that would leave some own seat uncontrolled or controlled by the wrong side.
 */
function isSupportedApSimulatorBody(body: {
  rulesetId: string;
  localSide: TeamSide;
  partyContext: { partySize: number; controlledSlots: { side: TeamSide; slotIndex: number }[] };
}): boolean {
  const controlled = body.partyContext.controlledSlots;
  return body.rulesetId === "dota2/ranked-all-pick"
    && body.partyContext.partySize === 5
    && controlled.length === 5
    && new Set(controlled.map((slot) => slot.slotIndex)).size === 5
    && controlled.every((slot) => slot.side === body.localSide);
}

export function createProtocolSessionRoutes(deps: ProtocolSessionRouteDeps) {
  async function post(request: Request): Promise<Response> {
    // Same opportunistic-cleanup discipline as SessionStore/simulator-sessions.ts -- no scheduler
    // of its own, just a cheap sweep on the path that creates new sessions.
    deps.store.evictStale();
    const body: unknown = await request.json().catch(() => null);
    if (!isValidCreateProtocolSessionBody(body)) return badRequest("invalid_body");
    if (body.humanPosition !== undefined && !isSupportedApSimulatorBody(body)) {
      return Response.json({ error: "unsupported_simulator_policy" }, { status: 422 });
    }

    const sessionId = crypto.randomUUID();
    const created = deps.store.create({
      sessionId,
      rulesetId: body.rulesetId,
      patch: body.patch,
      partyContext: body.partyContext,
      localSide: body.localSide,
      adapterKind: body.adapterKind,
      humanPosition: body.humanPosition,
      simulatorSeed: body.simulatorSeed,
    });
    if (!created.ok) return Response.json({ error: created.reason, detail: "detail" in created ? created.detail : undefined }, { status: 422 });

    // Captain's Mode needs a certified hero universe before the kernel will allow any hero
    // action. It is loaded HERE, from the server side, precisely so the client never gets to
    // supply it. No artifact (the default) -> nothing loaded -> ELIGIBILITY_UNVERIFIED on the
    // first CM action, which is the fail-closed posture this ruleset already had.
    let eligibilityCertified = false;
    if (body.rulesetId === "dota2/captains-mode") {
      const readArtifact = deps.trustedEligibility ?? (() => loadTrustedEligibilityArtifact());
      const artifact = readArtifact();
      if (artifact !== null && artifact !== undefined) {
        eligibilityCertified = deps.store.loadTrustedEligibility(created.sessionId, artifact).ok;
      }
    }
    return Response.json(
      { sessionId: created.sessionId, ruleset: created.state.ruleset, status: created.state.status, eligibilityCertified },
      { status: 201 },
    );
  }

  /**
   * The one response shape every session route returns: the Player's perspective view, the actions
   * the Player may take, and -- for AP Simulator sessions once a round has been handed over -- the
   * Simulator-layer timer/gold-penalty projection (never kernel state, never a hidden hero).
   */
  function snapshotBody(sessionId: string) {
    return {
      view: deps.store.view(sessionId),
      legalActions: deps.store.authorizedLegalActions(sessionId),
      simulator: deps.store.simulatorTimerView(sessionId),
    };
  }

  function parseSessionSubpath(pathname: string, suffix: string): string | null {
    const pattern = new RegExp(`^/api/session/protocol/([^/]+)/${suffix}$`);
    const match = pattern.exec(pathname);
    return match ? decodeURIComponent(match[1]!) : null;
  }

  function parseSessionId(pathname: string): string | null {
    const match = /^\/api\/session\/protocol\/([^/]+)$/.exec(pathname);
    return match ? decodeURIComponent(match[1]!) : null;
  }

  function get(sessionId: string, url: URL): Response {
    const sideParam = url.searchParams.get("side");
    if (sideParam !== null && !isTeamSide(sideParam)) return badRequest("invalid_side");
    const state = deps.store.get(sessionId);
    if (!state) return notFound();
    const metadata = deps.store.metadata(sessionId)!;
    if (sideParam !== null && sideParam !== metadata.localSide) {
      return Response.json({ error: "perspective_forbidden" }, { status: 403 });
    }
    return Response.json(snapshotBody(sessionId));
  }

  async function postCommand(request: Request, sessionId: string): Promise<Response> {
    if (!deps.store.get(sessionId)) return notFound();
    const body: unknown = await request.json().catch(() => null);
    if (!isValidSubmitProtocolCommandBody(body)) return badRequest("invalid_body");
    const metadata = deps.store.metadata(sessionId)!;
    if (body.viewerSide !== undefined && body.viewerSide !== null && body.viewerSide !== metadata.localSide) {
      return Response.json({ error: "perspective_forbidden" }, { status: 403 });
    }
    // R1 S3 (final trust-boundary repair). TRUSTED_SERVER_ONLY commands are refused here on the
    // basis of WHERE THEY ARRIVED, before any consideration of how well-formed they are -- a
    // perfectly valid, perfectly self-consistent OFFICIAL_DEPOT snapshot is refused exactly like a
    // garbage one, because the client is not an authority on its own eligibility no matter what
    // it writes. Separate error from `action_forbidden` so the refusal is legible as a boundary,
    // not as "wrong side/turn". The supported path is ProtocolSessionStore.loadTrustedEligibility,
    // reachable only from the server side (draft-protocol/trusted-eligibility.ts).
    if (isTrustedServerOnlyCommand(body.command.type)) {
      return Response.json(
        { error: "admin_command_forbidden", detail: `${body.command.type} is loaded server-side only, never from a request body` },
        { status: 403 },
      );
    }
    if (!deps.store.isCommandAuthorized(sessionId, body.command)) {
      return Response.json({ error: "action_forbidden" }, { status: 403 });
    }

    const result = deps.store.apply(sessionId, body.command);
    if (!result) return notFound();
    return Response.json({ accepted: !result.rejected, rejected: result.rejected, ...snapshotBody(sessionId) }, { status: 202 });
  }

  /**
   * S2.4 -- SIMULATOR collision authority. Explicit, separate endpoint (never folded into
   * postCommand) so it can never be confused with a real command an ordinary adapter would send:
   * only a caller that KNOWS it's driving a simulator scenario reaches for this path at all.
   */
  async function postSimulatorAuthority(request: Request, sessionId: string): Promise<Response> {
    const state = deps.store.get(sessionId);
    if (!state) return notFound();
    if (!deps.store.isSimulator(sessionId)) return Response.json({ error: "simulator_authority_forbidden" }, { status: 403 });
    const body: unknown = await request.json().catch(() => null);
    if (!isValidSimulatorAuthorityBody(body)) return badRequest("invalid_body");

    // body.seed is accepted for API compatibility and IGNORED: the winner is decided only by the
    // session registration ledger (first accepted registration wins), never by a seed.
    const pending = state.rankedAp?.round?.pendingCollision;
    if (!pending) return Response.json({ applied: false, reason: "no_pending_collision" }, { status: 409 });
    const resolution = resolveSimulatorCollisionAuthority(pending, deps.store.registrationEvidence(sessionId)!);
    if (!resolution.ok) {
      return Response.json({ applied: false, error: "collision_authority_unavailable", reason: resolution.reason }, { status: 409 });
    }

    const result = deps.store.apply(sessionId, resolution.command);
    return Response.json({ applied: !result?.rejected, rejected: result?.rejected, policy: resolution.policy, view: deps.store.view(sessionId), legalActions: deps.store.authorizedLegalActions(sessionId) });
  }

  /**
   * S2.2/S2.6 -- bot decision for a sealed slot, built ONLY from project(state, side) (never
   * authoritative hidden state) via adapters/suggestion-bridge.ts, then scored by the real V6
   * engine (deps.computeSuggestions, the same pipeline /api/suggestions/preview uses) -- this is
   * the structural fix for the "bot receives pendingUserPicks" bug (engine.md).
   */
  async function postBotSelection(request: Request, sessionId: string): Promise<Response> {
    const state = deps.store.get(sessionId);
    const metadata = deps.store.metadata(sessionId);
    if (!state || !metadata) return notFound();
    const body: unknown = await request.json().catch(() => null);
    if (!isValidBotSelectionBody(body)) return badRequest("invalid_body");

    const botView = deps.store.botView(sessionId);
    if (!botView) return Response.json({ error: "bot_selection_forbidden" }, { status: 403 });
    const botSide = botView.viewerSide!;

    if (state.captainsMode) {
      const action = legalActions(state).find(
        (candidate) => candidate.type === "CM_ACTION" && candidate.absoluteSide === botSide,
      );
      if (!action || action.type !== "CM_ACTION") {
        return Response.json({ accepted: false, reason: "no_open_slot" }, { status: 409 });
      }
      const heroId = lowestEligibleHeroIdStrategy.chooseHeroId(action.eligibleHeroIds, action);
      const result = deps.store.apply(sessionId, { type: "CM_ACTION", actor: action.actor, kind: action.kind, heroId });
      return Response.json({
        accepted: !result?.rejected,
        rejected: result?.rejected,
        view: deps.store.view(sessionId),
        legalActions: deps.store.authorizedLegalActions(sessionId),
      });
    }

    const openSlotsForSide = legalActions(state).filter(
      (action): action is Extract<typeof action, { type: "SUBMIT_SEALED_SELECTION" }> =>
        action.type === "SUBMIT_SEALED_SELECTION" && action.side === botSide,
    );
    if (openSlotsForSide.length === 0) {
      return Response.json({ accepted: false, reason: "no_open_slot" }, { status: 409 });
    }

    const legacyState = perspectiveToLegacyDraftState(botView, { patch: metadata.patch });
    const takenHeroIds = new Set([...legacyState.banned, ...legacyState.picks.radiant, ...legacyState.picks.dire]);

    // R1 S7 (final blocker repair, Blocker 1) -- TEST-ONLY, gated on the construction-time
    // `deps.allowClientForcedBotSelection` seam (never an environment variable -- see the doc
    // comment on ProtocolSessionRouteDeps above). Lets a deterministic browser E2E force the AP
    // bot's sealed selection to a specific heroId -- still submitted through the SAME real
    // SUBMIT_SEALED_SELECTION kernel command below, so the collision reducer runs for real. A
    // forced heroId that's already taken (or the seam being off, which is every production
    // request, unconditionally) falls straight through to the real V6 path, never forcing
    // something the kernel would reject anyway.
    const forcedHeroId =
      deps.allowClientForcedBotSelection === true && body.forcedHeroId !== undefined && !takenHeroIds.has(body.forcedHeroId)
        ? body.forcedHeroId
        : null;

    let heroId = forcedHeroId;
    if (heroId === null) {
      const suggestions = await deps.computeSuggestions(legacyState, null);
      const chosen = suggestions.suggestions.find((suggestion) => !takenHeroIds.has(suggestion.hero));
      if (!chosen) return Response.json({ accepted: false, reason: "no_suggestion_available" }, { status: 409 });
      heroId = chosen.hero;
    }

    const slot = openSlotsForSide[0]!;
    const result = deps.store.apply(sessionId, {
      type: "SUBMIT_SEALED_SELECTION",
      side: slot.side,
      slotIndex: slot.slotIndex,
      heroId,
    });
    return Response.json({
      accepted: !result?.rejected,
      rejected: result?.rejected,
      view: deps.store.view(sessionId),
      legalActions: deps.store.authorizedLegalActions(sessionId),
    });
  }

  async function postTestAdvanceClock(request: Request, sessionId: string): Promise<Response> {
    if (deps.allowTestClockControl !== true) return notFound();
    const body: unknown = await request.json().catch(() => null);
    const ms = typeof body === "object" && body !== null ? (body as { ms?: unknown }).ms : undefined;
    if (typeof ms !== "number" || !Number.isInteger(ms) || ms <= 0 || ms > 600_000) return badRequest("invalid_body");
    if (!deps.store.advanceTestClock(sessionId, ms)) return notFound();
    return Response.json({ advancedMs: ms, simulator: deps.store.simulatorTimerView(sessionId) });
  }

  /**
   * AP Simulator ban resolution: BAN_CONFIGURATION -> BAN_RESOLUTION -> PICK_ROUND_1.
   *
   * The Player's nominations arrive here; the other nine participants are simulated from the
   * session seed; BanResolutionPolicy produces the resolved set; ONLY that final set is recorded in
   * the kernel. FAIL CLOSED: if the policy throws or returns something invalid, nothing is recorded,
   * Round 1 is not entered, and the very same request can be retried (`retryable: true`). An empty
   * or reduced ban set is never fabricated. The two kernel commands are applied atomically.
   */
  async function postResolveBans(request: Request, sessionId: string): Promise<Response> {
    const state = deps.store.get(sessionId);
    const metadata = deps.store.metadata(sessionId);
    if (!state || !metadata) return notFound();
    if (!state.rankedAp || !isApSimulatorMetadata(metadata)) {
      return Response.json({ error: "ap_simulator_required" }, { status: 403 });
    }
    if (state.rankedAp.phase !== "BAN_RESOLUTION" || state.rankedAp.banResolutionComplete) {
      return Response.json({ error: "bans_already_resolved" }, { status: 409 });
    }
    const body: unknown = await request.json().catch(() => null);
    if (!isValidResolveBansBody(body)) return badRequest("invalid_body");

    if (!deps.heroUniverse) {
      return Response.json({ error: "ban_resolution_failed", reason: "hero_universe_unavailable", retryable: true }, { status: 503 });
    }
    let universe: HeroUniverse;
    try {
      universe = await deps.heroUniverse();
    } catch {
      return Response.json({ error: "ban_resolution_failed", reason: "hero_universe_unavailable", retryable: true }, { status: 503 });
    }

    const resolution = resolveSimulatorBans({
      playerPreferences: body.playerBanPreferences as (number | null)[],
      universe,
      seed: metadata.simulatorSeed!,
      policy: deps.banResolutionPolicy ?? defaultBanResolutionPolicy,
    });
    if (!resolution.ok) {
      if (resolution.reason === "invalid_player_preferences") {
        return Response.json({ error: "invalid_ban_preferences", detail: resolution.detail }, { status: 400 });
      }
      return Response.json({ error: "ban_resolution_failed", reason: resolution.reason, retryable: true }, { status: 422 });
    }

    const applied = deps.store.applyAtomically(sessionId, [
      { type: "RECORD_RESOLVED_BANS", heroes: resolution.bans },
      { type: "BAN_RESOLUTION_COMPLETE" },
    ]);
    if (!applied || !applied.ok) {
      return Response.json({ error: "ban_resolution_failed", reason: "kernel_rejected", retryable: true }, { status: 422 });
    }
    return Response.json({ resolvedBans: resolution.bans, ...snapshotBody(sessionId) });
  }

  /**
   * AP Simulator driver for the ENEMY side. Advances only Enemy Bot seats and pauses at the
   * boundaries the Player can observe: the Player's own seats becoming legal ("human_input"), a
   * round having been revealed ("round_revealed"), or the draft being complete.
   *
   * Every enemy decision is built from `project(state, enemySide)` -- the enemy's own perspective,
   * in which the Player's sealed picks are HIDDEN -- and is constrained to heroes playable at that
   * seat's INTERNAL position (chooseEnemyBotHero). That assignment is Simulator truth and is never
   * placed in any response.
   */
  async function postAutoDrive(sessionId: string): Promise<Response> {
    let state = deps.store.get(sessionId);
    const metadata = deps.store.metadata(sessionId);
    if (!state || !metadata) return notFound();
    if (!state.rankedAp || !isApSimulatorMetadata(metadata)) {
      return Response.json({ error: "ap_simulator_required" }, { status: 403 });
    }
    const humanSide = metadata.localSide;
    const botConfig = createEnemyBotConfig(metadata.simulatorSeed!, oppositeSide(humanSide));
    const heroPositions = deps.heroPositions ?? MODULE_HERO_POSITIONS;
    const initialRound = state.rankedAp.round?.round ?? null;

    for (let guard = 0; guard < 64; guard += 1) {
      state = deps.store.get(sessionId)!;
      const ranked = state.rankedAp!;
      const currentRound = ranked.round?.round ?? null;
      if (initialRound !== null && currentRound !== initialRound) {
        return Response.json({ ...snapshotBody(sessionId), stopReason: "round_revealed", completedRound: initialRound });
      }
      if (state.status === "COMPLETE") {
        return Response.json({
          ...snapshotBody(sessionId),
          stopReason: initialRound === null ? "complete" : "round_revealed",
          completedRound: initialRound,
        });
      }
      if (state.status === "WAITING_FOR_COLLISION_AUTHORITY") {
        // First-registration-wins from the ledger. Missing/ambiguous evidence FAILS CLOSED: the
        // draft stays paused in WAITING_FOR_COLLISION_AUTHORITY and no winner is invented.
        const pending = ranked.round?.pendingCollision;
        const evidence = deps.store.registrationEvidence(sessionId);
        if (!pending || !evidence) return Response.json({ error: "collision_resolution_unavailable" }, { status: 409 });
        const resolution = resolveSimulatorCollisionAuthority(pending, evidence);
        if (!resolution.ok) {
          return Response.json({ error: "collision_authority_unavailable", reason: resolution.reason }, { status: 409 });
        }
        deps.store.apply(sessionId, resolution.command);
        continue;
      }
      if (currentRound === null) {
        return Response.json({ error: "no_open_round" }, { status: 409 });
      }

      const openActions = legalActions(state).filter(
        (action): action is Extract<typeof action, { type: "SUBMIT_SEALED_SELECTION" }> => action.type === "SUBMIT_SEALED_SELECTION",
      );
      // Enemy seats first: after a collision the enemy re-picks (knowing the newly banned hero)
      // before the Player is handed the reopened seat back.
      const enemyAction = openActions.find((action) => action.side === botConfig.side);
      if (!enemyAction) {
        if (!openActions.some((action) => action.side === humanSide)) {
          return Response.json({ error: "no_open_action" }, { status: 409 });
        }
        deps.store.ensureSimulatorTimer(sessionId);
        return Response.json({ ...snapshotBody(sessionId), stopReason: "human_input", completedRound: null });
      }

      const rosterSlot = rosterSlotForRoundSlot(currentRound, enemyAction.slotIndex);
      if (rosterSlot === null) return Response.json({ error: "participant_mapping_failed" }, { status: 409 });
      const decisionIndex = ranked.confirmedPicks.length + (ranked.round?.sealed.length ?? 0) + ranked.bannedHeroes.length;
      const decision = await chooseEnemyBotHero({
        config: botConfig,
        state,
        slotIndex: enemyAction.slotIndex,
        rosterSlot,
        decisionIndex,
        patch: metadata.patch,
        computeSuggestions: deps.computeSuggestions,
        heroPositions,
      });
      if (!decision) return Response.json({ error: "enemy_bot_no_valid_candidate" }, { status: 409 });
      const result = deps.store.apply(sessionId, { ...enemyAction, heroId: decision.heroId });
      if (!result || result.rejected) {
        return Response.json({ error: "external_pick_rejected", rejected: result?.rejected }, { status: 409 });
      }
    }
    return Response.json({ error: "auto_drive_guard_exhausted" }, { status: 409 });
  }

  /**
   * The V2 set for one session/view -- the ONE place recommendation inputs are assembled (used by the
   * plain V2 response and, injected, by the Coach). It reads the authoritative session; nothing
   * downstream of the Coach ever does.
   */
  async function buildV2ForSession(sessionId: string, view: PerspectiveDraftView): Promise<RecommendationSetV2> {
    const state = deps.store.get(sessionId)!;
    const metadata = deps.store.metadata(sessionId)!;
    return buildRecommendationSetV2({
      state,
      view,
      actor: metadata.localSide,
      patch: metadata.patch,
      computeSuggestions: deps.computeSuggestions,
      seed: metadata.simulatorSeed ?? undefined,
      // AP Ranked Roles V1 / Wave 1: the Player controls all five own seats, so there is no
      // single-participant `targetPosition` and no per-seat filter here. Personal-position
      // intelligence (scoping, "YOUR POSITION NOW", hero pool) belongs to later waves.
      outputLimit: isApSimulatorMetadata(metadata) ? AP_RECOMMENDATION_OUTPUT_LIMIT : undefined,
    });
  }

  // Coach path: built ONLY from a perspective-safe context (see coach-recommendations.ts). The store is
  // handed over through a narrow interface that cannot reach authoritative state.
  const coachRecommendations = createCoachRecommendations({
    source: deps.store,
    computeSuggestions: deps.computeSuggestions,
    heroPositions: deps.heroPositions,
  });

  /**
   * R1 S5 -- RecommendationSet/v2: the one recommendation truth for kernel-backed sessions.
   * Follows the exact same perspective-forbidden guard as `get()` above -- a caller can request
   * only ITS OWN side's recommendations, never inject an arbitrary perspective (same trust
   * boundary as the rest of this route family). `?format=legacy` returns the honest V1 projection
   * (translate-v1.ts) for a caller that only understands `suggestions/v1` -- it is still V2
   * underneath; nothing is rescored for that query param.
   */
  async function getRecommendations(sessionId: string, url: URL, accountId: number | null = null): Promise<Response> {
    const sideParam = url.searchParams.get("side");
    if (sideParam !== null && !isTeamSide(sideParam)) return badRequest("invalid_side");
    const state = deps.store.get(sessionId);
    const metadata = deps.store.metadata(sessionId);
    if (!state || !metadata) return notFound();
    if (sideParam !== null && sideParam !== metadata.localSide) {
      return Response.json({ error: "perspective_forbidden" }, { status: 403 });
    }
    const view = deps.store.view(sessionId);
    if (!view) return notFound();

    const startedAt = Date.now();
    // AP Ranked Roles V1 / Wave 2 -- `?format=v3` asks the Coach: a RecommendationOutputV3 plus the V2-shaped
    // set it was built on. That set comes from the PERSPECTIVE-SAFE builder (never from authoritative
    // state, so it is not identical to the legacy V2 body: no one-ply lookahead, no simulator seed). The
    // plain and `?format=legacy` responses below are the legacy V2 path, unchanged.
    const wantsCoach = url.searchParams.get("format") === "v3";
    if (wantsCoach && !view.rankedAp) return Response.json({ error: "coach_requires_ranked_all_pick" }, { status: 422 });
    let recommendationSet: RecommendationSetV2;
    let coachOutput: RecommendationOutputV3 | null = null;
    if (wantsCoach) {
      const recomputation = await coachRecommendations.recommend(sessionId, metadata.humanPosition, accountId);
      if (!recomputation) return notFound();
      recommendationSet = recomputation.recommendationSet;
      coachOutput = recomputation.output;
    } else {
      recommendationSet = await buildV2ForSession(sessionId, view);
    }

    // R1 S7 (safe telemetry) -- diagnóstico mínimo para el MVP: ningún héroe, ni propio ni rival,
    // ni ningún dato de personas. Sólo identidad/estado agregados, ya redactados por basedOn
    // (stateIdentity nunca lleva picks ocultos -- ver identity-hash.ts). Mismo patrón de logging
    // estructurado que ya usa este servidor para rate limiting (app.ts).
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "recommendations_computed",
      sessionId,
      rulesetId: recommendationSet.basedOn.protocolId,
      stateIdentity: recommendationSet.basedOn.stateIdentity,
      protocolStatus: view.status,
      actionKind: recommendationSet.decision.actionKind,
      degradations: recommendationSet.degradations.map((degradation) => degradation.reason),
      recommendationCount: recommendationSet.recommendations.length,
      computedInMs: Date.now() - startedAt,
    }));

    if (url.searchParams.get("format") === "legacy") {
      return Response.json(translateRecommendationSetToLegacySuggestionSet(recommendationSet));
    }
    if (wantsCoach) return Response.json({ output: coachOutput, recommendationSet });
    return Response.json(recommendationSet);
  }

  async function postPositionAssignment(request: Request, sessionId: string, accountId: number | null = null): Promise<Response> {
    const metadata = deps.store.metadata(sessionId);
    if (!metadata) return notFound();
    const body: unknown = await request.json().catch(() => null);
    if (typeof body !== "object" || body === null) return badRequest("invalid_body");
    const value = body as Record<string, unknown>;
    const heroId = value.heroId;
    const position = value.position;
    if (typeof heroId !== "number" || !Number.isInteger(heroId) || heroId <= 0) return badRequest("invalid_body");
    if (position !== null && position !== 1 && position !== 2 && position !== 3 && position !== 4 && position !== 5) return badRequest("invalid_body");
    const view = deps.store.view(sessionId);
    const isOwnVisibleHero = view?.ownPicks.some((slot) => slot.visibility !== "HIDDEN" && slot.heroId === heroId) ?? false;
    if (!isOwnVisibleHero) return Response.json({ error: "own_team_assignment_only" }, { status: 403 });
    const recomputation = await coachRecommendations.assignPosition(sessionId, metadata.humanPosition, accountId, heroId, position);
    if (!recomputation) return notFound();
    return Response.json({ output: recomputation.output, recommendationSet: recomputation.recommendationSet }, { status: 202 });
  }

  return {
    post,
    get,
    postCommand,
    postSimulatorAuthority,
    postResolveBans,
    postTestAdvanceClock,
    postBotSelection,
    postAutoDrive,
    postPositionAssignment,
    getRecommendations,
    parseSessionId,
    parseSessionSubpath,
  };
}

const MODULE_HERO_POSITIONS: HeroPositions = loadHeroPositions();
