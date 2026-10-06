/* LANDING-01B · Evidence. The honesty section: the same call at two evidence levels. The count of
   matches is real, so the markers are 1:1 with it (Motion Canonical: gather / scatter). Gathering reads
   as conviction, so it is offered ONLY for a strategic call — with thin evidence the markers stay
   scattered, the segment is absent, and the page says it in words. */
"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ActionQuiet, Glass, Metric } from "@/design/canonical/primitives";
import { PerimeterFrame } from "@/design/round-3a/perimeter-frame";
import { EVIDENCE } from "../copy";
import type { DraftFrame, LandingProductState } from "../product-state/types";
import { positionLabel } from "../product-state/types";
import { LandingSection } from "./LandingSection";

type CssVars = CSSProperties & Record<`--${string}`, string | number>;
type Level = "enough" | "thin";

/** The two frames this section contrasts, found by what they ARE (a strategic call / a default view), not by index. */
export function evidenceFrames(state: LandingProductState): { enough: DraftFrame; thin: DraftFrame } {
  const strategic = state.frames.filter((frame) => frame.basis === "STRATEGIC");
  const enough = strategic.reduce((best, frame) => (frame.evidenceSamples > best.evidenceSamples ? frame : best), strategic[0] ?? state.frames[0]);
  const thin = state.frames.find((frame) => frame.basis === "DETERMINISTIC_DEFAULT") ?? state.frames[state.frames.length - 1];
  return { enough, thin };
}

/** Deterministic scatter positions (percent of the field) — a function of the index, so renders never differ. */
export function scatterOf(index: number) {
  return { x: (index * 37 + 11) % 86, y: (index * 53 + 7) % 70 };
}

function Samples({ count, gathered }: { count: number; gathered: boolean }) {
  const markers = Array.from({ length: count }, (_, index) => index);
  return (
    <div aria-hidden="true" className="ld-samples" data-gathered={gathered ? "true" : "false"}>
      {markers.map((index) => {
        const scatter = scatterOf(index);
        const style = { "--ld-i": index, "--ld-sx": `${scatter.x}%`, "--ld-sy": `${scatter.y}%` } as CssVars;
        return <i className="ld-sample" key={index} style={style} />;
      })}
    </div>
  );
}

function LevelToggle({ level, onChange }: { level: Level; onChange: (level: Level) => void }) {
  function handleEnough() {
    onChange("enough");
  }
  function handleThin() {
    onChange("thin");
  }
  return (
    <div aria-label={EVIDENCE.toggleLabel} className="ld-level" role="group">
      <ActionQuiet onPress={handleEnough} selected={level === "enough"}>{EVIDENCE.enough}</ActionQuiet>
      <ActionQuiet onPress={handleThin} selected={level === "thin"}>{EVIDENCE.thin}</ActionQuiet>
    </div>
  );
}

function GatherToggle({ disabled, gathered, onToggle }: { disabled: boolean; gathered: boolean; onToggle: () => void }) {
  return <ActionQuiet disabled={disabled} icon="inspect" onPress={onToggle} selected={gathered}>{gathered ? "Scatter the matches" : "Gather the matches"}</ActionQuiet>;
}

export function EvidenceSection({ productState }: { productState: LandingProductState }) {
  const frames = useMemo(() => evidenceFrames(productState), [productState]);
  const [level, setLevel] = useState<Level>("enough");
  const [gathered, setGathered] = useState(false);
  const frame = frames[level];
  const strategic = frame.basis === "STRATEGIC";
  const top = frame.top3[0];
  const isGathered = gathered && strategic;

  function handleLevel(next: Level) {
    setLevel(next);
    if (next === "thin") setGathered(false);
  }
  function handleToggle() {
    setGathered((current) => !current);
  }

  return (
    <LandingSection id="evidence" kicker={EVIDENCE.kicker} lede={EVIDENCE.lede} title={EVIDENCE.title}>
      <div className="ld-evidence" data-level={level}>
        <LevelToggle level={level} onChange={handleLevel} />
        <PerimeterFrame canonical className="ld-evidence-frame" edge={strategic ? "bottom" : null} label="Evidence behind the call" pulse={0} rest="corners" source={strategic ? "strategic" : "default"}>
          <Glass className="ld-evidence-card" edge={strategic} surfaceLevel="3">
            <Metric label={`${top.hero} · ${positionLabel(top.position)}`} register="expressive" value={String(top.fit)} />
            <p className="ld-evidence-note">{strategic ? EVIDENCE.strategicNote : EVIDENCE.defaultNote}</p>
            <Samples count={frame.evidenceSamples} gathered={isGathered} />
            <p className="ld-evidence-count"><b>{frame.evidenceSamples}</b> {EVIDENCE.samplesLabel}</p>
            <GatherToggle disabled={!strategic} gathered={isGathered} onToggle={handleToggle} />
          </Glass>
        </PerimeterFrame>
      </div>
    </LandingSection>
  );
}
