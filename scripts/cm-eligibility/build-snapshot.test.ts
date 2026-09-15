import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, runBuild } from "./build-snapshot";
import { buildSyntheticVpkV1 } from "./test-fixtures";

const tempPaths: string[] = [];
afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cm-eligibility-test-"));
  tempPaths.push(dir);
  return dir;
}

describe("parseArgs", () => {
  test("lee --vpk/--patch/--build-id/--out/--allow-demo-output", () => {
    const args = parseArgs(["--vpk", "/x/pak01_dir.vpk", "--patch", "7.41e", "--build-id", "12345", "--depot-id", "373301", "--manifest-id", "fixture-manifest", "--out", "/tmp/out.json", "--allow-demo-output"]);
    expect(args).toEqual({ vpkPath: "/x/pak01_dir.vpk", patch: "7.41e", buildId: "12345", depotId: "373301", manifestId: "fixture-manifest", out: "/tmp/out.json", allowDemoOutput: true });
  });

  test("valores por defecto sin flags", () => {
    const args = parseArgs([]);
    expect(args.vpkPath).toBeNull();
    expect(args.allowDemoOutput).toBe(false);
  });
});

describe("runBuild -- modo demo (sin --vpk, este entorno no tiene depot real)", () => {
  test("sin --allow-demo-output: no escribe nada en disco, reporta claramente que es demo", () => {
    const result = runBuild({ vpkPath: null, patch: "demo", buildId: "demo", depotId: null, manifestId: null, out: null, allowDemoOutput: false });
    expect(result.ok).toBe(true);
    expect(result.isDemo).toBe(true);
    expect(result.snapshotPath).toBeUndefined();
    expect(result.message).toContain("DEMO MODE");
    expect(result.message).toContain("NOT real Valve data");
  });

  test("con --allow-demo-output: escribe el artefacto, etiquetado como demo en depotManifests", () => {
    const dir = tempDir();
    const outPath = join(dir, "demo-snapshot.json");
    const result = runBuild({ vpkPath: null, patch: "demo", buildId: "demo", depotId: null, manifestId: null, out: outPath, allowDemoOutput: true });
    expect(result.ok).toBe(true);
    expect(existsSync(outPath)).toBe(true);
    const written = JSON.parse(readFileSync(outPath, "utf-8"));
    expect(written.depotManifests["570"]).toBe("DEMO_FIXTURE_NOT_REAL_DEPOT_DATA");
    expect(written.provenance.kind).toBe("DEMO_FIXTURE");
    expect(written.heroIds).toEqual([1, 2]); // antimage + axe from the demo fixture, base template excluded
  });
});

describe("runBuild -- modo real (--vpk apuntando a un archivo)", () => {
  test("VPK inexistente -> ok:false, mensaje claro, nada escrito", () => {
    const result = runBuild({ vpkPath: "/nowhere/pak01_dir.vpk", patch: "7.41e", buildId: "1", depotId: "fixture-depot", manifestId: "fixture-manifest", out: null, allowDemoOutput: false });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
  });

  test("VPK real (sintético) sin scripts/npc/npc_heroes.txt -> ok:false", () => {
    const dir = tempDir();
    const vpkPath = join(dir, "pak01_dir.vpk");
    writeFileSync(vpkPath, buildSyntheticVpkV1([{ extension: "txt", path: "", filename: "unrelated", content: "x" }]));
    const result = runBuild({ vpkPath, patch: "7.41e", buildId: "1", depotId: "fixture-depot", manifestId: "fixture-manifest", out: null, allowDemoOutput: false });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found inside");
  });

  test("un --vpk arbitrario sin identidad de depot no se trata automáticamente como oficial", () => {
    const dir = tempDir();
    const vpkPath = join(dir, "pak01_dir.vpk");
    writeFileSync(vpkPath, buildSyntheticVpkV1([]));
    const result = runBuild({ vpkPath, patch: "7.41e", buildId: "buildX", depotId: null, manifestId: null, out: null, allowDemoOutput: false });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ELIGIBILITY_UNVERIFIED");
  });

  test("pipeline completo con provenance explícita: VPK sintético -> snapshot estructural oficial", () => {
    const dir = tempDir();
    const vpkPath = join(dir, "pak01_dir.vpk");
    const npcHeroesContent = '"DOTAHeroes" { "npc_dota_hero_antimage" { "HeroID" "1" } "npc_dota_hero_axe" { "HeroID" "2" } }';
    writeFileSync(vpkPath, buildSyntheticVpkV1([{ extension: "txt", path: "scripts/npc", filename: "npc_heroes", content: npcHeroesContent }]));
    const outPath = join(dir, "out.json");

    const result = runBuild({ vpkPath, patch: "7.41e", buildId: "buildX", depotId: "fixture-depot", manifestId: "fixture-manifest", out: outPath, allowDemoOutput: false });
    expect(result.ok).toBe(true);
    expect(result.isDemo).toBe(false);
    expect(existsSync(outPath)).toBe(true);

    const written = JSON.parse(readFileSync(outPath, "utf-8"));
    expect(written.schema).toBe("cm-hero-eligibility/v1");
    expect(written.patch).toBe("7.41e");
    expect(written.buildId).toBe("buildX");
    expect(written.heroIds).toEqual([1, 2]);
    expect(written.depotManifests["570"]).not.toBe("DEMO_FIXTURE_NOT_REAL_DEPOT_DATA");
    expect(written.depotManifests["570"]).toBe("fixture-manifest");
    expect(written.provenance).toMatchObject({ kind: "OFFICIAL_DEPOT", appId: 570, buildId: "buildX", depotId: "fixture-depot", manifestId: "fixture-manifest" });
    expect(typeof written.contentHash).toBe("string");
  });
});
