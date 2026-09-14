import { createHash } from "node:crypto";

// R1 S1 (protocol kernel): canonical hashing primitive. Reuses the exact idiom already
// established in scripts/eval/snapshot.ts (node:crypto sha256, hex digest, hash over *logical*
// content, never a file/commit SHA) -- that file cannot be imported from apps/ (scripts/eval is
// offline-only, invariantes.md), so this is a necessary in-apps copy of the same discipline, not a
// second scheme. Unlike snapshot.ts (which hand-enumerates fields and relies on JS insertion
// order), this adds a real canonical-JSON step (recursive key sort) because the kernel hashes
// nested, ruleset-shaped structures where insertion order is not a safe invariant to lean on.

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

/**
 * Blocker 5 (R1 S1 independent review): canonicalStringify must produce ONLY canonical valid
 * JSON. undefined/NaN/Infinity/-Infinity are explicitly rejected rather than silently coerced --
 * JSON.stringify(NaN) === "null" and JSON.stringify(undefined) is the JS value undefined (which,
 * interpolated into a template literal, becomes the literal text "undefined", not valid JSON).
 * Either failure mode would silently corrupt canonical identity/hashing. `value: CanonicalValue`
 * excludes undefined/NaN at the TYPE level, but every real caller in this module reaches this
 * function via an `as unknown as CanonicalValue` cast on a live DraftProtocolState/
 * PerspectiveDraftView -- the type system cannot prove the object is actually clean, so this check
 * has to be a real runtime guard, not a type-level one.
 */
export class CanonicalizationError extends Error {}

/**
 * Stable JSON stringify: object keys sorted recursively so structurally identical inputs always
 * produce byte-identical output regardless of construction order. Arrays keep their order --
 * order is semantic for arrays (e.g. the CM 24-step sequence, event logs).
 */
export function canonicalStringify(value: CanonicalValue): string {
  if (value === undefined) {
    throw new CanonicalizationError("undefined is not valid canonical JSON");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new CanonicalizationError(`non-finite number (${value}) is not valid canonical JSON`);
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalStringify(entryValue as CanonicalValue)}`);
  return `{${entries.join(",")}}`;
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function canonicalHash(value: CanonicalValue): string {
  return sha256Hex(canonicalStringify(value));
}

/**
 * Fields that must never enter a functional-identity hash: wall-clock timestamps, measured
 * durations, and session/transport identifiers. Two authoritative states built from the same
 * canonical inputs (ruleset + initial config + events) must hash identically even if they were
 * produced at different wall-clock moments or over different transport sessions -- this is the
 * literal "hidden twin" / replay-determinism requirement.
 */
const FUNCTIONAL_IDENTITY_EXCLUDED_KEYS = new Set([
  "timestamp",
  "emittedAt",
  "sentAt",
  "updatedAt",
  "turnStartedAt",
  "duration",
  "durationMs",
  "computedInMs",
  "sessionId",
  "transportId",
  "connectionId",
]);

function stripFunctionalNoise(value: CanonicalValue): CanonicalValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripFunctionalNoise);
  const out: { [key: string]: CanonicalValue } = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (FUNCTIONAL_IDENTITY_EXCLUDED_KEYS.has(key)) continue;
    out[key] = stripFunctionalNoise(entryValue);
  }
  return out;
}

/**
 * Hash used for cross-state comparability (hidden twin equality, replay-determinism): strips
 * timestamps/durations/transport ids before hashing, so functional identity survives wall-clock
 * and transport differences.
 */
export function functionalIdentityHash(value: CanonicalValue): string {
  return canonicalHash(stripFunctionalNoise(value));
}
