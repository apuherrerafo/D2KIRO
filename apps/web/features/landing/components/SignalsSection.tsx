/* LANDING-01B · Signals. "What matters most" moved: the spectral rail transfers to the chosen signal,
   the gained row nudges in 4 px, the outgoing row goes ink → muted by colour (Motion Canonical:
   focus transfer). The right side states what that signal does to each candidate — Delta, sign first. */
"use client";

import { useRef, useState, type CSSProperties } from "react";
import { HeroIcon } from "@/design/canonical/hero-media";
import { Delta, StateTarget } from "@/design/canonical/primitives";
import { play } from "@/design/canonical/motion/play";
import { SNAPPY, TIMING } from "@/design/canonical/motion/timing";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { SIGNALS } from "../copy";
import type { LandingProductState, SignalRow } from "../product-state/types";
import { LandingSection } from "./LandingSection";

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

function SignalOption({ index, onChoose, selected, signal }: { index: number; onChoose: (index: number) => void; selected: boolean; signal: SignalRow }) {
  function handlePress() {
    onChoose(index);
  }
  return (
    <li className="ld-signal" data-selected={selected ? "true" : "false"}>
      <StateTarget onPress={handlePress} state={selected ? "selected" : "rest"} title={signal.label} value={signal.value} />
    </li>
  );
}

function Shifts({ signal }: { signal: SignalRow }) {
  const shifts = signal.shifts ?? [];
  return (
    <div className="ld-shifts">
      <h3 className="ld-shifts-title">{SIGNALS.shiftsTitle}</h3>
      <p className="ld-shifts-detail">{signal.detail}</p>
      <ul aria-label={SIGNALS.shiftsTitle} className="ld-shift-list">
        {shifts.map((shift) => (
          <li className="ld-shift" key={shift.hero}>
            <HeroIcon hero={shift.hero} size="md" />
            <span className="ld-shift-name">{shift.hero}</span>
            <Delta digits={1} locale="en" unit={SIGNALS.shiftsUnit} value={shift.delta} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SignalsSection({ productState }: { productState: LandingProductState }) {
  const reduced = useReducedMotion();
  const list = useRef<HTMLOListElement>(null);
  const signals = productState.frames[0].signals;
  const [index, setIndex] = useState(0);
  const active = signals[index];

  function handleChoose(next: number) {
    if (next === index) return;
    setIndex(next);
    const row = list.current?.querySelectorAll<HTMLElement>(".ld-signal")[next];
    if (row) play(row, "gain", [{ translate: `${TIMING.gainPx}px 0` }, { translate: "0 0" }], { duration: SNAPPY.durationMs, easing: SNAPPY.easing }, reduced);
  }

  return (
    <LandingSection id="signals" kicker={SIGNALS.kicker} lede={SIGNALS.lede} title={SIGNALS.title}>
      <div className="ld-signals">
        <div className="ld-signal-rail-host" style={{ "--ld-focus": index, "--ld-n": signals.length } as CssVars}>
          <span aria-hidden="true" className="ld-rail" />
          <ol aria-label={SIGNALS.listLabel} className="ld-signal-list" ref={list}>
            {signals.map((signal, position) => <SignalOption index={position} key={signal.id} onChoose={handleChoose} selected={position === index} signal={signal} />)}
          </ol>
        </div>
        <Shifts signal={active} />
      </div>
    </LandingSection>
  );
}
