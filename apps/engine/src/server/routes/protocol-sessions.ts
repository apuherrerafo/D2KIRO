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
import { legalActions } from "../../draft-protocol";
import type { DraftPathArchetype } from "../../draft-paths/types";
import type { DraftState } from "../../draft/reducer";
import type { SuggestionSet } from "../../signals/mix";
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
  options?: { archetypeIntent?: DraftPathArchetype },
) => Promise<SuggestionSet>;

export interface ProtocolSessionRouteDeps {
  store: ProtocolSessionStore;
  computeSuggestions: ComputeSuggestionsForDraftState;
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
    return Response.json({ sessionId: created.sessionId, ruleset: created.state.ruleset, status: created.state.status }, { status: 201 });
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
    const suggestions = await deps.computeSuggestions(legacyState, null);
    const takenHeroIds = new Set([...legacyState.banned, ...legacyState.picks.radiant, ...legacyState.picks.dire]);
    const chosen = suggestions.suggestions.find((suggestion) => !takenHeroIds.has(suggestion.hero));
    if (!chosen) return Response.json({ accepted: false, reason: "no_suggestion_available" }, { status: 409 });

    const slot = openSlotsForSide[0]!;
    const result = deps.store.apply(sessionId, {
      type: "SUBMIT_SEALED_SELECTION",
      side: slot.side,
      slotIndex: slot.slotIndex,
      heroId: chosen.hero,
    });
    return Response.json({
      accepted: !result?.rejected,
      rejected: result?.rejected,
      view: deps.store.view(sessionId),
      legalActions: deps.store.authorizedLegalActions(sessionId),
    });
  }

  return {
    post,
    get,
    postCommand,
    postSimulatorAuthority,
    postBotSelection,
    parseSessionId,
    parseSessionSubpath,
  };
}
