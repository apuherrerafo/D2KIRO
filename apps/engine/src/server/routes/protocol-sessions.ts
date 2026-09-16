import { resolveSimulatorCollisionAuthority } from "../../draft-protocol/adapters/simulator-authority";
import { lowestEligibleHeroIdStrategy } from "../../draft-protocol/adapters/cm-simulator";
import { perspectiveToLegacyDraftState } from "../../draft-protocol/adapters/suggestion-bridge";
import {
  isValidBotSelectionBody,
  isValidCreateProtocolSessionBody,
  isValidSimulatorAuthorityBody,
  isValidSubmitProtocolCommandBody,
  isTeamSide,
} from "../../draft-protocol/validation";
import { isTrustedServerOnlyCommand, legalActions, loadTrustedEligibilityArtifact } from "../../draft-protocol";
import type { DraftPathArchetype } from "../../draft-paths/types";
import type { DraftState } from "../../draft/reducer";
import type { SuggestionSet } from "../../signals/mix";
import { buildRecommendationSetV2, translateRecommendationSetToLegacySuggestionSet } from "../../recommendation";
import { ProtocolSessionStore } from "../protocol-session";

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
  accountId: null,
  // R1 S5: widened to include teamOpening/diversitySeed -- app.ts's real
  // computeSuggestionsForState already accepts both (it forwards options straight into
  // buildSuggestions); this type only used to advertise archetypeIntent because bot-selection was
  // its only caller. recommendation/build.ts's buildRecommendationSetV2 is now a second real
  // caller and needs both to reach V6.
  options?: {
    archetypeIntent?: DraftPathArchetype;
    teamOpening?: boolean;
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
}

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

export function createProtocolSessionRoutes(deps: ProtocolSessionRouteDeps) {
  async function post(request: Request): Promise<Response> {
    // Same opportunistic-cleanup discipline as SessionStore/simulator-sessions.ts -- no scheduler
    // of its own, just a cheap sweep on the path that creates new sessions.
    deps.store.evictStale();
    const body: unknown = await request.json().catch(() => null);
    if (!isValidCreateProtocolSessionBody(body)) return badRequest("invalid_body");

    const sessionId = crypto.randomUUID();
    const created = deps.store.create({
      sessionId,
      rulesetId: body.rulesetId,
      patch: body.patch,
      partyContext: body.partyContext,
      localSide: body.localSide,
      adapterKind: body.adapterKind,
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
    const view = deps.store.view(sessionId);
    return Response.json({ view, legalActions: deps.store.authorizedLegalActions(sessionId) });
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
    return Response.json(
      { accepted: !result.rejected, rejected: result.rejected, view: deps.store.view(sessionId), legalActions: deps.store.authorizedLegalActions(sessionId) },
      { status: 202 },
    );
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

    const resolution = resolveSimulatorCollisionAuthority(state, body.seed);
    if (!resolution) return Response.json({ applied: false, reason: "no_pending_collision" }, { status: 409 });

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

  /**
   * R1 S5 -- RecommendationSet/v2: the one recommendation truth for kernel-backed sessions.
   * Follows the exact same perspective-forbidden guard as `get()` above -- a caller can request
   * only ITS OWN side's recommendations, never inject an arbitrary perspective (same trust
   * boundary as the rest of this route family). `?format=legacy` returns the honest V1 projection
   * (translate-v1.ts) for a caller that only understands `suggestions/v1` -- it is still V2
   * underneath; nothing is rescored for that query param.
   */
  async function getRecommendations(sessionId: string, url: URL): Promise<Response> {
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
    const recommendationSet = await buildRecommendationSetV2({
      state,
      view,
      actor: metadata.localSide,
      patch: metadata.patch,
      computeSuggestions: deps.computeSuggestions,
    });

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
    return Response.json(recommendationSet);
  }

  return {
    post,
    get,
    postCommand,
    postSimulatorAuthority,
    postBotSelection,
    getRecommendations,
    parseSessionId,
    parseSessionSubpath,
  };
}
