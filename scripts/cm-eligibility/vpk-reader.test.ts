import { describe, expect, test } from "bun:test";
import { extractVpkEntry, findVpkEntry, parseVpkDirectory } from "./vpk-reader";
import { buildSyntheticVpkV1 } from "./test-fixtures";

// Hand-built synthetic VPK v1 buffers (test-fixtures.ts), following the documented format
// byte-for-byte -- this is the only way to verify this reader's correctness against the SPEC in
// an environment with no real Steam depot file to test against (see vpk-reader.ts's header
// comment). Not real Valve content: a minimal single-entry archive with inline data.

class ByteWriter {
  private chunks: number[] = [];
  writeUint32(value: number): this {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, value, true);
    this.chunks.push(...new Uint8Array(buf));
    return this;
  }
  toBuffer(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

describe("parseVpkDirectory + extractVpkEntry -- synthetic VPK v1 (spec-conformance, not real Valve data)", () => {
  test("parsea un archivo de una sola entrada en la raíz", () => {
    const buffer = buildSyntheticVpkV1([{ extension: "txt", path: "", filename: "readme", content: "hello vpk" }]);
    const directory = parseVpkDirectory(buffer);
    expect(directory.version).toBe(1);
    expect(directory.entries).toHaveLength(1);
    expect(directory.entries[0]!.fullPath).toBe("readme.txt");
  });

  test("parsea npc_heroes.txt bajo scripts/npc/ y extrae su contenido exacto", () => {
    const content = '"DOTAHeroes" { "npc_dota_hero_antimage" { "HeroID" "1" } }';
    const buffer = buildSyntheticVpkV1([{ extension: "txt", path: "scripts/npc", filename: "npc_heroes", content }]);
    const directory = parseVpkDirectory(buffer);
    const entry = findVpkEntry(directory, "scripts/npc/npc_heroes.txt");
    expect(entry).not.toBeNull();
    const extracted = extractVpkEntry(buffer, directory, entry!);
    expect(new TextDecoder().decode(extracted)).toBe(content);
  });

  test("múltiples entradas bajo distintas extensiones/paths se listan todas", () => {
    const buffer = buildSyntheticVpkV1([
      { extension: "txt", path: "scripts/npc", filename: "npc_heroes", content: "hero data" },
      { extension: "txt", path: "scripts/npc", filename: "npc_abilities", content: "ability data" },
      { extension: "vmt", path: "materials/heroes", filename: "antimage", content: "material data" },
    ]);
    const directory = parseVpkDirectory(buffer);
    expect(directory.entries).toHaveLength(3);
    expect(findVpkEntry(directory, "scripts/npc/npc_abilities.txt")).not.toBeNull();
    expect(findVpkEntry(directory, "materials/heroes/antimage.vmt")).not.toBeNull();
  });

  test("entrada inexistente -> null, nunca lanza", () => {
    const buffer = buildSyntheticVpkV1([{ extension: "txt", path: "", filename: "a", content: "x" }]);
    const directory = parseVpkDirectory(buffer);
    expect(findVpkEntry(directory, "scripts/npc/npc_heroes.txt")).toBeNull();
  });

  test("firma inválida se rechaza explícitamente (fail-closed, nunca un árbol parcial adivinado)", () => {
    const badBuffer = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => parseVpkDirectory(badBuffer)).toThrow(/bad signature/);
  });

  test("versión no soportada se rechaza explícitamente", () => {
    const header = new ByteWriter().writeUint32(0x55aa1234).writeUint32(99).writeUint32(0).toBuffer();
    expect(() => parseVpkDirectory(header)).toThrow(/unsupported version/);
  });

  test("extractVpkEntry sobre un archivo multi-parte (archiveIndex real) lanza un error claramente etiquetado, nunca bytes adivinados", () => {
    const buffer = buildSyntheticVpkV1([{ extension: "txt", path: "", filename: "a", content: "x" }]);
    const directory = parseVpkDirectory(buffer);
    const entry = findVpkEntry(directory, "a.txt")!;
    const multiPartEntry = { ...entry, archiveIndex: 3, entryLength: 5 };
    expect(() => extractVpkEntry(buffer, directory, multiPartEntry)).toThrow(/multi-part archive reading is not implemented/);
  });

  test("path raíz codificado como espacio único (\" \") se normaliza a string vacío", () => {
    const buffer = buildSyntheticVpkV1([{ extension: "txt", path: "", filename: "root-file", content: "y" }]);
    const directory = parseVpkDirectory(buffer);
    expect(directory.entries[0]!.path).toBe("");
  });
});
