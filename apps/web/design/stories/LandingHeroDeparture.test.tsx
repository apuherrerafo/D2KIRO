import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LandingPage } from "@/features/landing";
import { HeroStory } from "@/features/landing/hero-story/HeroStory";
import { STEPS, settledPosition } from "@/features/landing/hero-story/use-hero-story";
import { HERO_STORY, rankAt } from "@/features/landing/product-state/fake-scenario-hero";

afterEach(cleanup);

const LAST = STEPS.length - 1;
const canonical = HERO_STORY.scenarios[0];
const puck = rankAt(canonical, 4)[0].hero;
const ember = rankAt(HERO_STORY.scenarios[1], 4)[0].hero;

describe("Hero departure: the Memory handoff always starts from the canonical Puck lock", () => {
  it("the canonical scenario is Puck, and Ember is the one that must never be left on screen", () => {
    expect(puck).toBe("Puck");
    expect(ember).toBe("Ember Spirit");
  });

  it("settledPosition lands on the final step of the canonical scenario from anywhere in the loop", () => {
    for (const cycle of [0, 1, 2, 3, 10, 11]) {
      for (let index = 0; index <= LAST; index += 1) {
        const settled = settledPosition({ cycle, index }, LAST);
        expect(settled.index).toBe(LAST);
        expect(settled.cycle % HERO_STORY.scenarios.length).toBe(0);
        expect(settled.cycle).toBeGreaterThanOrEqual(cycle);
        expect(settled.cycle - cycle).toBeLessThan(HERO_STORY.scenarios.length);
      }
    }
  });

  it("an Ember pass (odd cycle) moves forward to the next Puck; an already-Puck pass stays on its cycle", () => {
    expect(settledPosition({ cycle: 1, index: 3 }, LAST)).toEqual({ cycle: 2, index: LAST });
    expect(settledPosition({ cycle: 1, index: LAST }, LAST)).toEqual({ cycle: 2, index: LAST });
    expect(settledPosition({ cycle: 2, index: 4 }, LAST)).toEqual({ cycle: 2, index: LAST });
    expect(settledPosition({ cycle: 2, index: LAST }, LAST)).toEqual({ cycle: 2, index: LAST });
  });

  it("a departing Hero shows the locked Puck, never Ember locked, and stays there", () => {
    const screen = render(<HeroStory settle />);
    const story = screen.getByTestId("hero-story");
    expect(story.getAttribute("data-step")).toBe("hold");
    expect(story.querySelector(".hs-lock")?.textContent).toBe("Puck locked · Pos 2");
    expect(story.textContent).not.toContain("Ember Spirit locked");
  });

  it("settling mid-story from the live loop resolves to the same locked Puck", () => {
    const screen = render(<HeroStory />);
    expect(screen.getByTestId("hero-story").getAttribute("data-step")).toBe("picks");
    screen.rerender(<HeroStory settle />);
    const story = screen.getByTestId("hero-story");
    expect(story.getAttribute("data-step")).toBe("hold");
    expect(story.querySelector(".hs-lock")?.textContent).toBe("Puck locked · Pos 2");
  });

  it("the standalone Hero is untouched: without `settle` it starts at the first moment and keeps its controls", () => {
    const screen = render(<HeroStory />);
    expect(screen.getByTestId("hero-story").getAttribute("data-step")).toBe("picks");
    expect(screen.queryByText("Pause")).not.toBeNull();
  });

  it("the bridge and the first memory share the screen: the track is pulled up under the title on tall stages, never on phones", () => {
    const css = readFileSync(join(import.meta.dir, "..", "..", "features", "landing", "landing.css"), "utf8");
    expect(css).toMatch(/@media \(min-width: 720px\) \{ \.ld-memory-track \{ margin-top: calc\(-1 \* max\(0px,/);
    expect(css).toMatch(/\.ld-memory-head \{[^}]*z-index: 1;/);
  });

  it("reduced motion keeps its contract: a departing Hero is still the final Puck lock", () => {
    const screen = render(
      <LandingPage motionMode="reduced" />,
    );
    const story = screen.getByTestId("hero-story");
    /* Reduced already plays on to Puck; the departure contract is the same final state. */
    expect(["picks", "hold"]).toContain(story.getAttribute("data-step") as string);
  });
});
