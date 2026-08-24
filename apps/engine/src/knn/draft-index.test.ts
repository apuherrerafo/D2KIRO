import { describe, expect, test } from "bun:test";
import type { DraftCandidate } from "./corpus";
import { buildDraftIndex, popcount } from "./draft-index";

// Fixture a mano, nunca el corpus real (mismo criterio S9/S10, testing-seams.md): la lógica de
// intersección bitwise no puede depender de qué drafts existan hoy en pro-draft-corpus.json.
const FIXTURE_CORPUS: DraftCandidate[] = [
  // draft 0 -- héroes 1 y 6 en juego
  {
    draftId: "f0",
    patch: "7.35d",
    radiantHeroes: [1, 2, 3, 4, 5],
    direHeroes: [6, 7, 8, 9, 10],
    winningSide: "radiant",
  },
  // draft 1 -- héroes 11 y 16
  {
    draftId: "f1",
    patch: "7.35d",
    radiantHeroes: [11, 12, 13, 14, 15],
    direHeroes: [16, 17, 18, 19, 20],
    winningSide: "dire",
  },
  // draft 2 -- repite 1 y 6 (comparte con draft 0)
  {
    draftId: "f2",
    patch: "7.35d",
    radiantHeroes: [1, 21, 22, 23, 24],
    direHeroes: [6, 25, 26, 27, 28],
    winningSide: "radiant",
  },
  // draft 3 -- repite 1, 6, 11 y 16 (comparte con los tres anteriores)
  {
    draftId: "f3",
    patch: "7.35d",
    radiantHeroes: [1, 11, 29, 30, 31],
    direHeroes: [16, 6, 32, 33, 34],
    winningSide: "dire",
  },
  // draft 4 -- sin overlap con ningún otro
  {
    draftId: "f4",
    patch: "7.35d",
    radiantHeroes: [35, 36, 37, 38, 39],
    direHeroes: [40, 41, 42, 43, 44],
    winningSide: "radiant",
  },
];

describe("buildDraftIndex -- metadata y postings", () => {
  test("corpusSize y patch reflejan el corpus de entrada", () => {
    const index = buildDraftIndex(FIXTURE_CORPUS, "7.35d");

    expect(index.corpusSize).toBe(5);
    expect(index.patch).toBe("7.35d");
  });

  test("postings marca el bit del draft correcto para cada héroe, sin importar el lado", () => {
    const index = buildDraftIndex(FIXTURE_CORPUS, "7.35d");

    // héroe 1 aparece (radiant) en los drafts 0, 2 y 3 -> bits 0,2,3 -> palabra 0b1101 = 13
    expect(index.postings.get(1)?.[0]).toBe(0b1101);
    // héroe 6 aparece (dire) en los mismos tres drafts -- confirma que no importa el lado
    expect(index.postings.get(6)?.[0]).toBe(0b1101);
    // héroe 11 aparece en drafts 1 y 3 -> bits 1,3 -> palabra 0b1010 = 10
    expect(index.postings.get(11)?.[0]).toBe(0b1010);
    // héroe 35 aparece solo en draft 4 -> bit 4 -> palabra 0b10000 = 16
    expect(index.postings.get(35)?.[0]).toBe(0b10000);
  });

  test("un héroe fuera del corpus no tiene entrada en postings", () => {
    const index = buildDraftIndex(FIXTURE_CORPUS, "7.35d");

    expect(index.postings.has(999)).toBe(false);
  });
});

describe("candidatesFor -- intersección bitwise", () => {
  test("partialDraft vacío devuelve el corpus completo, en orden original", () => {
    const index = buildDraftIndex(FIXTURE_CORPUS, "7.35d");

    expect(index.candidatesFor([])).toEqual(FIXTURE_CORPUS);
  });

  test("un solo héroe devuelve todos los drafts que lo contienen, en orden original", () => {
    const index = buildDraftIndex(FIXTURE_CORPUS, "7.35d");

    const result = index.candidatesFor([1]);

    expect(result.map((d) => d.draftId)).toEqual(["f0", "f2", "f3"]);
  });

  test("varios héroes intersectan -- solo el draft que tiene a todos", () => {
    const index = buildDraftIndex(FIXTURE_CORPUS, "7.35d");

    const result = index.candidatesFor([1, 11]);

    expect(result.map((d) => d.draftId)).toEqual(["f3"]);
  });

  test("un héroe ausente del corpus produce intersección vacía, sin lanzar", () => {
    const index = buildDraftIndex(FIXTURE_CORPUS, "7.35d");

    expect(index.candidatesFor([999])).toEqual([]);
    expect(index.candidatesFor([1, 999])).toEqual([]);
  });

  test("corpus vacío nunca lanza -- candidatesFor siempre devuelve []", () => {
    const index = buildDraftIndex([], "7.35d");

    expect(index.corpusSize).toBe(0);
    expect(index.candidatesFor([1])).toEqual([]);
    expect(index.candidatesFor([])).toEqual([]);
  });

  test("intersección cruza el límite de una palabra de 32 bits", () => {
    // 40 drafts sintéticos -- el héroe 555 vive únicamente en el draft 35 (palabra 1, bit 3),
    // fuera de la primera palabra de 32 bits. Verifica que la extracción de bits no se quede
    // atada a la primera palabra del Uint32Array.
    const bigCorpus: DraftCandidate[] = Array.from({ length: 40 }, (_, i) => ({
      draftId: `big-${i}`,
      patch: "7.35d",
      radiantHeroes: i === 35 ? [555, 501, 502, 503, 504] : [500, 501, 502, 503, 504],
      direHeroes: [600, 601, 602, 603, 604],
      winningSide: "radiant" as const,
    }));

    const index = buildDraftIndex(bigCorpus, "7.35d");

    expect(index.postings.get(555)?.length).toBeGreaterThan(1); // más de una palabra de 32 bits
    expect(index.candidatesFor([555]).map((d) => d.draftId)).toEqual(["big-35"]);
    // héroe 600 vive en los 40 drafts -- confirma que la palabra 1 también se recorre bien
    expect(index.candidatesFor([600]).length).toBe(40);
  });
});

describe("popcount -- Kernighan, aislado", () => {
  test("cuenta bits encendidos en casos conocidos", () => {
    expect(popcount(0)).toBe(0);
    expect(popcount(1)).toBe(1);
    expect(popcount(0b1011)).toBe(3);
    expect(popcount(0xffffffff)).toBe(32);
  });

  test("trata la palabra como 32 bits sin signo (bit más alto no cuenta como negativo)", () => {
    expect(popcount(0x80000000)).toBe(1);
  });
});
