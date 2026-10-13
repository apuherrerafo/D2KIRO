import { describe, expect, test } from 'bun:test';
import { AimStabilizer, RECONSTRUCT, allStillUrls, quantizeAim, reconstructFrame, stillUrl, toRenderState } from './coach-renderer';
import { beamAllowed } from './coach-state';

describe('quantizeAim', () => {
  test('dead zone is center', () => {
    expect(quantizeAim(0, 0)).toBe('center');
    expect(quantizeAim(0.1, -0.1)).toBe('center');
  });
  test('eight-way sectors fold onto the seven frames', () => {
    expect(quantizeAim(-1, 0)).toBe('left');
    expect(quantizeAim(1, 0)).toBe('right');
    expect(quantizeAim(-0.8, 0.6)).toBe('left-up');
    expect(quantizeAim(0.8, -0.6)).toBe('right-down');
    expect(quantizeAim(-0.9, -0.5)).toBe('left-down');
  });
  test('straight up/down tips to the side of the vector', () => {
    expect(quantizeAim(-0.1, 0.9)).toBe('left-up');
    expect(quantizeAim(0.1, -0.9)).toBe('right-down');
  });
});

describe('memory pack addressing', () => {
  test('stills come from the memory set only', () => {
    expect(stillUrl({ state: 'confirming', aim: 'right-up' })).toBe('/coach-web-pack/memory/confirming-ru.webp');
    const urls = allStillUrls();
    expect(urls).toHaveLength(28);
    expect(new Set(urls).size).toBe(28);
    expect(urls.every((u) => u.startsWith('/coach-web-pack/memory/'))).toBe(true);
  });
  test('reconstruct frames are clamped to the sheet', () => {
    expect(reconstructFrame(-5)).toBe(0);
    expect(reconstructFrame(RECONSTRUCT.durationMs * 2)).toBe(RECONSTRUCT.frames - 1);
  });
  test('uncertain reads as watching; only reading states may point', () => {
    expect(toRenderState('uncertain')).toBe('watching');
    expect(beamAllowed('uncertain')).toBe(false);
    expect(beamAllowed('analyzing')).toBe(true);
  });
});

describe('AimStabilizer', () => {
  test('a new direction must hold before it is adopted; reduced motion is immediate', () => {
    const a = new AimStabilizer(160);
    expect(a.next('left', 0, false)).toBe('center');
    expect(a.next('left', 100, false)).toBe('center');
    expect(a.next('left', 200, false)).toBe('left');
    expect(a.next('right', 210, true)).toBe('right');
  });
});
