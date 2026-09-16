"use client";

// R1 S7 (Blocker 2) -- minimal Captain's Mode session driver. CM has NO hidden information (the
// protocol's frozen contract: "CM picks/bans are immediately REVEALED", perspective.ts) and is
// strictly sequential (24 steps, one actor at a time) -- a much simpler shape than Ranked All
// Pick's blind/timed rounds, so this intentionally does NOT reuse use-random-draft-session.ts's
// timer/reveal machinery. It reuses everything that IS generic: protocol-client.ts's HTTP helpers
// (createSimulatorProtocolSession/submitProtocolCommand/requestBotSelection/fetchRecommendations),
// unchanged.
import { useCallback, useRef, useState } from "react";
import type { TeamSide } from "@/features/draft/types";
import {
  createSimulatorProtocolSession,
  fetchRecommendations,
  requestBotSelection,
  submitProtocolCommand,
  type CmActionKind,
  type ProtocolLegalAction,
  type ProtocolSnapshot,
  type RecommendationSetV2,
} from "../random-draft-simulator/protocol-client";

export type CaptainsModePhase = "idle" | "active" | "complete" | "unreachable";
export type PreviewStatus = "idle" | "loading" | "ready" | "failed";

export interface CaptainsModeStartConfig {
  localSide: TeamSide;
  firstPickSide: TeamSide;
  patch: string;
}

export interface CmActionOption {
  step: number;
  kind: CmActionKind;
  eligibleHeroIds: number[];
}

export interface UseCaptainsModeSessionResult {
  phase: CaptainsModePhase;
  snapshot: ProtocolSnapshot | null;
  recommendations: RecommendationSetV2 | null;
  previewStatus: PreviewStatus;
  /** The local side's currently open CM_ACTION, if it is this side's turn right now. */
  localAction: CmActionOption | null;
  start(config: CaptainsModeStartConfig): Promise<void>;
  submitHero(heroId: number): Promise<void>;
  reset(): void;
}

function findLocalCmAction(legalActions: ProtocolLegalAction[], localSide: TeamSide): CmActionOption | null {
  const action = legalActions.find(
    (candidate): candidate is Extract<ProtocolLegalAction, { type: "CM_ACTION" }> =>
      candidate.type === "CM_ACTION" && candidate.absoluteSide === localSide,
  );
  if (!action) return null;
  return { step: action.step, kind: action.kind, eligibleHeroIds: action.eligibleHeroIds };
}

export function useCaptainsModeSession(fetchImpl: typeof fetch = fetch): UseCaptainsModeSessionResult {
  const [phase, setPhase] = useState<CaptainsModePhase>("idle");
  const [snapshot, setSnapshot] = useState<ProtocolSnapshot | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationSetV2 | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  // `localSide` is read from event handlers only (start/submitHero), never during render, but
  // react-hooks/refs still flags a ref read reached from the render-time `localAction` derivation
  // below -- state, not a ref, is the correct tool here.
  const [localSide, setLocalSide] = useState<TeamSide | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const refreshRecommendations = useCallback(
    async function refreshRecommendations(sessionId: string): Promise<void> {
      setPreviewStatus("loading");
      try {
        const result = await fetchRecommendations(sessionId, fetchImpl);
        if (sessionIdRef.current !== sessionId) return; // superseded by a reset/new session
        setRecommendations(result);
        setPreviewStatus("ready");
      } catch {
        if (sessionIdRef.current === sessionId) setPreviewStatus("failed");
      }
    },
    [fetchImpl],
  );

  // Drives the bot's (opposite) side automatically until either the local side has an open
  // CM_ACTION or the draft is COMPLETE. CM has no reveal pause to simulate (nothing is hidden), so
  // this just keeps calling requestBotSelection -- one HTTP round trip per step, near-instant.
  const driveUntilLocalTurnOrComplete = useCallback(
    async function driveUntilLocalTurnOrComplete(sessionId: string, localSide: TeamSide, current: ProtocolSnapshot): Promise<void> {
      let latest = current;
      try {
        for (let guard = 0; guard < 30; guard += 1) {
          if (latest.view.status === "COMPLETE") {
            setSnapshot(latest);
            setPhase("complete");
            return;
          }
          const localAction = findLocalCmAction(latest.legalActions, localSide);
          if (localAction) {
            setSnapshot(latest);
            void refreshRecommendations(sessionId);
            return;
          }
          latest = await requestBotSelection(sessionId, fetchImpl);
        }
        throw new Error("captains-mode adapter guard exhausted");
      } catch (error) {
        console.error("[useCaptainsModeSession] drive failed", error);
        setPhase("unreachable");
      }
    },
    [fetchImpl, refreshRecommendations],
  );

  const start = useCallback(
    async function start(config: CaptainsModeStartConfig): Promise<void> {
      try {
        const sessionId = await createSimulatorProtocolSession(config.patch, config.localSide, fetchImpl, {
          rulesetId: "dota2/captains-mode",
          partySize: 5,
        });
        sessionIdRef.current = sessionId;
        setLocalSide(config.localSide);
        setPhase("active");
        setRecommendations(null);
        setPreviewStatus("idle");
        const afterFirstPick = await submitProtocolCommand(sessionId, { type: "CONFIRM_FIRST_PICK_SIDE", side: config.firstPickSide }, fetchImpl);
        await driveUntilLocalTurnOrComplete(sessionId, config.localSide, afterFirstPick);
      } catch (error) {
        console.error("[useCaptainsModeSession] start failed", error);
        setPhase("unreachable");
      }
    },
    [driveUntilLocalTurnOrComplete, fetchImpl],
  );

  const submitHero = useCallback(
    async function submitHero(heroId: number): Promise<void> {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !localSide || !snapshot) return;
      const localAction = findLocalCmAction(snapshot.legalActions, localSide);
      if (!localAction) return;
      // CM_ACTION.actor is the RELATIVE side ("first"/"second") -- read straight off the same
      // legal action the eligibleHeroIds came from, never re-derived here (the kernel is the only
      // authority on first/second <-> radiant/dire, resolveAbsoluteSide).
      const rawAction = snapshot.legalActions.find(
        (candidate): candidate is Extract<ProtocolLegalAction, { type: "CM_ACTION" }> =>
          candidate.type === "CM_ACTION" && candidate.absoluteSide === localSide,
      );
      if (!rawAction) return;
      try {
        const next = await submitProtocolCommand(
          sessionId,
          { type: "CM_ACTION", actor: rawAction.actor, kind: rawAction.kind, heroId },
          fetchImpl,
        );
        await driveUntilLocalTurnOrComplete(sessionId, localSide, next);
      } catch (error) {
        console.error("[useCaptainsModeSession] submitHero failed", error);
        setPhase("unreachable");
      }
    },
    [driveUntilLocalTurnOrComplete, fetchImpl, localSide, snapshot],
  );

  const reset = useCallback(function reset(): void {
    sessionIdRef.current = null;
    setLocalSide(null);
    setPhase("idle");
    setSnapshot(null);
    setRecommendations(null);
    setPreviewStatus("idle");
  }, []);

  const localAction = snapshot && localSide ? findLocalCmAction(snapshot.legalActions, localSide) : null;

  return { phase, snapshot, recommendations, previewStatus, localAction, start, submitHero, reset };
}
