/* COACH MOTION V2 · comparison lab. Coaches at the same slot size, one shared script:
     CURRENT   the Landing's pre-rendered stills (HeroCoach, mode "sprite": ~160 ms cross-fade between stills)
     LIVE      the Gold Master on Three.js (HeroCoach, mode "live")
     MOTION V2 prerendered grid atlas (WebP prototype), deterministic frame clock (CoachMotionAtlas)
     A / B / C the production-format candidates (AVIF atlases, see FORMATS), `?mode=format` shows LIVE against them
   The script is the loop's real choreography for this experiment: WATCHING (draft cue) -> ANALYZING (reveal cue). */
"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
import { CoachMotionAtlas, type CoachMotionHandle } from "./CoachMotionAtlas";
import { loadAtlas, loadManifest, type ClipId, type PackId } from "./clips";
import "./coach-motion-lab.css";
import type { CoachMotionLabProps, PanelId } from "./lab-params";

const MOTION_VARS = motionCssVars() as CSSProperties;

/** How long WATCHING holds before the reveal cue lands in "Replay WATCHING -> ANALYZING" (the loop's draft beat is 1.8 s). */
const LEAD_MS = 1800;

type Phase = "watching" | "analyzing";

/** The two cues the loop really sends here: `draft` then `reveal` (see CUE_BY_PHASE in loop.ts). */
const CUES: Record<Phase, CoachCue> = {
  watching: coachCueFor({ id: "draft", phase: "draft", applied: 0, ms: 1800, verb: null }, "high"),
  analyzing: coachCueFor({ id: "reveal", phase: "reveal", applied: 0, ms: 1300, verb: "GATHER" }, "high"),
};

/** The three production-format candidates. Same source frames, same crop; only resolution / fps / AVIF quality differ. */
export const FORMATS: Record<"a" | "b" | "c", { pack: PackId; title: string; facts: string }> = {
  a: { pack: "A", title: "A · 384 px · 30 fps", facts: "AVIF q45" },
  b: { pack: "B", title: "B · 384 px · 24 fps", facts: "AVIF q30" },
  c: { pack: "C", title: "C · 256 px · 30 fps", facts: "AVIF q40" },
};

function AtlasPanel({ id, pack, title, facts, clip, playing, beatKey, cue, register }: { id: string; pack: PackId; title: string; facts: string; clip: ClipId; playing: boolean; beatKey: string; cue: CoachCue; register: (id: string, h: CoachMotionHandle | null) => void }) {
  const [readout, setReadout] = useState("");
  const onFrame = useCallback((frame: number, count: number) => setReadout(`${frame + 1}/${count}`), []);
  // NEXT clip prefetched while CURRENT plays: the cue must never wait for a fetch + decode
  useEffect(() => {
    void loadManifest(pack).then((m) => loadAtlas(pack, m.clips.WATCHING_TO_ANALYZING.file));
  }, [pack]);
  const setHandle = useCallback((h: CoachMotionHandle | null) => register(id, h), [register, id]);
  return (
    <section className="cm-panel" data-testid={`panel-${id}`}>
      <h2>{title}</h2>
      <p className="cm-readout" data-testid={id === "v2" ? "cm-readout" : `cm-readout-${id}`}>{`${clip} · frame ${readout} · ${facts}`}</p>
      <p>{id === "v2" ? "Prerendered atlas frames from the live stage, 30 fps, deterministic clock (WebP prototype)." : "Prerendered atlas frames from the live stage, deterministic clock."}</p>
      <div className="cm-stage">
        <div className="cm-zoom">
          <div className="hl-coach" data-renderer="atlas" data-state={cue.state} data-testid={id === "v2" ? "coach-v2" : `coach-${id}`} style={{ "--hl-coach-scale": String(cue.scale) } as CSSProperties}>
            <div className="hl-coach-body">
              <div className="hl-coach-flourish">
                <CoachMotionAtlas className="cm-atlas" clip={clip} onFrame={onFrame} pack={pack} playing={playing} ref={setHandle} restartKey={beatKey} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CoachMotionLab({ panels, theme: themeInitial, inspect: inspectInitial }: CoachMotionLabProps) {
  const [theme, setTheme] = useState(themeInitial);
  const [inspect, setInspect] = useState(inspectInitial);
  const [phase, setPhase] = useState<Phase>("watching");
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(true);
  const handles = useRef<Record<string, CoachMotionHandle | null>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cue = CUES[phase];
  const clip: ClipId = phase === "watching" ? "WATCHING_IDLE" : "WATCHING_TO_ANALYZING";
  const beatKey = `${phase}-${run}`;

  const cancelLead = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancelLead, [cancelLead]);

  const replayIdle = useCallback(() => {
    cancelLead();
    setPhase("watching");
    setRun((r) => r + 1);
    setPlaying(true);
  }, [cancelLead]);

  const replayTransition = useCallback(() => {
    replayIdle();
    timer.current = setTimeout(() => {
      setPhase("analyzing");
      setRun((r) => r + 1);
    }, LEAD_MS);
  }, [replayIdle]);

  const register = useCallback((id: string, h: CoachMotionHandle | null) => {
    handles.current[id] = h;
  }, []);
  const stepAll = (delta: number) => Object.values(handles.current).forEach((h) => h?.step(delta));
  const show = (id: PanelId) => panels.includes(id);
  const atlasPanel = (id: "v2" | "a" | "b" | "c") =>
    show(id) && (
      <AtlasPanel
        beatKey={beatKey}
        clip={clip}
        cue={cue}
        facts={id === "v2" ? "WebP q80 · 384 px · 30 fps" : `${FORMATS[id].facts}`}
        register={register}
        id={id}
        key={id}
        pack={id === "v2" ? "webp" : FORMATS[id].pack}
        playing={playing}
        title={id === "v2" ? "C · MOTION V2 (WebP prototype)" : FORMATS[id].title}
      />
    );

  return (
    <div className="r3-page hl-lab-page" data-testid="coach-motion-page" style={MOTION_VARS}>
      <div className="hl-lab-theme" data-testid="coach-motion-theme" data-theme={theme}>
        <div className="hl-lab" data-phase={phase} data-testid="coach-motion-lab">
          <header className="hl-lab-head">
            <div>
              <h1 className="hl-lab-title">Coach motion V2 · lab</h1>
              <p className="hl-lab-sub" data-testid="cm-sub">{`${phase === "watching" ? "WATCHING" : "WATCHING → ANALYZING"} · clip ${clip}`}</p>
            </div>
            <div aria-label="Lab controls" className="hl-lab-controls" role="group">
              <button className="hl-lab-btn" data-testid="replay-idle" onClick={replayIdle} type="button">Replay idle</button>
              <button className="hl-lab-btn" data-testid="replay-transition" onClick={replayTransition} type="button">Replay WATCHING → ANALYZING</button>
              <button aria-pressed={!playing} className="hl-lab-btn" data-testid="pause" onClick={() => setPlaying((p) => !p)} type="button">{playing ? "Pause atlases" : "Play atlases"}</button>
              <button className="hl-lab-btn" data-testid="step-back" disabled={playing} onClick={() => stepAll(-1)} type="button">‹ Frame</button>
              <button className="hl-lab-btn" data-testid="step" disabled={playing} onClick={() => stepAll(1)} type="button">Frame ›</button>
              <button aria-pressed={inspect} className="hl-lab-btn" data-testid="inspect" onClick={() => setInspect((v) => !v)} type="button">{inspect ? "2× inspect" : "1× actual"}</button>
              <button aria-pressed={theme === "light"} className="hl-lab-btn" data-testid="theme" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} type="button">{theme === "light" ? "Light" : "Dark"}</button>
            </div>
          </header>
          <div className="cm-grid" data-inspect={inspect ? "1" : "0"} data-testid="cm-grid">
            {show("current") && (
              <section className="cm-panel" data-testid="panel-current">
                <h2>A · CURRENT</h2>
                <p className="cm-readout">12 stills · cross-fade</p>
                <p>Landing sprite: 12 stills, ~160 ms cross-fade between them.</p>
                <div className="cm-stage">
                  <div className="cm-zoom">
                    <HeroCoach beatKey={beatKey} cue={cue} mode="sprite" />
                  </div>
                </div>
              </section>
            )}
            {show("live") && (
              <section className="cm-panel" data-testid="panel-live">
                <h2>{panels.includes("a") ? "LIVE" : "B · LIVE"}</h2>
                <p className="cm-readout">Three.js · real time</p>
                <p>Gold Master on Three.js (reference). Cannot be paused here.</p>
                <div className="cm-stage">
                  <div className="cm-zoom">
                    <HeroCoach beatKey={beatKey} cue={cue} mode="live" />
                  </div>
                </div>
              </section>
            )}
            {atlasPanel("v2")}
            {atlasPanel("a")}
            {atlasPanel("b")}
            {atlasPanel("c")}
          </div>
        </div>
      </div>
    </div>
  );
}
