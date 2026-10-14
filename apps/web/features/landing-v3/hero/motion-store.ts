/* LANDING V3 · whether the visitor paused the Hero's motion. One tiny external store: the toggle in the product card and the Hero
   stage (a separate island) both read it, with no context needed between them. */
let paused = false;
const listeners = new Set<() => void>();

export const motionStore = {
  get: (): boolean => paused,
  set: (next: boolean): void => {
    if (next === paused) return;
    paused = next;
    listeners.forEach((listener) => listener());
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
