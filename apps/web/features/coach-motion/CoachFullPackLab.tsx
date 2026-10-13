/* COACH MOTION V2 · full semantic pack review lab (review shell only, not product, not linked from the Landing).
   LIVE Gold Master next to the production player (CoachMotionPlayer -> MotionController -> the 384 px pack's manifest graph). Every picture on the Motion V2 side is a
   pre-rendered Gold Master frame chosen by the generic sequencer: a state button cues the edge from the loop being played when the graph has one (otherwise it jumps),
   "Play full cycle" walks WATCHING -> ANALYZING -> POINTING -> CONFIRMING -> POINTING -> WATCHING through real cues, "Replay transition" replays the last edge taken.
   The cycle is lab data, checked against the manifest's graph when the pack loads; the player itself names no state. */
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
import type { CoachCue, CoachCueState } from "../hero-loop/loop";
import "../hero-loop/hero-loop.css";
import "../hero-loop/hero-loop-lab.css";
import "./coach-motion-lab.css";
import { CoachMotionPlayer, type CoachMotionPlayerHandle, type MotionState, type MotionStatus } from "./CoachMotionPlayer";
import { LOOP_DEFS } from "./loop-pose";
import { edgeBetween, manifestUrl, parseManifest, type ProdManifest } from "./production-manifest";

const MOTION_VARS = motionCssVars() as CSSProperties;
const PACK = "384";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
/** The review cycle: every hop must be an edge of the pack's graph. */
export const FULL_CYCLE: readonly MotionState[] = ["watching", "analyzing", "pointing", "confirming", "pointing", "watching"];
/** Time each state is held (playing) before the next cue, ms. */
const HOLD_MS = 2600;
/** Longest a cued edge may take to land in its target loop before the cycle reports an error, ms. */
const ARRIVE_TIMEOUT_MS = 12000;
/** Landing host scale per state (CUE_BY_PHASE: draft / reveal / recommendation / lock): a CSS property of the slot, not part of the rendered frames. */
const SLOT_SCALE: Record<string, number> = { watching: 0.88, analyzing: 0.92, pointing: 1, confirming: 1.04 };

/** The LIVE cue of a loop: the verb, aim and amplitude its frames were authored with (loop-pose.ts LOOP_DEFS), the Landing's slot scale. */
function liveCue(state: string): CoachCue {
  const def = LOOP_DEFS[state] ?? LOOP_DEFS.watching;
  return { state: def.id as CoachCueState, aim: def.aim.x > 0 ? "right" : "center", verb: def.verb as CoachCue["verb"], scale: SLOT_SCALE[def.id] ?? 1, amplitude: def.amplitude };
}

export type CycleEvent = { t: number; kind: "start" | "cue" | "arrive" | "done" | "error"; from?: string; to?: string; taken?: boolean; detail?: string };

declare global {
  interface Window {
    /** review / audit hook: the cycle's events and the player's read-out (fullpack-audit.mjs samples it) */
    __fullPack?: { events: CycleEvent[]; running: boolean; snapshot: () => ReturnType<CoachMotionPlayerHandle["snapshot"]> | null };
  }
}

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
const label = (s: string) => s.toUpperCase();

export function CoachFullPackLab({ theme: themeInitial, live }: { theme: "dark" | "light"; live: boolean }) {
  const reduced = useReducedMotion();
  const [theme, setTheme] = useState(themeInitial);
  const [playing, setPlaying] = useState(true);
  const [manifest, setManifest] = useState<ProdManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState("WATCHING");
  const [shownState, setShownState] = useState<MotionState>("watching");
  const [liveKey, setLiveKey] = useState(0);
  const [readout, setReadout] = useState("starting…");
  const [status, setStatus] = useState<MotionStatus>("static");
  const handle = useRef<CoachMotionPlayerHandle | null>(null);
  const playingRef = useRef(true);
  const run = useRef(0); // the cycle / replay script that may still act: bumping it cancels the one in flight
  const lastEdge = useRef<{ from: MotionState; to: MotionState } | null>(null);
  const events = useRef<CycleEvent[]>([]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // the same manifest the player loads (revalidated): the lab reads the graph for its buttons and checks the cycle against it
  useEffect(() => {
    let alive = true;
    fetch(manifestUrl(PACK), { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest ${r.status}`))))
      .then((raw: unknown) => {
        const m = parseManifest(raw);
        const missing = FULL_CYCLE.slice(1).map((to, i) => [FULL_CYCLE[i], to]).filter(([from, to]) => !edgeBetween(m, from, to));
        if (missing.length) throw new Error(`the pack's graph has no edge ${missing.map(([a, b]) => `${a}>${b}`).join(", ")}`);
        if (alive) setManifest(m);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    window.__fullPack = { events: events.current, running: false, snapshot: () => handle.current?.snapshot() ?? null };
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const s = handle.current?.snapshot();
      if (!s) return;
      const where = s.clip ? `${s.clip} · ${s.frame}` : s.status;
      const entry = s.entry ? ` · entry ${s.entry.edge} head ${s.entry.phase} (±${s.entry.step} f)` : "";
      const armed = s.pendingEdge ? ` · armed ${s.pendingEdge}` : "";
      setReadout(`${s.status === "motion" ? where : s.status === "failed" ? `STATIC (Motion V2 failed: ${s.failure ?? "?"})` : s.status === "static" ? "STATIC (reduced motion)" : "loading…"}${entry}${armed} · ${MB(s.residentBytes)} MB decoded · ${s.loads} loads`);
    }, 120);
    return () => clearInterval(id);
  }, []);

  const log = useCallback((e: Omit<CycleEvent, "t">) => {
    events.current.push({ t: performance.now(), ...e });
  }, []);

  /** Resolves after `ms` of PLAYING time (a pause holds the script too); false when the script was cancelled. */
  const hold = useCallback((token: number, ms: number) => {
    return new Promise<boolean>((resolve) => {
      let left = ms;
      let last = performance.now();
      const id = setInterval(() => {
        const now = performance.now();
        if (playingRef.current) left -= now - last;
        last = now;
        if (run.current !== token) {
          clearInterval(id);
          resolve(false);
        } else if (left <= 0) {
          clearInterval(id);
          resolve(true);
        }
      }, 20);
    });
  }, []);

  /** Resolves once the picture plays the loop `state` (the edge's tail has handed over), false on cancel / timeout. */
  const arrive = useCallback((token: number, state: string) => {
    return new Promise<boolean>((resolve) => {
      const t0 = performance.now();
      const id = setInterval(() => {
        const s = handle.current?.snapshot();
        if (run.current !== token) {
          clearInterval(id);
          resolve(false);
        } else if (s?.mode === state) {
          clearInterval(id);
          resolve(true);
        } else if (performance.now() - t0 > ARRIVE_TIMEOUT_MS && playingRef.current) {
          clearInterval(id);
          resolve(false);
        }
      }, 10);
    });
  }, []);

  /** Cue the edge from the loop being played to `to`; resolves after the target loop is reached. */
  const transition = useCallback(
    async (token: number, from: MotionState, to: MotionState) => {
      const h = handle.current;
      if (!h) return false;
      const taken = h.cue(to);
      log({ kind: "cue", from, to, taken });
      if (!taken) {
        log({ kind: "error", from, to, detail: "cue refused (no edge from the loop being played)" });
        return false;
      }
      lastEdge.current = { from, to };
      setScene(`${label(from)} → ${label(to)}`);
      const ok = await arrive(token, to);
      if (ok) {
        log({ kind: "arrive", from, to });
        setScene(label(to));
      } else if (run.current === token) log({ kind: "error", from, to, detail: "target loop not reached" });
      return ok;
    },
    [arrive, log],
  );

  const jump = useCallback((state: MotionState) => {
    run.current += 1;
    if (window.__fullPack) window.__fullPack.running = false;
    handle.current?.goTo(state);
    setScene(label(state));
    setPlaying(true);
  }, []);

  /** A state button: the edge from the loop being played when the graph has one (a real transition), otherwise a jump to that loop. */
  const press = useCallback(
    (state: MotionState) => {
      const s = handle.current?.snapshot();
      const from = s?.mode; // a loop id, or "transition" while an edge plays (no edge leaves a transition)
      if (manifest && from && from !== state && edgeBetween(manifest, from, state)) {
        run.current += 1;
        setPlaying(true);
        void transition(run.current, from as MotionState, state);
      } else jump(state);
    },
    [jump, manifest, transition],
  );

  const playCycle = useCallback(async () => {
    const token = ++run.current;
    setPlaying(true);
    events.current.length = 0;
    if (window.__fullPack) window.__fullPack.running = true;
    handle.current?.goTo(FULL_CYCLE[0]);
    setScene(`${label(FULL_CYCLE[0])} (cycle)`);
    log({ kind: "start", to: FULL_CYCLE[0] });
    for (let i = 1; i < FULL_CYCLE.length; i += 1) {
      if (!(await hold(token, HOLD_MS))) return;
      if (!(await transition(token, FULL_CYCLE[i - 1], FULL_CYCLE[i]))) break;
    }
    if (run.current === token && (await hold(token, HOLD_MS))) log({ kind: "done" });
    if (window.__fullPack && run.current === token) window.__fullPack.running = false;
  }, [hold, log, transition]);

  const replay = useCallback(async () => {
    const edge = lastEdge.current ?? { from: FULL_CYCLE[0], to: FULL_CYCLE[1] };
    const token = ++run.current;
    setPlaying(true);
    handle.current?.goTo(edge.from);
    setScene(label(edge.from));
    if (await hold(token, HOLD_MS)) await transition(token, edge.from, edge.to);
  }, [hold, transition]);

  const onState = useCallback((s: MotionState) => {
    setShownState(s);
    setLiveKey((k) => k + 1);
  }, []);

  const states = manifest ? (Object.keys(manifest.graph.loops) as MotionState[]) : [];
  const cue = liveCue(shownState);
  return (
    <div className="r3-page hl-lab-page" data-testid="coach-fullpack-page" style={MOTION_VARS}>
      <div className="hl-lab-theme" data-testid="coach-fullpack-theme" data-theme={theme}>
        <div className="hl-lab" data-phase={shownState} data-testid="coach-fullpack-lab">
          <header className="hl-lab-head">
            <div>
              <h1 className="hl-lab-title">Coach motion V2 · full semantic pack</h1>
              <p className="hl-lab-sub" data-testid="fp-scene">{error ? `ERROR: ${error}` : `${scene}${reduced ? " · reduced motion: static Coach only" : ""}`}</p>
            </div>
            <div aria-label="Lab controls" className="hl-lab-controls" role="group">
              {states.map((s) => (
                <button aria-pressed={shownState === s} className="hl-lab-btn" data-testid={`btn-${s}`} key={s} onClick={() => press(s)} type="button">{label(s)}</button>
              ))}
              <button className="hl-lab-btn" data-testid="btn-cycle" disabled={!manifest} onClick={() => void playCycle()} type="button">Play full cycle</button>
              <button className="hl-lab-btn" data-testid="btn-replay" disabled={!manifest} onClick={() => void replay()} type="button">Replay transition</button>
              <button aria-pressed={!playing} className="hl-lab-btn" data-testid="btn-pause" onClick={() => setPlaying((p) => !p)} type="button">{playing ? "Pause" : "Play"}</button>
              <button aria-pressed={theme === "light"} className="hl-lab-btn" data-testid="btn-theme" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} type="button">{theme === "light" ? "Light" : "Dark"}</button>
            </div>
          </header>
          <div className="cm-grid" data-testid="cm-grid" style={{ "--cm-zoom": 1.4, gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" } as CSSProperties}>
            {live && (
              <section className="cm-panel" data-testid="panel-live">
                <h2>LIVE</h2>
                <p className="cm-readout" data-testid="live-state">{`Three.js · real time · ${label(shownState)}`}</p>
                <p>The Gold Master itself (reference). It follows the semantic state of the Motion V2 picture: the cue lands when the entry head starts. It cannot be paused.</p>
                <div className="cm-stage">
                  <div className="cm-zoom">
                    <div className="hl-coach" data-renderer="live" data-state={cue.state} style={{ "--hl-coach-scale": String(cue.scale) } as CSSProperties}>
                      <HeroCoach beatKey={`${shownState}-${liveKey}`} cue={cue} mode={reduced ? "static" : "live"} />
                    </div>
                  </div>
                </div>
              </section>
            )}
            <section className="cm-panel" data-motion-status={status} data-testid="panel-384">
              <h2>MOTION V2</h2>
              <p className="cm-readout" data-testid="readout-384">{readout}</p>
              <p>{manifest ? `384 px · 30 fps · AVIF q${manifest.encoder.quality} · ${Object.keys(manifest.graph.loops).length} loops · ${manifest.graph.edges.length} edges · ${(manifest.totalBytes / 1e6).toFixed(2)} MB pack` : "…"}</p>
              <div className="cm-stage">
                <div className="cm-zoom">
                  <div className="hl-coach" data-renderer="motion-v2" data-state={cue.state} data-testid="coach-384" style={{ "--hl-coach-scale": String(cue.scale) } as CSSProperties}>
                    <div className="hl-coach-body">
                      <div className="hl-coach-flourish">
                        <CoachMotionPlayer maxDpr={2} onState={onState} onStatus={setStatus} pack={PACK} phase={shownState} playing={playing} reducedMotion={reduced} ref={handle} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
          <details className="cm-look" open>
            <summary>What to look at</summary>
            <ol>
              <li>Play full cycle (WATCHING → ANALYZING → POINTING → CONFIRMING → POINTING → WATCHING): does it read as one character changing its mind, not as clips?</li>
              <li>Every transition: no pop where the head hands over to the tail, none where the tail lands in the next loop; compare its intent with the LIVE panel.</li>
              <li>Hold each state (press it, then wait 20 s): no freeze, no visible loop restart; POINTING is blinkless by design, CONFIRMING blinks once per lap.</li>
              <li>Press a state button at random moments: the transition starts from wherever the loop is (nearest entry head), never from a reset.</li>
              <li>Pause, then Play: it resumes on the next frame. Dark / Light: no halo on the silhouette.</li>
            </ol>
          </details>
        </div>
      </div>
    </div>
  );
}
