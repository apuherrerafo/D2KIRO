import "@/test-support/happy-dom";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCanonicalHero } from "@/design/canonical/hero-media";
import { LandingPage } from "@/features/landing";
import { HeroStory } from "@/features/landing/hero-story/HeroStory";
import { STEPS, STEP_MS, flagsFor, momentOf } from "@/features/landing/hero-story/use-hero-story";
import { HERO_STORY, REASON_STAGES, candidateOf, fitAt, rankAt } from "@/features/landing/product-state/fake-scenario-hero";

afterEach(cleanup);

const css = readFileSync(join(import.meta.dir, "..", "..", "features", "landing", "hero-story", "hero-story.css"), "utf8");

describe("Landing 01C hero story: the clock", () => {
  it("tells one blind round in about eleven seconds, then holds the finished draft before the next one", () => {
    const at = (step: (typeof STEPS)[number]) => STEPS.slice(0, STEPS.indexOf(step)).reduce((sum, name) => sum + STEP_MS[name], 0);
    expect(at("reveal")).toBe(2200);
    expect(at("counterA")).toBe(3700);
    expect(at("decide")).toBe(7400);
    expect(at("lock")).toBe(9100);
    expect(at("hold")).toBe(11000);
    expect(at("hold") + STEP_MS.hold).toBeLessThanOrEqual(14000);
  });

  it("is causal: nothing is revealed or scored before the enemy picks are revealed, and only the reveal opens the scoring", () => {
    expect(flagsFor("picks").revealed).toBe(false);
    expect(flagsFor("picks").applied).toBe(0);
    expect(flagsFor("reveal").revealed).toBe(true);
    expect(flagsFor("reveal").applied).toBe(0);
    expect(STEPS.map((step) => flagsFor(step).applied)).toEqual([0, 0, 1, 2, 3, 4, 4, 4, 4, 4]);
  });

  it("only ever adds to the story within a pass: flags never switch off", () => {
    for (const name of ["revealed", "applied", "decided", "pressed", "placed"] as const) {
      const series = STEPS.map((step) => Number(flagsFor(step)[name]));
      expect(series).toEqual([...series].sort((a, b) => a - b));
    }
    expect(STEPS.filter((step) => flagsFor(step).placing)).toEqual(["place"]);
    expect(flagsFor("picks", false).armed).toBe(false);
  });

  it("walks the five product moments in order", () => {
    expect(STEPS.map(momentOf)).toEqual([0, 1, 2, 2, 2, 2, 3, 4, 4, 4]);
  });
});

describe("Landing 01C hero story: the data", () => {
  it("shows real heroes only", () => {
    for (const scenario of HERO_STORY.scenarios) {
      const names = [...scenario.bans, ...scenario.enemies, ...scenario.allies.map((seat) => seat.hero), ...scenario.candidates.map((candidate) => candidate.hero)].filter((name): name is string => name !== null);
      for (const name of names) expect(getCanonicalHero(name)).not.toBeNull();
    }
  });

  it("opens with our two supports locked, never a core, and our own seat empty", () => {
    for (const scenario of HERO_STORY.scenarios) {
      const bySeat = Object.fromEntries(scenario.allies.map((seat) => [seat.position, seat]));
      expect(bySeat[4].hero).not.toBeNull();
      expect(bySeat[5].hero).not.toBeNull();
      expect(bySeat[2].you).toBe(true);
      expect(bySeat[2].hero).toBeNull();
      expect(scenario.allies.filter((seat) => seat.hero !== null)).toHaveLength(2);
    }
  });

  it("every score is its base plus the reasons that have arrived, so every delta has a cause", () => {
    const puck = candidateOf(HERO_STORY.scenarios[0], "Puck");
    expect(fitAt(puck, 0)).toBe(78);
    expect(fitAt(puck, 4)).toBe(91);
    expect(fitAt(puck, 4) - fitAt(puck, 0)).toBe(puck.reasons.reduce((sum, reason) => sum + reason.delta, 0));
    expect(puck.reasons.map((reason) => reason.stage)).toEqual([...REASON_STAGES]);
    for (const scenario of HERO_STORY.scenarios) {
      for (const candidate of scenario.candidates) expect(candidate.reasons.map((reason) => reason.stage)).toEqual([...REASON_STAGES]);
    }
  });

  it("the enemy reveal is what changes the leader: before it the ranking is the baseline, after it the winner leads", () => {
    for (const scenario of HERO_STORY.scenarios) {
      const before = rankAt(scenario, 0).map((row) => row.hero);
      const after = rankAt(scenario, 4).map((row) => row.hero);
      expect(before[0]).not.toBe(after[0]);
      expect(rankAt(scenario, 4)[0].fit).toBeGreaterThanOrEqual(90);
      expect(rankAt(scenario, 2)[0].hero).toBe(after[0]);
    }
    expect(rankAt(HERO_STORY.scenarios[0], 4).map((row) => row.fit)).toEqual([91, 82, 74]);
  });
});

describe("Landing 01C hero story: the stage", () => {
  it("renders the story without a click, summarised once in words, hidden from assistive tech otherwise", () => {
    const screen = render(<LandingPage motionMode="reduced" />);
    const story = screen.getByTestId("hero-story");
    expect(story.getAttribute("data-motion")).toBe("reduced");
    expect(story.parentElement?.textContent).toContain(HERO_STORY.scenarios[0].summary);
    expect(story.querySelectorAll("[aria-hidden='true']").length).toBeGreaterThan(0);
    expect(story.querySelectorAll(".hs-card")).toHaveLength(3);
    expect(story.querySelectorAll(".hs-node")).toHaveLength(HERO_STORY.signals.length);
  });

  it("lets a visitor stop the motion", () => {
    const screen = render(<LandingPage motionMode="full" />);
    const hero = screen.container.querySelector('[data-section="hero"]') as HTMLElement;
    const pause = [...hero.querySelectorAll("button")].find((button) => button.textContent === "Pause") as HTMLElement;
    expect(pause).toBeDefined();
    fireEvent.click(pause);
    expect(hero.querySelector(".hs-host")?.getAttribute("data-paused")).toBe("true");
    expect([...hero.querySelectorAll("button")].some((button) => button.textContent === "Resume")).toBe(true);
  });

  it("freezes the canonical story at a requested review step", () => {
    const screen = render(<HeroStory reviewStep="counterB" />);
    const story = screen.getByTestId("hero-story");
    expect(story.getAttribute("data-step")).toBe("counterB");
    expect(story.getAttribute("data-revealed")).toBe("true");
    expect(story.parentElement?.textContent).toContain("You · Pos 2 Mid");
  });
});

describe("Landing 01C hero story: the CSS", () => {
  it("keeps to tokens: no colour literal, no custom property outside the hs- namespace (the icon size token is the one sanctioned override)", () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(css)).toBe(false);
    expect(/(^|[{;]\s*)--(?!hs-|chm-icon-size)[a-z][a-z-]*\s*:/m.test(css)).toBe(false);
  });

  it("loops only what is ambient or travelling, and every loop has a reduced-motion substitute", () => {
    const looping = [...css.matchAll(/animation:\s*(hs-[a-z-]+)[^;]*infinite/g)].map((match) => match[1]);
    expect(new Set(looping)).toEqual(new Set(["hs-sweep", "hs-drift", "hs-shimmer", "hs-lane", "hs-stub", "hs-spin", "hs-bus-l", "hs-bus-r", "hs-drop", "hs-foil"]));
    expect(css.includes('.hs[data-motion="reduced"] .hs-ambient')).toBe(true);
    expect(css.includes('.hs[data-motion="reduced"] .hs-spectrum::before')).toBe(true);
    expect(css.includes('.hs[data-motion="reduced"] .hs-beam::after')).toBe(true);
    expect(css.includes("@media (prefers-reduced-motion: reduce)")).toBe(true);
  });

  it("never depends on an animation for visibility under reduced motion: every hidden base state has a transition", () => {
    for (const selector of [".hs-px-art", ".hs-chip", ".hs-why li"]) {
      const rule = css.split("\n").find((line) => line.startsWith(`${selector} {`));
      expect(rule).toBeDefined();
      expect(rule).toContain("opacity: 0");
      expect(rule).toContain("transition: opacity");
    }
  });
});

describe("Landing 01C hero story: typography", () => {
  it("uses neither the rejected families nor uppercase, tracked micro-labels", () => {
    expect(/--f-(plex|pmono|smono)/.test(css)).toBe(false);
    expect(/text-transform:\s*uppercase|letter-spacing:\s*\.0[1-9]/.test(css)).toBe(false);
  });
});
