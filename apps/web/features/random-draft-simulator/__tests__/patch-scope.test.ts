import { expect, test } from "bun:test";
import { dominantNonEmptyPatch, statsInPatch } from "../patch-scope";

// Espejo del comportamiento de apps/engine/src/meta/patch-scope.test.ts (mismas reglas, mismos casos).
const row = (patch: string) => ({ patch });

test("el preferido gana si algún héroe tiene filas de él, aunque otro parche tenga más filas", () => {
  const stats = { 1: [row("7.40"), row("7.40")], 2: [row("7.40"), row("7.41e")] };
  expect(dominantNonEmptyPatch(stats, "7.41e")).toBe("7.41e");
});

test("preferido ausente en los datos -> cae al dominante no vacío", () => {
  const stats = { 1: [row("7.40"), row("7.40")], 2: [row("7.39")] };
  expect(dominantNonEmptyPatch(stats, "7.41e")).toBe("7.40");
});

test("empate exacto: el mayor en orden de texto (igual que el motor)", () => {
  expect(dominantNonEmptyPatch({ 1: [row("7.40"), row("7.41e")] })).toBe("7.41e");
});

test("ignora vacío, solo espacios y no-texto; sin parche real -> null", () => {
  expect(dominantNonEmptyPatch({ 1: [row(""), row("  "), { patch: undefined as unknown as string }] })).toBeNull();
  expect(dominantNonEmptyPatch({ 1: [row(""), row("7.41e")] })).toBe("7.41e");
});

test("statsInPatch: parche null/ausente o sin filas -> [] (nunca se completa con otro parche)", () => {
  const rows = [{ patch: "7.40", picks: 1 }, { patch: "7.41e", picks: 2 }];
  expect(statsInPatch(rows, "7.41e")).toEqual([{ patch: "7.41e", picks: 2 }]);
  expect(statsInPatch(rows, null)).toEqual([]);
  expect(statsInPatch(rows, "7.99")).toEqual([]);
  expect(statsInPatch(undefined, "7.41e")).toEqual([]);
});
