/* HERO-LOOP LAB · review shell around the loop. NOT product UI: the controls exist so a reviewer can pause, step, jump to a
   condition, hide Recent calls and force a Coach renderer. Everything is also reachable by query string, so every
   review capture is a link:  ?scenario=A|B|C  &beat=<id>  &pause=1  &calls=0  &coach=live|sprite  &q=full  &motion=reduced|full  &theme=dark|light */
"use client";

import { useRef, useState, type ReactNode } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/canonical.css";
import "@/design/canonical/motion/motion.css";
import { LabProvider, useReducedMotion, type MotionMode } from "@/design/round-3a/lab-context";
import { motionCssVars } from "@/design/round-3a/motion-tokens";
import { useCoachMode, type CoachOverride } from "./coach/HeroCoach";
import type { StageQuality } from "./coach/live-stage";
import { HeroLoop } from "./HeroLoop";
import { usePortraitsReady } from "./preload";
import { LOOP_SCENARIOS, type ScenarioId } from "./scenarios";
import { positionFor, useHeroLoop } from "./use-hero-loop";
import "./hero-loop-lab.css";

const MOTION_VARS = motionCssVars() as React.CSSProperties;

export type HeroLoopLabProps = {
  beat?: string;
  calls: boolean;
  coach: CoachOverride;
  motion: MotionMode;
  pause: boolean;
  quality: StageQuality;
  scenario: ScenarioId;
  theme: LabTheme;
};

export type LabTheme = "dark" | "light";

function Toggle({ children, on, onPress, testId }: { children: ReactNode; on: boolean; onPress: () => void; testId: string }) {
  return (
    <button aria-pressed={on} className="hl-lab-btn" data-testid={testId} onClick={onPress} type="button">
      {children}
    </button>
  );
}

function Lab({ beat, calls: callsInitial, coach, pause, quality, scenario, theme: themeInitial }: Omit<HeroLoopLabProps, "motion">) {
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(pause);
  const [calls, setCalls] = useState(callsInitial);
  const [theme, setTheme] = useState<LabTheme>(themeInitial);
  const [override, setOverride] = useState<CoachOverride>(coach);
  const start = positionFor(Math.max(0, LOOP_SCENARIOS.findIndex((s) => s.id === scenario)), beat);
  const portraitsReady = usePortraitsReady(LOOP_SCENARIOS);
  const clock = useHeroLoop(host, reduced, paused, start, portraitsReady);
  const mode = useCoachMode(reduced, override);
  const current = clock.frame.scenario;

  return (
    <div className="hl-lab-theme" data-testid="hero-loop-theme" data-theme={theme}>
    <div className="hl-lab" data-testid="hero-loop-lab" ref={host}>
      <header className="hl-lab-head">
        <div>
          <h1 className="hl-lab-title">Hero loop · lab</h1>
          <p className="hl-lab-sub" data-testid="lab-condition">{`${current.id} — ${current.condition}`}</p>
        </div>
        <div aria-label="Lab controls" className="hl-lab-controls" role="group">
          {LOOP_SCENARIOS.map((s, index) => (
            <Toggle key={s.id} on={s.id === current.id} onPress={() => clock.jumpTo(index)} testId={`jump-${s.id}`}>{s.id}</Toggle>
          ))}
          <Toggle on={paused} onPress={() => setPaused((p) => !p)} testId="pause">{paused ? "Play" : "Pause"}</Toggle>
          <button className="hl-lab-btn" data-testid="step" onClick={clock.step} type="button">Step ›</button>
          <Toggle on={calls} onPress={() => setCalls((c) => !c)} testId="calls">Recent calls</Toggle>
          <Toggle on={theme === "light"} onPress={() => setTheme((t) => (t === "light" ? "dark" : "light"))} testId="theme">{theme === "light" ? "Light" : "Dark"}</Toggle>
          <Toggle on={override === "sprite"} onPress={() => setOverride((o) => (o === "sprite" ? "auto" : "sprite"))} testId="toggle-coach-sprite">Sprite</Toggle>
          <Toggle on={override === "live"} onPress={() => setOverride((o) => (o === "live" ? "auto" : "live"))} testId="toggle-coach-live">Live</Toggle>
        </div>
      </header>
      <HeroLoop calls={calls} clock={clock} coachMode={mode} quality={quality} reduced={reduced} />
      <p className="hl-lab-note">{HERO_NOTE}</p>
    </div>
    </div>
  );
}

const HERO_NOTE = "Illustrative draft. Desktop: live Gold Master. Mobile: pre-rendered Hero pack. Reduced motion: static state stills.";

export function HeroLoopLab({ motion, ...props }: HeroLoopLabProps) {
  return (
    <div className="r3-page hl-lab-page" data-testid="hero-loop-page" style={MOTION_VARS}>
      <LabProvider value={{ autoplay: false, mode: motion }}>
        <Lab {...props} />
      </LabProvider>
    </div>
  );
}
