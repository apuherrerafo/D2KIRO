import { expect, test } from "bun:test";
import { type DraftCandidate, loadDraftCorpus, parseDraftCorpus } from "./corpus";

// Smoke test contra el archivo real -- estructural, no de contenido (mismo criterio S9/S10,
// testing-seams.md): el seed es un dato incompleto a propósito (ver corpus.ts), un test atado a
// un draftId puntual se rompería en silencio al ampliar el corpus.
test("loadDraftCorpus() carga el archivo real: entradas válidas, sin draftId duplicado", () => {
  const corpus = loadDraftCorpus();
  const draftIds = corpus.map((d) => d.draftId);

  expect(corpus.length).toBeGreaterThan(0);
  expect(new Set(draftIds).size).toBe(draftIds.length);
  for (const draft of corpus) {
    expect(draft.radiantHeroes).toHaveLength(5);
    expect(draft.direHeroes).toHaveLength(5);
    expect(["radiant", "dire"]).toContain(draft.winningSide);
  }
});

// El resto de los casos usa parseDraftCorpus con fixtures sintéticos -- nunca el archivo real:
// la lógica de validación no puede depender de qué drafts existan hoy en el corpus curado.

test("parseDraftCorpus descarta entradas inválidas sin lanzar y conserva las válidas", () => {
  const valid: DraftCandidate = {
    draftId: "d1",
    patch: "7.35d",
    radiantHeroes: [1, 2, 3, 4, 5],
    direHeroes: [6, 7, 8, 9, 10],
    winningSide: "radiant",
  };
  const raw = [
    valid,
    { ...valid, draftId: "d2", radiantHeroes: [1, 2, 3, 4] }, // menos de 5 héroes
    { ...valid, draftId: "d3", radiantHeroes: [1, 2, 3, 4, 4] }, // héroe repetido
    { ...valid, draftId: "d4", direHeroes: [6, 7, 8, 9, -1] }, // heroId inválido
    { ...valid, draftId: "d5", winningSide: "elsewhere" }, // side inválido
    { ...valid, draftId: "" }, // draftId vacío
    { ...valid, patch: "" }, // patch vacío
    "not an object",
    null,
    42,
    {},
  ];

  const result = parseDraftCorpus(raw);

  expect(result).toEqual([valid]);
});

test("parseDraftCorpus descarta draftId duplicado (conserva la primera aparición)", () => {
  const first: DraftCandidate = {
    draftId: "dup",
    patch: "7.35d",
    radiantHeroes: [1, 2, 3, 4, 5],
    direHeroes: [6, 7, 8, 9, 10],
    winningSide: "radiant",
  };
  const second = { ...first, direHeroes: [11, 12, 13, 14, 15] };

  const result = parseDraftCorpus([first, second]);

  expect(result).toEqual([first]);
});

test("parseDraftCorpus con el archivo entero corrupto devuelve [] sin lanzar", () => {
  expect(parseDraftCorpus(null)).toEqual([]);
  expect(parseDraftCorpus(undefined)).toEqual([]);
  expect(parseDraftCorpus("not an array")).toEqual([]);
  expect(parseDraftCorpus({ draftId: "d1" })).toEqual([]);
  expect(parseDraftCorpus(42)).toEqual([]);
});
