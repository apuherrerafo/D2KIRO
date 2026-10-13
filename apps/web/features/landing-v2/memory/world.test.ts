import { describe, expect, test } from 'bun:test';
import { SCENES, NODES } from './fixtures';
import { beamAllowed } from './coach-state';
import { MemoryWorld, sceneMetrics, settledSnapshot } from './world';
import type { CoachState, LayoutId } from './types';

function playAll(layout: LayoutId, seed?: number): MemoryWorld {
  const w = new MemoryWorld(layout, seed);
  for (let i = 0; i < SCENES.length; i++) {
    w.loadScene(i);
    w.runUntilDone();
  }
  return w;
}

function positions(w: MemoryWorld): string {
  return [...w.nodes.values()].map((n) => `${n.id}:${n.x.toFixed(4)},${n.y.toFixed(4)}`).join('|');
}

describe('MemoryWorld determinism', () => {
  test('same seed + same story => identical settled composition', () => {
    expect(positions(playAll('wide', 24))).toBe(positions(playAll('wide', 24)));
  });

  test('a restored snapshot reproduces the live-settled composition of that scene', () => {
    const live = new MemoryWorld('wide', 24);
    for (let i = 0; i <= 2; i++) {
      live.loadScene(i);
      live.runUntilDone();
    }
    const snap = settledSnapshot('wide', 2, 24);
    for (const n of snap.nodes) {
      const l = live.nodes.get(n.id);
      expect(l?.present).toBe(n.present);
      if (n.present) {
        expect(Math.abs((l?.x ?? 0) - n.x)).toBeLessThan(0.001);
        expect(Math.abs((l?.y ?? 0) - n.y)).toBeLessThan(0.001);
      }
    }
  });

  test('every scene settles on its own (cooling works) within 8 s of sim time', () => {
    for (const layout of ['wide', 'narrow'] as const) {
      const w = new MemoryWorld(layout);
      for (let i = 0; i < SCENES.length; i++) {
        w.loadScene(i);
        const ms = w.runUntilDone(20000);
        expect(w.done).toBe(true);
        expect(ms).toBeLessThan(8000);
      }
    }
  });

  test('settled nodes sit on their semantic anchors', () => {
    const w = playAll('wide');
    for (const n of w.nodes.values()) {
      expect(Math.hypot(n.x - n.ax, n.y - n.ay)).toBeLessThan(2);
    }
  });
});

describe('story beats', () => {
  test('match 01 is almost empty: 3 nodes, quiet', () => {
    const w = new MemoryWorld('wide');
    w.loadScene(0);
    w.runUntilDone();
    expect([...w.nodes.values()].filter((n) => n.present).map((n) => n.id).sort()).toEqual(['m01', 'puck', 'you']);
    expect(w.metrics.peakSpeed).toBeLessThan(500);
  });

  test('match 24 is the strongest motion event and loses equilibrium', () => {
    const peaks = SCENES.map((_, i) => sceneMetrics('wide', i));
    const key = peaks[2];
    expect(key.peakSpeed).toBeGreaterThan(peaks[0].peakSpeed);
    expect(key.peakSpeed).toBeGreaterThan(peaks[3].peakSpeed);
    expect(key.peakSpeed).toBeGreaterThan(peaks[4].peakSpeed);
    // a spring stretches significantly and the system is pushed far from its anchors
    expect(key.maxTension).toBeGreaterThan(1.9);
  });

  test('match 24 settles into a DIFFERENT topology while the same evidence remains', () => {
    const before = settledSnapshot('wide', 1);
    const after = settledSnapshot('wide', 2);
    const pb = before.nodes.find((n) => n.id === 'puck');
    const pa = after.nodes.find((n) => n.id === 'puck');
    expect(Math.hypot((pb?.x ?? 0) - (pa?.x ?? 0), (pb?.y ?? 0) - (pa?.y ?? 0))).toBeGreaterThan(80);
    for (const n of before.nodes.filter((x) => x.present)) {
      expect(after.nodes.find((x) => x.id === n.id)?.present).toBe(true);
    }
    expect(after.linksBorn).toContain('cond-you');
    expect(after.linksBorn).toContain('cond-viper');
    // nothing disappears: the previous path survives as an undertrace
    expect(after.ghost.length).toBeGreaterThan(0);
  });

  test('the Coach confirms only AFTER the new equilibrium exists', () => {
    const w = new MemoryWorld('wide');
    const log: Array<{ state: CoachState; settled: boolean }> = [];
    w.setHandlers({ onCoach: (state) => log.push({ state, settled: w.settled }) });
    for (let i = 0; i <= 2; i++) {
      w.loadScene(i);
      w.runUntilDone();
    }
    const confirming = log.filter((e) => e.state === 'confirming');
    expect(confirming.length).toBeGreaterThan(0);
    expect(confirming.every((e) => e.settled)).toBe(true);
  });

  test('the Coach reacts AFTER the evidence enters', () => {
    const w = new MemoryWorld('wide');
    const marks: Record<string, number> = {};
    w.setHandlers({
      onCoach: (state) => {
        if (state === 'analyzing' && marks.analyzing === undefined && w.scene === 1) marks.analyzing = w.sceneT;
      },
    });
    w.loadScene(0);
    w.runUntilDone();
    w.loadScene(1);
    let evidenceAt = -1;
    while (!w.done && w.sceneT < 6000) {
      w.step();
      if (evidenceAt < 0 && w.nodes.get('m08')?.present) evidenceAt = w.sceneT;
    }
    expect(evidenceAt).toBeGreaterThan(0);
    expect(marks.analyzing - evidenceAt).toBeGreaterThanOrEqual(150);
  });

  test('final topology uses exactly the same nodes as match 56', () => {
    const a = settledSnapshot('wide', 3).nodes.filter((n) => n.present).map((n) => n.id).sort();
    const b = settledSnapshot('wide', 4).nodes.filter((n) => n.present).map((n) => n.id).sort();
    expect(b).toEqual(a);
    expect(b.length).toBe(NODES.length);
    expect(b.length).toBeLessThanOrEqual(15);
  });
});

describe('coach rules', () => {
  test('uncertain never points', () => {
    expect(beamAllowed('uncertain')).toBe(false);
    expect(beamAllowed('watching')).toBe(false);
    expect(beamAllowed('analyzing')).toBe(true);
  });
});

describe('v1.1 polish contracts', () => {
  test('story timing does not depend on frame rate (fast frames vs a 4 fps device)', async () => {
    const { LiveController } = await import('./controllers');
    const run = (frameMs: number): number => {
      let confirmedAt = -1;
      let clock = 0;
      const ctl = new LiveController('narrow', {
        onCoach: (state) => {
          if (state === 'confirming' && confirmedAt < 0) confirmedAt = clock;
        },
        onDone: () => {},
      });
      ctl.goTo(2);
      while (confirmedAt < 0 && clock < 30000) {
        clock += frameMs;
        ctl.tick(frameMs);
      }
      return confirmedAt;
    };
    const fast = run(16.7);
    const slow = run(250);
    expect(fast).toBeGreaterThan(0);
    expect(Math.abs(slow - fast)).toBeLessThan(400);
  });

  test('hovering the pointer does not keep the world from settling', () => {
    const w = new MemoryWorld('wide');
    w.pointer = { x: 10, y: 10 };
    w.loadScene(0);
    w.runUntilDone();
    expect(w.done).toBe(true);
  });

  test('match 24 confirms no later than 5.6 s of sim time', () => {
    for (const layout of ['wide', 'narrow'] as const) {
      const w = new MemoryWorld(layout);
      let at = -1;
      w.setHandlers({ onCoach: (s) => { if (s === 'confirming' && w.scene === 2 && at < 0) at = w.sceneT; } });
      for (let i = 0; i <= 2; i++) { w.loadScene(i); w.runUntilDone(); }
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(5600);
      expect(w.settled).toBe(true);
    }
  });

  test('the undertrace is loud while unsettled and a residue once settled', () => {
    expect(SCENES[2].ghostLive ?? 0).toBeGreaterThan(SCENES[2].layers.ghost * 3);
    expect(SCENES[2].layers.ghost).toBeLessThan(0.15);
    expect(SCENES[3].layers.ghost).toBeLessThan(SCENES[2].ghostLive ?? 1);
  });

  test('final transfer moves the same nodes: every cluster is rebalanced exactly once, none dropped', () => {
    const steps = SCENES[4].timed.filter((s) => s.kind === 'rebalance');
    const ids = steps.flatMap((s) => (s.kind === 'rebalance' ? s.ids ?? [] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(NODES.map((n) => n.id).sort());
    expect(SCENES[4].transfer).toBe(true);
  });
});
