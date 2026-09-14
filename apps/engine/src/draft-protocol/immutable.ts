// R1 S1 -- Blocker 2 (independent architecture review): immutability / anti-aliasing primitives.
// No new library (Immer et al.) -- plain node:structuredClone + Object.freeze is sufficient for
// this module's size and gives a hard runtime guarantee (a frozen object throws in strict mode --
// every ES module is strict by default -- on an attempted mutation, rather than silently
// succeeding and corrupting shared state).

/**
 * Deep, independent structural copy. Used at every trust boundary where the kernel accepts a
 * caller-owned value (a command, an eligibility snapshot) that must never alias the caller's own
 * object -- otherwise a caller mutating their own reference after acceptance would silently
 * corrupt canonical state/eventLog/replay output.
 */
export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Recursively freezes an object graph. Applied to every DraftProtocolState / PerspectiveDraftView
 * returned to a caller so that, even after deepClone has already made it independent of the
 * caller's own objects, no one (including internal code, by accident) can mutate the kernel's own
 * copies in place either.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
