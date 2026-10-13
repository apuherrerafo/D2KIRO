/* COACH MOTION V2 · offline capture harness (R&D tooling, not product UI).
   Drives the REAL live Gold Master stage (HeroCoachStage, the class behind /lab/hero-loop?coach=live) on a fixed clock and
   reads back transparent PNG frames. Same cue -> stage calls as CoachLive; the only difference is that time is a fixed-step
   simulation instead of requestAnimationFrame, so a capture is reproducible. No tweening: every frame is a rendered live pose. */
"use client";

import { useEffect, useState } from "react";
import type { CoachCue } from "../hero-loop/loop";
import { addPose, statePose, verbImpulse, type MotionVerb, type Pose } from "../hero-loop/coach/motion";
import { ANALYZE_AIM, ANALYZE_AMPLITUDE, WATCH_AIM, WATCH_AMPLITUDE, damp, jobPoses, smoothPose, type Job } from "./loop-pose";

export type CueEvent = {
  /** absolute stage clock, seconds */
  at: number;
  state: CoachCue["state"];
  aim: CoachCue["aim"];
  amplitude: number;
  verb: MotionVerb | null;
  /** entry-head study: from this cue on the stage clock runs shifted by `rebase` seconds, so the post-cue frames are those of another cue time */
  rebase?: number;
};

export type CaptureSpec = {
  px: number;
  fps: number;
  /** simulation rate in Hz; must be a multiple of fps */
  rate: number;
  /** clock of the first captured frame, seconds */
  start: number;
  frames: number;
  init: CueEvent;
  events: CueEvent[];
  /** false = return poses only (no render / PNG) */
  render: boolean;
  /** bridge study: instead of cues, ease the pose-space from the pose at `start` to the pose at this clock over `bridgeFrames` frames, then hold */
  bridgeTo?: number;
  bridgeFrames?: number;
};

export type CapturedFrame = { t: number; pose: Record<string, number>; png: string | null };

/** Production slice: renders poses authored by loop-pose.ts, one real Gold Master render per pose. */
export type ProductionCapture = {
  /** poses of a job, so the capture script can store them next to the frames */
  poses: (job: Job) => Pose[];
  /** a stage of `px` x `px`; frames(poses) renders one PNG data URL per pose; close() disposes it */
  open: (px: number) => { frames: (poses: Pose[]) => string[]; close: () => void };
  /** loop-pose.ts smoothing vs the real HeroCoachStage.update on the Live (un-snapped) clock: max abs pose difference */
  selfCheck: () => number;
};

declare global {
  interface Window {
    __coachCapture?: { run: (spec: CaptureSpec) => Promise<CapturedFrame[]>; renderer: string | null; production?: ProductionCapture };
  }
}

const EPS = 1e-9;

export function CoachMotionCapture() {
  const [status, setStatus] = useState("loading Gold Master…");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ HeroCoachStage }, { loadModularPackage }] = await Promise.all([import("../hero-loop/coach/live-stage"), import("../hero-loop/coach/gold-master/package")]);
        const data = await loadModularPackage();
        if (!alive) return;

        const run = async (spec: CaptureSpec): Promise<CapturedFrame[]> => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = spec.px;
          const stage = new HeroCoachStage(canvas, data, "lite");
          stage.resize(spec.px);
          const perFrame = Math.round(spec.rate / spec.fps);
          const dt = 1 / spec.rate;
          const startStep = Math.round(spec.start * spec.rate);
          const pending = [...spec.events].sort((a, b) => a.at - b.at);
          // the same calls CoachLive's effect makes when a cue arrives
          const apply = (e: CueEvent, t: number) => {
            stage.setState(e.state, t);
            stage.amplitude = e.amplitude;
            stage.aim = { x: e.aim === "left" ? -1 : e.aim === "right" ? 1 : 0, y: e.aim === "right" ? 0.15 : 0 };
            stage.triggerVerb(e.verb, t);
          };
          apply(spec.init, 0);
          const out: CapturedFrame[] = [];
          if (spec.bridgeTo !== undefined) {
            // pose-space bridge: both end poses come from the real stage; every in-between pose is rendered by it (no image blending)
            const priv = stage as unknown as { pose: Record<string, number>; applyPose: (p: Record<string, number>) => void };
            let from: Record<string, number> | null = null;
            let to: Record<string, number> | null = null;
            const endStep = Math.round(spec.bridgeTo * spec.rate);
            for (let k = 0; k <= endStep; k += 1) {
              stage.update(k * dt);
              if (k === startStep) from = { ...priv.pose };
            }
            to = { ...priv.pose };
            const n = spec.bridgeFrames ?? 6;
            for (let i = 0; i < spec.frames; i += 1) {
              const x = Math.min(1, i / n);
              const s = x * x * (3 - 2 * x);
              const pose: Record<string, number> = {};
              for (const key of Object.keys(to)) pose[key] = (from as Record<string, number>)[key] + (to[key] - (from as Record<string, number>)[key]) * s;
              priv.applyPose(pose);
              stage.render();
              out.push({ t: spec.start + i / spec.fps, pose, png: spec.render ? canvas.toDataURL("image/png") : null });
            }
            stage.dispose();
            return out;
          }
          let shift = 0;
          for (let k = 0; out.length < spec.frames; k += 1) {
            const t = k * dt;
            while (pending.length && pending[0].at <= t + EPS) {
              const e = pending.shift() as CueEvent;
              if (e.rebase !== undefined) {
                shift = e.rebase;
                (stage as unknown as { lastT: number }).lastT = t - dt + shift; // keep the smoothing step length unchanged across the clock jump
              }
              apply(e, t + shift);
            }
            stage.update(t + shift);
            if (k >= startStep && (k - startStep) % perFrame === 0) {
              let png: string | null = null;
              if (spec.render) {
                stage.render();
                png = canvas.toDataURL("image/png"); // synchronous, straight after render, so the drawing buffer is still intact
              }
              out.push({ t, pose: { ...(stage as unknown as { pose: Record<string, number> }).pose }, png });
            }
          }
          stage.dispose();
          return out;
        };

        type Priv = { pose: Pose; applyPose: (p: Pose) => void };
        const production: ProductionCapture = {
          poses: jobPoses,
          open: (px) => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = px;
            const stage = new HeroCoachStage(canvas, data, "lite");
            stage.resize(px);
            return {
              frames: (poses) =>
                poses.map((pose) => {
                  (stage as unknown as Priv).applyPose(pose);
                  stage.render();
                  return canvas.toDataURL("image/png"); // synchronous, straight after render, so the drawing buffer is still intact
                }),
              close: () => stage.dispose(),
            };
          },
          selfCheck: () => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 64;
            const stage = new HeroCoachStage(canvas, data, "lite");
            stage.resize(64);
            const rate = 120;
            const cueAt = 2;
            stage.setState("watching", 0);
            stage.amplitude = WATCH_AMPLITUDE;
            stage.aim = WATCH_AIM;
            let mine: Pose | null = null;
            let worst = 0;
            for (let k = 0; k <= 5 * rate; k += 1) {
              const t = k / rate;
              if (k === cueAt * rate) {
                stage.setState("analyzing", t);
                stage.amplitude = ANALYZE_AMPLITUDE;
                stage.aim = ANALYZE_AIM;
                stage.triggerVerb("GATHER", t);
              }
              stage.update(t);
              const after = t >= cueAt;
              let target = after ? statePose("analyzing", t - cueAt, t, ANALYZE_AIM) : statePose("watching", t, t, WATCH_AIM);
              if (after) target = addPose(target, verbImpulse("GATHER", t - cueAt, ANALYZE_AIM));
              target = damp(target, after ? ANALYZE_AMPLITUDE : WATCH_AMPLITUDE);
              mine = mine ? smoothPose(mine, target, 1 / rate) : target;
              const live = (stage as unknown as Priv).pose;
              for (const key of Object.keys(live) as (keyof Pose)[]) worst = Math.max(worst, Math.abs(live[key] - mine[key]));
            }
            stage.dispose();
            return worst;
          },
        };

        const gl = document.createElement("canvas").getContext("webgl");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        window.__coachCapture = { run, renderer: info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null, production };
        document.documentElement.dataset.captureReady = "1";
        setStatus("ready");
      } catch (error) {
        setStatus(`failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main style={{ background: "#111", color: "#ccc", font: "13px monospace", minHeight: "100vh", padding: 16 }}>
      <p data-testid="capture-status">coach-motion-v2 capture · {status}</p>
    </main>
  );
}
