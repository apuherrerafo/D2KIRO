import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LandingPage } from "@/features/landing";
import {
  MEMORY_BEATS_ON_SCROLL, MEMORY_SCROLL_SCREENS, beatAt, beatName, memoryCoachCue, memoryScrollView, sameView,
} from "@/features/landing/memory-scroll";
import { MEMORY_SCENE_ORDER, MEMORY_TRANSITIONS } from "@/features/landing/memory-strip";

afterEach(cleanup);

const css = readFileSync(join(import.meta.dir, "..", "..", "features", "landing", "landing.css"), "utf8");
const SAMPLES = 4000;
const sweep = (reduced: boolean) => Array.from({ length: SAMPLES + 1 }, (_, i) => memoryScrollView(i / SAMPLES, reduced));
const order = (id: string) => MEMORY_SCENE_ORDER.indexOf(id as (typeof MEMORY_SCENE_ORDER)[number]);

describe("Memory Strip on scroll: the beats", () => {
  it("runs handoff → 01 → 08 → 24 → 56 → model, a rest on every state and one scrubbed window per approved transition", () => {
    expect(MEMORY_BEATS_ON_SCROLL.map(beatName)).toEqual([
      "handoff",
      "hold:match-01", "transition:match-01>match-08",
      "hold:match-08", "transition:match-08>match-24",
      "hold:match-24", "transition:match-24>match-56",
      "hold:match-56", "transition:match-56>player-model",
      "hold:player-model",
    ]);
    const transitions = MEMORY_BEATS_ON_SCROLL.flatMap((beat) => (beat.kind === "transition" ? [beat.transition] : []));
    expect(transitions).toEqual(MEMORY_TRANSITIONS.map((t) => t.id));
  });

  it("gives every beat real room, transitions more than rests, and stays a section rather than a trap", () => {
    for (const beat of MEMORY_BEATS_ON_SCROLL) expect(beat.screens).toBeGreaterThanOrEqual(0.3);
    MEMORY_BEATS_ON_SCROLL.forEach((beat, i) => {
      if (beat.kind === "transition") expect(beat.screens).toBeGreaterThan(MEMORY_BEATS_ON_SCROLL[i - 1].screens);
    });
    const total = MEMORY_BEATS_ON_SCROLL.reduce((sum, beat) => sum + beat.screens, 0);
    expect(MEMORY_SCROLL_SCREENS).toBeCloseTo(total, 2);
    expect(MEMORY_SCROLL_SCREENS).toBeGreaterThan(4);
    expect(MEMORY_SCROLL_SCREENS).toBeLessThan(6.5);
  });

  it("clamps outside the pin: before it is the handoff at its start, after it is the model at rest", () => {
    expect(beatAt(-0.4)).toEqual({ index: 0, local: 0 });
    expect(beatAt(Number.NaN)).toEqual({ index: 0, local: 0 });
    expect(beatAt(1)).toEqual({ index: MEMORY_BEATS_ON_SCROLL.length - 1, local: 1 });
    expect(memoryScrollView(-1, false)).toMatchObject({ sceneId: "match-01", scrub: null, handoff: 0 });
    expect(memoryScrollView(3, false)).toMatchObject({ sceneId: "player-model", scrub: null, handoff: 1 });
  });
});

describe("Memory Strip on scroll: full motion", () => {
  const views = sweep(false);

  it("never goes backwards through the story and visits every state", () => {
    const ranks = views.map((view) => order(view.sceneId));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(views.map((view) => view.sceneId))).toEqual(new Set(MEMORY_SCENE_ORDER));
  });

  it("scrubs only inside a transition (into its later scene), rests elsewhere", () => {
    for (const view of views) {
      const beat = MEMORY_BEATS_ON_SCROLL[view.beat];
      if (beat.kind === "transition") {
        expect(view.sceneId).toBe(beat.to);
        expect(view.scrub).not.toBeNull();
        expect(view.scrub as number).toBeGreaterThanOrEqual(0);
        expect(view.scrub as number).toBeLessThanOrEqual(1);
      } else {
        expect(view.scrub).toBeNull();
      }
    }
  });

  it("is continuous at every boundary: a transition ends on its last frame and hands over to the rest of the same scene", () => {
    views.forEach((view, i) => {
      const next = views[i + 1];
      if (!next || next.beat === view.beat) return;
      const from = MEMORY_BEATS_ON_SCROLL[view.beat];
      const to = MEMORY_BEATS_ON_SCROLL[next.beat];
      if (from.kind === "transition") {
        expect(view.scrub as number).toBeGreaterThan(0.99);
        expect(to.kind === "hold" && to.scene).toBe(from.to);
      }
      if (to.kind === "transition") expect(next.scrub as number).toBeLessThan(0.01);
    });
  });

  it("a rest is a rest: any two positions inside a hold give the same view, so React hears nothing", () => {
    const holds = views.filter((view) => MEMORY_BEATS_ON_SCROLL[view.beat].kind === "hold");
    for (const view of holds) expect(sameView(view, holds.find((other) => other.beat === view.beat) as typeof view)).toBe(true);
  });

  it("hands off from the Hero by letting Match 01 join the first retained decision, then never undoes it", () => {
    expect(views[0].handoff).toBe(0);
    const during = views.filter((view) => view.beat === 0).map((view) => view.handoff);
    expect(during.some((h) => h > 0 && h < 1)).toBe(true);
    expect(during).toEqual([...during].sort((a, b) => a - b));
    expect(views.filter((view) => view.beat > 0).every((view) => view.handoff === 1)).toBe(true);
  });
});

describe("Memory Strip on scroll: reduced motion", () => {
  const views = sweep(true);

  it("never scrubs a morph with the scroll: discrete states, in order, switching at the middle of each transition window", () => {
    expect(views.every((view) => view.scrub === null)).toBe(true);
    const ranks = views.map((view) => order(view.sceneId));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(views.map((view) => view.sceneId))).toEqual(new Set(MEMORY_SCENE_ORDER));
    views.forEach((view, i) => {
      const beat = MEMORY_BEATS_ON_SCROLL[view.beat];
      if (beat.kind !== "transition") return;
      expect(view.sceneId).toBe(beatAt(i / SAMPLES).local < 0.5 ? beat.from : beat.to);
    });
  });

  it("the handoff is a step, not a fade", () => {
    expect(views.every((view) => view.handoff === 0 || view.handoff === 1)).toBe(true);
    expect(views.some((view) => view.handoff === 0)).toBe(true);
  });
});

describe("Memory Strip on scroll: the Coach seam", () => {
  it("speaks the existing slot vocabulary, analyses while evidence changes, is unsure while it is thin, never anchors", () => {
    const cues = MEMORY_BEATS_ON_SCROLL.map((beat) => [beatName(beat), memoryCoachCue(beat)] as const);
    for (const [, cue] of cues) {
      expect(["watching", "analyzing", "pointing", "confirming", "uncertain"]).toContain(cue.state);
      expect(cue.anchor).toBeNull();
    }
    const by = Object.fromEntries(cues.map(([name, cue]) => [name, cue.state]));
    expect(by.handoff).toBe("watching");
    expect(by["hold:match-01"]).toBe("uncertain");
    expect(by["hold:match-08"]).toBe("uncertain");
    expect(by["hold:player-model"]).toBe("pointing");
    for (const t of MEMORY_TRANSITIONS) expect(by[`transition:${t.id}`]).toBe("analyzing");
  });
});

describe("Memory Strip on the real landing", () => {
  it("sits right after the Hero, outside it, as one pinned stage around the same Phase C player", () => {
    const screen = render(<LandingPage motionMode="reduced" />);
    const page = screen.getByTestId("landing-01b");
    const hero = page.querySelector('[data-section="hero"]') as HTMLElement;
    const memory = page.querySelector('[data-section="memory"]') as HTMLElement;
    expect(hero.nextElementSibling).toBe(memory);
    expect(hero.querySelector('[data-testid="hero-story"]')).not.toBeNull();
    expect(hero.querySelector('[data-testid="memory-strip"]')).toBeNull();
    expect(memory.querySelectorAll('[data-testid="memory-strip"]')).toHaveLength(1);
    expect(memory.querySelector('[data-testid="memory-strip"]')?.getAttribute("data-scene")).toBe("match-01");
    expect(memory.querySelector("h2")?.textContent).toBe("The call is made. D2KIRO keeps it.");
    const stage = memory.querySelector(".ld-memory-stage") as HTMLElement;
    expect(stage.getAttribute("data-beat")).toBe("handoff");
    expect(stage.querySelector('[data-coach-slot="memory"]')).not.toBeNull();
    const track = memory.querySelector(".ld-memory-track") as HTMLElement;
    expect(track.style.getPropertyValue("--ld-memory-screens")).toBe(String(MEMORY_SCROLL_SCREENS));
  });

  it("pins under the nav at the small viewport height, and the handoff never hides the retained decision", () => {
    expect(css).toMatch(/\.ld-memory-stage \{[^}]*position: sticky; top: 56px;/);
    expect(css).toMatch(/\.ld-memory-stage \{[^}]*height: calc\(100svh - 56px\)/);
    const handoff = css.split("\n").find((line) => line.includes('[data-handoff="pending"]')) as string;
    expect(handoff).toContain(':not([data-evidence="role:you"])');
    expect(handoff).toContain(':not([data-for="role:you"])');
    expect(handoff.includes(".ms-origin")).toBe(false);
  });
});
