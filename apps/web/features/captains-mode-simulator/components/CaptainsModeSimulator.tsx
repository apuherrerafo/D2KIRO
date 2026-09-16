"use client";

// R1 S7 (Blocker 2) -- top-level Captain's Mode entry point, composed the same way
// /simulator's Ranked All Pick tree already is: one hook owns the engine conversation
// (use-captains-mode-session.ts), this component only picks which panel to show.
import { useState } from "react";
import { BUTTON_SECONDARY } from "@/features/draft/styles";
import type { TeamSide } from "@/features/draft/types";
import { useHeroCatalog } from "@/features/draft/use-hero-catalog";
import { EngineUnreachableBanner } from "../../random-draft-simulator/components/EngineUnreachableBanner";
import { CopilotPanel } from "../../random-draft-simulator/components/CopilotPanel";
import { loadMetaSnapshot } from "../../random-draft-simulator/meta-loader";
import { useCaptainsModeSession } from "../use-captains-mode-session";
import { CaptainsModeConfigPanel } from "./CaptainsModeConfigPanel";
import { CaptainsModeBoard } from "./CaptainsModeBoard";

function IdleView({
  localSide,
  firstPickSide,
  onLocalSideChange,
  onFirstPickSideChange,
  onStart,
}: {
  localSide: TeamSide;
  firstPickSide: TeamSide;
  onLocalSideChange: (side: TeamSide) => void;
  onFirstPickSideChange: (side: TeamSide) => void;
  onStart: () => void;
}) {
  return (
    <CaptainsModeConfigPanel
      localSide={localSide}
      firstPickSide={firstPickSide}
      onLocalSideChange={onLocalSideChange}
      onFirstPickSideChange={onFirstPickSideChange}
      onStart={onStart}
    />
  );
}

export function CaptainsModeSimulator() {
  const { heroes: heroCatalog } = useHeroCatalog();
  const session = useCaptainsModeSession();
  const [localSide, setLocalSide] = useState<TeamSide>("radiant");
  const [firstPickSide, setFirstPickSide] = useState<TeamSide>("radiant");

  async function handleStart() {
    const { currentPatch } = await loadMetaSnapshot();
    await session.start({ localSide, firstPickSide, patch: currentPatch });
  }

  return (
    <div className="flex flex-col gap-4">
      <EngineUnreachableBanner />
      {session.phase === "idle" && (
        <IdleView
          localSide={localSide}
          firstPickSide={firstPickSide}
          onLocalSideChange={setLocalSide}
          onFirstPickSideChange={setFirstPickSide}
          onStart={handleStart}
        />
      )}
      {session.phase === "unreachable" && (
        <div className="flex flex-col gap-3 rounded-lg border border-signal-negative bg-surface-raised p-4">
          <span className="text-body text-signal-negative">No se pudo continuar el draft de Captain&apos;s Mode.</span>
          <button type="button" onClick={session.reset} className={`self-start ${BUTTON_SECONDARY}`}>
            Volver a intentar
          </button>
        </div>
      )}
      {(session.phase === "active" || session.phase === "complete") && session.snapshot && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <CaptainsModeBoard
            snapshot={session.snapshot}
            localAction={session.localAction}
            isComplete={session.phase === "complete"}
            heroCatalog={heroCatalog}
            onSelectHero={session.submitHero}
          />
          <div className="flex flex-col gap-4">
            <CopilotPanel recommendations={session.recommendations} heroCatalog={heroCatalog} previewStatus={session.previewStatus} />
            {session.phase === "complete" && (
              <button type="button" onClick={session.reset} className={`self-start ${BUTTON_SECONDARY}`}>
                Nuevo draft
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
