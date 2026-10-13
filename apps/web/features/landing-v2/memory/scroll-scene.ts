/* LANDING V2 · MEMORY · scroll progress -> the scene that should be on screen. Pure, so it is unit-tested; the graph itself
   stays deterministic because the scroll only chooses WHICH scene plays, never how it plays. */

/** Scroll share each scene owns. Match 24 is the peak, so it holds the longest. */
export const SCENE_WEIGHTS: readonly number[] = [1, 1, 1.4, 1, 1.1];

export function sceneForProgress(progress: number, weights: readonly number[] = SCENE_WEIGHTS): number {
  const total = weights.reduce((a, b) => a + b, 0);
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0)) * total;
  let edge = 0;
  for (let i = 0; i < weights.length; i += 1) {
    edge += weights[i];
    if (p < edge) return i;
  }
  return weights.length - 1;
}

/** Scroll progress through a pinned track: 0 when the pin engages, 1 when it releases. */
export function pinProgress(trackTop: number, trackHeight: number, pinHeight: number, pinTop: number): number {
  const travel = trackHeight - pinHeight;
  if (travel <= 0) return 0;
  return Math.min(1, Math.max(0, (pinTop - trackTop) / travel));
}

/** First scroll progress at which scene `scene` is current (for jump links and review captures). */
export function progressForScene(scene: number, weights: readonly number[] = SCENE_WEIGHTS): number {
  const total = weights.reduce((a, b) => a + b, 0);
  const before = weights.slice(0, scene).reduce((a, b) => a + b, 0);
  return (before + weights[scene] * 0.5) / total;
}
