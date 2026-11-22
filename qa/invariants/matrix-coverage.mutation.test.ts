/**
 * R3.1 -- pruebas de mutacion del guard de cobertura de la matriz de QA.
 *
 * Contexto: `vacuityProblems` aceptaba una matriz con UNA sola shortlist con tarjetas (>=1), asi que una regresion masiva
 * (194 -> 1 checkpoints con tarjetas) pasaba en verde. Estas pruebas parten de una matriz sintetica con la FORMA de la real
 * (varias rondas / pasos / bandos / tamanos de party / posiciones, abstenciones legitimas incluidas), derivan su referencia con
 * la misma funcion que genera `coverage-reference.json`, y la MUTAN. Ninguna lee la matriz real, una SQLite ni un JSON curado.
 */
import { describe, expect, test } from "bun:test";
import {
  buildCoverageReference,
  matrixCoverage,
  matrixGuardProblems,
  semanticCoverageProblems,
  vacuityProblems,
  type CoverageCheckpoint,
  type CoverageRun,
} from "./matrix-coverage";

const ROUNDS = [1, 2, 3] as const;
const STEPS = ["after_bans", "before_human_turn", "after_own_pick"] as const;
const SIDES = ["radiant", "dire"] as const;
const PARTY: readonly (readonly number[])[] = [[2], [2, 3], [1, 2, 3], [1, 2, 3, 4, 5]];
const card = { heroId: 25 };

/** Sintetica: 48 corridas x 6 checkpoints. Tarjetas solo donde la posicion 1 esta abierta (como la real); el resto son abstenciones. */
function baseline(): CoverageRun[] {
  const runs: CoverageRun[] = [];
  for (let index = 0; index < 48; index += 1) {
    const controlled = PARTY[index % PARTY.length]!;
    const side = SIDES[index % 2]!;
    const checkpoints: CoverageCheckpoint[] = [];
    for (let k = 0; k < 6; k += 1) {
      const open = controlled.length > 1 && k % 2 === 1 ? [controlled[controlled.length - 1]!] : [...controlled];
      const hasCarry = open.includes(1);
      const answered = k !== 5; // el ultimo checkpoint de cada corrida: el Coach no responde
      const cards = answered && hasCarry && (index + k) % 2 === 0;
      checkpoints.push({
        humanOpenPositions: open,
        controlledPositions: controlled,
        round: ROUNDS[k % 3]!,
        step: STEPS[k % 3]!,
        side,
        v3: answered ? { shortlist: cards ? [card] : [] } : null,
      });
    }
    runs.push({ scenarioId: `run-${index}`, checkpoints });
  }
  return runs;
}

const REFERENCE = buildCoverageReference(baseline(), { commit: "fixture", measuredOn: "2026-11-22", source: "sintetica" });
const guard = (matrix: readonly CoverageRun[]) => matrixGuardProblems(matrix, REFERENCE);

/** Quita las tarjetas de todo checkpoint salvo los que cumplan `keep` (nth = ordinal 1-based entre los checkpoints con tarjetas). */
function stripCards(matrix: readonly CoverageRun[], keep: (nth: number) => boolean): CoverageRun[] {
  let nth = 0;
  return matrix.map((run) => ({
    ...run,
    checkpoints: run.checkpoints.map((checkpoint) => {
      if (!checkpoint.v3 || checkpoint.v3.shortlist.length === 0) return checkpoint;
      nth += 1;
      return keep(nth) ? checkpoint : { ...checkpoint, v3: { shortlist: [] } };
    }),
  }));
}

describe("linea base sintetica: el guard acepta una matriz representativa (control positivo)", () => {
  test("la matriz de referencia pasa su propio guard", () => {
    expect(guard(baseline())).toEqual([]);
  });
  test("tiene abstenciones legitimas y tarjetas (no es trivial)", () => {
    const coverage = matrixCoverage(baseline());
    expect(coverage.withCards).toBeGreaterThan(20);
    expect(coverage.coachAnswered - coverage.withCards).toBeGreaterThan(20);
  });
});

describe("MUTACION: el guard viejo dejaba pasar regresiones masivas", () => {
  test("de N a 1 checkpoint con tarjetas, matriz comparable: el guard viejo lo acepta (documenta el hueco)", () => {
    const collapsed = stripCards(baseline(), (nth) => nth === 1);
    expect(matrixCoverage(collapsed).withCards).toBe(1);
    expect(vacuityProblems(matrixCoverage(collapsed))).toEqual([]);
  });

  test("de N a 1 checkpoint con tarjetas: el guard nuevo FALLA", () => {
    const collapsed = stripCards(baseline(), (nth) => nth === 1);
    expect(guard(collapsed).length).toBeGreaterThan(0);
  });

  test("todas las tarjetas viven en un unico escenario: FALLA nombrando la concentracion", () => {
    const concentrated = baseline().map((run, index) => ({
      ...run,
      checkpoints: run.checkpoints.map((checkpoint, k) =>
        index === 0 ? { ...checkpoint, humanOpenPositions: [1], round: ROUNDS[k % 3]!, v3: { shortlist: [card] } } : checkpoint.v3 ? { ...checkpoint, v3: { shortlist: [] } } : checkpoint,
      ),
    }));
    expect(matrixCoverage(concentrated).withCards).toBeGreaterThan(0);
    expect(vacuityProblems(matrixCoverage(concentrated))).toEqual([]);
    expect(guard(concentrated).some((problem) => problem.includes("escenario"))).toBe(true);
  });

  test("desaparecen las tarjetas de un segmento que tenia cobertura (ronda 2): FALLA nombrando el segmento", () => {
    const lostRound2 = baseline().map((run) => ({
      ...run,
      checkpoints: run.checkpoints.map((checkpoint) => (checkpoint.round === 2 && checkpoint.v3 ? { ...checkpoint, v3: { shortlist: [] } } : checkpoint)),
    }));
    expect(vacuityProblems(matrixCoverage(lostRound2))).toEqual([]);
    expect(guard(lostRound2).some((problem) => problem.includes("round=2"))).toBe(true);
  });

  test("el Coach deja de responder en la mayoria de los checkpoints: FALLA", () => {
    const mute = baseline().map((run) => ({ ...run, checkpoints: run.checkpoints.map((checkpoint, k) => (k === 5 || k % 2 === 0 ? { ...checkpoint, v3: null } : checkpoint)) }));
    expect(guard(mute).length).toBeGreaterThan(0);
  });

  test("matriz sin respuestas: FALLA", () => {
    const none = baseline().map((run) => ({ ...run, checkpoints: run.checkpoints.map((checkpoint) => ({ ...checkpoint, v3: null })) }));
    expect(guard(none).length).toBeGreaterThan(0);
  });

  test("matriz completamente vacia (y corridas sin checkpoints): FALLA", () => {
    expect(guard([]).length).toBeGreaterThan(0);
    expect(guard([{ checkpoints: [] }]).length).toBeGreaterThan(0);
  });

  test("matriz encogida a una sola corrida ya no es comparable: FALLA", () => {
    expect(guard(baseline().slice(0, 1)).length).toBeGreaterThan(0);
  });
});

describe("CONTROLES POSITIVOS: el guard no castiga abstenciones ni cambios de composicion", () => {
  test("agregar checkpoints sin fundamento que correctamente devuelven cards: [] no es regresion", () => {
    const extra: CoverageRun[] = Array.from({ length: 6 }, (_, index) => ({
      scenarioId: `abstain-${index}`,
      checkpoints: [{ humanOpenPositions: [3], controlledPositions: [3], round: 1, step: "after_bans", side: "radiant", v3: { shortlist: [] } }],
    }));
    expect(guard([...baseline(), ...extra])).toEqual([]);
  });

  test("un segmento sin tarjetas en la referencia (posicion 3 sola) no se exige", () => {
    const withoutCarry = baseline().filter((run) => !run.checkpoints.every((checkpoint) => checkpoint.humanOpenPositions.includes(1)));
    expect(guard(withoutCarry)).toEqual([]);
  });

  test("cambio legitimo de composicion: se agregan abstenciones nuevas y las tarjetas se mantienen en todos los segmentos", () => {
    const noise: CoverageRun[] = baseline().map((run, index) => ({
      ...run,
      scenarioId: `noise-${index}`,
      checkpoints: run.checkpoints.map((checkpoint) => (checkpoint.v3 ? { ...checkpoint, v3: { shortlist: [] } } : checkpoint)),
    }));
    // La tasa de tarjetas cae a ~2/3 de la referencia: dentro de la tolerancia declarada (rateFloor).
    expect(guard([...baseline(), ...noise.slice(0, 24)])).toEqual([]);
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
