/* COUNTERFACTUAL LAB · review shell around the object. NOT product UI. The story plays once and rests on the "For you" read
   (no full reset, no carousel); Replay runs it again. Everything is reachable by query string so every capture is a link:
   ?phase=generic|evidence|personal  &beat=generic|evidence|rerank|call|quiet  &theme=dark|light  &motion=full|reduced  &coach=1|0 */
"use client";

import { useEffect, useState } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/canonical.css";
import "@/design/canonical/motion/motion.css";
import { LabProvider, useReducedMotion } from "@/design/round-3a/lab-context";
import { motionCssVars } from "@/design/round-3a/motion-tokens";
import "../hero-loop/hero-loop-lab.css";
import { Counterfactual } from "./Counterfactual";
import type { CounterfactualLabProps, LabTheme } from "./lab-params";
import { BEATS, FINAL_BEAT, beatIndexOf } from "./model";

const MOTION_VARS = motionCssVars() as React.CSSProperties;

function Lab({ beat, coach, theme: themeInitial }: Pick<CounterfactualLabProps, "beat" | "coach" | "theme">) {
  const reduced = useReducedMotion();
  const [theme, setTheme] = useState<LabTheme>(themeInitial);
  const held = beat !== undefined;
  const [index, setIndex] = useState(held ? beatIndexOf(beat) : 0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (held || index >= FINAL_BEAT) return;
    const timer = window.setTimeout(() => setIndex((i) => i + 1), BEATS[index].ms);
    return () => window.clearTimeout(timer);
  }, [held, index, run]);

  const current = BEATS[index];
  return (
    <div className="hl-lab-theme cfl-theme" data-testid="cfl-theme" data-theme={theme}>
      <div className="cfl-lab">
        <div aria-label="Lab controls" className="cfl-controls" role="group">
          <button className="hl-lab-btn" data-testid="replay" onClick={() => { setIndex(0); setRun((r) => r + 1); }} type="button">Replay</button>
          <button aria-pressed={theme === "light"} className="hl-lab-btn" data-testid="theme" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} type="button">{theme === "light" ? "Light" : "Dark"}</button>
        </div>
        <Counterfactual beat={current.id} coach={current.coach} phase={current.phase} reduced={reduced} showCoach={coach} />
      </div>
    </div>
  );
}

export function CounterfactualLab({ motion, ...props }: CounterfactualLabProps) {
  return (
    <div className="r3-page hl-lab-page" data-testid="cfl-page" style={MOTION_VARS}>
      <LabProvider value={{ autoplay: false, mode: motion }}>
        <Lab {...props} />
      </LabProvider>
    </div>
  );
}
