import { describe, expect, test } from "bun:test";
import { canonicalHash, canonicalStringify, functionalIdentityHash, sha256Hex } from "./hash";

describe("canonicalStringify", () => {
  test("mismo objeto con claves en distinto orden produce el mismo string", () => {
    const a = canonicalStringify({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalStringify({ a: 2, c: { x: 2, y: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  test("preserva el orden de los arrays (es semántico)", () => {
    const a = canonicalStringify({ list: [1, 2, 3] });
    const b = canonicalStringify({ list: [3, 2, 1] });
    expect(a).not.toBe(b);
  });
});

describe("canonicalHash — criterio 20: mismo input canónico -> mismo hash", () => {
  test("dos construcciones distintas del mismo objeto lógico dan el mismo hash", () => {
    const h1 = canonicalHash({ id: "dota2/ranked-all-pick", version: "1.0.0", rounds: [1, 2, 3] });
    const h2 = canonicalHash({ version: "1.0.0", rounds: [1, 2, 3], id: "dota2/ranked-all-pick" });
    expect(h1).toBe(h2);
  });

  test("un cambio real en el contenido cambia el hash", () => {
    const h1 = canonicalHash({ id: "dota2/ranked-all-pick" });
    const h2 = canonicalHash({ id: "dota2/captains-mode" });
    expect(h1).not.toBe(h2);
  });

  test("sha256Hex produce 64 caracteres hexadecimales", () => {
    expect(sha256Hex("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("functionalIdentityHash — excluye timestamps/duraciones/ids de transporte", () => {
  test("dos estados idénticos salvo timestamp/sessionId hashean igual", () => {
    const a = { sessionId: "s1", updatedAt: "2026-01-01T00:00:00Z", durationMs: 42, phase: "ACTIVE" };
    const b = { sessionId: "s2", updatedAt: "2026-02-02T00:00:00Z", durationMs: 999, phase: "ACTIVE" };
    expect(functionalIdentityHash(a)).toBe(functionalIdentityHash(b));
  });

  test("un cambio en un campo funcional real sí cambia el hash", () => {
    const a = { sessionId: "s1", phase: "ACTIVE" };
    const b = { sessionId: "s1", phase: "COMPLETE" };
    expect(functionalIdentityHash(a)).not.toBe(functionalIdentityHash(b));
  });
});
