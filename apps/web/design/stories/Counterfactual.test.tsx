import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LandingPage, type CoachCharacterProps } from "@/features/landing";
import { FORBIDDEN_CLAIMS } from "@/features/landing/copy";
import {
  COUNTERFACTUAL_FIXTURE, COUNTERFACTUAL_SCROLL_SCREENS, COUNTERFACTUAL_STAGES, CounterfactualObject, STAGE_SCREENS, candidateSlots, counterfactualCoachCue, counterfactualView,
  factTone, modeOfStage, personalReasons, rankHeroes, scoreOf, sameView, stageAt, tagsFor, winnerOf,
  type CandidateFixture, type CounterfactualFixture, type CounterfactualStage, type CounterfactualView,
} from "@/features/landing/counterfactual";
import { MEMORY_SCROLL_SCREENS } from "@/features/landing/memory-scroll";

afterEach(cleanup);

const css = readFileSync(join(import.meta.dir, "..", "..", "features", "landing", "counterfactual", "counterfactual.css"), "utf8");
const SAMPLES = 4000;
const sweep = (reduced: boolean) => Array.from({ length: SAMPLES + 1 }, (_, i) => counterfactualView(i / SAMPLES, reduced));
const rankOf = (stage: CounterfactualStage) => COUNTERFACTUAL_STAGES.indexOf(stage);
const held = (stage: CounterfactualStage): CounterfactualView => ({
  stage, context: rankOf(stage) >= 1 ? 1 : 0, reinterpret: rankOf(stage) >= 2 ? 1 : 0, reorder: rankOf(stage) >= 3 ? 1 : 0,
});
const NAMES = COUNTERFACTUAL_FIXTURE.candidates.map((candidate) => candidate.hero.name);
const [GENERIC_WINNER, PERSONAL_WINNER] = [winnerOf(COUNTERFACTUAL_FIXTURE, "generic"), winnerOf(COUNTERFACTUAL_FIXTURE, "personal")];
const candidate = (name: string) => COUNTERFACTUAL_FIXTURE.candidates.find((c) => c.hero.name === name) as CandidateFixture;
const stripPersonal = (fixture: CounterfactualFixture): CounterfactualFixture => ({
  ...fixture,
  candidates: fixture.candidates.map((entry) => ({ hero: entry.hero, generic: entry.generic, history: { ...entry.history, level: 0, evidence: "missing" as const } })),
});

function renderObject(stage: CounterfactualStage, reducedMotion = false) {
  const screen = render(<CounterfactualObject reducedMotion={reducedMotion} view={held(stage)} />);
  return screen.container;
}
const order = (root: HTMLElement) => [...root.querySelectorAll(".cf-row")].map((row) => row.getAttribute("data-hero"));

describe("Counterfactual: the ranking is derived, and the change has a cause", () => {
  it("reads the same candidates two ways and reaches a different winner on purpose", () => {
    const generic = rankHeroes(COUNTERFACTUAL_FIXTURE, "generic");
    const personal = rankHeroes(COUNTERFACTUAL_FIXTURE, "personal");
    expect([...generic].sort()).toEqual([...personal].sort());
    expect(generic).not.toEqual(personal);
    expect(GENERIC_WINNER).not.toBe(PERSONAL_WINNER);
    expect(generic).toEqual(["Outworld Destroyer", "Puck", "Ember Spirit"]);
    expect(personal).toEqual(["Puck", "Outworld Destroyer", "Ember Spirit"]);
  });

  it("is a credible generic answer, not a straw man: the generic winner is strong on both of its generic readings", () => {
    const winner = candidate(GENERIC_WINNER);
    expect(winner.generic.meta.level).toBeGreaterThanOrEqual(3);
    expect(winner.generic.lane.level).toBeGreaterThanOrEqual(3);
    /* …and the personal winner was already a close second there, so the move is a re-reading, not a rescue. */
    expect(rankHeroes(COUNTERFACTUAL_FIXTURE, "generic").indexOf(PERSONAL_WINNER)).toBe(1);
  });

  it("never ties, so an order can never change by accident of sorting", () => {
    for (const mode of ["generic", "personal"] as const) {
      const scores = COUNTERFACTUAL_FIXTURE.candidates.map((c) => scoreOf(c, mode));
      expect(new Set(scores).size).toBe(scores.length);
    }
  });

  it("explains the new winner with explicit personal evidence, and gives the others none", () => {
    expect(personalReasons(COUNTERFACTUAL_FIXTURE, PERSONAL_WINNER).length).toBeGreaterThanOrEqual(2);
    expect(candidate(PERSONAL_WINNER).history.evidence).toBe("present");
    expect(candidate(PERSONAL_WINNER).laneThroughYou).toBeDefined();
    for (const name of NAMES.filter((n) => n !== PERSONAL_WINNER)) expect(personalReasons(COUNTERFACTUAL_FIXTURE, name)).toEqual([]);
  });

  it("is the personal evidence that moves it: with that evidence taken away, the order does not change", () => {
    const bare = stripPersonal(COUNTERFACTUAL_FIXTURE);
    expect(rankHeroes(bare, "personal")).toEqual(rankHeroes(bare, "generic"));
    expect(winnerOf(bare, "personal")).toBe(GENERIC_WINNER);
  });

  it("moves exactly one candidate up, the one it passes down, and leaves the rest where they were", () => {
    const slots = candidateSlots(COUNTERFACTUAL_FIXTURE);
    const by = (hero: string) => slots.find((slot) => slot.hero === hero);
    expect(by(PERSONAL_WINNER)).toMatchObject({ from: 1, to: 0, role: "rises" });
    expect(by(GENERIC_WINNER)).toMatchObject({ from: 0, to: 1, role: "falls" });
    expect(by("Ember Spirit")).toMatchObject({ from: 2, to: 2, role: "holds" });
  });

  it("stays qualitative: no number, percentage or win rate is ever rendered", () => {
    for (const stage of COUNTERFACTUAL_STAGES) {
      const text = (renderObject(stage).textContent ?? "").replaceAll("D2KIRO", "");
      expect(/\d+(\.\d+)?\s*%/.test(text)).toBe(false);
      expect(/win ?rate|probab|confidence|\bpts\b|\bmmr\b/i.test(text)).toBe(false);
      /* The only digits on the object are the seats (Pos 2) and the three rank numerals. */
      expect((text.match(/\d+/g) ?? []).join(",")).toBe(["2", "1", "2", "3"].join(","));
      cleanup();
    }
  });

  it("says nothing the landing forbids", () => {
    const text = COUNTERFACTUAL_STAGES.map((stage) => { const t = renderObject(stage).textContent ?? ""; cleanup(); return t; }).join(" ");
    for (const claim of FORBIDDEN_CLAIMS) expect(claim.test(text)).toBe(false);
  });
});

describe("Counterfactual: evidence semantics", () => {
  const tones = (name: string, stage: CounterfactualStage) => tagsFor(candidate(name), stage).map((tag) => `${tag.id}:${tag.tone}${tag.dashed ? ":dashed" : ""}`);

  it("the generic reading is neutral everywhere, and the model has not entered", () => {
    for (const name of NAMES) {
      expect(tones(name, "generic")).toEqual(["meta:neutral", "lane:neutral"]);
    }
  });

  it("the model enters as history: solid cyan where there is evidence, dashed neutral where there is none (never a negative)", () => {
    expect(tones(PERSONAL_WINNER, "context")).toEqual(["meta:neutral", "lane:neutral", "history:cyan"]);
    for (const name of NAMES.filter((n) => n !== PERSONAL_WINNER)) expect(tones(name, "context")).toEqual(["meta:neutral", "lane:neutral", "history:neutral:dashed"]);
  });

  it("the lane is challenged (pink) and then qualified (lime), and only where the player's games speak to it", () => {
    expect(tones(PERSONAL_WINNER, "reinterpret")[1]).toBe("lane:pink");
    expect(tones(PERSONAL_WINNER, "reorder")[1]).toBe("lane:lime");
    expect(tones(PERSONAL_WINNER, "personal")[1]).toBe("lane:lime");
    for (const name of NAMES.filter((n) => n !== PERSONAL_WINNER)) {
      for (const stage of COUNTERFACTUAL_STAGES) expect(tones(name, stage)[1]).toBe("lane:neutral");
    }
  });

  it("the model's two facts light in order: history on arrival, the matchup pink while it challenges, lime once it holds", () => {
    expect(COUNTERFACTUAL_STAGES.map((stage) => factTone("history", stage))).toEqual(["neutral", "cyan", "cyan", "cyan", "cyan"]);
    expect(COUNTERFACTUAL_STAGES.map((stage) => factTone("matchup", stage))).toEqual(["neutral", "neutral", "pink", "lime", "lime"]);
  });

  it("shows the generic order until the ranking moves, and the personal order from then on", () => {
    expect(COUNTERFACTUAL_STAGES.map(modeOfStage)).toEqual(["generic", "generic", "generic", "personal", "personal"]);
  });
});

describe("Counterfactual: the one object", () => {
  it("keeps the same draft and the same three rows through every stage; only their reading changes", () => {
    const drafts = new Set<string>();
    const rosters = new Set<string>();
    for (const stage of COUNTERFACTUAL_STAGES) {
      const root = renderObject(stage);
      drafts.add(root.querySelector(".cf-draft")?.getAttribute("data-draft-id") ?? "");
      rosters.add([...root.querySelectorAll(".cf-roster [role=img]")].map((n) => n.getAttribute("aria-label")).join("|"));
      expect([...order(root)].sort()).toEqual([...NAMES].sort());
      expect(root.querySelectorAll(".cf-object")).toHaveLength(1);
      cleanup();
    }
    expect(drafts).toEqual(new Set([COUNTERFACTUAL_FIXTURE.draft.id]));
    expect(rosters.size).toBe(1);
  });

  it("puts the rows in reading order: the DOM follows the order the stage shows", () => {
    expect(order(renderObject("generic"))).toEqual(["Outworld Destroyer", "Puck", "Ember Spirit"]);
    cleanup();
    expect(order(renderObject("personal"))).toEqual(["Puck", "Outworld Destroyer", "Ember Spirit"]);
  });

  it("gives every row its two slots as data, so the move is a transform between them", () => {
    const root = renderObject("reorder");
    const row = (name: string) => root.querySelector(`.cf-row[data-hero="${name}"]`) as HTMLElement;
    expect([row("Puck").style.getPropertyValue("--cf-from"), row("Puck").style.getPropertyValue("--cf-to")]).toEqual(["1", "0"]);
    expect(row("Puck").getAttribute("data-role")).toBe("rises");
    expect(row("Outworld Destroyer").getAttribute("data-role")).toBe("falls");
    expect(row("Ember Spirit").getAttribute("data-role")).toBe("holds");
  });

  it("settles on a final winner that holds the decision position and says why", () => {
    const root = renderObject("personal");
    expect(root.querySelector(".cf")?.getAttribute("data-stage")).toBe("personal");
    expect(root.querySelector(".cf-mode")?.getAttribute("data-mode")).toBe("personal");
    expect(root.querySelector(".cf-rank")?.getAttribute("aria-label")).toContain(`${PERSONAL_WINNER} leads because of`);
    const winner = root.querySelector(".cf-row") as HTMLElement;
    expect(winner.getAttribute("data-hero")).toBe(PERSONAL_WINNER);
    expect(winner.textContent).toContain("Lane · qualified");
    expect(winner.textContent).toContain("History · yours");
    expect(root.querySelector(".cf-frame")).not.toBeNull();
  });

  it("states what the model is and whether generic meta reads it", () => {
    expect(renderObject("generic").querySelector(".cf-model")?.getAttribute("data-state")).toBe("idle");
    expect(renderObject("generic").textContent).toContain("Not read by generic meta.");
    cleanup();
    expect(renderObject("context").querySelector(".cf-model")?.getAttribute("data-state")).toBe("active");
  });

  it("uses the Player Model's own contour, not a drawing of its own", () => {
    const root = renderObject("context");
    expect(root.querySelectorAll(".cf-contour-path").length).toBeGreaterThanOrEqual(5);
    expect(root.querySelector(".cf-contour")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Counterfactual: the scroll mapping", () => {
  const views = sweep(false);

  it("runs generic → context → reinterpret → reorder → personal, never backwards, and visits every stage", () => {
    expect(COUNTERFACTUAL_STAGES).toEqual(["generic", "context", "reinterpret", "reorder", "personal"]);
    const ranks = views.map((view) => rankOf(view.stage));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(views.map((view) => view.stage))).toEqual(new Set(COUNTERFACTUAL_STAGES));
  });

  it("is a short pin: materially shorter than the Memory Strip, with real room on every stage and the most on the reorder", () => {
    const total = COUNTERFACTUAL_STAGES.reduce((sum, stage) => sum + STAGE_SCREENS[stage], 0);
    expect(COUNTERFACTUAL_SCROLL_SCREENS).toBeCloseTo(total, 2);
    expect(COUNTERFACTUAL_SCROLL_SCREENS).toBeLessThan(MEMORY_SCROLL_SCREENS / 2);
    expect(COUNTERFACTUAL_SCROLL_SCREENS).toBeGreaterThan(1.5);
    for (const stage of COUNTERFACTUAL_STAGES) expect(STAGE_SCREENS[stage]).toBeGreaterThanOrEqual(0.3);
    for (const stage of COUNTERFACTUAL_STAGES.filter((s) => s !== "reorder")) expect(STAGE_SCREENS.reorder).toBeGreaterThan(STAGE_SCREENS[stage]);
  });

  it("clamps outside the pin: before it is the generic reading at rest, after it is the personal one", () => {
    expect(stageAt(-0.4)).toEqual({ stage: "generic", local: 0 });
    expect(stageAt(Number.NaN)).toEqual({ stage: "generic", local: 0 });
    expect(stageAt(1)).toEqual({ stage: "personal", local: 1 });
    expect(counterfactualView(-1, false)).toEqual({ stage: "generic", context: 0, reinterpret: 0, reorder: 0 });
    expect(counterfactualView(3, false)).toEqual({ stage: "personal", context: 1, reinterpret: 1, reorder: 1 });
  });

  it("only ever scrubs the transformation it is inside, and every number stays in 0–1 and never reverses", () => {
    for (const key of ["context", "reinterpret", "reorder"] as const) {
      const values = views.map((view) => view[key]);
      expect(Math.min(...values)).toBe(0);
      expect(Math.max(...values)).toBe(1);
      expect(values).toEqual([...values].sort((a, b) => a - b));
    }
    for (const view of views) {
      if (view.stage === "generic") expect(view).toMatchObject({ context: 0, reinterpret: 0, reorder: 0 });
      if (view.stage === "personal") expect(view).toMatchObject({ context: 1, reinterpret: 1, reorder: 1 });
      if (view.stage === "context") expect(view.reinterpret + view.reorder).toBe(0);
      if (view.stage === "reinterpret") expect([view.context, view.reorder]).toEqual([1, 0]);
      if (view.stage === "reorder") expect([view.context, view.reinterpret]).toEqual([1, 1]);
    }
  });

  it("is continuous at every boundary: one stage ends on the value the next one starts from", () => {
    views.forEach((view, i) => {
      const next = views[i + 1];
      if (!next) return;
      for (const key of ["context", "reinterpret", "reorder"] as const) expect(Math.abs(next[key] - view[key])).toBeLessThan(0.05);
    });
  });

  it("a rest is a rest: two positions inside the first stage give the same view, so React hears nothing", () => {
    expect(sameView(counterfactualView(0.01, false), counterfactualView(0.02, false))).toBe(true);
    expect(sameView(counterfactualView(0.35, false), counterfactualView(0.36, false))).toBe(false);
  });

  it("reduced motion never scrubs: every number is 0 or 1, the stages are discrete and in the same order", () => {
    const reduced = sweep(true);
    for (const view of reduced) for (const key of ["context", "reinterpret", "reorder"] as const) expect([0, 1]).toContain(view[key]);
    expect(new Set(reduced.map((view) => view.stage))).toEqual(new Set(COUNTERFACTUAL_STAGES));
    const ranks = reduced.map((view) => rankOf(view.stage));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    /* Each stage is one fixed picture: the order has changed by the reorder stage and stays changed. */
    const at = (stage: CounterfactualStage) => reduced.find((view) => view.stage === stage) as CounterfactualView;
    expect(at("reorder").reorder).toBe(1);
    expect(at("reinterpret").reorder).toBe(0);
  });
});

describe("Counterfactual: reduced motion keeps the story", () => {
  it("tells the same reasons in the same order, with the changed evidence on screen at each stage", () => {
    const seen = COUNTERFACTUAL_STAGES.map((stage) => {
      const root = renderObject(stage, true);
      const text = root.querySelector(".cf-copy-line")?.textContent ?? "";
      const winner = (root.querySelector(".cf-row") as HTMLElement).textContent ?? "";
      const reduced = root.querySelector(".cf")?.getAttribute("data-motion");
      cleanup();
      return { text, winner, reduced };
    });
    expect(new Set(seen.map((s) => s.text)).size).toBe(COUNTERFACTUAL_STAGES.length);
    expect(seen.every((s) => s.reduced === "reduced")).toBe(true);
    expect(seen[1].winner).toContain("Outworld Destroyer");
    expect(seen[3].winner).toContain("Puck");
    expect(seen[3].winner).toContain("Lane · qualified");
    expect(seen[4].winner).toContain("History · yours");
  });

  it("substitutes, never just removes: no travel, but a short fade still marks each change", () => {
    const reduced = css.slice(css.indexOf('.cf[data-motion="reduced"] .cf-row'));
    expect(reduced).toContain("animation: cf-fade");
    expect(/@media \(prefers-reduced-motion: reduce\)/.test(css)).toBe(true);
    /* The row has no interpolation left: its slot is its final one. */
    expect(/\[data-motion="reduced"\] \.cf-row \{[^}]*transition: none/.test(css)).toBe(true);
  });
});

describe("Counterfactual: the stylesheet obeys the landing contract", () => {
  it("keeps to tokens: no colour literal, no raw duration, nothing loops, only cf- / ld- properties declared", () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(css)).toBe(false);
    expect(css.includes("infinite")).toBe(false);
    expect(/(transition|animation):[^;{]*\s[1-9]\d*(\.\d+)?m?s\b/.test(css)).toBe(false);
    expect(/(^|[{;]\s*)--(?!cf-|ld-)[a-z][a-z-]*\s*:/m.test(css)).toBe(false);
  });

  it("composes for the phone first-class: a narrow tier with its own row height, and the copy never hides the stage on short screens", () => {
    expect(css).toContain("@container (max-width: 520px)");
    expect(/@container \(max-width: 520px\) \{[^}]*--cf-row: 84px/.test(css)).toBe(true);
    expect(css).toContain("@media (max-height: 760px) and (max-width: 719px)");
  });

  it("pins short, under the nav, to the small viewport — and nothing in the object escapes it", () => {
    expect(css).toContain(".ld-cf-stage { height: calc(100svh - 56px); overflow: clip; position: sticky; top: 56px; }");
    expect(css).toContain("--ld-cf-screens");
  });
});

describe("Counterfactual: the Coach seam", () => {
  it("speaks the existing slot vocabulary: watches the generic reading, analyses while it is re-read, points at the call", () => {
    expect(COUNTERFACTUAL_STAGES.map((stage) => counterfactualCoachCue(stage).state)).toEqual(["watching", "analyzing", "analyzing", "analyzing", "pointing"]);
  });
});

describe("Counterfactual on the real landing", () => {
  it("sits right after the Memory Strip and right before the proposition, as one short pinned stage", () => {
    const { container } = render(<LandingPage motionMode="reduced" />);
    const ids = [...container.querySelectorAll("[data-section]")].map((node) => node.getAttribute("data-section"));
    expect(ids.slice(ids.indexOf("memory"), ids.indexOf("memory") + 3)).toEqual(["memory", "counterfactual", "proposition"]);
    const section = container.querySelector('[data-section="counterfactual"]') as HTMLElement;
    expect(section.querySelectorAll("h2")).toHaveLength(1);
    expect(section.querySelector(".ld-cf-stage .cf")).not.toBeNull();
    expect((section.querySelector(".ld-cf-track") as HTMLElement).style.getPropertyValue("--ld-cf-screens")).toBe(String(COUNTERFACTUAL_SCROLL_SCREENS));
    expect(section.getAttribute("aria-labelledby")).toBe("counterfactual-title");
  });

  it("opens on the generic reading and hands the Coach slot its own placement and cue", () => {
    const seen: CoachCharacterProps[] = [];
    function Probe(props: CoachCharacterProps) { seen.push(props); return <i data-probe={props.placement} />; }
    const { container } = render(<LandingPage coach={Probe} motionMode="reduced" />);
    expect(container.querySelector('[data-section="counterfactual"] .cf')?.getAttribute("data-stage")).toBe("generic");
    const slot = container.querySelector('[data-coach-slot="counterfactual"]');
    expect(slot?.getAttribute("data-cue")).toBe("watching");
    expect(seen.some((props) => props.placement === "counterfactual" && props.cue === "watching")).toBe(true);
  });

  it("is the same draft the whole page keeps: the object's draft id is stable across a re-render", () => {
    const first = render(<LandingPage motionMode="reduced" />).container.querySelector(".cf-draft")?.getAttribute("data-draft-id");
    cleanup();
    const second = render(<LandingPage motionMode="reduced" />).container.querySelector(".cf-draft")?.getAttribute("data-draft-id");
    expect(first).toBe(COUNTERFACTUAL_FIXTURE.draft.id);
    expect(second).toBe(first);
  });
});
