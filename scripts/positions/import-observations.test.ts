import { expect, test } from "bun:test";
import { buildObservations, locateMatchesColumn, normalizeName, PAGE_SCHEMA, type PositionPage } from "./import-observations";
import { parseHeroPositionObservations } from "../../apps/engine/src/signals/hero-positions";

// Inline fixtures only -- no page dump, no SQLite, no network.
const catalog = [{ id: 1, localizedName: "Anti-Mage" }, { id: 66, localizedName: "Chen" }, { id: 7, localizedName: "Earthshaker" }, { id: 99, localizedName: "Bristleback" }];
const page = (position: 1 | 2 | 3 | 4 | 5, rows: [string, string][], header: string[] | null = ["Hero", "Win rate", "Matches"]): PositionPage => ({
  schema: PAGE_SCHEMA, position, url: `https://example.invalid/meta?position=pos+${position}`, retrievedAt: `2026-09-2${position}T00:00:00.000Z`, tableHeader: header,
  rows: rows.map(([name, matches]) => ({ name, cells: [name, "51.2%", matches] })),
});
const pages = [
  page(1, [["Anti-Mage", "1,409"], ["Earthshaker", "2969"], ["Chen", "12"]]),
  page(2, [["Earthshaker", "199"]]),
  page(3, [["Earthshaker", "1,026"], ["Chen", "44"]]),
  page(4, []),
  page(5, [["Chen", "150"], ["Earthshaker", "199"]]),
];

test("conserva TODAS las observaciones, incluidas las bajo el piso, y no aplica ningún filtro", () => {
  const { file, report } = buildObservations(pages, catalog, 2);
  const earthshaker = file.heroes.find((h) => h.hero === 7)!;

  expect(earthshaker.observations).toEqual([{ position: 1, matches: 2969 }, { position: 2, matches: 199 }, { position: 3, matches: 1026 }, { position: 5, matches: 199 }]);
  expect(report.belowFloorRows).toBe(5); // Earthshaker 199 x2, Chen 12 / 44 / 150 -- counted, never dropped
  expect(file.provenance.admissionFloorNote).toContain("NOT applied");
});

test("el archivo generado alimenta al cargador del motor: denominador completo, piso aplicado después", () => {
  const { file } = buildObservations(pages, catalog, 2);
  const positions = parseHeroPositionObservations(JSON.parse(JSON.stringify(file)));

  expect(positions[7]!.map((s) => s.position)).toEqual([1, 3]);
  expect(positions[7]![0]!.heroTotalMatches).toBe(2969 + 199 + 1026 + 199);
});

test("Chen (todas las filas bajo el piso) queda observado pero SIN posición admitida; un héroe sin filas queda como no observado", () => {
  const { file, report } = buildObservations(pages, catalog, 2);

  expect(report.heroesBelowFloorEverywhere.map((h) => h.id)).toEqual([66]);
  expect(report.unobservedHeroes.map((h) => h.id)).toEqual([99]);
  expect(66 in parseHeroPositionObservations(file)).toBe(false);
});

test("nombres sin match, celdas no numéricas y filas duplicadas se REPORTAN, nunca se adivinan", () => {
  const dirty = [page(1, [["Nobody", "500"], ["Anti-Mage", "lots"], ["Earthshaker", "300"], ["Earthshaker", "301"]])];
  const { report } = buildObservations(dirty, catalog, 2);

  expect(report.unmatchedNames).toEqual([{ position: 1, name: "Nobody" }]);
  expect(report.unparseableRows).toEqual([{ position: 1, name: "Anti-Mage", cell: "lots" }]);
  expect(report.duplicateRows).toEqual([{ position: 1, name: "Earthshaker" }]);
});

test("determinista: misma entrada -> misma salida byte a byte, sin importar el orden de las páginas", () => {
  const a = JSON.stringify(buildObservations(pages, catalog, 2).file);
  const b = JSON.stringify(buildObservations([...pages].reverse(), [...catalog].reverse(), 2).file);

  expect(b).toBe(a);
});

test("la columna Matches se detecta del encabezado y falla cerrada si es ambigua o no está", () => {
  expect(locateMatchesColumn(pages, undefined)).toBe(2);
  expect(locateMatchesColumn([page(1, [], null)], 4)).toBe(4);
  expect(() => locateMatchesColumn([page(1, [], null)], undefined)).toThrow();
  expect(() => locateMatchesColumn([page(1, [], ["Hero", "Matches"]), page(2, [], ["Hero", "WR", "Matches"])], undefined)).toThrow();
  expect(normalizeName("Nature's Prophet")).toBe(normalizeName("natures prophet"));
});
