/* DS V1 · Landing 01B · Memory Strip — Phase C: motion review surface. Review tooling only (no scroll, no final navigation):
   trigger each transition, step, replay, scrub, slow down, and force reduced motion. */
import { useState, type CSSProperties } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/canonical.css";
import { Button } from "@/design/components";
import { MEMORY_SCENE_ORDER, MEMORY_TRANSITIONS, MemoryStripMotion } from "@/features/landing/memory-strip";
import type { MemorySceneId } from "@/features/landing/memory-strip";

const meta = {
  title: "DS V1 / Landing 01B / Memory Strip Motion",
  component: MemoryStripMotion,
  args: { sceneId: "match-01" satisfies MemorySceneId },
  parameters: { layout: "fullscreen" },
};
export default meta;

const SHORT: Record<MemorySceneId, string> = { "match-01": "01", "match-08": "08", "match-24": "24", "match-56": "56", "player-model": "Model" };
const bar: CSSProperties = { alignItems: "center", background: "var(--r3-bg)", borderBottom: "1px solid var(--r3-line-strong)", color: "var(--r3-ink)", display: "flex", flexWrap: "wrap", font: "500 12px/1 var(--f-bric)", gap: 8, padding: 12 };
const inline: CSSProperties = { display: "inline-block" };
const group: CSSProperties = { alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 };

interface ReviewProps { width?: number; startAt?: MemorySceneId; reducedMotion?: "auto" | "reduce" | "full" }

function MotionReviewSurface({ width, startAt = "match-01", reducedMotion = "auto" }: ReviewProps) {
  const [sceneId, setSceneId] = useState<MemorySceneId>(startAt);
  const [replayKey, setReplayKey] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [reduced, setReduced] = useState(reducedMotion);
  const index = MEMORY_SCENE_ORDER.indexOf(sceneId);

  const playTransition = (to: MemorySceneId) => { setScrubbing(false); setSceneId(to); setReplayKey((k) => k + 1); };
  const onNext = () => { setScrubbing(false); setSceneId(MEMORY_SCENE_ORDER[Math.min(index + 1, MEMORY_SCENE_ORDER.length - 1)]); };
  const onPrevious = () => { setScrubbing(false); setSceneId(MEMORY_SCENE_ORDER[Math.max(index - 1, 0)]); };
  const onReplay = () => { setScrubbing(false); setReplayKey((k) => k + 1); };
  const onReset = () => { setScrubbing(false); setSceneId("match-01"); };
  const onScrubToggle = () => setScrubbing((on) => !on);
  const onProgress = (event: React.ChangeEvent<HTMLInputElement>) => { setScrubbing(true); setProgress(Number(event.target.value) / 1000); };
  const onSpeed = (event: React.ChangeEvent<HTMLSelectElement>) => setSpeed(Number(event.target.value));
  const onReduced = (event: React.ChangeEvent<HTMLSelectElement>) => setReduced(event.target.value as "auto" | "reduce" | "full");
  const frame: CSSProperties = width ? { margin: "0 auto", width } : {};

  return (
    <div className="r3-page" data-theme="dark" style={frame}>
      <div style={bar} data-testid="motion-review-controls">
        <span data-testid="motion-review-state">State: {SHORT[sceneId]}</span>
        <div style={group}>
          {MEMORY_TRANSITIONS.map((t) => (
            <span key={t.id} data-testid={`play-${t.id}`} style={inline}><Button variant="secondary" onClick={() => playTransition(t.to)}>{SHORT[t.from]} → {SHORT[t.to]}</Button></span>
          ))}
        </div>
        <div style={group}>
          <span data-testid="previous" style={inline}><Button variant="secondary" onClick={onPrevious}>Previous (cut)</Button></span>
          <span data-testid="next" style={inline}><Button variant="secondary" onClick={onNext}>Next</Button></span>
          <span data-testid="replay" style={inline}><Button variant="secondary" onClick={onReplay}>Replay</Button></span>
          <span data-testid="reset" style={inline}><Button variant="secondary" onClick={onReset}>Reset to 01</Button></span>
        </div>
        <label style={group}>Scrub into this state
          <input type="range" min={0} max={1000} value={Math.round(progress * 1000)} data-testid="scrub" onChange={onProgress} />
          <span data-testid="scrub-toggle" style={inline}><Button variant="secondary" onClick={onScrubToggle}>{scrubbing ? "Scrubbing: release" : "Scrub"}</Button></span>
        </label>
        <label style={group}>Speed
          <select value={speed} onChange={onSpeed} data-testid="speed">
            <option value={1}>1×</option>
            <option value={0.5}>0.5×</option>
            <option value={0.25}>0.25×</option>
          </select>
        </label>
        <label style={group}>Motion
          <select value={reduced} onChange={onReduced} data-testid="reduced">
            <option value="auto">Follow system</option>
            <option value="full">Full</option>
            <option value="reduce">Reduced</option>
          </select>
        </label>
      </div>
      <MemoryStripMotion sceneId={sceneId} replayKey={replayKey} scrub={scrubbing ? progress : null} speed={speed} reducedMotion={reduced} />
    </div>
  );
}

/** Desktop review: use the transition buttons, Next / Previous / Replay, or scrub a transition by hand. */
export function MotionReview() { return <MotionReviewSurface />; }
/** The same surface at 390 px. */
export function MotionReviewMobile() { return <MotionReviewSurface width={390} />; }
/** Reduced motion forced on: the same relationships, opacity and direct updates only. */
export function MotionReviewReduced() { return <MotionReviewSurface reducedMotion="reduce" />; }
