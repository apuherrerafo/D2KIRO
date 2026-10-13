import { describe, expect, test } from 'bun:test';
import { MemoryWorld } from './world';
import { SCENES } from './fixtures';
import { EXIT_DEADLINE_PROGRESS, HOLD_MS, LATE_PROGRESS, holdFor, mustSettle, paceFor } from './scroll-pace';
import { SCENE_WEIGHTS, sceneForProgress } from './scroll-scene';

const LAST = SCENES.length - 1;

/** Sim ms each scene takes to be `done` at 1x (the approved choreography). */
function sceneDurations(): number[] {
  const w = new MemoryWorld('narrow');
  return SCENES.map((_, k) => {
    w.loadScene(k);
    return w.runUntilDone();
  });
}
const DUR = sceneDurations();

/** One scroll gesture: move `px` over `ms`, then rest for `pauseMs`. */
interface Gesture { px: number; ms: number; pauseMs: number }

interface Trace { snapped: boolean; exitShown: number; exitRest: number; shownAtT: Array<[number, number, number]>; sceneStart: number[]; sceneEnd: number[] }

/** Deterministic model of MemorySection: scroll sets target, the sequencer advances with pace/hold. Exit = the deadline (before the release). */
function run(gestures: Gesture[], trackPx: number): Trace {
  const STEP = 10;
  let y = 0;
  let shown = 0;
  let sceneT = 0; // sim ms into the shown scene (at 1x)
  let holdLeft = -1;
  const sceneStart: number[] = [0];
  const sceneEnd: number[] = [];
  const shownAtT: Array<[number, number, number]> = [];
  let t = 0;
  let snapped = false;
  const queue = gestures.flatMap((g) => [
    ...Array.from({ length: Math.round(g.ms / STEP) }, () => g.px / (g.ms / STEP)),
    ...Array.from({ length: Math.round(g.pauseMs / STEP) }, () => 0),
  ]);
  const total = queue.length * STEP + 60000;
  for (let i = 0; t < total; i++, t += STEP) {
    y = Math.min(trackPx, y + (queue[i] ?? 0));
    const target = sceneForProgress(y / trackPx);
    if (mustSettle(shown, LAST, y / trackPx >= EXIT_DEADLINE_PROGRESS)) {
      snapped = true; shown = LAST; sceneT = DUR[LAST]; sceneStart[LAST] = t;
      shownAtT.push([t, target, shown]);
      break;
    }
    if (shown < target || (shown === target && shown <= LAST)) {
      const pace = paceFor(shown, target, LAST, y / trackPx >= LATE_PROGRESS);
      if (sceneT < DUR[shown]) sceneT += STEP * pace;
      if (sceneT >= DUR[shown] && shown < LAST) {
        if (holdLeft < 0) { holdLeft = holdFor(shown, target, false); sceneEnd[shown] = t; }
        holdLeft -= STEP;
        if (holdLeft <= 0 && target > shown) {
          shown += 1; sceneT = 0; holdLeft = -1; sceneStart[shown] = t;
        }
      }
    }
    shownAtT.push([t, target, shown]);
  }
  const last = shownAtT[shownAtT.length - 1];
  return { snapped, exitShown: last[2], exitRest: sceneT >= DUR[last[2]] ? 1 : 0, shownAtT, sceneStart, sceneEnd };
}

const steady = (pxPerS: number, seconds: number): Gesture[] => [{ px: pxPerS * seconds, ms: seconds * 1000, pauseMs: 0 }];
/** Wall-clock time Match 24 was the rendered scene. */
const peakMs = (tr: Trace) => tr.shownAtT.filter(([, , sh]) => sh === 2).length * 10;
const maxLag = (tr: Trace) => Math.max(...tr.shownAtT.map(([, tg, sh]) => tg - sh));

describe('memory pace', () => {
  test('in step with the scroll: 1x and the approved hold', () => {
    expect(paceFor(1, 1, LAST)).toBe(1);
    expect(holdFor(1, 1, false)).toBe(HOLD_MS);
  });
  test('behind the scroll: no hold, faster clock, growing with the backlog', () => {
    expect(holdFor(1, 2, false)).toBe(0);
    expect(paceFor(1, 2, LAST)).toBeGreaterThan(1);
    expect(paceFor(0, 3, LAST)).toBeGreaterThan(paceFor(1, 3, LAST));
  });
  test('Match 24 is never rushed below a legible time', () => {
    expect(DUR[2] / paceFor(2, 4, LAST)).toBeGreaterThanOrEqual(1300);
  });
  test('exit catch-up lifts the Match 24 ceiling; before it the ceiling holds', () => {
    expect(paceFor(2, 4, LAST, false)).toBeLessThanOrEqual(4.2);
    expect(paceFor(2, 4, LAST, true)).toBeGreaterThan(4.2);
    expect(mustSettle(2, LAST, true)).toBe(true);
    expect(mustSettle(LAST, LAST, true)).toBe(false);
    expect(mustSettle(2, LAST, false)).toBe(false);
  });
  test('the story needs more than the pin lasts at 1x (why the scroll must drive it)', () => {
    const total = DUR.reduce((a, b) => a + b, 0) + HOLD_MS * LAST;
    expect(total).toBeGreaterThan(15000);
    expect(SCENE_WEIGHTS).toHaveLength(SCENES.length);
  });
});

describe('memory playback keeps pace with scroll (deterministic profiles)', () => {
  // track length ~3.4 viewports of travel
  const DESKTOP = 3060;
  const MOBILE = 2870;

  test('A desktop calm 170px/s: final at exit, Match 24 plays at the approved pace', () => {
    const tr = run(steady(170, DESKTOP / 170), DESKTOP);
    expect(tr.snapped).toBe(false);
    expect(tr.exitShown).toBe(LAST);
    expect(maxLag(tr)).toBeLessThanOrEqual(1);
    // Match 24 played in full (at 1x) when in step
    expect(tr.sceneEnd[2] - tr.sceneStart[2]).toBeGreaterThanOrEqual(DUR[2] * 0.6);
  });

  test('B mobile calm 210px/s with short pauses: Match 24 seen, 56 reached, final settled before release', () => {
    const g: Gesture[] = Array.from({ length: 12 }, () => ({ px: 210, ms: 1000, pauseMs: 0 })).flatMap((s, i) => (i % 3 === 2 ? [s, { px: 0, ms: 400, pauseMs: 0 }] : [s]));
    const tr = run(g, MOBILE);
    expect(tr.snapped).toBe(false);
    expect(tr.exitShown).toBe(LAST);
    expect(tr.exitRest).toBe(1);
    expect(maxLag(tr)).toBeLessThanOrEqual(2);
    expect(peakMs(tr)).toBeGreaterThanOrEqual(1300);
  });

  test('C mobile flicks 1.3vh with pauses: never leaves Match 08 behind; final shown before the release', () => {
    const flick: Gesture = { px: 1100, ms: 450, pauseMs: 900 };
    const tr = run([flick, flick, flick], MOBILE);
    expect(tr.exitShown).toBe(LAST);
    expect(tr.snapped || tr.exitShown === LAST).toBe(true);
    expect(peakMs(tr)).toBeGreaterThanOrEqual(500);
    // monotone, forward only
    let prev = 0;
    for (const [, , sh] of tr.shownAtT) { expect(sh).toBeGreaterThanOrEqual(prev); prev = sh; }
  });

  test('D fast desktop skim 1400px/s: catches up quickly instead of spending many seconds behind', () => {
    const tr = run(steady(1400, DESKTOP / 1400), DESKTOP);
    expect(tr.exitShown).toBe(LAST);
    // the backlog never lasts: scenes behind by >=2 for a bounded time only
    const behind2 = tr.shownAtT.filter(([, tg, sh]) => tg - sh >= 2).length * 10;
    expect(behind2).toBeLessThan(2500);
  });
});
