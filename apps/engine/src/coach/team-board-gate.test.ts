import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { CompositionNeed } from "./composition-need";
import { nothingStrongForWhatIsMissing, type TeamCoachPositionState } from "./team-coach-board";

// El gate que calla ELIGE AHORA en el Live cuando lo que TODAVÍA falta no tiene ningún candidato con evidencia fuerte (función pura).

const need = (covered: Position[]): CompositionNeed => ({ covered, need: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } });
const states = (entries: Partial<Record<Position, TeamCoachPositionState>>) => (position: Position) => entries[position];
const ALL: Position[] = [1, 2, 3, 4, 5];

describe("nothingStrongForWhatIsMissing", () => {
  test("lo que falta (mid) está RANKED pero sin ningún héroe con evidencia fuerte -> se calla", () => {
    const covered = need([1, 3, 4, 5]);
    expect(nothingStrongForWhatIsMissing(covered, ALL, [1, 3, 4, 5], states({ 2: "RANKED" }))).toBe(true);
  });

  test("lo que falta SÍ tiene un candidato fuerte (la posición está en el campo de objetivos) -> no se calla", () => {
    expect(nothingStrongForWhatIsMissing(need([1, 3, 4, 5]), ALL, [1, 2, 3, 4, 5], states({ 2: "RANKED" }))).toBe(false);
  });

  test("lo que falta es una columna que FALLÓ (UNAVAILABLE): no es 'sin candidato' -> no se calla", () => {
    expect(nothingStrongForWhatIsMissing(need([1, 3, 4, 5]), ALL, [1, 3, 4, 5], states({ 2: "UNAVAILABLE" }))).toBe(false);
  });

  test("falta más de una posición y una de ellas falló: no se calla", () => {
    expect(nothingStrongForWhatIsMissing(need([4, 5, 3]), ALL, [3, 4, 5], states({ 1: "RANKED", 2: "UNAVAILABLE" }))).toBe(false);
  });

  test("sin dato de composición (simulador, primer pick, nada que inferir) nunca se calla", () => {
    expect(nothingStrongForWhatIsMissing(null, ALL, [], states({}))).toBe(false);
  });

  test("todo lo accionable ya está cubierto: no hay 'lo que falta' que callar", () => {
    expect(nothingStrongForWhatIsMissing(need([4, 5]), [4, 5], [4, 5], states({}))).toBe(false);
  });
});
