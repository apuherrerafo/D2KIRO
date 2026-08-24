import { describe, expect, test } from "bun:test";
import type { DraftCandidate } from "./corpus";
import { buildDraftIndex } from "./draft-index";
import { createJaccardEngine, defaultJaccardWeights, similarity } from "./jaccard";
import type { JaccardWeights } from "./jaccard";
import type { HeroPositions } from "../signals/hero-positions";

// Fixtures a mano, nunca el corpus/hero-positions real (S9/S10, testing-seams.md): el cálculo de
// similarity no puede depender de qué drafts o qué meta existan hoy.

const NEUTRAL_WEIGHTS: JaccardWeights = {
  alphaRole: () => 1,
  betaHero: () => 1,
  gammaSide: () => 1,
};

const CANDIDATE: DraftCandidate = {
  draftId: "c1",
  patch: "7.35d",
  radiantHeroes: [1, 2, 3, 4, 5],
  direHeroes: [6, 7, 8, 9, 10],
  winningSide: "radiant",
};

describe("similarity -- Jaccard ponderado contra el lado ganador", () => {
  test("calcula el número exacto con pesos neutros: intersección 2, unión 6", () => {
    // own=[1,2,6]: 1 y 2 están en el lado ganador {1..5}; 6 está en el lado perdedor.
    const sim = similarity([1, 2, 6], CANDIDATE, NEUTRAL_WEIGHTS);
    expect(sim).toBeCloseTo(2 / 6, 10);
  });

  test("own idéntico al lado ganador -> similarity 1", () => {
    const sim = similarity([1, 2, 3, 4, 5], CANDIDATE, NEUTRAL_WEIGHTS);
    expect(sim).toBeCloseTo(1, 10);
  });

  test("own sin overlap con el lado ganador -> similarity 0", () => {
    const sim = similarity([50, 51, 52], CANDIDATE, NEUTRAL_WEIGHTS);
    expect(sim).toBe(0);
  });

  test("pesos no neutros cambian el número calculado (alphaRole/gammaSide sí influyen)", () => {
    const weights: JaccardWeights = {
      alphaRole: (heroId) => (heroId === 1 ? 2 : 1),
      betaHero: () => 1,
      gammaSide: (side) => (side === "radiant" ? 1 : 0.5),
    };
    // union {1,2,3,4,5,6} pesos [2,1,1,1,1,1] = 7; intersección {1,2} pesos [2,1] = 3
    const sim = similarity([1, 2, 6], CANDIDATE, weights);
    expect(sim).toBeCloseTo(3 / 7, 10);
  });
});

describe("createJaccardEngine -- nearestNeighbors", () => {
  const CORPUS: DraftCandidate[] = [
    {
      draftId: "n1",
      patch: "7.35d",
      radiantHeroes: [1, 2, 3, 4, 5],
      direHeroes: [10, 11, 12, 13, 14],
      winningSide: "radiant",
    }, // sim(own=[1,2,3]) = 3/5 = 0.6
    {
      draftId: "n2",
      patch: "7.35d",
      radiantHeroes: [20, 21, 22, 23, 24],
      direHeroes: [1, 2, 25, 26, 27],
      winningSide: "dire",
    }, // sim(own=[1,2,3]) = 2/6 ~= 0.333
    {
      draftId: "n3",
      patch: "7.35d",
      radiantHeroes: [30, 31, 32, 33, 34],
      direHeroes: [35, 36, 37, 38, 39],
      winningSide: "radiant",
    }, // sim(own=[1,2,3]) = 0
  ];

  test("ordena descendente por similarity y respeta k", () => {
    const engine = createJaccardEngine(buildDraftIndex(CORPUS, "7.35d"));
    const result = engine.nearestNeighbors([1, 2, 3], 2, NEUTRAL_WEIGHTS);

    expect(result.map((r) => r.candidate.draftId)).toEqual(["n1", "n2"]);
    expect(result[0]?.sim).toBeCloseTo(0.6, 10);
    expect(result[1]?.sim).toBeCloseTo(2 / 6, 10);
  });

  test("k mayor al tamaño del corpus devuelve todo, ordenado", () => {
    const engine = createJaccardEngine(buildDraftIndex(CORPUS, "7.35d"));
    const result = engine.nearestNeighbors([1, 2, 3], 99, NEUTRAL_WEIGHTS);

    expect(result.map((r) => r.candidate.draftId)).toEqual(["n1", "n2", "n3"]);
  });

  test("k=0 devuelve []", () => {
    const engine = createJaccardEngine(buildDraftIndex(CORPUS, "7.35d"));
    expect(engine.nearestNeighbors([1, 2, 3], 0, NEUTRAL_WEIGHTS)).toEqual([]);
  });

  test("cambiar los pesos cambia el orden del ranking, no solo el número", () => {
    // Mismo tipo de hallazgo que TSK-036: un ranking fijo que ignore los pesos pasaría un test
    // ingenuo de un solo escenario. Acá dos drafts empatan bajo pesos neutros y se separan al
    // ponderar un héroe específico más alto.
    const tiedCorpus: DraftCandidate[] = [
      {
        draftId: "w1",
        patch: "7.35d",
        radiantHeroes: [1, 100, 101, 102, 103],
        direHeroes: [900, 901, 902, 903, 904],
        winningSide: "radiant",
      },
      {
        draftId: "w2",
        patch: "7.35d",
        radiantHeroes: [2, 200, 201, 202, 203],
        direHeroes: [900, 901, 902, 903, 904],
        winningSide: "radiant",
      },
    ];
    const engine = createJaccardEngine(buildDraftIndex(tiedCorpus, "7.35d"));
    const own = [1, 2];

    const neutral = engine.nearestNeighbors(own, 2, NEUTRAL_WEIGHTS);
    expect(neutral[0]?.sim).toBeCloseTo(neutral[1]?.sim ?? -1, 10); // empate bajo pesos neutros

    const boostHero1: JaccardWeights = {
      alphaRole: (heroId) => (heroId === 1 ? 5 : 1),
      betaHero: () => 1,
      gammaSide: () => 1,
    };
    const boosted = engine.nearestNeighbors(own, 2, boostHero1);
    expect(boosted.map((r) => r.candidate.draftId)).toEqual(["w1", "w2"]);
    expect(boosted[0]?.sim).toBeGreaterThan(boosted[1]?.sim ?? 1);
  });
});

describe("defaultJaccardWeights -- reutiliza HeroPositions (S10)", () => {
  const FIXTURE_POSITIONS: HeroPositions = {
    1: [
      { position: 1, matches: 800 },
      { position: 2, matches: 200 },
    ],
    2: [{ position: 5, matches: 500 }],
  };

  test("alphaRole devuelve la proporción real de partidas del héroe en esa posición", () => {
    const weights = defaultJaccardWeights(FIXTURE_POSITIONS);

    expect(weights.alphaRole(1, 1)).toBeCloseTo(800 / 1000, 10);
    expect(weights.alphaRole(1, 2)).toBeCloseTo(200 / 1000, 10);
    expect(weights.alphaRole(1, 3)).toBe(0); // sin partidas en esa posición
  });

  test("héroe sin datos de posición -> peso neutro (1), nunca penaliza un hueco de dato", () => {
    const weights = defaultJaccardWeights(FIXTURE_POSITIONS);
    expect(weights.alphaRole(999, 1)).toBe(1);
  });

  test("betaHero y gammaSide son hooks neutros por defecto -- documentado, no simulan datos falsos", () => {
    const weights = defaultJaccardWeights(FIXTURE_POSITIONS);
    expect(weights.betaHero(1)).toBe(1);
    expect(weights.gammaSide("radiant")).toBe(1);
    expect(weights.gammaSide("dire")).toBe(1);
  });
});

describe("performance", () => {
  test("nearestNeighbors sobre 5000 candidatos se mantiene rápido", () => {
    // Objetivo real del doc de investigación (pro-drafter-spec-v1.md §2.1): ~0.9-1.8ms para hasta
    // 5000 candidatos. El assertion usa un margen generoso a propósito para no volverse flaky en
    // CI compartido (documentado en el plan de Fase 5-8) -- lo que prueba es ausencia de una
    // regresión de orden de magnitud, no el número exacto.
    const bigCorpus: DraftCandidate[] = Array.from({ length: 5000 }, (_, i) => ({
      draftId: `perf-${i}`,
      patch: "7.35d",
      radiantHeroes: [0, 1, 2, 3, 4].map((k) => ((i + k) % 120) + 1),
      direHeroes: [5, 6, 7, 8, 9].map((k) => ((i + k) % 120) + 1),
      winningSide: i % 2 === 0 ? "radiant" : ("dire" as const),
    }));
    const engine = createJaccardEngine(buildDraftIndex(bigCorpus, "7.35d"));
    engine.nearestNeighbors([1, 2, 3], 5, NEUTRAL_WEIGHTS); // warm-up -- evita medir JIT/alloc frío

    const start = performance.now();
    engine.nearestNeighbors([1, 2, 3], 5, NEUTRAL_WEIGHTS);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(15);
  });
});
