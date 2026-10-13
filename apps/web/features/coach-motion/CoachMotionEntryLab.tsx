/* COACH MOTION V2 · entry-phase lab (R&D, not product UI). Answers one question: when the reveal cue arrives while WATCHING_IDLE is at an
   arbitrary phase, what does the screen do at the boundary? Three strategies run side by side through the real player:
     canonical  the one transition that starts where the idle clip ends (the first prototype)
     nearest    enter the transition at the entry phase closest to the next idle phase (no latency, small pose step)
     wait       keep the idle running to the next entry phase (no pose step, latency < stride frames)
   Loader model under test: CURRENT clip decoded + NEXT prefetched, the previous clip released after the hand-over.
   `window.__entry.run(frame)` drives one pass and returns the frames around the boundary as PNG read-backs for the metrics scripts. */
"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/canonical.css";
import "@/design/canonical/motion/motion.css";
import { motionCssVars } from "@/design/round-3a/motion-tokens";
import { coachCueFor } from "../hero-loop/loop";
import "../hero-loop/hero-loop.css";
import "../hero-loop/hero-loop-lab.css";
import { CoachMotionAtlas, type CoachMotionHandle, type FrameInfo } from "./CoachMotionAtlas";
import { heldAtlasKeys, loadAtlas, loadManifest, releaseAtlas, retainedDecodedBytes, type ClipId, type MotionManifest, type PackId } from "./clips";
import { entryPhases, planEntry, type EntryPlan, type EntryStrategy } from "./entry-plan";
import "./coach-motion-lab.css";

const MOTION_VARS = motionCssVars() as CSSProperties;
const IDLE: ClipId = "WATCHING_IDLE";
const CANONICAL: ClipId = "WATCHING_TO_ANALYZING";
const TAIL: ClipId = "WATCHING_TO_ANALYZING_TAIL";
const HOLD_AFTER = 10; // frames recorded after the boundary
const CUE = coachCueFor({ id: "draft", phase: "draft", applied: 0, ms: 1800, verb: null }, "high");

const headOf = (phase: number) => `ENTRY_HEAD_${String(phase).padStart(2, "0")}`;
const playlistFor = (phase: number, strategy: EntryStrategy): ClipId[] => (strategy === "canonical" ? [CANONICAL] : [headOf(phase), TAIL]);

export type EntryFrame = { clip: string; frame: number; t: number; png: string };
export type EntryResult = { strategy: EntryStrategy; shown: number; dir: number; plan: EntryPlan; boundary: number; frames: EntryFrame[]; peakDecodedBytes: number; held: string[] };

declare global {
  interface Window {
    __entry?: { run: (target: number) => Promise<EntryResult[]>; strategies: EntryStrategy[]; memory: () => { bytes: number; keys: string[] } };
  }
}

type Ctl = { target: number; runId: number; collect: (r: EntryResult) => void };

function EntryPanel({ strategy, pack, stride, ctl, runId, manage, manifest }: { strategy: EntryStrategy; pack: PackId; stride: number; ctl: MutableRefObject<Ctl>; runId: number; manage: boolean; manifest: MotionManifest }) {
  const handle = useRef<CoachMotionHandle>(null);
  const fresh = (runId: number) => ({ runId, started: false, prev: -1, dir: 1 as 1 | -1, fired: false, remaining: -1, plan: null as EntryPlan | null, shown: 0, frames: [] as EntryFrame[], boundary: -1, post: 0, done: false, peak: 0, released: false });
  const s = useRef(fresh(0));
  const [readout, setReadout] = useState("");
  const count = manifest.clips[IDLE].frames;

  // loader model: NEXT = what a cue could need from the idle phase on screen, decoded ahead; anything else is released
  const prefetch = useCallback(
    (frame: number) => {
      const want = new Set<string>([manifest.clips[IDLE].file]);
      if (strategy === "canonical") want.add(manifest.clips[CANONICAL].file);
      else {
        want.add(manifest.clips[TAIL].file);
        for (const p of entryPhases(count, stride)) if (Math.abs(p - frame) <= stride) want.add(manifest.clips[headOf(p)].file);
      }
      want.forEach((f) => void loadAtlas(pack, f));
      // releasing is only meaningful when one strategy owns the loader (the 3-panel page shares one decoded set)
      if (manage) for (const c of Object.values(manifest.clips)) if (!want.has(c.file)) releaseAtlas(pack, c.file);
    },
    [count, manage, manifest, pack, strategy, stride],
  );

  const onFrame = useCallback(
    (frame: number, _n: number, info: FrameInfo) => {
      if (s.current.runId !== ctl.current.runId) s.current = fresh(ctl.current.runId); // a new pass starts on its first frame
      const st = s.current;
      if (st.done) return;
      const el = handle.current?.canvas();
      st.peak = Math.max(st.peak, retainedDecodedBytes());
      setReadout(`${info.clip} ${frame + 1}`);
      const rec = () => st.frames.push({ clip: info.clip, frame, t: performance.now(), png: el ? el.toDataURL("image/png") : "" });
      if (ctl.current.runId === 0) {
        prefetch(frame); // before the first pass the idle only warms the loader
        return;
      }
      if (!st.started) {
        // the pass begins when the restarted idle shows its frame 0; callbacks of the idle that was still playing are ignored
        if (info.clip !== IDLE || frame !== 0) return;
        st.started = true;
      }
      if (info.clip === IDLE && !st.fired) {
        st.dir = st.prev < 0 ? 1 : frame > st.prev ? 1 : frame < st.prev ? -1 : st.dir;
        st.prev = frame;
        rec();
        if (st.frames.length > 4) st.frames.shift();
        prefetch(frame);
        if (frame === ctl.current.target && st.remaining < 0) {
          st.plan = planEntry(strategy, frame, st.dir, count, stride);
          st.shown = frame;
          st.remaining = st.plan.wait;
          if (st.remaining === 0) {
            st.fired = true;
            st.boundary = st.frames.length; // index of the first frame after the switch
            handle.current?.playNext(playlistFor(st.plan.phase, strategy));
          }
        } else if (st.remaining > 0) {
          st.remaining -= 1;
          if (st.remaining === 0 && st.plan) {
            st.fired = true;
            st.boundary = st.frames.length;
            handle.current?.playNext(playlistFor(st.plan.phase, strategy));
          }
        }
        return;
      }
      if (!st.fired) return;
      rec();
      if (!st.released) {
        st.released = true;
        // the previous clip is released as soon as the new playlist is the one being drawn
        if (manage) releaseAtlas(pack, manifest.clips[IDLE].file);
      }
      st.post += 1;
      if (st.post >= HOLD_AFTER) {
        st.done = true;
        ctl.current.collect({ strategy, shown: st.shown, dir: st.dir, plan: st.plan as EntryPlan, boundary: st.boundary, frames: st.frames, peakDecodedBytes: st.peak, held: heldAtlasKeys() });
      }
    },
    [count, ctl, manage, manifest, pack, prefetch, strategy, stride],
  );

  return (
    <section className="cm-panel" data-testid={`entry-${strategy}`}>
      <h2>{strategy.toUpperCase()}</h2>
      <p className="cm-readout" data-testid={`entry-readout-${strategy}`}>{readout}</p>
      <div className="cm-stage">
        <div className="cm-zoom">
          <div className="hl-coach" data-renderer="atlas" data-state={CUE.state} style={{ "--hl-coach-scale": String(CUE.scale) } as CSSProperties}>
            <div className="hl-coach-body">
              <div className="hl-coach-flourish">
                <CoachMotionAtlas className="cm-atlas" clip={IDLE} onFrame={onFrame} pack={pack} playing ref={handle} restartKey={runId} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CoachMotionEntryLab({ pack, theme, stride, only }: { pack: PackId; theme: "dark" | "light"; stride: number; only: EntryStrategy | null }) {
  const [manifest, setManifest] = useState<MotionManifest | null>(null);
  const [runId, setRunId] = useState(0);
  const ctl = useRef<Ctl>({ target: 0, runId: 0, collect: () => {} });
  const strategies: EntryStrategy[] = only ? [only] : ["canonical", "nearest", "wait"];

  useEffect(() => {
    void loadManifest(pack).then(setManifest);
  }, [pack]);

  useEffect(() => {
    if (!manifest) return;
    window.__entry = {
      strategies,
      memory: () => ({ bytes: retainedDecodedBytes(), keys: heldAtlasKeys() }),
      run: async (target) => {
        // CURRENT decoded before the clock starts, so every panel's idle begins on frame 0 in the same tick
        await loadAtlas(pack, manifest.clips[IDLE].file);
        await Promise.all(strategies.map((st) => loadAtlas(pack, manifest.clips[st === "canonical" ? CANONICAL : TAIL].file)));
        await Promise.all(strategies.filter((st) => st !== "canonical").flatMap(() => entryPhases(manifest.clips[IDLE].frames, stride).filter((p) => p <= 2 * stride).map((p) => loadAtlas(pack, manifest.clips[headOf(p)].file))));
        return new Promise<EntryResult[]>((resolve) => {
          const out: EntryResult[] = [];
          ctl.current = {
            target,
            runId: ctl.current.runId + 1,
            collect: (r) => {
              out.push(r);
              if (out.length === strategies.length) resolve(out);
            },
          };
          setRunId(ctl.current.runId);
        });
      },
    };
    return () => {
      delete window.__entry;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, pack, stride, only]);

  return (
    <div className="r3-page hl-lab-page" data-testid="coach-entry-page" style={MOTION_VARS}>
      <div className="hl-lab-theme" data-testid="coach-entry-theme" data-theme={theme}>
        <div className="hl-lab" data-testid="coach-entry-lab">
          <header className="hl-lab-head">
            <div>
              <h1 className="hl-lab-title">Coach motion V2 · entry phase</h1>
              <p className="hl-lab-sub">{`pack ${pack} · entry heads every ${stride} idle frames · call window.__entry.run(frame)`}</p>
            </div>
          </header>
          <div className="cm-grid" data-inspect="0">
            {manifest && strategies.map((st) => <EntryPanel ctl={ctl} key={st} manifest={manifest} pack={pack} manage={only !== null} runId={runId} stride={stride} strategy={st} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
