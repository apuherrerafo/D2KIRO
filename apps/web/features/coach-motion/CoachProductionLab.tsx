/* COACH MOTION V2 · production-slice review lab. LIVE Gold Master next to the two Motion V2 candidates (384 px and 512 px), same slot size, one shared script.
   WATCHING (long loop) -> cue -> WATCHING -> ANALYZING (entry head + shared tail) -> ANALYZING (long loop). Review shell only, not product styling. */
"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/canonical.css";
import "@/design/canonical/motion/motion.css";
import { motionCssVars } from "@/design/round-3a/motion-tokens";
import { HeroCoach } from "../hero-loop/coach/HeroCoach";
import { coachCueFor, type CoachCue } from "../hero-loop/loop";
import "../hero-loop/hero-loop.css";
import "../hero-loop/hero-loop-lab.css";
import "./coach-motion-lab.css";
import { CoachMotionPlayer, type CoachMotionPlayerHandle, type MotionStatus } from "./CoachMotionPlayer";
import type { ProductionLabProps } from "./production-params";
import type { ProdPackId } from "./production-manifest";

const MOTION_VARS = motionCssVars() as CSSProperties;

/** Seconds of WATCHING the scripted buttons let you see before the cue lands (the loop's draft beat is 1.8 s; a longer look makes the hold judgeable). */
const WATCH_LEAD_MS = 3000;
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

type Phase = "watching" | "analyzing";
const CUES: Record<Phase, CoachCue> = {
  watching: coachCueFor({ id: "draft", phase: "draft", applied: 0, ms: 1800, verb: null }, "high"),
  analyzing: coachCueFor({ id: "reveal", phase: "reveal", applied: 0, ms: 1300, verb: "GATHER" }, "high"),
};

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const q = window.matchMedia(REDUCED_QUERY);
      q.addEventListener("change", onChange);
      return () => q.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

const MB = (bytes: number) => (bytes / 1048576).toFixed(1);

function MotionPanel({ pack, title, facts, playing, reduced, phase, timeoutMs, maxDpr, register }: { pack: ProdPackId; title: string; facts: string; playing: boolean; reduced: boolean; phase: Phase; timeoutMs: number | undefined; maxDpr: number; register: (id: string, h: CoachMotionPlayerHandle | null) => void }) {
  const [readout, setReadout] = useState("starting…");
  const [status, setStatus] = useState<MotionStatus>("static");
  const handle = useRef<CoachMotionPlayerHandle | null>(null);
  const setHandle = useCallback(
    (h: CoachMotionPlayerHandle | null) => {
      handle.current = h;
      register(pack, h);
    },
    [register, pack],
  );
  useEffect(() => {
    const id = setInterval(() => {
      const s = handle.current?.snapshot();
      if (!s) return;
      const where = s.clip ? `${s.clip} · ${s.frame}` : s.status;
      const entry = s.entry ? ` · entry head ${s.entry.phase} (±${s.entry.step} f)` : "";
      setReadout(`${s.status === "motion" ? where : s.status === "failed" ? `STATIC (Motion V2 failed: ${s.failure ?? "?"})` : s.status === "static" ? "STATIC (reduced motion)" : "loading…"}${entry} · ${MB(s.residentBytes)} MB decoded`);
    }, 120);
    return () => clearInterval(id);
  }, []);
  const cue = CUES[phase];
  return (
    <section className="cm-panel" data-motion-status={status} data-testid={`panel-${pack}`}>
      <h2>{title}</h2>
      <p className="cm-readout" data-testid={`readout-${pack}`}>{readout}</p>
      <p>{facts}</p>
      <div className="cm-stage">
        <div className="cm-zoom">
          <div className="hl-coach" data-renderer="motion-v2" data-state={cue.state} data-testid={`coach-${pack}`} style={{ "--hl-coach-scale": String(cue.scale) } as CSSProperties}>
            <div className="hl-coach-body">
              <div className="hl-coach-flourish">
                <CoachMotionPlayer maxDpr={maxDpr} onStatus={setStatus} pack={pack} phase={phase} playing={playing} reducedMotion={reduced} ref={setHandle} timeoutMs={timeoutMs} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CoachProductionLab({ panels, theme: themeInitial, timeoutMs, maxDpr }: ProductionLabProps) {
  const reduced = useReducedMotion();
  const [theme, setTheme] = useState(themeInitial);
  const [phase, setPhase] = useState<Phase>("watching");
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [scene, setScene] = useState("WATCHING");
  const handles = useRef<Record<string, CoachMotionPlayerHandle | null>>({});
  const phaseRef = useRef<Phase>("watching");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = useCallback((id: string, h: CoachMotionPlayerHandle | null) => {
    handles.current[id] = h;
  }, []);
  const each = (fn: (h: CoachMotionPlayerHandle) => void) => Object.values(handles.current).forEach((h) => h && fn(h));
  const cancelLead = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancelLead, [cancelLead]);

  const setSemantic = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
    setRun((r) => r + 1);
  }, []);

  const toWatching = useCallback(() => {
    cancelLead();
    setSemantic("watching");
    each((h) => h.goTo("watching"));
    setScene("WATCHING");
    setPlaying(true);
  }, [cancelLead, setSemantic]);

  const toAnalyzing = useCallback(() => {
    cancelLead();
    setSemantic("analyzing");
    each((h) => h.goTo("analyzing"));
    setScene("ANALYZING");
    setPlaying(true);
  }, [cancelLead, setSemantic]);

  const sendCue = useCallback(() => {
    setSemantic("analyzing");
    each((h) => h.cue());
    setScene("WATCHING → ANALYZING");
  }, [setSemantic]);

  /** From a held WATCHING the cue lands now, at whatever loop phase it is in (that is the entry-head test); from anywhere else WATCHING restarts and the cue follows. */
  const toTransition = useCallback(() => {
    setPlaying(true);
    if (phaseRef.current === "watching") {
      sendCue();
      return;
    }
    toWatching();
    timer.current = setTimeout(sendCue, WATCH_LEAD_MS);
  }, [sendCue, toWatching]);

  const replay = useCallback(() => {
    toWatching();
    timer.current = setTimeout(sendCue, WATCH_LEAD_MS);
  }, [sendCue, toWatching]);

  const motionPanels = panels.filter((p): p is ProdPackId => p !== "live");
  return (
    <div className="r3-page hl-lab-page" data-testid="coach-production-page" style={MOTION_VARS}>
      <div className="hl-lab-theme" data-testid="coach-production-theme" data-theme={theme}>
        <div className="hl-lab" data-phase={phase} data-testid="coach-production-lab">
          <header className="hl-lab-head">
            <div>
              <h1 className="hl-lab-title">Coach motion V2 · production slice</h1>
              <p className="hl-lab-sub" data-testid="cp-scene">{`${scene}${reduced ? " · reduced motion: static Coach only" : ""}`}</p>
            </div>
            <div aria-label="Lab controls" className="hl-lab-controls" role="group">
              <button aria-pressed={scene === "WATCHING"} className="hl-lab-btn" data-testid="btn-watching" onClick={toWatching} type="button">WATCHING</button>
              <button aria-pressed={scene === "WATCHING → ANALYZING"} className="hl-lab-btn" data-testid="btn-transition" onClick={toTransition} type="button">WATCHING → ANALYZING</button>
              <button aria-pressed={scene === "ANALYZING"} className="hl-lab-btn" data-testid="btn-analyzing" onClick={toAnalyzing} type="button">ANALYZING</button>
              <button className="hl-lab-btn" data-testid="btn-replay" onClick={replay} type="button">Replay</button>
              <button aria-pressed={!playing} className="hl-lab-btn" data-testid="btn-pause" onClick={() => setPlaying((p) => !p)} type="button">{playing ? "Pause" : "Play"}</button>
              <button aria-pressed={theme === "light"} className="hl-lab-btn" data-testid="btn-theme" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} type="button">{theme === "light" ? "Light" : "Dark"}</button>
            </div>
          </header>
          <div className="cm-grid cm-prod" data-testid="cm-grid">
            {panels.includes("live") && (
              <section className="cm-panel" data-testid="panel-live">
                <h2>LIVE</h2>
                <p className="cm-readout">Three.js · real time</p>
                <p>The Gold Master itself (reference). It cannot be paused here.</p>
                <div className="cm-stage">
                  <div className="cm-zoom">
                    <HeroCoach beatKey={`${phase}-${run}`} cue={CUES[phase]} mode={reduced ? "static" : "live"} />
                  </div>
                </div>
              </section>
            )}
            {motionPanels.map((pack) => (
              <MotionPanel
                facts={pack === "384" ? "MOTION V2 · 384 px · 30 fps · AVIF" : "MOTION V2 · 512 px · 30 fps · AVIF"}
                key={pack}
                maxDpr={maxDpr}
                pack={pack}
                phase={phase}
                playing={playing}
                reduced={reduced}
                register={register}
                timeoutMs={timeoutMs}
                title={`${pack} MOTION V2`}
              />
            ))}
          </div>
          <details className="cm-look">
            <summary>What to look at</summary>
            <ol>
              <li>Does it still feel like changing photos, or like one object?</li>
              <li>Hold WATCHING for 20 s: does it stay alive (blink every ~4 s, ring, visor)? Does anything freeze or loop visibly?</li>
              <li>Press WATCHING → ANALYZING at random moments: does it read like the LIVE character reacting?</li>
              <li>After the transition: does ANALYZING keep moving (ring one way, eyes scanning), no freeze?</li>
              <li>384 vs 512 at this size, then browser zoom 200 %: any shimmer on edges / eyes / ring glass?</li>
            </ol>
          </details>
        </div>
      </div>
    </div>
  );
}
