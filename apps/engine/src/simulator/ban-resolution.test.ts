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

  test("longitud variable: el numero de bans depende de los solapamientos", () => {
    const lengths = new Set(
      ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8"].map((seed) => {
        const result = resolveSimulatorBans({ playerPreferences: [], universe: UNIVERSE, seed });
        return result.ok ? result.bans.length : -1;
      }),
    );
    expect(lengths.has(-1)).toBe(false);
    expect(lengths.size).toBeGreaterThan(1);
  });

  test("un set vacio solo es valido cuando nadie nomino a nadie", () => {
    expect(defaultBanResolutionPolicy.resolve([set("a"), set("b")], "seed")).toEqual([]);
    const nominated = defaultBanResolutionPolicy.resolve([set("a", 5), set("b")], "seed");
    expect(nominated).toEqual([5]);
  });
});

describe("BanResolutionPolicy -- FAIL CLOSED", () => {
  const throwing: BanResolutionPolicy = { resolve: () => { throw new Error("boom"); } };

  test("una policy que lanza => ok:false, jamas un set vacio o reducido fabricado", () => {
    const result = resolveSimulatorBans({ playerPreferences: [1], universe: UNIVERSE, seed: "X", policy: throwing });
    expect(result).toEqual({ ok: false, reason: "policy_failed", detail: "boom" });
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
