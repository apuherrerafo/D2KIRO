import "@/test-support/happy-dom";

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_CONTINUITY, MEMORY_SCENE_ORDER, MEMORY_TRANSITIONS, MemoryStripMotion } from "@/features/landing/memory-strip";
import { MEMORY_SCENES } from "@/features/landing/memory-strip/fake-scenario-memory";
import {
  MEMORY_BEATS, MEMORY_MOTION, MOBILE_WINDOW, PRIMARY_EVENT, annotationState, buildPlan, frameAt, ghostItems, steadyLabelIds,
} from "@/features/landing/memory-strip/motion";
import { SAMPLE_N, nearestOn, revealPts, sampleClosed, sampleOpen } from "@/features/landing/memory-strip/path-sample";
import type { MemorySceneId } from "@/features/landing/memory-strip/types";
import * as stories from "./MemoryStripMotion.stories";

afterEach(cleanup);

const css = readFileSync(join(import.meta.dir, "..", "..", "features", "landing", "memory-strip", "memory-strip.css"), "utf8");
const ids = (id: MemorySceneId) => MEMORY_SCENES[id].items.map((item) => item.id);
const track = (transition: (typeof MEMORY_TRANSITIONS)[number]["id"], id: string) => {
  const found = buildPlan(transition).tracks.find((t) => t.id === id);
  if (!found) throw new Error(`no track ${id}`);
  return found;
};
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("path sampling (local, deterministic)", () => {
  it("resamples paths of different point counts to the same N points, starting and ending on the curve", () => {
    const a = sampleOpen([[0, 0], [10, 0], [20, 0]]);
    const b = sampleOpen([[0, 0], [5, 5], [10, 0], [15, -5], [20, 0]]);
    expect(a).toHaveLength(SAMPLE_N);
    expect(b).toHaveLength(SAMPLE_N);
    expect(a[0]).toEqual([0, 0]);
    expect(dist(a[SAMPLE_N - 1], [20, 0])).toBeLessThan(0.01);
    expect(sampleOpen([[0, 0], [10, 5], [20, 0]])).toEqual(sampleOpen([[0, 0], [10, 5], [20, 0]]));
  });

  it("spaces samples by arc length, so a path drawn from its start reveals at constant speed", () => {
    const line = sampleOpen([[0, 0], [100, 0]]);
    const gaps = line.slice(1).map((p, i) => dist(p, line[i]));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01);
    const half = revealPts(line, 0.5);
    expect(dist(half[half.length - 1], [50, 0])).toBeLessThan(0.5);
  });

  it("gives two closed regions the same winding and start so they morph without twisting", () => {
    const ring = [[0, 0], [10, 0], [10, 10], [0, 10]] as const;
    const reversed = [...ring].reverse();
    sampleClosed(ring).forEach((p, i) => expect(dist(p, sampleClosed(reversed)[i])).toBeLessThan(1e-6));
    expect(sampleClosed(ring)).toHaveLength(SAMPLE_N);
  });

  it("finds the closest point of a path", () => {
    expect(nearestOn([[0, 0], [10, 0], [20, 0]], [12, 5])).toEqual([10, 0]);
  });
});

describe("motion plan follows the continuity map", () => {
  it("has a track for every non-stays continuity entry, and nothing else", () => {
    for (const t of MEMORY_TRANSITIONS) {
      const moving = MEMORY_CONTINUITY[t.id].filter((e) => e.verb !== "stays").map((e) => e.id).sort();
      expect(buildPlan(t.id).tracks.map((tr) => tr.id).sort()).toEqual(moving);
    }
  });

  it("every piece of evidence in either scene is covered by the continuity map (nothing moves un-described)", () => {
    for (const t of MEMORY_TRANSITIONS) {
      const covered = new Set(MEMORY_CONTINUITY[t.id].map((e) => e.id));
      for (const id of new Set([...ids(t.from), ...ids(t.to)])) expect(covered.has(id)).toBe(true);
    }
  });

  it("evidence marked 'stays' has identical geometry in both scenes — it needs no motion", () => {
    for (const t of MEMORY_TRANSITIONS) {
      for (const entry of MEMORY_CONTINUITY[t.id].filter((e) => e.verb === "stays")) {
        const a = MEMORY_SCENES[t.from].items.find((i) => i.id === entry.id);
        const b = MEMORY_SCENES[t.to].items.find((i) => i.id === entry.id);
        const geo = (item: typeof a) => JSON.stringify(item && { ...item, label: undefined, meaning: undefined, active: undefined });
        expect(geo(a)).toBe(geo(b));
      }
    }
  });

  it("every track has a beat and a primary event exists in each transition", () => {
    for (const t of MEMORY_TRANSITIONS) {
      const plan = buildPlan(t.id);
      for (const tr of plan.tracks) expect(Object.hasOwn(MEMORY_BEATS[t.id], tr.id) || tr.verb === "stays").toBe(true);
      expect(PRIMARY_EVENT[t.id].length).toBeGreaterThan(0);
      for (const id of PRIMARY_EVENT[t.id]) expect(plan.tracks.some((tr) => tr.id === id)).toBe(true);
    }
  });

  it("uses a small token set, not a table of timings", () => {
    expect(Object.keys(MEMORY_MOTION).sort()).toEqual(["ATTACH", "COMPRESS", "EVIDENCE_ENTER", "EXPAND", "MODEL_REORGANIZE", "QUALIFY", "STRENGTHEN"]);
  });

  it("is deterministic: the same plan and time give the same frame", () => {
    const tr = track("match-08>match-24", "path:main");
    expect(frameAt(tr, 1200)).toEqual(frameAt(tr, 1200));
  });
});

describe("01 → 08: recurrence attaches to the existing memory", () => {
  it("the origin and the first path stay; recurrence attaches; the unresolved path is untouched", () => {
    const plan = buildPlan("match-01>match-08");
    const ids01 = plan.tracks.map((t) => t.id);
    for (const stays of ["origin", "node:m1", "path:open", "role:you"]) expect(ids01).not.toContain(stays);
    expect(track("match-01>match-08", "path:reuse").verb).toBe("attaches");
    expect(track("match-01>match-08", "path:main").verb).toBe("strengthens");
  });

  it("is staged: recurrence attaches before the route reinforces, before supporting recurrence joins", () => {
    const start = (id: string) => track("match-01>match-08", id).start;
    expect(start("path:reuse")).toBeLessThan(start("path:main"));
    expect(start("path:main")).toBeLessThan(start("path:weak"));
    expect(start("path:weak")).toBeLessThan(start("echo:storm"));
  });

  it("the attached path draws out of existing evidence (from its first point) and is not visible before it starts", () => {
    const tr = track("match-01>match-08", "path:reuse");
    expect(frameAt(tr, tr.start).opacity).toBe(0);
    const mid = frameAt(tr, tr.start + tr.dur * 0.5).pts ?? [];
    expect(mid[0]).toEqual(sampleOpen(tr.dst && tr.dst.kind === "path" ? tr.dst.points : [])[0]);
    expect(mid.length).toBeLessThan(SAMPLE_N);
  });

  it("the strengthened path pulses and returns to its resting weight", () => {
    const tr = track("match-01>match-08", "path:main");
    expect(frameAt(tr, tr.start).emphasis).toBe(0);
    expect(frameAt(tr, tr.start + tr.dur / 2).emphasis).toBeGreaterThan(0.9);
    expect(frameAt(tr, tr.start + tr.dur).emphasis).toBeLessThan(0.01);
  });
});

describe("08 → 24: the contradiction qualifies the interpretation", () => {
  const T = "match-08>match-24" as const;

  it("the contradicting matchup arrives before the marker, and the route bends after both", () => {
    expect(track(T, "matchup:m1").start).toBeLessThan(track(T, "marker:c1").start);
    expect(track(T, "marker:c1").start).toBeLessThan(track(T, "path:main").start);
    expect(track(T, "path:main").mode).toBe("morph");
  });

  it("node:m1, path:open and echo:storm FOLD into their recorded targets instead of disappearing", () => {
    expect(track(T, "node:m1")).toMatchObject({ mode: "fold", linkedId: "node:m2" });
    expect(track(T, "path:open")).toMatchObject({ mode: "fold", linkedId: "region:open" });
    expect(track(T, "echo:storm")).toMatchObject({ mode: "fold", linkedId: "path:main" });
    const ghosts = ghostItems(buildPlan(T)).map((i) => i.id);
    for (const id of ["node:m1", "path:open", "echo:storm"]) expect(ghosts).toContain(id);
  });

  it("a folding node travels to its target and shrinks; it is still visible while it travels", () => {
    const tr = track(T, "node:m1");
    const m1 = tr.src && "at" in tr.src ? tr.src.at : [0, 0];
    const m2 = MEMORY_SCENES["match-24"].items.find((i) => i.id === "node:m2");
    const target = m2 && "at" in m2 ? m2.at : [0, 0];
    const half = frameAt(tr, tr.start + tr.dur * 0.5);
    /* subordinate while travelling (fades 0.2→0.8 of the fold), but never gone before it arrives */
    expect(half.opacity).toBeGreaterThan(0.3);
    expect(half.opacity).toBeLessThan(1);
    expect(dist(half.pos ?? m1, target as [number, number])).toBeLessThan(dist(m1 as [number, number], target as [number, number]));
    const end = frameAt(tr, tr.start + tr.dur);
    expect(end.opacity).toBe(0);
    expect(dist(end.pos ?? m1, target as [number, number])).toBeLessThan(0.01);
    expect(end.scale).toBeLessThan(0.5);
  });

  it("a folding path lands ON the path that absorbs it", () => {
    const tr = track(T, "path:reuse");
    const main = MEMORY_SCENES["match-24"].items.find((i) => i.id === "path:main");
    const line = sampleOpen(main && main.kind === "path" ? main.points : []);
    const end = frameAt(tr, tr.start + tr.dur).pts ?? [];
    for (const p of end) expect(dist(p, nearestOn(line, p))).toBeLessThan(0.01);
  });

  it("the history stays: the original reading is an undertrace that attaches, and the qualified route joins after it", () => {
    expect(track(T, "path:undertrace").verb).toBe("attaches");
    expect(track(T, "path:qualified").start).toBeGreaterThanOrEqual(track(T, "path:undertrace").start);
  });
});

describe("24 → 56: compressed evidence re-expands from where it was recorded", () => {
  const T = "match-24>match-56" as const;

  it("node:m1, path:open and echo:storm unfold from node:m2, region:open and path:main", () => {
    expect(track(T, "node:m1")).toMatchObject({ mode: "unfold", linkedId: "node:m2" });
    expect(track(T, "path:open")).toMatchObject({ mode: "unfold", linkedId: "region:open" });
    expect(track(T, "echo:storm")).toMatchObject({ mode: "unfold", linkedId: "path:main" });
  });

  it("an expanding item starts AT its source, not at its destination, and never from nowhere", () => {
    const m1 = track(T, "node:m1");
    const m2 = MEMORY_SCENES["match-24"].items.find((i) => i.id === "node:m2");
    const source = (m2 && "at" in m2 ? m2.at : [0, 0]) as [number, number];
    const first = frameAt(m1, m1.start);
    expect(first.opacity).toBe(0);
    expect(dist(first.pos ?? [0, 0], source)).toBeLessThan(0.01);
    const last = frameAt(m1, m1.start + m1.dur);
    expect(last.opacity).toBe(1);
    expect(dist(last.pos ?? [0, 0], m1.dst && "at" in m1.dst ? m1.dst.at : [0, 0])).toBeLessThan(0.01);
  });

  it("an expanding echo starts on the path that held it (the closest point of path:main)", () => {
    const echo = track(T, "echo:storm");
    const main = MEMORY_SCENES["match-24"].items.find((i) => i.id === "path:main");
    const line = sampleOpen(main && main.kind === "path" ? main.points : []);
    const start = frameAt(echo, echo.start + 1).pos ?? [0, 0];
    expect(dist(start, nearestOn(line, start))).toBeLessThan(2);
  });

  it("an expanding path starts collapsed on its source and unfolds outward", () => {
    const open = track(T, "path:open");
    const first = frameAt(open, open.start).pts ?? [];
    const source = open.anchor?.point ?? [0, 0];
    for (const p of first) expect(dist(p, source)).toBeLessThan(0.01);
    const last = frameAt(open, open.start + open.dur).pts ?? [];
    expect(dist(last[0], last[last.length - 1])).toBeGreaterThan(40);
  });

  it("evidence groups arrive in order: affinity, role, then the exception — the open end is not completed", () => {
    expect(track(T, "path:affinity").start).toBeLessThan(track(T, "path:role").start);
    expect(track(T, "path:role").start).toBeLessThan(track(T, "path:exception").start);
    const open = frameAt(track(T, "path:open"), 99999);
    expect(open.terminal).toBe(1);
  });
});

describe("56 → Model: the evidence reorganises into the contour", () => {
  const T = "match-56>player-model" as const;

  it("surviving evidence MOVES (it keeps its identity) and the strands that are not the contour fold into it", () => {
    for (const id of ["origin", "path:main", "path:qualified", "echo:storm", "matchup:m1", "marker:c1", "node:m1"]) expect(track(T, id).mode).toBe("morph");
    expect(track(T, "path:affinity")).toMatchObject({ mode: "fold", linkedId: "path:main" });
    expect(track(T, "path:role")).toMatchObject({ mode: "fold", linkedId: "path:contour-b" });
    expect(track(T, "node:m2")).toMatchObject({ mode: "fold", linkedId: "node:core" });
  });

  it("uses the largest token, and nothing of Match 56 fades out wholesale", () => {
    expect(MEMORY_MOTION.MODEL_REORGANIZE.dur).toBe(Math.max(...Object.values(MEMORY_MOTION).map((m): number => m.dur)) as 1500);
    // every piece of evidence that exists in both scenes is a morph (identity kept), never an exit
    const both = ids("match-56").filter((id) => ids("player-model").includes(id));
    for (const id of both) expect(track(T, id).mode === "morph" || MEMORY_CONTINUITY[T].find((e) => e.id === id)?.verb === "stays").toBe(true);
  });

  it("the new structure (contour-b, core) draws out after the strands that explain it have started to fold", () => {
    expect(track(T, "path:contour-b").start).toBeGreaterThan(track(T, "path:role").start);
    expect(track(T, "path:core").start).toBeGreaterThan(track(T, "node:m2").start);
  });

  it("a morphing path is interpolated between two different point counts without a jump", () => {
    const tr = track(T, "path:main");
    const from = frameAt(tr, tr.start).pts ?? [];
    const end = frameAt(tr, tr.start + tr.dur).pts ?? [];
    expect(from).toHaveLength(SAMPLE_N);
    expect(end).toHaveLength(SAMPLE_N);
    expect(dist(from[0], sampleOpen(tr.src && tr.src.kind === "path" ? tr.src.points : [])[0])).toBeLessThan(0.01);
    expect(dist(end[SAMPLE_N - 1], sampleOpen(tr.dst && tr.dst.kind === "path" ? tr.dst.points : [])[SAMPLE_N - 1])).toBeLessThan(0.01);
  });
});

describe("labels and annotation", () => {
  it("a label that is identical in both scenes is steady (no blinking); a changed one is not", () => {
    const steady = steadyLabelIds(MEMORY_SCENES["match-01"], MEMORY_SCENES["match-08"]);
    expect(steady.has("role:you")).toBe(true);
    expect(steady.has("node:m1")).toBe(false);
  });

  it("the annotation changes words only while it is faded out", () => {
    const plan = buildPlan("match-08>match-24");
    expect(annotationState(plan, 0)).toEqual({ opacity: 1, scene: "from" });
    const swap = annotationState(plan, 260);
    expect(swap.scene).toBe("to");
    expect(swap.opacity).toBe(0);
    expect(annotationState(plan, 900)).toEqual({ opacity: 1, scene: "to" });
  });
});

describe("reduced motion preserves meaning", () => {
  it("is short, with direct geometry and opacity changes only", () => {
    for (const t of MEMORY_TRANSITIONS) {
      const plan = buildPlan(t.id, true);
      expect(plan.duration).toBeLessThanOrEqual(400);
      for (const tr of plan.tracks) {
        const f = frameAt(tr, 100, true);
        expect(f.pts).toBeUndefined();
        expect(f.pos).toBeUndefined();
        expect(f.band).toBeUndefined();
      }
    }
  });

  it("what arrives fades in, what is folded away fades out, what persists is simply there", () => {
    const plan = buildPlan("match-08>match-24", true);
    const by = (id: string) => plan.tracks.find((t) => t.id === id) as (typeof plan.tracks)[number];
    expect(frameAt(by("matchup:m1"), 0, true).opacity).toBe(0);
    expect(frameAt(by("matchup:m1"), plan.duration, true).opacity).toBe(1);
    expect(frameAt(by("node:m1"), 0, true).opacity).toBe(1);
    expect(frameAt(by("node:m1"), plan.duration, true).opacity).toBe(0);
    expect(frameAt(by("path:main"), 0, true).opacity).toBe(1);
  });
});

describe("mobile window", () => {
  it("MOBILE_WINDOW matches the crops in memory-strip.css", () => {
    for (const id of MEMORY_SCENE_ORDER.filter((s) => s !== "player-model")) {
      const rule = css.match(new RegExp(`\\.ms\\[data-scene="${id}"\\] \\.ms-canvas \\{ --ms-top: (\\d+); --ms-h: (\\d+);`));
      expect(rule).not.toBeNull();
      expect(Number(rule?.[1])).toBe(MOBILE_WINDOW[id].top);
      expect(Number(rule?.[2])).toBe(MOBILE_WINDOW[id].h);
    }
    expect(MOBILE_WINDOW["player-model"]).toEqual({ top: 0, h: 500 });
  });
});

describe("player (DOM)", () => {
  const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };
  const el = (root: HTMLElement, id: string) => root.querySelector(`[data-evidence="${id}"]`);

  it("renders a settled scene identically to the static component's evidence (same ids)", () => {
    const { getByTestId } = render(<MemoryStripMotion sceneId="match-24" />);
    const root = getByTestId("memory-strip");
    expect(root.getAttribute("data-scene")).toBe("match-24");
    expect(root.getAttribute("data-motion")).toBeNull();
    for (const id of ids("match-24")) expect(el(root, id)).not.toBeNull();
  });

  it("scrub freezes a transition: ghosts of folding evidence are on screen mid-way, and persistent evidence is the SAME DOM node", async () => {
    const view = render(<MemoryStripMotion sceneId="match-08" />);
    const before = {
      origin: el(view.container, "origin"),
      main: el(view.container, "path:main"),
      m1: el(view.container, "node:m1"),
    };
    view.rerender(<MemoryStripMotion sceneId="match-24" scrub={0.4} />);
    await settle();
    const root = view.getByTestId("memory-strip");
    expect(root.getAttribute("data-motion")).toBe("on");
    expect(root.getAttribute("data-scene")).toBe("match-24");
    expect(el(root, "origin")).toBe(before.origin);
    expect(el(root, "path:main")).toBe(before.main);
    expect(el(root, "node:m1")).toBe(before.m1);
    expect(el(root, "path:weak")).not.toBeNull();
    expect(el(root, "matchup:m1")).not.toBeNull();
  });

  it("releasing the scrub settles to exactly the static scene (ghosts gone, imperative writes removed)", async () => {
    const view = render(<MemoryStripMotion sceneId="match-08" />);
    const main = el(view.container, "path:main");
    const staticD = main?.querySelector(".ms-path-core")?.getAttribute("d");
    view.rerender(<MemoryStripMotion sceneId="match-24" scrub={0.5} />);
    await settle();
    expect(main?.querySelector(".ms-path-core")?.getAttribute("d")).not.toBe(staticD);
    view.rerender(<MemoryStripMotion sceneId="match-24" scrub={null} />);
    await settle();
    const root = view.getByTestId("memory-strip");
    expect(root.getAttribute("data-motion")).toBeNull();
    expect(el(root, "path:weak")).toBeNull();
    expect(el(root, "node:m1")).toBeNull();
    const reference = render(<MemoryStripMotion sceneId="match-24" />).container;
    const normalize = (html: string) => html.replace(/ms-(hatch|desc)-\w+/g, "ID");
    expect(normalize(view.container.innerHTML)).toBe(normalize(reference.innerHTML));
  });

  it("a plain next-scene change plays and then settles on the static scene; any other change cuts", async () => {
    const view = render(<MemoryStripMotion sceneId="match-01" reducedMotion="reduce" speed={50} />);
    view.rerender(<MemoryStripMotion sceneId="match-08" reducedMotion="reduce" speed={50} />);
    expect(view.getByTestId("memory-strip").getAttribute("data-motion")).toBe("on");
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(view.getByTestId("memory-strip").getAttribute("data-motion")).toBeNull();
    view.rerender(<MemoryStripMotion sceneId="player-model" reducedMotion="reduce" speed={50} />);
    expect(view.getByTestId("memory-strip").getAttribute("data-motion")).toBeNull();
    expect(view.getByTestId("memory-strip").getAttribute("data-scene")).toBe("player-model");
  });

  it("the review stories exist and render", () => {
    for (const name of ["MotionReview", "MotionReviewMobile", "MotionReviewReduced"] as const) {
      const Story = stories[name];
      const { getByTestId } = render(<Story />);
      expect(getByTestId("memory-strip")).toBeTruthy();
      expect(getByTestId("motion-review-controls")).toBeTruthy();
      cleanup();
    }
  });
});
