import { describe, expect, test } from "bun:test";
import { analyzedPickOf, type AnalyzedPickInput } from "./analyzed-pick";

const BASE: AnalyzedPickInput = {
  analyzed: { position: 3, heroId: 10 },
  availablePositions: [3, 5],
  attemptPositions: [3, 5],
  unavailable: new Set([99]),
  noHumanAction: false,
};

describe("analyzedPickOf · el candidato analizado es un pick LEGAL solo si el panel ya lo permitiría", () => {
  test("sin candidato abierto → oculto (abrir el análisis no ofrece nada por sí solo)", () => {
    expect(analyzedPickOf({ ...BASE, analyzed: null })).toEqual({ kind: "hidden" });
  });
  test("posición sin sellar + héroe disponible → legal, con SU posición (no la seleccionada en el panel)", () => {
    expect(analyzedPickOf(BASE)).toEqual({ kind: "legal", position: 3, heroId: 10 });
    expect(analyzedPickOf({ ...BASE, analyzed: { position: 5, heroId: 10 } })).toEqual({ kind: "legal", position: 5, heroId: 10 });
  });
  test("posición ya sellada → bloqueado con motivo", () => {
    expect(analyzedPickOf({ ...BASE, availablePositions: [5] })).toMatchObject({ kind: "blocked", position: 3 });
  });
  test("héroe baneado o ya elegido → bloqueado con motivo", () => {
    expect(analyzedPickOf({ ...BASE, analyzed: { position: 3, heroId: 99 } })).toMatchObject({ kind: "blocked" });
  });
  test("el motor dice que no hay acción humana → bloqueado", () => {
    expect(analyzedPickOf({ ...BASE, noHumanAction: true })).toMatchObject({ kind: "blocked" });
  });
  test("una posición que el humano no controla nunca se ofrece", () => {
    expect(analyzedPickOf({ ...BASE, analyzed: { position: 1, heroId: 10 } })).toEqual({ kind: "hidden" });
  });
});
