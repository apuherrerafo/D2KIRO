import { describe, expect, test } from "bun:test";
import { computeRemainingMs } from "./DraftTimer";

describe("computeRemainingMs", () => {
  test("sin tiempo transcurrido, queda el total completo", () => {
    expect(computeRemainingMs(30000, 1000, 1000)).toBe(30000);
  });

  test("resta exactamente el tiempo transcurrido desde startedAtMs", () => {
    expect(computeRemainingMs(30000, 1000, 11000)).toBe(20000);
  });

  test("nunca baja de 0 aunque el tiempo transcurrido supere el total -- turno real reconectado tarde", () => {
    expect(computeRemainingMs(30000, 0, 999999)).toBe(0);
  });

  test("startedAtMs en el pasado (reconexión a mitad de turno) ya descuenta lo transcurrido antes de este render", () => {
    // El turno arrancó hace 15s reales, quedan 15s de los 30s originales.
    expect(computeRemainingMs(30000, 0, 15000)).toBe(15000);
  });
});
