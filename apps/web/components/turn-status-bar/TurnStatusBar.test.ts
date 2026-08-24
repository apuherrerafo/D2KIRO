import { describe, expect, test } from "bun:test";
import { reservePercent } from "./TurnStatusBar";

describe("reservePercent", () => {
  test("reserva completa (130000ms) es 100%", () => {
    expect(reservePercent(130000)).toBe(100);
  });

  test("reserva en 0 es 0%", () => {
    expect(reservePercent(0)).toBe(0);
  });

  test("la mitad de la reserva es 50%", () => {
    expect(reservePercent(65000)).toBe(50);
  });

  test("nunca pasa de 100% aunque llegue un valor mayor al total (defensivo)", () => {
    expect(reservePercent(999999)).toBe(100);
  });
});
