import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStripScene } from "@/features/landing/memory-strip";
import { MEMORY_SCENES } from "@/features/landing/memory-strip/fake-scenario-memory";
import { smoothPath } from "@/features/landing/memory-strip/geometry";
import type { MemorySceneId } from "@/features/landing/memory-strip/types";
import * as stories from "./MemoryStrip.stories";

afterEach(cleanup);

const SCENE_IDS: MemorySceneId[] = ["match-01", "match-24", "player-model"];
const dir = join(import.meta.dir, "..", "..", "features", "landing", "memory-strip");
const css = readFileSync(join(dir, "memory-strip.css"), "utf8");
const ids = (id: MemorySceneId) => MEMORY_SCENES[id].items.map((item) => item.id);
const shot = (id: MemorySceneId) => render(<MemoryStripScene sceneId={id} />).getByTestId("memory-strip");
const labels = (root: HTMLElement) => [...root.querySelectorAll(".ms-label")];
const normalized = (html: string) => html.replace(/ms-(hatch|desc)-\w+/g, "ID");

describe("Memory Strip phase A: deterministic scenes", () => {
  it("renders the same markup twice for the same scene", () => {
    for (const id of SCENE_IDS) {
      const first = normalized(render(<MemoryStripScene sceneId={id} />).container.innerHTML);
      cleanup();
      const second = normalized(render(<MemoryStripScene sceneId={id} />).container.innerHTML);
      cleanup();
      expect(second).toBe(first);
    }
  });

  it("builds smooth path geometry deterministically and passes through every point", () => {
    const points = [[0, 0], [10, 5], [20, 0]] as const;
    expect(smoothPath(points)).toBe(smoothPath(points));
    expect(smoothPath(points)).toContain("10 5");
    expect(smoothPath(points).startsWith("M0 0")).toBe(true);
  });

  it("Match 01: sparse — one retained path, one uncertain path that visibly stops, at most two labels, no contradiction", () => {
    const root = shot("match-01");
    expect(root.getAttribute("data-scene")).toBe("match-01");
    expect(root.querySelectorAll('[data-relation="retained"]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-relation="uncertain"] .ms-terminal')).toHaveLength(1);
    expect(root.querySelectorAll(".ms-contradiction")).toHaveLength(0);
    expect(root.querySelectorAll(".ms-echo")).toHaveLength(0);
    expect(labels(root).length).toBeLessThanOrEqual(2);
    expect(root.querySelectorAll(".ms-region")).toHaveLength(1);
    expect(root.textContent).toContain("Puck stayed with you. That is a memory, not a model.");
    expect(root.textContent).toContain("You · Pos 2 Mid");
  });

  it("Match 24: before, contradiction and qualified after are all present, and the original reading is kept as an undertrace", () => {
    const root = shot("match-24");
    expect(root.querySelectorAll('[data-relation="retained"]')).toHaveLength(1);
    expect(root.querySelectorAll(".ms-contradiction")).toHaveLength(1);
    expect(root.querySelectorAll(".ms-matchup")).toHaveLength(1);
    expect(root.querySelectorAll('[data-relation="undertrace"]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-relation="qualified"]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-relation="qualified"] .ms-path-halo')).toHaveLength(1);
    expect(root.textContent).toContain("You return to this choice—until the matchup changes what it means.");
  });

  it("Match 24: the retained path ends at the contradiction, and the undertrace and the qualified path both leave from it", () => {
    const items = MEMORY_SCENES["match-24"].items;
    const marker = items.find((item) => item.kind === "contradiction");
    const qualified = items.find((item) => item.id === "path:qualified");
    const undertrace = items.find((item) => item.id === "path:undertrace");
    const main = items.find((item) => item.id === "path:main");
    if (marker?.kind !== "contradiction" || qualified?.kind !== "path" || undertrace?.kind !== "path" || main?.kind !== "path") throw new Error("fixture shape");
    expect(qualified.points[0]).toEqual(marker.at);
    expect(undertrace.points[0]).toEqual(marker.at);
    expect(main.points[main.points.length - 1]).toEqual(marker.at);
  });

  it("Player Model: reuses the whole evidence vocabulary, keeps one region open, and shows no score", () => {
    const root = shot("player-model");
    for (const selector of [".ms-origin", ".ms-node", ".ms-echo", ".ms-contradiction", ".ms-matchup", ".ms-region"]) {
      expect(root.querySelectorAll(selector).length).toBeGreaterThan(0);
    }
    for (const relation of ["retained", "uncertain", "undertrace", "qualified"]) {
      expect(root.querySelectorAll(`[data-relation="${relation}"]`).length).toBeGreaterThan(0);
    }
    expect(root.querySelectorAll('[data-relation="uncertain"] .ms-terminal').length).toBeGreaterThan(0);
    expect(root.textContent).toContain("A player model is not a verdict.");
    expect(root.textContent).not.toMatch(/score|%|rating/i);
  });

  it("keeps evidence identity stable across scenes so motion can transform instead of remount", () => {
    for (const id of ["origin", "path:main", "role:you", "region:open"]) {
      for (const scene of SCENE_IDS) expect(ids(scene)).toContain(id);
    }
    for (const id of ["marker:c1", "matchup:m1"]) {
      expect(ids("match-24")).toContain(id);
      expect(ids("player-model")).toContain(id);
    }
    for (const scene of SCENE_IDS) expect(new Set(ids(scene)).size).toBe(ids(scene).length);
    expect(shot("match-24").querySelectorAll('[data-evidence="origin"]')).toHaveLength(1);
  });

  it("is not wired to Puck: the hero is data on the scene, rendered through the canonical hero icon", () => {
    const root = shot("match-24");
    expect(MEMORY_SCENES["match-24"].hero.id).toBeGreaterThan(0);
    expect(root.querySelector(".ms-origin .chm-icon")).not.toBeNull();
  });

  it("describes every piece of evidence in words, so no state depends on colour or on the picture", () => {
    for (const id of SCENE_IDS) {
      const root = shot(id);
      const described = [...root.querySelectorAll("[data-evidence-text]")].map((node) => node.getAttribute("data-evidence-text"));
      expect(described).toEqual(ids(id));
      expect(root.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(root.querySelector(".ms-object")?.getAttribute("aria-describedby")).toBeTruthy();
      cleanup();
    }
  });

  it("marks only active evidence to keep its label on a narrow object, and hides the rest by container query", () => {
    const root = shot("match-24");
    const active = labels(root).filter((node) => node.getAttribute("data-active") === "true");
    expect(active.length).toBeGreaterThan(0);
    expect(active.length).toBeLessThan(labels(root).length);
    expect(css).toContain('.ms-label[data-active="false"] { display: none; }');
  });

  it("uses tokens only: no literal colour in the stylesheet", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});

describe("Memory Strip phase A: Storybook states", () => {
  it("exports the three desktop, three mobile and one review story", () => {
    expect(Object.keys(stories).filter((name) => name !== "default").sort()).toEqual(
      ["Match01", "Match01Mobile", "Match24", "Match24Mobile", "PlayerModel", "PlayerModelMobile", "Review"],
    );
    expect(stories.default.title).toBe("DS V1 / Landing 01B / Memory Strip");
  });

  it("each story renders its scene; mobile stories render the same scene in a 390px frame", () => {
    const cases = [
      [stories.Match01, "match-01", ""], [stories.Match24, "match-24", ""], [stories.PlayerModel, "player-model", ""],
      [stories.Match01Mobile, "match-01", "390px"], [stories.Match24Mobile, "match-24", "390px"], [stories.PlayerModelMobile, "player-model", "390px"],
    ] as const;
    for (const [Story, scene, width] of cases) {
      const { container } = render(<Story />);
      expect(container.querySelector(`[data-scene="${scene}"]`)).not.toBeNull();
      expect((container.firstElementChild as HTMLElement).style.width).toBe(width);
      cleanup();
    }
  });
});
