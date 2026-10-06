/* LANDING-01B · the product demo. A draft played out in the frames of `LandingProductState`. The
   stepper is the only control (ActionQuiet, aria-pressed): the visitor drives the draft, or lets it run
   one pass. Each step is a real change of data, so each motion answers a change — never a timer. */
"use client";

import { useRef } from "react";
import { ActionQuiet } from "@/design/canonical/primitives";
import { SkinStage } from "@/design/canonical/motion/skin";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { CoachSlot, CoachSlotProvider, coachCueFor, type CoachCharacter } from "../coach/coach-slot";
import { DEMO } from "../copy";
import { useDemoPlayer, type DemoPlayer } from "../hooks";
import type { LandingProductState } from "../product-state/types";
import { DraftStage } from "./DraftStage";
import { LandingSection } from "./LandingSection";

function StepButton({ index, label, onSelect, selected }: { index: number; label: string; onSelect: (index: number) => void; selected: boolean }) {
  function handlePress() {
    onSelect(index);
  }
  return <ActionQuiet onPress={handlePress} selected={selected}>{`${index + 1} · ${label}`}</ActionQuiet>;
}

function Stepper({ player, state }: { player: DemoPlayer; state: LandingProductState }) {
  return (
    <div aria-label={DEMO.stepperLabel} className="ld-stepper" role="group">
      {state.frames.map((entry, index) => <StepButton index={index} key={entry.id} label={entry.label} onSelect={player.select} selected={index === player.index} />)}
      <span className="ld-stepper-spacer" />
      <ActionQuiet icon="shift" onPress={player.replay}>{DEMO.replay}</ActionQuiet>
    </div>
  );
}

function Narrative({ text }: { text: string }) {
  return <p aria-live="polite" className="ld-narrative" role="status">{text}</p>;
}

export function DemoSection({ character, productState, reducedMotion, showCoachPlaceholder }: { character: CoachCharacter | null; productState: LandingProductState; reducedMotion: boolean; showCoachPlaceholder: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const player = useDemoPlayer(productState.frames, host, !reduced);
  const cue = coachCueFor(player.frame, player.previous);
  return (
    <LandingSection id="demo" kicker={DEMO.kicker} lede={DEMO.lede} title={DEMO.title}>
      <div className="ld-demo" ref={host}>
        <Stepper player={player} state={productState} />
        <CoachSlotProvider character={character} cue={cue} reducedMotion={reducedMotion} showPlaceholder={showCoachPlaceholder}>
          <SkinStage center className="ld-demo-field" ghost={String(player.frame.top3[0].fit)}>
            <DraftStage frame={player.frame} previous={player.previous} variant="demo" />
          </SkinStage>
          <div className="ld-demo-foot">
            <Narrative text={player.frame.narrative} />
            <CoachSlot placement="demo" />
          </div>
        </CoachSlotProvider>
        <IllustrativeNote show={productState.illustrative} />
      </div>
    </LandingSection>
  );
}

function IllustrativeNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="ld-illustrative">{DEMO.illustrative}</p>;
}
