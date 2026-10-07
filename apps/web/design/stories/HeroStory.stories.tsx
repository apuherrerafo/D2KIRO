/* DS V1 · Landing 01B — the production HeroStory, frozen at a chosen moment for review. */
import type { CSSProperties } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/canonical.css";
import "@/design/canonical/motion/motion.css";
import { LabProvider } from "@/design/round-3a/lab-context";
import { motionCssVars } from "@/design/round-3a/motion-tokens";
import { HeroStory } from "@/features/landing/hero-story/HeroStory";
import { STEPS, type HeroStoryStep } from "@/features/landing/hero-story/use-hero-story";

const meta = {
  title: "DS V1 / Landing 01B / Hero",
  component: HeroStory,
  args: { reviewStep: "picks" satisfies HeroStoryStep },
  argTypes: { reviewStep: { control: "select", options: STEPS } },
  parameters: { layout: "fullscreen" },
};
export default meta;

export function Review({ reviewStep = "picks" }: { reviewStep?: HeroStoryStep }) {
  return (
    <div className="r3-page" data-theme="dark" style={motionCssVars() as CSSProperties}>
      <LabProvider value={{ autoplay: false, mode: "full" }}>
        <HeroStory reviewStep={reviewStep} />
      </LabProvider>
    </div>
  );
}
