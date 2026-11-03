/* LANDING-01B · the proposition: what the visitor gets while drafting. One block, not three: the product itself
   (a draft played out in the frames of `LandingProductState`) with the three rules that describe it written under
   it. The stepper is the only control (ActionQuiet, aria-pressed): the visitor drives the draft, or lets it run one
   pass. Each step is a real change of data, so each motion answers a change — never a timer.
   After the Counterfactual this is where the page calms down: the stage is the Hero's own vocabulary, quieter. */
"use client";

import { useRef } from "react";
import { ActionQuiet } from "@/design/canonical/primitives";
import { SkinStage } from "@/design/canonical/motion/skin";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { CoachSlot, CoachSlotProvider, coachCueFor, type CoachCharacter } from "../coach/coach-slot";
import { PROPOSITION } from "../copy";
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
    <div aria-label={PROPOSITION.stepperLabel} className="ld-stepper" role="group">
      {state.frames.map((entry, index) => <StepButton index={index} key={entry.id} label={entry.label} onSelect={player.select} selected={index === player.index} />)}
      <span className="ld-stepper-spacer" />
      <ActionQuiet icon="shift" onPress={player.replay}>{PROPOSITION.replay}</ActionQuiet>
    </div>
  );
}

function Narrative({ text }: { text: string }) {
  return <p aria-live="polite" className="ld-narrative" role="status">{text}</p>;
}

function IllustrativeNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="ld-illustrative">{PROPOSITION.illustrative}</p>;
}

function Points() {
  return (
    <ol aria-label={PROPOSITION.pointsLabel} className="ld-points">
      {PROPOSITION.points.map((point, index) => (
        <li className="ld-point" key={point.id}>
          <span aria-hidden="true" className="ld-point-index">{String(index + 1).padStart(2, "0")}</span>
          <h3 className="ld-point-title">{point.title}</h3>
          <p className="ld-point-body">{point.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function PropositionSection({ character, productState, reducedMotion, showCoachPlaceholder }: { character: CoachCharacter | null; productState: LandingProductState; reducedMotion: boolean; showCoachPlaceholder: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const player = useDemoPlayer(productState.frames, host, !reduced);
  const cue = coachCueFor(player.frame, player.previous);
  return (
    <LandingSection id="proposition" kicker={PROPOSITION.kicker} lede={PROPOSITION.lede} title={PROPOSITION.title}>
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
      <Points />
    </LandingSection>
  );
}
