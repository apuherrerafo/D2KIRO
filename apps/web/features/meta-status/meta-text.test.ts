import { describe, expect, test } from "bun:test";
import { describePatch, describeSync, formatSyncedAt } from "./meta-text";

describe("describeSync", () => {
  test("sin datos, desactualizado y al día se dicen con palabras distintas", () => {
    expect(describeSync({ syncedAt: null, isStale: true })).toEqual({ tag: "Sin datos", tone: "empty" });
    expect(describeSync({ syncedAt: "2026-11-10T10:00:00Z", isStale: true }).tone).toBe("pending");
    expect(describeSync({ syncedAt: "2026-11-10T10:00:00Z", isStale: false })).toEqual({ tag: "Al día", tone: "ok" });
  });
});

describe("describePatch", () => {
  test("el parche sin verificar nunca se presenta como verificado", () => {
    expect(describePatch({ label: "7.41e", verified: false, basis: "rótulo manual" })).toEqual({ value: "Parche 7.41e", tag: "Sin verificar", tone: "pending" });
    expect(describePatch({ label: "7.41e", verified: true, basis: "x" }).tag).toBe("Verificado");
  });

  test("sin procedencia registrada se declara, no se inventa", () => {
    expect(describePatch(undefined).tag).toBe("Sin procedencia");
    expect(describePatch({ label: null, verified: false, basis: "" }).tag).toBe("Sin procedencia");
  });
});

describe("formatSyncedAt", () => {
  test("nunca y fecha inválida tienen texto propio", () => {
    expect(formatSyncedAt(null)).toBe("Nunca se actualizó");
    expect(formatSyncedAt("no-es-fecha")).toBe("Fecha no disponible");
    expect(formatSyncedAt("2026-11-10T10:00:00Z").length).toBeGreaterThan(8);
  });
});
