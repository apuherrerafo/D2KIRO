import { afterEach, expect, test } from "bun:test";
import { loadMetaSnapshot } from "../meta-loader";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetch(heroes: unknown[], patchStats: Record<string, unknown[]>, currentPatch?: string): void {
  global.fetch = (async (url: string) => {
    if (url.includes("/api/heroes")) return new Response(JSON.stringify(heroes));
    if (url.includes("/api/meta/hero-stats")) return new Response(JSON.stringify({ patchStats, currentPatch }));
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

test("loadMetaSnapshot ignora filas con patch vacío aunque empaten en cantidad (base de producción con restos de la sync vieja)", async () => {
  // Producción tenía 1016 filas con patch "" (sync antigua) y 1016 con "7.41e": el empate hacía ganar a "" y el
  // motor rechazaba el draft con 400 (patch vacío). El patch vacío nunca es un parche real.
  mockFetch(
    [{ id: 1, localizedName: "Hero Uno", roles: ["Carry"] }],
    {
      "1": [
        { patch: "", bracket: "all", picks: 900, wins: 450 },
        { patch: "7.41e", bracket: "all", picks: 800, wins: 400 },
      ],
    },
  );

  const result = await loadMetaSnapshot();

  expect(result.currentPatch).toBe("7.41e");
});

test("loadMetaSnapshot retorna 'unknown' si todos los patch son vacíos o solo espacios", async () => {
  mockFetch(
    [{ id: 1, localizedName: "Hero Uno", roles: [] }],
    { "1": [{ patch: "", bracket: "all", picks: 10, wins: 5 }, { patch: "   ", bracket: "all", picks: 10, wins: 5 }] },
  );

  const result = await loadMetaSnapshot();

  expect(result.currentPatch).toBe("unknown");
});

test("loadMetaSnapshot retorna currentPatch:'unknown' sin patchStats", async () => {
  mockFetch([{ id: 1, localizedName: "Hero Uno", roles: [] }], {});

  const result = await loadMetaSnapshot();

  expect(result.currentPatch).toBe("unknown");
  expect(result.metaBanPool).toEqual([1]);
});

test("metaBanPool ordena por picks de UN solo parche: los restos con patch vacío no cuentan", async () => {
  // Antes se sumaban todas las filas: el héroe 1 (restos de 9000 picks) quedaba primero aunque en 7.41e tenga 100.
  mockFetch(
    [
      { id: 1, localizedName: "Resto viejo", roles: ["Carry"] },
      { id: 2, localizedName: "Meta actual", roles: ["Support"] },
    ],
    {
      "1": [
        { patch: "", bracket: "all", picks: 9000, wins: 4500 },
        { patch: "7.41e", bracket: "all", picks: 100, wins: 50 },
      ],
      "2": [
        { patch: "", bracket: "all", picks: 10, wins: 5 },
        { patch: "7.41e", bracket: "all", picks: 500, wins: 250 },
      ],
    },
  );

  const result = await loadMetaSnapshot();

  expect(result.currentPatch).toBe("7.41e");
  expect(result.metaBanPool).toEqual([2, 1]);
  expect(result.meta.currentPatch).toBe("7.41e");
});

test("usa el currentPatch que informa el motor aunque otro parche domine por conteo (misma regla que el motor)", async () => {
  mockFetch(
    [{ id: 1, localizedName: "Hero Uno", roles: ["Carry"] }, { id: 2, localizedName: "Hero Dos", roles: ["Support"] }],
    {
      "1": [{ patch: "7.40", bracket: "all", picks: 900, wins: 450 }, { patch: "7.40", bracket: "other", picks: 900, wins: 450 }],
      "2": [{ patch: "7.40", bracket: "all", picks: 10, wins: 5 }, { patch: "7.41e", bracket: "all", picks: 20, wins: 10 }],
    },
    "7.41e",
  );
  const result = await loadMetaSnapshot();
  expect(result.currentPatch).toBe("7.41e");
  expect(result.meta.currentPatch).toBe("7.41e");
  expect(result.metaBanPool).toEqual([2, 1]); // sólo cuentan los picks de 7.41e (héroe 1 tiene 0)
});
