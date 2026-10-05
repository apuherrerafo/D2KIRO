import { describe, expect, test } from "bun:test";
import {
  defaultBanResolutionPolicy,
  resolveSimulatorBans,
  simulateBanPreferences,
  validatePlayerBanPreferences,
  type BanPreferenceSet,
  type BanResolutionPolicy,
  type HeroUniverse,
} from "./ban-resolution";

// Inline fixture universe (S2): 120 heroes, ordered as if hero 1 were the most-banned.
const ALL = Array.from({ length: 120 }, (_, index) => index + 1);
const UNIVERSE: HeroUniverse = { allHeroIds: ALL, metaOrder: ALL };

function set(playerId: string, ...preferences: (number | null)[]): BanPreferenceSet {
  return { playerId, preferences: [...preferences, ...Array.from({ length: 4 - preferences.length }, () => null)] };
}

describe("BanResolutionPolicy", () => {
  test("mismos inputs + misma seed => salida identica (byte a byte)", () => {
    const player = [90, 91, 92, 93];
    const first = resolveSimulatorBans({ playerPreferences: player, universe: UNIVERSE, seed: "D2K00001" });
    const second = resolveSimulatorBans({ playerPreferences: player, universe: UNIVERSE, seed: "D2K00001" });
    expect(first.ok).toBe(true);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("distinta seed => bans distintos (los simulados cambian; las preferencias del Player no)", () => {
    const player = [90, 91, 92, 93];
    const outputs = new Set(
      ["D2K00001", "D2K00002", "D2K00003", "ABCDEFGH", "QWERTY12", "ZZZZZZZZ"].map((seed) => {
        const result = resolveSimulatorBans({ playerPreferences: player, universe: UNIVERSE, seed });
        return result.ok ? JSON.stringify(result.bans) : "failed";
      }),
    );
    expect(outputs.size).toBeGreaterThan(3);
    expect(outputs.has("failed")).toBe(false);
  });

  test("las preferencias simuladas son deterministas y siempre son 9 sets de <= 4", () => {
    const a = simulateBanPreferences(UNIVERSE, "SEEDSEED");
    expect(simulateBanPreferences(UNIVERSE, "SEEDSEED")).toEqual(a);
    expect(a).toHaveLength(9);
    for (const entry of a) expect(entry.preferences).toHaveLength(4);
  });

  test("garantia: un jugador con las 4 preferencias llenas tiene al menos 1 en el set resuelto", () => {
    // Heroes 110..113 are outside the simulated nomination pool -> no consensus can rescue them.
    for (const seed of ["A1", "B2", "C3", "D4", "E5"]) {
      const result = resolveSimulatorBans({ playerPreferences: [110, 111, 112, 113], universe: UNIVERSE, seed });
      expect(result.ok).toBe(true);
      if (result.ok) expect([110, 111, 112, 113].some((hero) => result.bans.includes(hero))).toBe(true);
    }
  });

  test("deduplicacion: un heroe en las preferencias de 3 jugadores aparece una sola vez", () => {
    const bans = defaultBanResolutionPolicy.resolve(
      [set("a", 7, 1), set("b", 7, 2), set("c", 7, 3), set("d")],
      "seed",
    );
    expect(bans.filter((hero) => hero === 7)).toHaveLength(1);
    expect(new Set(bans).size).toBe(bans.length);
  });

  test("consenso primero: un heroe nominado por varios se banea antes que las nominaciones sueltas", () => {
    const bans = defaultBanResolutionPolicy.resolve([set("a", 7, 1), set("b", 7, 2), set("c", 9, 3)], "seed");
    expect(bans[0]).toBe(7);
  });

  test("empty preference list => 16 unique bans", () => {
    const result = resolveSimulatorBans({ playerPreferences: [], universe: UNIVERSE, seed: "SEED_EMPTY" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bans).toHaveLength(16);
      expect(new Set(result.bans).size).toBe(16);
    }
  });

  test("1 preference => still 16 unique bans", () => {
    const result = resolveSimulatorBans({ playerPreferences: [5], universe: UNIVERSE, seed: "SEED_ONE" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bans).toHaveLength(16);
      expect(new Set(result.bans).size).toBe(16);
    }
  });

  test("4 preferences => still 16 unique bans", () => {
    const result = resolveSimulatorBans({ playerPreferences: [1, 2, 3, 4], universe: UNIVERSE, seed: "SEED_FOUR" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bans).toHaveLength(16);
      expect(new Set(result.bans).size).toBe(16);
    }
  });

  test("same seed => exact same bans (byte-identical across replays)", () => {
    const first = resolveSimulatorBans({ playerPreferences: [10], universe: UNIVERSE, seed: "REPLAY_SEED" });
    const second = resolveSimulatorBans({ playerPreferences: [10], universe: UNIVERSE, seed: "REPLAY_SEED" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.bans).toEqual(second.bans);
    }
  });

  test("different seeds => can produce a different result", () => {
    const results = ["SEED_A", "SEED_B", "SEED_C", "SEED_D", "SEED_E"].map((seed) => {
      const res = resolveSimulatorBans({ playerPreferences: [], universe: UNIVERSE, seed });
      return res.ok ? JSON.stringify(res.bans) : "";
    });
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  test("no duplicate heroes in 16 bans across multiple seeds", () => {
    for (const seed of ["S1", "S2", "S3", "S4", "S5"]) {
      const result = resolveSimulatorBans({ playerPreferences: [7, 8], universe: UNIVERSE, seed });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.bans).toHaveLength(16);
        expect(new Set(result.bans).size).toBe(16);
      }
    }
  });

  test("universe con menos de 16 héroes banea todos los disponibles sin fallar", () => {
    const smallUniverse: HeroUniverse = {
      allHeroIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      metaOrder: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    };
    const result = resolveSimulatorBans({ playerPreferences: [], universe: smallUniverse, seed: "SMALL" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bans).toHaveLength(10);
      expect(new Set(result.bans).size).toBe(10);
    }
  });

  test("un set vacio solo es valido cuando nadie nomino a nadie", () => {
    expect(defaultBanResolutionPolicy.resolve([set("a"), set("b")], "seed")).toEqual([]);
    const nominated = defaultBanResolutionPolicy.resolve([set("a", 5), set("b")], "seed");
    expect(nominated).toEqual([5]);
  });

  test("metaOrder contiene menos de 16 héroes y allHeroIds >= 16 => resuelve exactamente 16 bans únicos", () => {
    const partialMetaUniverse: HeroUniverse = {
      allHeroIds: ALL,
      metaOrder: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    };
    const result1 = resolveSimulatorBans({ playerPreferences: [], universe: partialMetaUniverse, seed: "PARTIAL_META_SEED" });
    expect(result1.ok).toBe(true);
    if (result1.ok) {
      expect(result1.bans).toHaveLength(16);
      expect(new Set(result1.bans).size).toBe(16);
      for (const hero of partialMetaUniverse.metaOrder) {
        expect(result1.bans.includes(hero)).toBe(true);
      }
    }

    const result2 = resolveSimulatorBans({ playerPreferences: [], universe: partialMetaUniverse, seed: "PARTIAL_META_SEED" });
    expect(result2.ok).toBe(true);
    if (result1.ok && result2.ok) {
      expect(result2.bans).toEqual(result1.bans);
    }
  });
});

describe("BanResolutionPolicy -- FAIL CLOSED", () => {
  const throwing: BanResolutionPolicy = { resolve: () => { throw new Error("boom"); } };

  test("una policy que lanza => ok:false, jamas un set vacio o reducido fabricado", () => {
    const result = resolveSimulatorBans({ playerPreferences: [1], universe: UNIVERSE, seed: "X", policy: throwing });
    expect(result).toEqual({ ok: false, reason: "policy_failed", detail: "boom" });
  });

  test("policy personalizada que devuelve menos de min(16, N) héroes => fail closed con policy_invalid_output", () => {
    const reducedPolicy: BanResolutionPolicy = {
      resolve: () => [1, 2, 3, 4, 5],
    };
    const result = resolveSimulatorBans({
      playerPreferences: [],
      universe: UNIVERSE,
      seed: "REDUCED_POLICY_SEED",
      policy: reducedPolicy,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("policy_invalid_output");
      expect(result.detail).toContain("expected exactly 16");
    }
  });

  test("salida invalida (duplicados / heroe inexistente / no-array / vacia pese a nominaciones) => ok:false", () => {
    const cases: BanResolutionPolicy[] = [
      { resolve: () => [1, 1] },
      { resolve: () => [99999] },
      { resolve: () => null as unknown as number[] },
      { resolve: () => [] },
    ];
    for (const policy of cases) {
      const result = resolveSimulatorBans({ playerPreferences: [1], universe: UNIVERSE, seed: "X", policy });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("policy_invalid_output");
    }
  });

  test("preferencias del Player invalidas (input externo) se rechazan antes de la policy", () => {
    const policy: BanResolutionPolicy = { resolve: () => { throw new Error("must not run"); } };
    for (const bad of [[1, 1], [0], [1.5], ["7"], [99999], [1, 2, 3, 4, 5]]) {
      const result = resolveSimulatorBans({ playerPreferences: bad as unknown as number[], universe: UNIVERSE, seed: "X", policy });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_player_preferences");
    }
    expect(validatePlayerBanPreferences([1, null, 3], UNIVERSE)).toEqual({ ok: true, preferences: [1, null, 3] });
  });
});
