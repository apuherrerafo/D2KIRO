import { afterEach, expect, test } from "bun:test";
import { loadMetaSnapshot } from "../meta-loader";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetch(heroes: unknown[], patchStats: Record<string, unknown[]>): void {
  global.fetch = (async (url: string) => {
    if (url.includes("/api/heroes")) return new Response(JSON.stringify(heroes));
    if (url.includes("/api/meta/hero-stats")) return new Response(JSON.stringify({ patchStats }));
    throw new Error(`unexpected url: ${url}`);
  }) as typeof fetch;
}

test("loadMetaSnapshot arma MetaSnapshot, metaBanPool (pick rate desc) y currentPatch", async () => {
  mockFetch(
    [
      { id: 1, localizedName: "Hero Uno", roles: ["Carry"] },
      { id: 2, localizedName: "Hero Dos", roles: ["Support"] },
      { id: 3, localizedName: "Hero Tres", roles: ["Mid"] },
    ],
    {
      "1": [{ patch: "7.37d", bracket: "all", picks: 100, wins: 40 }],
      "2": [{ patch: "7.37d", bracket: "all", picks: 500, wins: 260 }],
      // héroe 3 sin patchStats -- 0 picks, debe quedar último en metaBanPool
    },
  );

  const result = await loadMetaSnapshot();

  expect(result.allHeroIds).toEqual([1, 2, 3]);
  expect(result.metaBanPool).toEqual([2, 1, 3]); // desc por picks: 500, 100, 0
  expect(result.currentPatch).toBe("7.37d");
  expect(result.meta.heroes[1]).toEqual({ id: 1, localizedName: "Hero Uno", roles: ["Carry"] });
  expect(result.meta.patchStats?.[2]).toEqual([{ patch: "7.37d", bracket: "all", picks: 500, wins: 260 }]);
});

test("loadMetaSnapshot retorna currentPatch:'unknown' sin patchStats", async () => {
  mockFetch([{ id: 1, localizedName: "Hero Uno", roles: [] }], {});

  const result = await loadMetaSnapshot();

  expect(result.currentPatch).toBe("unknown");
  expect(result.metaBanPool).toEqual([1]);
});
