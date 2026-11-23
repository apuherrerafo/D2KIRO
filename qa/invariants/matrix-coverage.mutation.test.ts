/**
 * R3.1/R3.2 -- pruebas de mutacion del guard de cobertura de la matriz de QA.
 *
 * Contexto: `vacuityProblems` aceptaba una matriz con UNA sola shortlist con tarjetas (>=1), asi que una regresion masiva
 * (194 -> 1 checkpoints con tarjetas) pasaba en verde.
 *
 * R3.2 (revision independiente, M3): desactivar cualquiera de las reglas de tasa/escenarios/concentracion NO hacia fallar ninguna
 * prueba, porque otra regla detectaba lo mismo. Ahora cada regla activa tiene su propia prueba de mutacion con un fixture AISLADO, y la
 * asercion es sobre el CONJUNTO de reglas que se disparan: debe ser exactamente `[regla]`. Una prueba que pase solo porque otra regla
 * detecto el defecto falla aqui. Ninguna lee la matriz real, una SQLite ni un JSON curado.
 */
import { describe, expect, test } from "bun:test";
import {
  buildCoverageReference,
  coverageRegressionProblems,
  matrixCoverage,
  matrixGuardProblems,
  matrixProfile,
  referenceTrustProblems,
  ruleOf,
  semanticCoverageProblems,
  vacuityProblems,
  type CoverageCheckpoint,
  type CoverageReference,
  type CoverageRun,
} from "./matrix-coverage";

const card = { heroId: 25 };
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const provenance = (curated: Record<string, string> = {}) => ({ commit: "fixture", measuredOn: "2026-11-22", source: "sintetica", fixtureInputs: curated });
const refOf = (matrix: readonly CoverageRun[], curated?: Record<string, string>): CoverageReference => buildCoverageReference(matrix, provenance(curated));
const guard = (matrix: readonly CoverageRun[], reference: CoverageReference, actual?: Record<string, string>) => matrixGuardProblems(matrix, reference, actual);
/** Conjunto de reglas disparadas (ordenado, sin repetir). */
const rulesOf = (problems: readonly string[]) => [...new Set(problems.map(ruleOf))].sort();

// ---------------------------------------------------------------------------------------------------------------------------------
// Fixture "grid": N corridas x 3 grupos x REPS checkpoints. Cada grupo fija las dimensiones; el resto es constante. Todo responde con
// tarjeta salvo que `cards`/`answered` digan otra cosa. Sirve para mutar UNA sola cosa y ver que UNA sola regla se dispara.
// ---------------------------------------------------------------------------------------------------------------------------------
const REPS = 5;
interface Group {
  open: readonly number[];
  ctrl: readonly number[];
  round: number;
  step: string;
  side: string;
}
const BASE_GROUP: Group = { open: [1], ctrl: [1], round: 1, step: "s", side: "r" };
const groupsOf = (override: (group: number) => Partial<Group>): Group[] => [0, 1, 2].map((index) => ({ ...BASE_GROUP, ...override(index) }));

interface GridOptions {
  runs?: number;
  groups?: Group[];
  cards?: (run: number, group: number, rep: number) => boolean;
  answered?: (run: number, group: number, rep: number) => boolean;
}
function grid({ runs = 12, groups = groupsOf(() => ({})), cards = () => true, answered = () => true }: GridOptions = {}): CoverageRun[] {
  return Array.from({ length: runs }, (_, run) => ({
    scenarioId: `g-${run}`,
    checkpoints: groups.flatMap((group, g) =>
      Array.from({ length: REPS }, (_, rep): CoverageCheckpoint => ({
        humanOpenPositions: group.open,
        controlledPositions: group.ctrl,
        round: group.round,
        step: group.step,
        side: group.side,
        v3: answered(run, g, rep) ? { shortlist: cards(run, g, rep) ? [card] : [] } : null,
      })),
    ),
  }));
}

describe("referencia de la rejilla: la matriz sin mutar pasa su propio guard (control positivo)", () => {
  test("sin problemas, con y sin huella de datos curados coincidente", () => {
    const matrix = grid();
    expect(guard(matrix, refOf(matrix))).toEqual([]);
    expect(guard(matrix, refOf(matrix, { "synthetic-counters": HASH_A }), { "synthetic-counters": HASH_A })).toEqual([]);
  });
});

describe("M3: UNA prueba de mutacion por regla activa -- el conjunto de reglas disparadas es exactamente [regla]", () => {
  test("NOT_COMPARABLE: la matriz se encoge a menos de la mitad, con las mismas tasas", () => {
    const reference = refOf(grid());
    const problems = guard(grid({ runs: 5 }), reference);
    expect(rulesOf(problems)).toEqual(["NOT_COMPARABLE"]);
  });

  test("COACH_ANSWER_RATE: el Coach calla en el 60 % de los checkpoints y responde con tarjeta en el resto", () => {
    const reference = refOf(grid());
    const problems = guard(grid({ answered: (_run, _group, rep) => rep >= 3 }), reference);
    expect(rulesOf(problems)).toEqual(["COACH_ANSWER_RATE"]);
  });

  test("CARD_RATE: se diluye la matriz con checkpoints respondidos sin tarjeta en dimensiones nuevas (corridas y segmentos conocidos intactos)", () => {
    const reference = refOf(grid());
    const diluted = grid().map((run) => ({
      ...run,
      checkpoints: [
        ...run.checkpoints,
        ...Array.from({ length: 20 }, (): CoverageCheckpoint => ({ humanOpenPositions: [9], controlledPositions: [9, 9], round: 9, step: "nuevo", side: "nuevo", v3: { shortlist: [] } })),
      ],
    }));
    expect(rulesOf(guard(diluted, reference))).toEqual(["CARD_RATE"]);
  });

  test("SCENARIO_SPREAD: las tarjetas pasan de estar repartidas en las 12 corridas a concentrarse en 4 (mismos segmentos, misma tasa global)", () => {
    const reference = refOf(grid({ cards: (_run, _group, rep) => rep < 2 }));
    const concentrated = grid({ cards: (run) => run < 4 });
    expect(reference.profile.runsWithCards).toBe(12);
    expect(matrixProfile(concentrated).runsWithCards).toBe(4);
    expect(rulesOf(guard(concentrated, reference))).toEqual(["SCENARIO_SPREAD"]);
  });

  const SEGMENTS: readonly { dimension: string; value: string; groups: Group[] }[] = [
    { dimension: "round", value: "2", groups: groupsOf((g) => ({ round: g === 2 ? 2 : 1 })) },
    { dimension: "step", value: "t", groups: groupsOf((g) => ({ step: g === 2 ? "t" : "s" })) },
    { dimension: "partySize", value: "2", groups: groupsOf((g) => ({ ctrl: g === 2 ? [1, 2] : [1] })) },
    { dimension: "side", value: "d", groups: groupsOf((g) => ({ side: g === 2 ? "d" : "r" })) },
    { dimension: "openPosition", value: "2", groups: groupsOf((g) => ({ open: g === 2 ? [2] : [1], ctrl: [1, 2] })) },
  ];
  for (const { dimension, value, groups } of SEGMENTS) {
    test(`SEGMENT_LOSS (${dimension}=${value}): un segmento con tarjetas en la referencia las pierde; el resto de la matriz sigue sano`, () => {
      const reference = refOf(grid({ groups }));
      const lost = grid({ groups, cards: (_run, group) => group !== 2 });
      const problems = guard(lost, reference);
      expect(rulesOf(problems)).toEqual(["SEGMENT_LOSS"]);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`${dimension}=${value}`);
    });
  }

  test("REFERENCE_INVALID: una referencia sin tarjetas no puede exigir nada", () => {
    const noCards = grid({ cards: () => false });
    const problems = coverageRegressionProblems(matrixProfile(grid()), refOf(noCards));
    expect(rulesOf(problems)).toEqual(["REFERENCE_INVALID"]);
  });

  test("REFERENCE_INCOMPATIBLE: el fixture sintetico cambio; matriz identica, y NO es PASS ni regresion", () => {
    const matrix = grid();
    const reference = refOf(matrix, { "synthetic-counters": HASH_A });
    const problems = guard(matrix, reference, { "synthetic-counters": HASH_B });
    expect(rulesOf(problems)).toEqual(["REFERENCE_INCOMPATIBLE"]);
    expect(problems[0]).toContain("NO es una regresion");
    expect(problems[0]).toContain("synthetic-counters");
  });

  test("REFERENCE_INCOMPATIBLE: fixture ausente tambien se diagnostica (no se asume que coincide)", () => {
    const matrix = grid();
    const problems = guard(matrix, refOf(matrix, { "synthetic-counters": HASH_A }), {});
    expect(rulesOf(problems)).toEqual(["REFERENCE_INCOMPATIBLE"]);
    expect(problems[0]).toContain("no se pudo calcular");
  });

  test("REFERENCE_INCOMPATIBLE: un fixture NUEVO que la referencia no registra se diagnostica (simetria, R3.3)", () => {
    const matrix = grid();
    const problems = guard(matrix, refOf(matrix, { "synthetic-counters": HASH_A }), { "synthetic-counters": HASH_A, "otro-fixture": HASH_B });
    expect(rulesOf(problems)).toEqual(["REFERENCE_INCOMPATIBLE"]);
    expect(problems[0]).toContain("otro-fixture");
    expect(problems[0]).toContain("no lo registra");
  });

  test("cambio de datos + regresion real: ambos diagnosticos, el de datos primero (no se esconde ninguno)", () => {
    const reference = refOf(grid(), { "synthetic-counters": HASH_A });
    const collapsed = grid({ cards: (run, group, rep) => run === 0 && group === 0 && rep === 0 });
    const problems = guard(collapsed, reference, { "synthetic-counters": HASH_B });
    expect(ruleOf(problems[0]!)).toBe("REFERENCE_INCOMPATIBLE");
    expect(rulesOf(problems)).toContain("CARD_RATE");
  });

  test("REFERENCE_TAMPERED: edicion a mano de la referencia sin regenerar la huella", () => {
    const matrix = grid();
    const reference = refOf(matrix);
    const edited = structuredClone(reference);
    edited.profile.segments.round!["1"]!.open += 1; // campo que ninguna regla usa: aislamos la huella
    expect(rulesOf(guard(matrix, edited))).toEqual(["REFERENCE_TAMPERED"]);
  });

  test("REFERENCE_TAMPERED: una tolerancia propia en el JSON se rechaza y NO debilita el guard", () => {
    const matrix = grid();
    const weakened = { ...refOf(matrix), tolerance: { rateFloor: 0, minSegmentAnswered: 0 } } as CoverageReference;
    expect(rulesOf(guard(matrix, weakened))).toEqual(["REFERENCE_TAMPERED"]);
    // Con la tolerancia debilitada en el JSON, una regresion real SIGUE detectandose (la tolerancia efectiva es la del codigo).
    const collapsed = grid({ cards: (run, group, rep) => run === 0 && group === 0 && rep === 0 });
    const problems = guard(collapsed, weakened);
    expect(rulesOf(problems)).toContain("CARD_RATE");
    expect(rulesOf(problems)).toContain("REFERENCE_TAMPERED");
  });

  test("referenceTrustProblems sin datos reales no evalua compatibilidad (solo integridad)", () => {
    expect(referenceTrustProblems(refOf(grid(), { "synthetic-counters": HASH_A }))).toEqual([]);
  });
});

describe("abstenciones legitimas: ninguna regla castiga lo que no se exigia", () => {
  test("segmento sin tarjetas en la referencia: no se exige aunque la mutada tampoco tenga", () => {
    const groups = groupsOf((g) => ({ side: g === 2 ? "d" : "r" }));
    const cards = (_run: number, group: number) => group !== 2;
    expect(guard(grid({ groups, cards }), refOf(grid({ groups, cards })))).toEqual([]);
  });

  test("segmento con menos de 5 respuestas en la referencia: no se exige (sin base estadistica)", () => {
    const tiny = (withCards: boolean): CoverageRun => ({
      scenarioId: "tiny",
      checkpoints: Array.from({ length: 4 }, (): CoverageCheckpoint => ({ humanOpenPositions: [1], controlledPositions: [1], round: 1, step: "s", side: "tiny", v3: { shortlist: withCards ? [card] : [] } })),
    });
    const reference = refOf([...grid(), tiny(true)]);
    expect(guard([...grid(), tiny(false)], reference)).toEqual([]);
  });

  test("agregar corridas de abstencion pura (sin fundamento, cards: []) dentro de la tolerancia declarada no es regresion", () => {
    const reference = refOf(grid());
    const abstentions: CoverageRun[] = Array.from({ length: 6 }, (_, index) => ({
      scenarioId: `abs-${index}`,
      checkpoints: Array.from({ length: 15 }, (): CoverageCheckpoint => ({ humanOpenPositions: [1], controlledPositions: [1], round: 1, step: "s", side: "r", v3: { shortlist: [] } })),
    }));
    expect(guard([...grid(), ...abstentions], reference)).toEqual([]);
  });
});

describe("la regresion que el revisor senalo (194 -> 1) y sus variantes", () => {
  test("el guard viejo la aceptaba (documenta el hueco) y el nuevo la rechaza", () => {
    const reference = refOf(grid());
    const collapsed = grid({ cards: (run, group, rep) => run === 0 && group === 0 && rep === 0 });
    expect(matrixCoverage(collapsed).withCards).toBe(1);
    expect(vacuityProblems(matrixCoverage(collapsed))).toEqual([]);
    expect(guard(collapsed, reference).length).toBeGreaterThan(0);
    expect(rulesOf(guard(collapsed, reference))).toContain("CARD_RATE");
    expect(rulesOf(guard(collapsed, reference))).toContain("SCENARIO_SPREAD");
  });

  test("todas las tarjetas en un unico escenario: SCENARIO_SPREAD", () => {
    const reference = refOf(grid());
    expect(rulesOf(guard(grid({ cards: (run) => run === 0 }), reference))).toContain("SCENARIO_SPREAD");
  });

  test("matriz sin respuestas y matriz vacia: se rechazan", () => {
    const reference = refOf(grid());
    expect(guard(grid({ answered: () => false }), reference).length).toBeGreaterThan(0);
    expect(guard([], reference).length).toBeGreaterThan(0);
    expect(guard([{ checkpoints: [] }], reference).length).toBeGreaterThan(0);
  });
});

describe("cobertura SEMANTICA: tarjeta esperada solo donde el fixture declara un fundamento (no circular)", () => {
  test("fundamento declarado y shortlist vacia: UNEXPECTED_COVERAGE_LOSS", () => {
    const problems = semanticCoverageProblems([{ label: "pos2", position: 2, grounded: true, shortlistLength: 0 }]);
    expect(problems.some((problem) => problem.includes("UNEXPECTED_COVERAGE_LOSS") && problem.includes("pos2"))).toBe(true);
  });

  test("sin fundamento y shortlist vacia: VALID_ABSTENTION (no se fuerzan tarjetas)", () => {
    const problems = semanticCoverageProblems([
      { label: "pos2", position: 2, grounded: true, shortlistLength: 1 },
      { label: "pos2-sin", position: 2, grounded: false, shortlistLength: 0 },
    ]);
    expect(problems).toEqual([]);
  });

  test("tarjeta sin fundamento declarado: se senala (el fixture es hermetico)", () => {
    const problems = semanticCoverageProblems([
      { label: "pos2", position: 2, grounded: true, shortlistLength: 1 },
      { label: "pos2-sin", position: 2, grounded: false, shortlistLength: 1 },
    ]);
    expect(problems.some((problem) => problem.includes("pos2-sin"))).toBe(true);
  });

  test("ninguna sonda con fundamento: INSUFFICIENT_EVIDENCE, no PASS", () => {
    expect(semanticCoverageProblems([]).some((problem) => problem.includes("INSUFFICIENT_EVIDENCE"))).toBe(true);
    expect(semanticCoverageProblems([{ label: "x", position: 1, grounded: false, shortlistLength: 0 }]).some((problem) => problem.includes("INSUFFICIENT_EVIDENCE"))).toBe(true);
  });
});
