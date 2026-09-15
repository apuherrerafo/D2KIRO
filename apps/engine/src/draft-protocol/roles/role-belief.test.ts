import { describe, expect, test } from "bun:test";
import type { HeroPositions } from "../../signals/hero-positions";
import { computeRoleBelief } from "./role-belief";
import type { Position } from "./role-belief";

// S3 (testing-seams.md): fixture inline, nunca hero-positions.json real -- ese archivo se
// regenera por parche, un test atado a su contenido se rompería en silencio con cada actualización.
const FLEX_HERO_POSITIONS: HeroPositions = {
  1: [
    { position: 2, matches: 400 },
    { position: 3, matches: 350 },
    { position: 4, matches: 250 },
  ],
  2: [{ position: 1, matches: 900 }],
};

describe("computeRoleBelief -- S4.1/S4.2", () => {
  test("probabilidades siempre suman 1", () => {
    const cases = [
      computeRoleBelief({ heroId: null }),
      computeRoleBelief({ heroId: 1, confirmedPosition: 3 }),
      computeRoleBelief({ heroId: 1, partyPreferredPositions: [2] }),
      computeRoleBelief({ heroId: 1, heroPositions: FLEX_HERO_POSITIONS }),
      computeRoleBelief({ heroId: 1, occupiedPositions: new Set<Position>([1, 5]), partyPreferredPositions: [2] }),
    ];
    for (const belief of cases) {
      const sum = Object.values(belief.probabilities).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 9);
    }
  });

  test("posición confirmada explícitamente es HARD CONSTRAINT -- one-hot, status CONFIRMED", () => {
    const belief = computeRoleBelief({ heroId: 1, confirmedPosition: 3, partyPreferredPositions: [1] });
    expect(belief.status).toBe("CONFIRMED");
    expect(belief.probabilities[3]).toBe(1);
    expect(belief.probabilities[1]).toBe(0);
    expect(belief.entropy).toBe(0);
    expect(belief.evidence).toEqual([{ kind: "CONFIRMED_EXPLICIT", detail: "posición 3 confirmada explícitamente" }]);
  });

  test("preferencia SOFT no fuerza la asignación -- ninguna posición llega a 1 ni a 0", () => {
    const belief = computeRoleBelief({ heroId: 1, partyPreferredPositions: [4] });
    expect(belief.status).toBe("LIKELY");
    expect(belief.probabilities[4]).toBeLessThan(1);
    expect(belief.probabilities[4]).toBeGreaterThan(0.2); // boosted above uniform
    for (const position of [1, 2, 3, 5] as const) {
      expect(belief.probabilities[position]).toBeGreaterThan(0);
    }
  });

  test("héroe flex (distribución histórica repartida) permanece multimodal", () => {
    const belief = computeRoleBelief({ heroId: 1, heroPositions: FLEX_HERO_POSITIONS });
    expect(belief.status).toBe("LIKELY");
    expect(belief.probabilities[2]).toBeGreaterThan(0.3);
    expect(belief.probabilities[3]).toBeGreaterThan(0.25);
    expect(belief.probabilities[4]).toBeGreaterThan(0.15);
    // multimodal: al menos tres posiciones con probabilidad no despreciable, ninguna domina por completo.
    const nonTrivial = Object.values(belief.probabilities).filter((p) => p > 0.05).length;
    expect(nonTrivial).toBeGreaterThanOrEqual(3);
    expect(Math.max(...Object.values(belief.probabilities))).toBeLessThan(0.9);
  });

  test("héroe sin datos de posición (single-position hero) inclina fuerte pero no colapsa vía distribución sola", () => {
    const belief = computeRoleBelief({ heroId: 2, heroPositions: FLEX_HERO_POSITIONS });
    expect(belief.status).toBe("LIKELY");
    expect(belief.probabilities[1]).toBe(1);
  });

  test("restricción estructural (posición ya cubierta por otro héroe propio) la zera y redistribuye", () => {
    const belief = computeRoleBelief({
      heroId: 1,
      heroPositions: FLEX_HERO_POSITIONS,
      occupiedPositions: new Set<Position>([2]),
    });
    expect(belief.status).toBe("LIKELY");
    expect(belief.probabilities[2]).toBe(0);
    expect(belief.probabilities[3]).toBeGreaterThan(0);
  });

  test("restricción estructural es prioridad más alta que la preferencia -- puede anularla", () => {
    const belief = computeRoleBelief({
      heroId: 1,
      partyPreferredPositions: [3],
      occupiedPositions: new Set<Position>([3]),
    });
    expect(belief.probabilities[3]).toBe(0);
  });

  test("sin ninguna evidencia -> estado UNRESOLVED honesto, prior neutral uniforme", () => {
    const belief = computeRoleBelief({ heroId: null });
    expect(belief.status).toBe("UNRESOLVED");
    for (const p of Object.values(belief.probabilities)) expect(p).toBeCloseTo(0.2, 9);
    expect(belief.entropy).toBeCloseTo(Math.log2(5), 9);
    expect(belief.evidence).toEqual([{ kind: "NEUTRAL_PRIOR", detail: "sin evidencia disponible" }]);
  });

  test("heroPositions sin entrada para el héroe (host desconocido) también cae a UNRESOLVED, no lanza", () => {
    const belief = computeRoleBelief({ heroId: 999999, heroPositions: FLEX_HERO_POSITIONS });
    expect(belief.status).toBe("UNRESOLVED");
  });

  test("determinismo: misma evidencia -> mismo resultado exacto", () => {
    const input = { heroId: 1, partyPreferredPositions: [2, 4] as const, heroPositions: FLEX_HERO_POSITIONS };
    const a = computeRoleBelief(input);
    const b = computeRoleBelief(input);
    expect(a).toEqual(b);
  });
});
