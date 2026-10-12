import { describe, expect, test } from "bun:test";
import { BEAT_MS, PHASES, advance, draftNumber, buildBeats, contradicts, draftLeaderOf, fitAt, frameFor, recentCalls, rankAt, totalMs, winnerOf, type Beat } from "./loop";
import { DOTA_SIGNOFF, LOOP_SCENARIOS } from "./scenarios";

const [A, B, C] = LOOP_SCENARIOS;

describe("scenario arithmetic", () => {
  test("A: the draft read leads with Queen of Pain; the personal step flips it to Puck", () => {
    expect(draftLeaderOf(A)).toBe("Queen of Pain");
    expect(rankAt(A, 3)[0]).toEqual({ hero: "Queen of Pain", fit: 84 });
    expect(rankAt(A, 4)[0]).toEqual({ hero: "Puck", fit: 88 });
    expect(winnerOf(A)).toBe("Puck");
  });
  test("B: the personal step is empty and moves nothing", () => {
    for (const c of B.candidates) expect(fitAt(B, c.hero, 4)).toBe(fitAt(B, c.hero, 3));
    expect(winnerOf(B)).toBe(draftLeaderOf(B));
  });
  test("C: Spectre contradicts the early leader and hands the lead to Mars", () => {
    expect(rankAt(C, 2)[0].hero).toBe("Centaur Warrunner");
    expect(contradicts(C, 2)).toBe(true);
    expect(rankAt(C, 3)[0].hero).toBe("Mars");
    expect(winnerOf(C)).toBe("Mars");
  });
  test("REPEL is the only contradiction in the loop", () => {
    const flagged = LOOP_SCENARIOS.flatMap((s) => s.steps.map((_, i) => (contradicts(s, i) ? `${s.id}${i}` : null)).filter(Boolean));
    expect(flagged).toEqual(["C2"]);
  });
  test("every confidence table covers every step count", () => {
    for (const s of LOOP_SCENARIOS) expect(s.confidenceByApplied.length).toBe(s.steps.length + 1);
  });
});

describe("beats", () => {
  test("phase order is the product chain, and nothing is missing", () => {
    for (const s of LOOP_SCENARIOS) {
      const phases = buildBeats(s).map((b) => b.phase);
      const seen = [...new Set(phases)];
      expect(seen).toEqual([...PHASES]);
    }
  });
  test("applied only ever grows and ends at the step count", () => {
    for (const s of LOOP_SCENARIOS) {
      const beats = buildBeats(s);
      beats.reduce((prev, b) => {
        expect(b.applied).toBeGreaterThanOrEqual(prev);
        return b.applied;
      }, 0);
      expect(beats[beats.length - 1].applied).toBe(s.steps.length);
    }
  });
  test("the verbs are the shared language; REPEL only on the contradiction", () => {
    const repel = LOOP_SCENARIOS.flatMap((s) => buildBeats(s).filter((b) => b.verb === "REPEL").map((b) => `${s.id}:${b.id}`));
    expect(repel).toEqual(["C:evidence-3"]);
    const beats = buildBeats(A);
    expect(beats.find((b) => b.id === "reveal")?.verb).toBe("GATHER");
    expect(beats.find((b) => b.id === "evidence-1")?.verb).toBe("ATTRACT");
    expect(beats.find((b) => b.id === "evidence-4")?.verb).toBe("TETHER");
    expect(beats.find((b) => b.id === "recommendation")?.verb).toBe("SETTLE");
    expect(beats.find((b) => b.id === "settle")?.verb).toBe("TRANSFER");
    expect(beats.find((b) => b.id === "relax")?.verb).toBe("SCATTER");
  });
  test("an absent personal step is quiet: no verb and shorter", () => {
    const beat = buildBeats(B).find((b) => b.id === "evidence-4") as Beat;
    expect(beat.verb).toBeNull();
    expect(beat.ms).toBe(BEAT_MS.evidenceAbsent);
  });
  test("one pass is readable, not exhausting", () => {
    for (const s of LOOP_SCENARIOS) {
      const ms = totalMs(buildBeats(s));
      expect(ms).toBeGreaterThan(10_000);
      expect(ms).toBeLessThan(18_000);
    }
  });
});

describe("frames", () => {
  const beat = (s: (typeof LOOP_SCENARIOS)[number], id: string) => buildBeats(s).find((b) => b.id === id) as Beat;

  test("enemies are hidden in the draft and revealed together in A", () => {
    expect(frameFor(A, beat(A, "draft")).enemies.every((e) => !e.visible)).toBe(true);
    expect(frameFor(A, beat(A, "reveal")).enemies.every((e) => e.visible)).toBe(true);
  });
  test("C reveals enemies as information grows", () => {
    expect(frameFor(C, beat(C, "reveal")).enemies.map((e) => e.visible)).toEqual([true, false, false, false]);
    expect(frameFor(C, beat(C, "evidence-3")).enemies.map((e) => e.visible)).toEqual([true, true, true, false]);
    expect(frameFor(C, beat(C, "evidence-4")).enemies.every((e) => e.visible)).toBe(true);
  });
  test("A flips the order only when the personal step arrives", () => {
    expect(frameFor(A, beat(A, "evidence-3")).rows[0].hero).toBe("Queen of Pain");
    const f = frameFor(A, beat(A, "evidence-4"));
    expect(f.rows[0].hero).toBe("Puck");
    expect(f.personalFlipped).toBe(true);
    expect(f.rows[0].detail).toBe("Often played");
  });
  test("B never claims personal evidence", () => {
    const f = frameFor(B, beat(B, "recommendation"));
    expect(f.personalFlipped).toBe(false);
    expect(f.draftOnly).toBe(true);
    expect(f.confidence).toBe("medium");
    expect(f.markers[3]?.absent).toBe(true);
  });
  test("C: the contradicted leader is repelled exactly on its step; confidence grows", () => {
    const f = frameFor(C, beat(C, "evidence-3"));
    expect(f.rows.find((r) => r.repelled)?.hero).toBe("Centaur Warrunner");
    expect(frameFor(C, beat(C, "evidence-4")).rows.some((r) => r.repelled)).toBe(false);
    const conf = ["draft", "evidence-1", "evidence-3", "evidence-5", "recommendation"].map((id) => frameFor(C, beat(C, id)).confidence);
    expect(conf).toEqual(["low", "low", "medium", "high", "high"]);
  });
  test("lock → settle → carry → relax flags are cumulative and the champion is the winner", () => {
    const flags = ["recommendation", "lock", "settle", "carry", "relax"].map((id) => {
      const f = frameFor(A, beat(A, id));
      return [f.decided, f.locked, f.seated, f.carried, f.relaxed];
    });
    expect(flags).toEqual([
      [true, false, false, false, false],
      [true, true, false, false, false],
      [true, true, false, false, false],
      [true, true, true, true, false],
      [true, true, true, true, true],
    ]);
    expect(frameFor(A, beat(A, "recommendation")).rows.find((r) => r.champion)?.hero).toBe("Puck");
    expect(frameFor(A, beat(A, "settle")).placing).toBe(true);
  });
});

describe("coach hierarchy", () => {
  test("confidence quiets the Coach through scale and amplitude, and a low-confidence read never outweighs a high one", () => {
    const rec = buildBeats(A).find((b) => b.id === "recommendation") as Beat;
    const high = frameFor(A, { ...rec }).coach;
    const recB = buildBeats(B).find((b) => b.id === "recommendation") as Beat;
    const medium = frameFor(B, recB).coach;
    expect(high.scale).toBeGreaterThan(medium.scale);
    expect(high.amplitude).toBeGreaterThan(medium.amplitude);
    expect(medium.state).toBe("pointing");
  });
  test("the Coach states are only the four approved ones", () => {
    const states = new Set(LOOP_SCENARIOS.flatMap((s) => buildBeats(s).map((b) => frameFor(s, b).coach.state)));
    expect([...states].sort()).toEqual(["analyzing", "confirming", "pointing", "watching"]);
  });
});

describe("the endless position", () => {
  test("advance walks beats, then scenarios, then wraps into the next cycle without a reset beat", () => {
    let p = { cycle: 0, scenario: 0, beat: 0 };
    const seen: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      const beats = buildBeats(LOOP_SCENARIOS[p.scenario]);
      seen.push(`${p.cycle}${LOOP_SCENARIOS[p.scenario].id}${beats[p.beat].id}`);
      p = advance(p, beats, LOOP_SCENARIOS.length);
    }
    expect(seen).toContain("1Adraft");
    expect(seen.filter((x) => x === "0Bdraft")).toHaveLength(1);
    expect(p.cycle).toBeGreaterThanOrEqual(1);
  });
  test("Recent calls are derived from the position: absent at first, fill on carry, newest first, keep the last three", () => {
    const beatsA = buildBeats(A);
    const at = (cycle: number, scenario: number, id: string) => {
      const beats = buildBeats(LOOP_SCENARIOS[scenario]);
      return recentCalls(LOOP_SCENARIOS, { cycle, scenario, beat: beats.findIndex((b) => b.id === id) }, beats);
    };
    expect(recentCalls(LOOP_SCENARIOS, { cycle: 0, scenario: 0, beat: 0 }, beatsA)).toEqual([]);
    expect(at(0, 0, "settle")).toEqual([]);
    expect(at(0, 0, "carry").map((r) => r.hero)).toEqual(["Puck"]);
    expect(at(0, 1, "draft").map((r) => r.hero)).toEqual(["Puck"]);
    expect(at(0, 2, "carry").map((r) => r.hero)).toEqual(["Mars", "Faceless Void", "Puck"]);
    expect(at(1, 0, "carry").map((r) => r.hero)).toEqual(["Puck", "Mars", "Faceless Void"]);
  });
});

describe("product truth", () => {
  test("no fixture looks like personal telemetry (no game counts, no win rates)", () => {
    const copy = LOOP_SCENARIOS.flatMap((s) => [...s.why, ...s.steps.flatMap((st) => [st.label, ...Object.values(st.detail ?? {})])]);
    for (const text of copy) expect(text).not.toMatch(/\d+\s*games|% ?win|win rate|probability/i);
  });
  test("draft number counts consecutive drafts across cycles", () => {
    expect(draftNumber({ cycle: 0, scenario: 0, beat: 0 }, 3)).toBe(1);
    expect(draftNumber({ cycle: 0, scenario: 2, beat: 0 }, 3)).toBe(3);
    expect(draftNumber({ cycle: 1, scenario: 0, beat: 0 }, 3)).toBe(4);
  });
  test("the expert-review list names every matchup step", () => {
    expect(DOTA_SIGNOFF.map((d) => d.steps.length)).toEqual([3, 3, 5]);
  });
});
