import { describe, expect, test } from "bun:test";
import { parseProductionParams } from "./production-params";

describe("production lab params", () => {
  test("defaults: all three panels, dark, DPR cap 2", () => {
    expect(parseProductionParams({})).toEqual({ panels: ["live", "384", "512"], theme: "dark", timeoutMs: undefined, maxDpr: 2 });
  });
  test("panel lists keep canonical order and drop unknown values", () => {
    expect(parseProductionParams({ panels: "512,live,evil" }).panels).toEqual(["live", "512"]);
    expect(parseProductionParams({ panels: "nope" }).panels).toEqual(["live", "384", "512"]);
  });
  test("theme / timeout / maxdpr are clamped", () => {
    const p = parseProductionParams({ theme: "light", timeout: "900", maxdpr: "3" });
    expect(p).toMatchObject({ theme: "light", timeoutMs: 900, maxDpr: 3 });
    expect(parseProductionParams({ timeout: "5", maxdpr: "9" })).toMatchObject({ timeoutMs: undefined, maxDpr: 2 });
  });
});
