import { describe, expect, test } from "bun:test";
import { matrixCoverage, vacuityProblems, type CoverageRun } from "./matrix-coverage";

const withCards = { humanOpenPositions: [2], v3: { shortlist: [{ heroId: 25 }] } };
const noCards = { humanOpenPositions: [2], v3: { shortlist: [] } };
const noAnswer = { humanOpenPositions: [2], v3: null };
const noHuman = { humanOpenPositions: [], v3: { shortlist: [{ heroId: 25 }] } };
const run = (...checkpoints: CoverageRun["checkpoints"][number][]): CoverageRun => ({ checkpoints });

describe("guard anti-vacio: falla cuando la matriz no juzga nada (prueba negativa)", () => {
  test("matriz sin ninguna tarjeta: se rechaza aunque el Coach responda", () => {
    const problems = vacuityProblems(matrixCoverage([run(noCards, noCards), run(noCards)]));
    expect(problems).toEqual(["ninguna shortlist del Coach tiene tarjetas"]);
  });

  test("el Coach nunca responde (v3 ausente): se rechaza por falta de respuestas y de tarjetas", () => {
    const problems = vacuityProblems(matrixCoverage([run(noAnswer, noAnswer)]));
    expect(problems).toContain("el Coach no respondio en ningun checkpoint con humano abierto");
    expect(problems).toContain("ninguna shortlist del Coach tiene tarjetas");
  });

  test("sin humanos abiertos: se rechaza por completo, aunque haya tarjetas en checkpoints sin humano", () => {
    const problems = vacuityProblems(matrixCoverage([run(noHuman)]));
    expect(problems).toHaveLength(3);
  });

  test("matriz vacia: se rechaza por los tres motivos", () => {
    expect(vacuityProblems(matrixCoverage([]))).toHaveLength(3);
    expect(vacuityProblems(matrixCoverage([run()]))).toHaveLength(3);
  });
});

describe("guard anti-vacio: acepta una matriz que si ejercita el camino", () => {
  test("mezcla realista: algunas shortlists vacias (sin fundamento, contrato vigente) y al menos una con tarjetas", () => {
    const coverage = matrixCoverage([run(noCards, noAnswer, noHuman), run(withCards)]);
    expect(coverage).toEqual({ humanOpen: 3, coachAnswered: 2, withCards: 1 });
    expect(vacuityProblems(coverage)).toEqual([]);
  });
});
