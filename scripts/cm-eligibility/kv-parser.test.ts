import { describe, expect, test } from "bun:test";
import { kvChild, kvChildEntries, kvString, parseKeyValues } from "./kv-parser";

describe("parseKeyValues -- Valve KV1 text format", () => {
  test("pares clave/valor simples entre comillas", () => {
    const result = parseKeyValues(`"DOTAHeroes" { "HeroID" "1" "Enabled" "1" }`);
    const heroes = kvChild(result, "DOTAHeroes")!;
    expect(kvString(heroes, "HeroID")).toBe("1");
    expect(kvString(heroes, "Enabled")).toBe("1");
  });

  test("bloques anidados arbitrariamente profundos", () => {
    const result = parseKeyValues(`
      "root" {
        "npc_dota_hero_antimage" {
          "HeroID" "1"
          "Ability1" { "SpecialBonus1" { "value" "10" } }
        }
      }
    `);
    const root = kvChild(result, "root")!;
    const hero = kvChild(root, "npc_dota_hero_antimage")!;
    expect(kvString(hero, "HeroID")).toBe("1");
    const ability = kvChild(hero, "Ability1")!;
    const bonus = kvChild(ability, "SpecialBonus1")!;
    expect(kvString(bonus, "value")).toBe("10");
  });

  test("ignora comentarios de línea //", () => {
    const result = parseKeyValues(`
      "root" {
        // esto es un comentario, no una clave
        "HeroID" "1" // comentario al final de línea
      }
    `);
    const root = kvChild(result, "root")!;
    expect(kvString(root, "HeroID")).toBe("1");
  });

  test("strings con comillas escapadas \\\" se desescapan", () => {
    const result = parseKeyValues(`"root" { "Name" "El \\"Rey\\" Invisible" }`);
    const root = kvChild(result, "root")!;
    expect(kvString(root, "Name")).toBe('El "Rey" Invisible');
  });

  test("claves repetidas al mismo nivel se acumulan como array", () => {
    const result = parseKeyValues(`"root" { "Ability" "a1" "Ability" "a2" "Ability" "a3" }`);
    const root = kvChild(result, "root")!;
    expect(root["Ability"]).toEqual(["a1", "a2", "a3"]);
  });

  test("tokens sin comillas también se leen (algunas claves de Valve no llevan comillas)", () => {
    const result = parseKeyValues(`root { HeroID 1 Enabled 1 }`);
    const root = kvChild(result, "root")!;
    expect(kvString(root, "HeroID")).toBe("1");
  });

  test("kvChildEntries devuelve solo los hijos que son bloques, en orden", () => {
    const result = parseKeyValues(`
      "DOTAHeroes" {
        "Version" "1"
        "npc_dota_hero_antimage" { "HeroID" "1" }
        "npc_dota_hero_axe" { "HeroID" "2" }
      }
    `);
    const heroes = kvChild(result, "DOTAHeroes")!;
    const entries = kvChildEntries(heroes);
    expect(entries.map(([key]) => key)).toEqual(["npc_dota_hero_antimage", "npc_dota_hero_axe"]);
  });

  test("documento vacío o solo espacios/comentarios -> nodo raíz vacío, no lanza", () => {
    expect(parseKeyValues("")).toEqual({});
    expect(parseKeyValues("   \n // solo un comentario\n  ")).toEqual({});
  });

  test("clave sin valor lanza (input malformado) -- el llamador decide cómo degradar", () => {
    expect(() => parseKeyValues(`"root" { "HeroID" }`)).toThrow();
  });

  test("llave de cierre extra lanza", () => {
    expect(() => parseKeyValues(`"root" { "HeroID" "1" } }`)).not.toThrow(); // el extra "}" se ignora como EOF temprano del root
  });
});
