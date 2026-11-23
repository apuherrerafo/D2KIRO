/** R3.4 -- la regla documentada del fixture sintetico (qa/scenarios/synthetic-counters.ts y coverage-reference.md) coincide con su contenido real. */
import { describe, expect, test } from "bun:test";
import { FILLER } from "./generate";
import { buildSyntheticCounters, SYNTHETIC_COUNTER_MARKER, SYNTHETIC_COUNTERS } from "./synthetic-counters";

describe("fixture sintetico de counters", () => {
  test("23 de 30 heroes de posicion 1 tienen 6 counters (1 hard + 5 medium); 7 no tienen ninguno", () => {
    const withCounters = [...SYNTHETIC_COUNTERS.keys()];
    expect(withCounters).toHaveLength(23);
    const without = Array.from({ length: 30 }, (_, index) => 100 + index).filter((hero) => !SYNTHETIC_COUNTERS.has(hero));
    expect(without).toHaveLength(7);
    for (const list of SYNTHETIC_COUNTERS.values()) {
      expect(list).toHaveLength(6);
      expect(list.filter((entry) => entry.level === "hard")).toHaveLength(1);
    }
  });

  test("todo enlace apunta a un id de relleno baneable y esta marcado como sintetico", () => {
    for (const list of SYNTHETIC_COUNTERS.values()) {
      for (const entry of list) {
        expect(FILLER).toContain(entry.vs);
        expect(entry.why).toBe(SYNTHETIC_COUNTER_MARKER);
      }
    }
  });

  test("es determinista: dos construcciones dan el mismo contenido", () => {
    expect([...buildSyntheticCounters()]).toEqual([...buildSyntheticCounters()]);
  });
});
