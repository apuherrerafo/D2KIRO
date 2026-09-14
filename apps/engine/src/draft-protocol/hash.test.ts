import { describe, expect, test } from "bun:test";
import * as hashModule from "./hash";
import * as identityHashModule from "./identity-hash";
import { rulesHash } from "./identity-hash";

type HashModuleExports = typeof import("./hash");
// @ts-expect-error -- compile-time boundary: generic hash primitive must remain absent
type NoCanonicalHashExport = HashModuleExports["canonicalHash"];
// @ts-expect-error -- compile-time boundary: generic identity primitive must remain absent
type NoFunctionalIdentityHashExport = HashModuleExports["functionalIdentityHash"];

describe("named hash API", () => {
  test("rulesHash is canonical, deterministic, and content-sensitive", () => {
    const a = rulesHash({ id: "dota2/ranked-all-pick", version: "1.0.0", rounds: [1, 2, 3] });
    const b = rulesHash({ rounds: [1, 2, 3], version: "1.0.0", id: "dota2/ranked-all-pick" });
    expect(a).toBe(b);
    expect(a).not.toBe(rulesHash({ id: "dota2/captains-mode" }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("named APIs preserve fail-closed canonicalization", () => {
    expect(() => rulesHash({ heroId: NaN })).toThrow();
    expect(() => rulesHash({ heroId: Infinity })).toThrow();
    expect(() => rulesHash({ value: undefined } as never)).toThrow();
  });

  test("the deep-importable hash module exposes no generic primitives", () => {
    expect(Object.keys(hashModule)).toEqual([]);
    expect(Object.keys(identityHashModule).sort()).toEqual([
      "authoritativeStateHash",
      "eligibilityHash",
      "perspectiveStateHash",
      "rulesHash",
    ]);
  });
});
