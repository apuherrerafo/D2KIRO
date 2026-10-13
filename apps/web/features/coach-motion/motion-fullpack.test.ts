// The production runtime (MotionController -> MotionSequencer -> BitmapStore) on the REAL committed full semantic pack: public/coach-motion-v2/prod/384/manifest.json,
// 4 loops, 5 edges, every entry-head grid, real chunk geometry. Decodes are fakes that land on the next microtask; everything else is the shipped code.
// WATCHING -> ANALYZING -> POINTING -> CONFIRMING -> POINTING -> WATCHING: every painted step must be a graph successor, every hop must open on head frame 0 of the
// cued edge, the clock must never hold, resident chunks stay bounded per mode, and no entry head / tail is requested while no cue is pending.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { edgeBetween, headClipId, headPhases, splitKey, type ProdManifest } from "./production-manifest";
import { FRAME_MS, authoringGraph, flush, realManifest, rig, type Paint } from "./test-support";

const CYCLE = ["watching", "analyzing", "pointing", "confirming", "pointing", "watching"];

/** Null when `b` may follow `a` on screen, otherwise why not (the same rules as scripts/coach-motion-v2/fullpack-audit.mjs). */
function successor(m: ProdManifest, a: Paint, b: Paint, cued: string | null): string | null {
  const loopOf = Object.fromEntries(Object.entries(m.graph.loops).map(([id, l]) => [l.clip, id]));
  if (a.clip === b.clip && a.frame === b.frame) return "duplicate";
  if (loopOf[a.clip]) {
    const n = m.clips[a.clip].frames;
    if (b.clip === a.clip) return b.frame === (a.frame + 1) % n ? null : `skipped ${a.clip} ${a.frame} -> ${b.frame}`;
    const e = m.graph.edges.find((x) => b.clip.startsWith(x.entry.headClipPrefix));
    if (!e || e.from !== loopOf[a.clip] || e.id !== cued) return `left ${a.clip} for ${b.clip} (cued ${cued})`;
    if (b.frame !== 0) return `opened ${b.clip} at frame ${b.frame}`;
    const phase = Number(b.clip.slice(e.entry.headClipPrefix.length));
    const up = (a.frame + 1) % n;
    return Math.min((phase - up + n) % n, (up - phase + n) % n) <= e.entry.maxStepFrames ? null : `head ${phase} too far from ${up}`;
  }
  const he = m.graph.edges.find((x) => a.clip.startsWith(x.entry.headClipPrefix));
  if (he) {
    if (b.clip === a.clip) return b.frame === a.frame + 1 ? null : `skipped head frame ${a.frame} -> ${b.frame}`;
    return a.frame === m.clips[a.clip].frames - 1 && b.clip === he.tail.clip && b.frame === 0 ? null : `head ${a.clip}#${a.frame} -> ${b.clip}#${b.frame}`;
  }
  const te = m.graph.edges.find((x) => x.tail.clip === a.clip)!;
  if (b.clip === a.clip) return b.frame === a.frame + 1 ? null : `skipped tail frame ${a.frame} -> ${b.frame}`;
  return a.frame === m.clips[a.clip].frames - 1 && b.clip === m.graph.loops[te.to].clip && b.frame === te.tail.enterFrame ? null : `tail ${a.clip}#${a.frame} -> ${b.clip}#${b.frame}`;
}

const isEdgeClip = (m: ProdManifest, clip: string) => m.graph.edges.some((e) => clip.startsWith(e.entry.headClipPrefix) || clip === e.tail.clip);

describe("the real full semantic pack on the unchanged runtime", () => {
  const m = realManifest("384");

  test("the committed 384 manifest is the whole authoring graph: every loop, edge, head grid and tail", () => {
    const g = authoringGraph();
    expect(Object.keys(m.graph.loops)).toEqual(Object.keys(g.loops));
    expect(m.graph.edges.map((e) => e.id)).toEqual(g.edges.map((e) => e.id));
    let heads = 0;
    for (const e of m.graph.edges) {
      for (const p of headPhases(m.clips[m.graph.loops[e.from].clip].frames, e.entry.stride)) {
        expect(m.clips[headClipId(e.entry.headClipPrefix, p)]?.frames, `${e.id} ${p}`).toBe(e.entry.headFrames);
        heads += 1;
      }
    }
    expect(heads).toBe(207);
    expect(m.totalBytes).toBeLessThanOrEqual(g.budget.packCeilingBytes);
    expect(Object.keys(m.clips)).toHaveLength(4 + 5 + 207);
  });

  test("full cycle: every paint is a graph successor, each hop opens on frame 0 of the cued edge's head, the clock never holds, ownership stays bounded, loading is cue-armed", async () => {
    const r = rig({ m });
    await flush();
    const marks: Array<{ at: number; requested: number; pending: boolean }> = [];
    const resident = { loop: 0, armed: 0, transition: 0 };
    let ticks = 0;
    const cues: Array<[number, string]> = []; // [paint index at the cue, edge id]
    const step = async () => {
      const before = r.paints.length;
      r.ctl.tick(FRAME_MS);
      await flush();
      ticks += 1;
      expect(r.paints.length, `tick ${ticks} painted nothing (held clock)`).toBe(before + 1);
      const mode = r.ctl.shown!.mode === "transition" ? "transition" : r.ctl.pendingEdge ? "armed" : "loop";
      resident[mode] = Math.max(resident[mode], r.ctl.residency().keys.length);
      marks.push({ at: r.paints.length, requested: r.io.requested.length, pending: mode !== "loop" });
    };
    for (let i = 0; i < 40; i += 1) await step();
    for (let i = 1; i < CYCLE.length; i += 1) {
      const e = edgeBetween(m, CYCLE[i - 1], CYCLE[i])!;
      expect(r.ctl.cue(CYCLE[i]), e.id).toBe(true);
      cues.push([r.paints.length, e.id]);
      const at = r.paints.length;
      for (let k = 0; k < 120 && r.ctl.shown!.mode !== CYCLE[i]; k += 1) await step();
      expect(r.ctl.shown!.mode, e.id).toBe(CYCLE[i]);
      const played = r.paints.slice(at);
      const h0 = played.findIndex((p) => p.clip.startsWith(e.entry.headClipPrefix));
      expect(h0, `${e.id}: cue -> head 0 within one frame (the entry is armed and decoded at once)`).toBeLessThanOrEqual(1);
      expect(played.slice(h0, h0 + e.entry.headFrames).map((p) => p.frame), e.id).toEqual([...Array(e.entry.headFrames).keys()]);
      const tail = m.clips[e.tail.clip].frames;
      expect(played.slice(h0 + e.entry.headFrames, h0 + e.entry.headFrames + tail).map((p) => `${p.clip}#${p.frame}`), e.id).toEqual([...Array(tail).keys()].map((k) => `${e.tail.clip}#${k}`));
      expect(r.ctl.lastEntry, e.id).toMatchObject({ edge: e.id });
      expect(r.ctl.lastEntry!.step, e.id).toBeLessThanOrEqual(e.entry.maxStepFrames);
      for (let k = 0; k < 60 + 7 * i; k += 1) await step(); // hold the target loop for a while (and across the cycle, at different phases)
    }
    // successor rule over the whole painted stream: a loop may only be left for a head of the edge that was CUED last
    const errs: string[] = [];
    for (let i = 1; i < r.paints.length; i += 1) {
      const cued = cues.filter(([at]) => at <= i).pop()?.[1] ?? null;
      const why = successor(m, r.paints[i - 1], r.paints[i], cued);
      if (why) errs.push(`${i}: ${why}`);
    }
    expect(errs).toEqual([]);
    expect(cues.map(([, id]) => id)).toEqual(CYCLE.slice(1).map((to, i) => `${CYCLE[i]}>${to}`));
    // ownership: an idle loop holds its current + next chunk; an armed request adds the entry heads and the tail opening; an edge holds its lookahead
    const maxArm = Math.max(...m.graph.edges.map((e) => e.entry.armHeads));
    const lookChunks = Math.ceil(Math.max(...m.graph.edges.map((e) => e.lookaheadFrames)) / m.chunkFrames) + 3;
    expect(resident.loop).toBeLessThanOrEqual(2);
    expect(resident.armed).toBeLessThanOrEqual(2 + maxArm + 1);
    expect(resident.transition).toBeLessThanOrEqual(lookChunks);
    // cue-armed only: every head / tail request happened while a request was pending or an edge was playing
    let idleEdgeLoads = 0;
    let seen = 0;
    for (const mk of marks) {
      const fresh = r.io.requested.slice(seen, mk.requested);
      seen = mk.requested;
      if (!mk.pending) idleEdgeLoads += fresh.filter((k) => isEdgeClip(m, splitKey(k).clip)).length;
    }
    expect(idleEdgeLoads).toBe(0);
    expect(r.events.fail).toEqual([]);
    expect(r.ctl.shown).toMatchObject({ state: "watching", mode: "watching" });
  });

  test("each loop held for two laps with nothing cued: no entry head or tail is ever requested (no idle head churn), the loop wraps, nothing else is painted", async () => {
    for (const loop of Object.keys(m.graph.loops)) {
      const r = rig({ m, loop });
      await flush();
      const frames = m.clips[m.graph.loops[loop].clip].frames;
      for (let i = 0; i < frames * 2 + 3; i += 1) {
        r.ctl.tick(FRAME_MS);
        await flush();
      }
      expect(r.io.requested.filter((k) => isEdgeClip(m, splitKey(k).clip)), loop).toEqual([]);
      expect(new Set(r.paints.map((p) => p.clip)), loop).toEqual(new Set([m.graph.loops[loop].clip]));
      expect(r.paints.filter((p) => p.frame === 0).length, loop).toBeGreaterThanOrEqual(3);
      expect(r.ctl.residency().keys.length, loop).toBeLessThanOrEqual(2);
      expect(r.events.fail, loop).toEqual([]);
    }
  });

  test("the full-pack lab and its cycle live outside the runtime: the runtime sources still name no state, clip or edge", () => {
    const dir = (f: string) => fileURLToPath(new URL(f, import.meta.url));
    for (const f of ["CoachMotionPlayer.tsx", "motion-controller.ts", "sequencer.ts", "production-manifest.ts", "chunk-loader.ts", "bitmap-store.ts"]) {
      const code = readFileSync(dir(f), "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      expect(code, f).not.toMatch(/POINTING|CONFIRMING|WATCHING_LOOP|ANALYZING_LOOP|ENTRY_HEAD|TAIL_|"pointing"|"confirming"|full-pack|FULL_CYCLE/);
    }
  });
});
