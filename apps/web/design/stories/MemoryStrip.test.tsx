import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_CONTINUITY, MEMORY_SCENE_ORDER, MEMORY_TRANSITIONS, MemoryStripScene } from "@/features/landing/memory-strip";
import { MEMORY_SCENES } from "@/features/landing/memory-strip/fake-scenario-memory";
import { smoothPath } from "@/features/landing/memory-strip/geometry";
import type { EvidenceItem, MemorySceneId } from "@/features/landing/memory-strip/types";
import * as stories from "./MemoryStrip.stories";

afterEach(cleanup);

const SCENE_IDS: MemorySceneId[] = ["match-01", "match-08", "match-24", "match-56", "player-model"];
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

describe("Memory Strip phase A+B: Storybook states", () => {
  it("exports five desktop, five mobile and one review story", () => {
    expect(Object.keys(stories).filter((name) => name !== "default").sort()).toEqual([
      "Match01", "Match01Mobile", "Match08", "Match08Mobile", "Match24", "Match24Mobile",
      "Match56", "Match56Mobile", "PlayerModel", "PlayerModelMobile", "Review",
    ]);
    expect(stories.default.title).toBe("DS V1 / Landing 01B / Memory Strip");
    expect(stories.default.argTypes.sceneId.options).toEqual(SCENE_IDS);
  });

  it("each story renders its scene; mobile stories render the same scene in a 390px frame", () => {
    const cases = [
      [stories.Match01, "match-01", ""], [stories.Match08, "match-08", ""], [stories.Match24, "match-24", ""],
      [stories.Match56, "match-56", ""], [stories.PlayerModel, "player-model", ""],
      [stories.Match01Mobile, "match-01", "390px"], [stories.Match08Mobile, "match-08", "390px"], [stories.Match24Mobile, "match-24", "390px"],
      [stories.Match56Mobile, "match-56", "390px"], [stories.PlayerModelMobile, "player-model", "390px"],
    ] as const;
    for (const [Story, scene, width] of cases) {
      const { container } = render(<Story />);
      expect(container.querySelector(`[data-scene="${scene}"]`)).not.toBeNull();
      expect((container.firstElementChild as HTMLElement).style.width).toBe(width);
      cleanup();
    }
  });

  it("the Review story renders every one of the five scenes", () => {
    for (const scene of SCENE_IDS) {
      const { container } = render(<stories.Review sceneId={scene} />);
      expect(container.querySelector(`[data-scene="${scene}"]`)).not.toBeNull();
      cleanup();
    }
  });
});

const items = (id: MemorySceneId) => MEMORY_SCENES[id].items;
const byId = (scene: MemorySceneId, id: string) => items(scene).find((item) => item.id === id);
const relations = (scene: MemorySceneId, relation: string) => items(scene).filter((item) => item.kind === "path" && item.relation === relation);
const IDENTITY_ONLY = new Set(["meaning", "label", "active"]);
const geometry = (scene: MemorySceneId, id: string) => Object.fromEntries(Object.entries(byId(scene, id) as unknown as Record<string, unknown>).filter(([key]) => !IDENTITY_ONLY.has(key)));
const heroOf = (scene: MemorySceneId, id: string) => (byId(scene, id) as { heroId: number }).heroId;

describe("Memory Strip phase B: Match 08", () => {
  it("shows a start of recurrence: the Match 01 path reinforced, about three recurring nodes, up to two echoes", () => {
    const root = shot("match-08");
    expect(root.querySelectorAll(".ms-node")).toHaveLength(3);
    expect(root.querySelectorAll(".ms-echo").length).toBeGreaterThanOrEqual(1);
    expect(root.querySelectorAll(".ms-echo").length).toBeLessThanOrEqual(2);
    expect(relations("match-08", "retained").map((p) => p.id)).toEqual(["path:main", "path:reuse"]);
    expect(geometry("match-08", "path:main")).toEqual(geometry("match-01", "path:main"));
    expect(byId("match-08", "node:m1")).toMatchObject({ at: (byId("match-01", "node:m1") as { at: unknown }).at });
    expect(root.querySelectorAll(".ms-contradiction")).toHaveLength(0);
  });

  it("keeps one weaker recurrence and one unresolved possible pattern that visibly stops", () => {
    const root = shot("match-08");
    expect(root.querySelector('[data-evidence="path:weak"]')?.getAttribute("data-relation")).toBe("uncertain");
    expect(root.querySelector('[data-evidence="path:weak"] .ms-terminal')).toBeNull();
    expect(root.querySelectorAll('[data-relation="uncertain"] .ms-terminal')).toHaveLength(1);
    expect(root.querySelectorAll(".ms-region")).toHaveLength(1);
  });

  it("claims nothing: no counts, progress, scores or completion wording", () => {
    const root = shot("match-08");
    expect(root.textContent).toContain("Something is starting to repeat.");
    expect(root.textContent).not.toMatch(/analy[sz]ed|progress|complete|score|rating|%|\d+\s+matches/i);
    expect(root.querySelector("progress, [role='progressbar']")).toBeNull();
  });
});

describe("Memory Strip phase B: Match 56", () => {
  it("carries the four evidence groups: affinity, role, matchup response, situational exception", () => {
    const root = shot("match-56");
    for (const id of ["path:affinity", "path:role", "matchup:m1", "path:exception"]) {
      expect(root.querySelector(`[data-evidence="${id}"]`)).not.toBeNull();
    }
    expect(root.querySelectorAll(".ms-echo").length).toBeGreaterThanOrEqual(4);
  });

  it("keeps the Match 24 contradiction history and the qualified route, unchanged", () => {
    const root = shot("match-56");
    for (const id of ["marker:c1", "matchup:m1", "path:undertrace", "path:qualified", "echo:viper", "echo:b"]) {
      expect(root.querySelector(`[data-evidence="${id}"]`)).not.toBeNull();
    }
    expect(root.querySelectorAll('[data-relation="qualified"] .ms-path-halo')).toHaveLength(1);
    for (const id of ["marker:c1", "matchup:m1", "path:undertrace", "path:qualified", "path:main", "origin"]) {
      expect(geometry("match-56", id)).toEqual(geometry("match-24", id));
    }
  });

  it("keeps unresolved evidence and negative space: an open region, a path that stops, few paths and few labels", () => {
    const root = shot("match-56");
    expect(root.querySelectorAll(".ms-region")).toHaveLength(1);
    expect(root.querySelectorAll('[data-relation="uncertain"] .ms-terminal')).toHaveLength(1);
    expect(root.querySelectorAll(".ms-path").length).toBeLessThanOrEqual(8);
    expect(labels(root).length).toBeLessThanOrEqual(6);
    expect(labels(root).filter((node) => node.getAttribute("data-active") === "true").length).toBeLessThanOrEqual(2);
  });

  it("is not a model, a network or a dashboard: no score, no mesh of links", () => {
    const root = shot("match-56");
    expect(root.textContent).not.toMatch(/score|%|rating/i);
    expect(root.textContent).toContain("not enough to call it a model");
    expect(relations("match-56", "retained").length).toBeLessThanOrEqual(4);
  });
});

describe("Memory Strip phase B: five-state data model and continuity", () => {
  it("has exactly the five canonical scenes, in order", () => {
    expect(MEMORY_SCENE_ORDER).toEqual(SCENE_IDS);
    expect(Object.keys(MEMORY_SCENES).sort()).toEqual([...SCENE_IDS].sort());
    for (const id of SCENE_IDS) expect(MEMORY_SCENES[id].id).toBe(id);
  });

  it("keeps persistent ids stable: one id names one concept across every scene it appears in", () => {
    for (const id of ["origin", "path:main", "role:you", "region:open"]) {
      for (const scene of SCENE_IDS) expect(ids(scene)).toContain(id);
    }
    for (const id of ["marker:c1", "matchup:m1", "path:qualified", "path:undertrace"]) {
      for (const scene of ["match-24", "match-56", "player-model"] as const) expect(ids(scene)).toContain(id);
    }
    for (const id of ["echo:storm", "echo:void", "echo:qop"]) expect(heroOf("match-56", id)).toBe(heroOf("player-model", id));
    expect(heroOf("match-08", "echo:a")).toBe(heroOf("match-24", "echo:a"));
    expect(heroOf("match-08", "echo:storm")).toBe(heroOf("match-56", "echo:storm"));
    expect(heroOf("match-24", "echo:b")).toBe(heroOf("player-model", "echo:b"));
  });

  it("never reuses one id for two different kinds of evidence", () => {
    const kindOf = new Map<string, EvidenceItem["kind"]>();
    for (const scene of SCENE_IDS) {
      for (const item of items(scene)) {
        const known = kindOf.get(item.id);
        if (known) expect(item.kind).toBe(known);
        kindOf.set(item.id, item.kind);
      }
    }
  });

  it("describes every transition: each id of either scene has exactly one continuity entry, consistent with where it exists", () => {
    expect(MEMORY_TRANSITIONS.map((t) => t.id as string)).toEqual(Object.keys(MEMORY_CONTINUITY));
    for (const { id, from, to } of MEMORY_TRANSITIONS) {
      const entries = MEMORY_CONTINUITY[id];
      const inFrom = new Set(ids(from)), inTo = new Set(ids(to));
      expect(entries.map((e) => e.id).sort()).toEqual([...new Set([...inFrom, ...inTo])].sort());
      for (const entry of entries) {
        if (["stays", "strengthens", "weakens", "qualifies", "moves"].includes(entry.verb)) {
          expect(inFrom.has(entry.id) && inTo.has(entry.id)).toBe(true);
        }
        if (entry.verb === "enters" || entry.verb === "attaches") expect(!inFrom.has(entry.id) && inTo.has(entry.id)).toBe(true);
        if (entry.verb === "exits") expect(inFrom.has(entry.id) && !inTo.has(entry.id)).toBe(true);
        if (entry.verb === "expands") {
          expect(!inFrom.has(entry.id) && inTo.has(entry.id)).toBe(true);
          expect(entry.from !== undefined && inFrom.has(entry.from) && inTo.has(entry.from)).toBe(true);
        }
        if (entry.verb === "compresses") {
          expect(inFrom.has(entry.id)).toBe(true);
          expect(entry.into === undefined ? inTo.has(entry.id) : inTo.has(entry.into)).toBe(true);
        }
      }
    }
  });

  it("never lets evidence vanish and reappear: absent in N, present in N-1 and N+1 ⇒ folds into X, then expands from that same X", () => {
    const sceneIds = MEMORY_SCENE_ORDER.map((s) => new Set(ids(s)));
    let checked = 0;
    for (let n = 1; n < MEMORY_SCENE_ORDER.length - 1; n++) {
      const before = MEMORY_TRANSITIONS[n - 1].id, after = MEMORY_TRANSITIONS[n].id;
      for (const id of sceneIds[n - 1]) {
        if (sceneIds[n].has(id) || !sceneIds[n + 1].has(id)) continue;
        const fold = MEMORY_CONTINUITY[before].find((e) => e.id === id);
        const unfold = MEMORY_CONTINUITY[after].find((e) => e.id === id);
        expect(fold?.verb).toBe("compresses");
        expect(fold?.into).toBeDefined();
        expect(unfold?.verb).toBe("expands");
        expect(unfold?.from).toBe(fold?.into);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("lets historical evidence leave only by being folded into something that remains", () => {
    for (const { id } of MEMORY_TRANSITIONS) {
      expect(MEMORY_CONTINUITY[id].filter((e) => e.verb === "exits")).toHaveLength(0);
    }
  });

  it("carries the Match 24 contradiction into Match 56 and the Player Model", () => {
    for (const scene of ["match-24", "match-56", "player-model"] as const) {
      expect(byId(scene, "marker:c1")?.kind).toBe("contradiction");
      expect(byId(scene, "matchup:m1")?.kind).toBe("matchup");
      expect(byId(scene, "path:undertrace")).toBeDefined();
    }
    const verb = (t: (typeof MEMORY_TRANSITIONS)[number]["id"], id: string) => MEMORY_CONTINUITY[t].find((e) => e.id === id)?.verb;
    expect(verb("match-24>match-56", "marker:c1")).toBe("stays");
    expect(verb("match-56>player-model", "marker:c1")).toBe("moves");
  });

  it("carries unresolved evidence into every scene: the open region survives and never exits", () => {
    for (const scene of SCENE_IDS) expect(byId(scene, "region:open")?.kind).toBe("region");
    for (const { id } of MEMORY_TRANSITIONS) {
      expect(MEMORY_CONTINUITY[id].find((e) => e.id === "region:open")?.verb).not.toBe("exits");
    }
    for (const scene of ["match-01", "match-08", "match-56", "player-model"] as const) {
      expect(relations(scene, "uncertain").length).toBeGreaterThan(0);
    }
  });

  it("limits mobile labels: only active evidence keeps one on a narrow object, in the new scenes too", () => {
    for (const scene of ["match-08", "match-56"] as const) {
      const root = shot(scene);
      const active = labels(root).filter((node) => node.getAttribute("data-active") === "true");
      expect(active.length).toBeGreaterThan(0);
      expect(active.length).toBeLessThanOrEqual(2);
      cleanup();
    }
  });
});
