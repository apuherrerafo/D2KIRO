import { describe, expect, test } from 'bun:test';
import { SCENES } from './fixtures';
import { SCENE_WEIGHTS, pinProgress, progressForScene, sceneForProgress } from './scroll-scene';

describe('memory scroll -> scene', () => {
  test('one weight per scene of the story', () => {
    expect(SCENE_WEIGHTS).toHaveLength(SCENES.length);
  });
  test('the scenes run in story order and never skip', () => {
    let last = 0;
    for (let i = 0; i <= 1000; i += 1) {
      const scene = sceneForProgress(i / 1000);
      expect(scene).toBeGreaterThanOrEqual(last);
      expect(scene - last).toBeLessThanOrEqual(1);
      last = scene;
    }
    expect(last).toBe(SCENES.length - 1);
  });
  test('the ends are clamped, garbage is scene 0', () => {
    expect(sceneForProgress(-3)).toBe(0);
    expect(sceneForProgress(9)).toBe(SCENES.length - 1);
    expect(sceneForProgress(Number.NaN)).toBe(0);
  });
  test('Match 24 owns the longest stretch of scroll', () => {
    expect(Math.max(...SCENE_WEIGHTS)).toBe(SCENE_WEIGHTS[2]);
  });
  test('a jump to a scene lands inside it', () => {
    for (let i = 0; i < SCENES.length; i += 1) expect(sceneForProgress(progressForScene(i))).toBe(i);
  });
  test('pin progress is 0 before the pin engages and 1 after it releases', () => {
    expect(pinProgress(300, 3000, 800, 56)).toBe(0);
    expect(pinProgress(56 - 2200, 3000, 800, 56)).toBe(1);
    expect(pinProgress(56 - 1100, 3000, 800, 56)).toBe(0.5);
    expect(pinProgress(0, 700, 800, 56)).toBe(0);
  });
});
