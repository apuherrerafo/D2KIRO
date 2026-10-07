/* DS V1 · Landing 01B · Counterfactual personalization — review surface (TSK-242). Isolated, not the source of truth: the
   real landing is. Three held states (generic · the model joins · for you), a full-sequence review with a scrubber that
   uses the SAME stage mapping the page uses, and the 390 px object. */
import { useState, type CSSProperties } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/canonical.css";
import "@/features/landing/landing.css";
import { Button } from "@/design/components";
import { motionCssVars } from "@/design/round-3a/motion-tokens";
import { COUNTERFACTUAL_STAGES, CounterfactualObject, counterfactualView, type CounterfactualStage, type CounterfactualView } from "@/features/landing/counterfactual";

const meta = {
  title: "DS V1 / Landing 01B / Counterfactual",
  component: CounterfactualObject,
  parameters: { layout: "fullscreen" },
};
export default meta;

const MOTION_VARS = motionCssVars() as CSSProperties;
const bar: CSSProperties = { alignItems: "center", background: "var(--r3-bg)", borderBottom: "1px solid var(--r3-line-strong)", color: "var(--r3-ink)", display: "flex", flexWrap: "wrap", font: "500 12px/1 var(--f-bric)", gap: 8, padding: 12 };
const group: CSSProperties = { alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 };
const inline: CSSProperties = { display: "inline-block" };
const SHORT: Record<CounterfactualStage, string> = { generic: "Generic", context: "Model joins", reinterpret: "Re-read", reorder: "Reorder", personal: "For you" };

const held = (stage: CounterfactualStage): CounterfactualView => {
  const at = COUNTERFACTUAL_STAGES.indexOf(stage);
  return { stage, context: at >= 1 ? 1 : 0, reinterpret: at >= 2 ? 1 : 0, reorder: at >= 3 ? 1 : 0 };
};

function Frame({ children, width }: { children: React.ReactNode; width?: number }) {
  const frame: CSSProperties = { ...MOTION_VARS, ...(width ? { margin: "0 auto", width } : {}) };
  return <div className="r3-page ld-root" data-theme="dark" style={frame}>{children}</div>;
}

function Held({ reducedMotion = false, stage, width }: { reducedMotion?: boolean; stage: CounterfactualStage; width?: number }) {
  return (
    <Frame width={width}>
      <div style={{ minHeight: width ? 760 : 700 }}><CounterfactualObject reducedMotion={reducedMotion} view={held(stage)} /></div>
    </Frame>
  );
}

/** The aggregate reading: reasonable for anyone in this draft. The player's model sits idle, unread. */
export function GenericState() { return <Held stage="generic" />; }
/** The model joins: its contour has compressed into the chip, and what it knows is read for this draft. */
export function PersonalContextState() { return <Held stage="context" />; }
/** The evidence is re-read: the lane that looked like a risk is challenged by the player's own games. */
export function ReinterpretedState() { return <Held stage="reinterpret" />; }
/** The call for this player: the order has moved, one candidate holds the decision position, and says why. */
export function PersonalizedState() { return <Held stage="personal" />; }

function MotionReviewSurface({ reduced = false, width }: { reduced?: boolean; width?: number }) {
  const [progress, setProgress] = useState(0);
  const [forceReduced, setForceReduced] = useState(reduced);
  const view = counterfactualView(progress, forceReduced);
  const onProgress = (event: React.ChangeEvent<HTMLInputElement>) => setProgress(Number(event.target.value) / 1000);
  const onReduced = (event: React.ChangeEvent<HTMLInputElement>) => setForceReduced(event.target.checked);
  const jump = (stage: CounterfactualStage) => () => setProgress(stageStart(stage));
  return (
    <Frame width={width}>
      <div data-testid="counterfactual-review-controls" style={bar}>
        <span data-testid="counterfactual-review-stage">Stage: {SHORT[view.stage]}</span>
        <div style={group}>
          {COUNTERFACTUAL_STAGES.map((stage) => (
            <span data-testid={`go-${stage}`} key={stage} style={inline}><Button onClick={jump(stage)} variant="secondary">{SHORT[stage]}</Button></span>
          ))}
        </div>
        <label style={group}>Scroll through the sequence
          <input data-testid="counterfactual-scrub" max={1000} min={0} onChange={onProgress} type="range" value={Math.round(progress * 1000)} />
        </label>
        <label style={group}>
          <input checked={forceReduced} data-testid="counterfactual-reduced" onChange={onReduced} type="checkbox" /> Reduced motion
        </label>
      </div>
      <div style={{ minHeight: width ? 760 : 700 }}><CounterfactualObject reducedMotion={forceReduced} view={view} /></div>
    </Frame>
  );
}

/** Where each stage starts on the 0–1 pinned range, from the same table the page uses. */
function stageStart(stage: CounterfactualStage) {
  for (let i = 0; i <= 1000; i += 1) if (counterfactualView(i / 1000, false).stage === stage) return i / 1000;
  return 0;
}

/** Full sequence: step through the stages or scrub the whole transformation by hand. */
export function MotionReview() { return <MotionReviewSurface />; }
/** The same review surface and object at 390 px. */
export function Mobile() { return <MotionReviewSurface width={390} />; }
/** Reduced motion forced on: the same story as discrete states — the order simply changes. */
export function ReducedMotion() { return <MotionReviewSurface reduced />; }
