import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ShaderLib } from "three";
import { createAtomMaterial, createCoreMaterial, createEnvelopeMaterial, createShardGlassMaterial, createShardRimMaterial, createVisorMaterial, setBakedAO, setWrap } from "./materials";
import type { ModularManifest } from "./types";

// Material mapping + shader-extension candado. Runs the REAL onBeforeCompile against three's REAL physical shader strings (no GL needed):
// if a three upgrade moves a chunk the extension patches, `mustReplace` throws here, not as a silently different render.
const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../public/coach-gold-master/modular/coach-modular.json"), "utf8")) as ModularManifest;
const mats = manifest.materials;

function compile(material: { onBeforeCompile: (s: never, r: never) => void }) {
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

describe("Blender Principled -> MeshPhysicalMaterial mapping (documented, not 1:1)", () => {
  test("atoms: roughness 0.40, Specular IOR Level 0.35 -> specularIntensity 0.70, IOR 1.5, no coat, neutral dielectric", () => {
    const { material } = createAtomMaterial(mats, null, "atom-texture");
    expect(material.roughness).toBe(0.4);
    expect(material.specularIntensity).toBeCloseTo(0.7, 10);
    expect(material.ior).toBe(1.5);
    expect(material.clearcoat).toBe(0);
    expect(material.metalness).toBe(0);
  });

  test("glass: transmission 0.65, IOR 1.45, roughness 0.18, level 0.5 -> 1.0, coat 0.30", () => {
    const { material } = createShardGlassMaterial(mats);
    expect([material.transmission, material.ior, material.roughness, material.specularIntensity, material.clearcoat]).toEqual([0.65, 1.45, 0.18, 1, 0.3]);
  });

  test("rim: roughness 0.30, coat 0; envelope: roughness 0.78, level 0.16 -> 0.32; core: no specular", () => {
    expect(createShardRimMaterial(mats).material.roughness).toBeCloseTo(0.3, 10);
    expect(createShardRimMaterial(mats).material.clearcoat).toBe(0);
    const env = createEnvelopeMaterial(mats).material;
    expect([env.roughness, env.specularIntensity]).toEqual([0.78, 0.32]);
    expect(createCoreMaterial(mats).material.specularIntensity).toBe(0);
  });

  test("visor stays a near-black anchor (base color < 0.01 linear on every channel)", () => {
    const { material } = createVisorMaterial(mats);
    expect(Math.max(material.color.r, material.color.g, material.color.b)).toBeLessThan(0.01);
  });
});

describe("shader extension patches", () => {
  test("atom (instanced texture) material: SSS wrap, macro horizon, atom albedo, baked AO and the per-instance texel fetch are all injected", () => {
    const { material } = createAtomMaterial(mats, null, "atom-texture");
    const s = compile(material as never);
    expect(s.fragmentShader).toContain("coachWrappedDiffuseFF");
    expect(s.fragmentShader).toContain("coachMacroVisibility");
    expect(s.fragmentShader).toContain("pow( coachL, vec3( 1.6 ) )");
    expect(s.fragmentShader).toContain("reflectedLight.indirectDiffuse *= coachAO");
    expect(s.vertexShader).toContain("texelFetch( uAtomAlbedo");
    expect(s.vertexShader).toContain("instanceMatrix[ 3 ]");
    expect(Object.keys(s.uniforms)).toEqual(expect.arrayContaining(["uCoachWrap", "uCoachAO", "uCoachMacro", "uAtomAlbedo"]));
  });

  test("the diffuse area-light line is replaced exactly once and the stock specular line keeps its Fresnel term", () => {
    const s = compile(createAtomMaterial(mats, null, "atom-texture").material as never);
    expect(s.fragmentShader.split("coachWrappedDiffuseFF( normal, viewDir, position, lightPos, rectCoords )").length - 1).toBe(1);
    expect(s.fragmentShader).toContain("lightColor * coachVis * fresnel * LTC_Evaluate");
  });

  test("shards emit their own vertex color (glass x2.40, rim x3.00) and do NOT get the body-only patches", () => {
    const glass = createShardGlassMaterial(mats);
    const rim = createShardRimMaterial(mats);
    expect(glass.handle.uniforms.uCoachEmit.value).toBe(2.4);
    expect(rim.handle.uniforms.uCoachEmit.value).toBe(3);
    const s = compile(glass.material as never);
    expect(s.fragmentShader).toContain("totalEmissiveRadiance += vColor.rgb * uCoachEmit");
    expect(s.fragmentShader).not.toContain("coachWrappedDiffuseFF( normal");
    expect(s.fragmentShader).not.toContain("vec3 coachL = max( vCoachCol");
  });

  test("setWrap / setBakedAO retune uniforms without a rebuild; the envelope keeps its smaller SSS (0.08 vs 0.5)", () => {
    const atom = createAtomMaterial(mats, null, "atom-texture");
    const env = createEnvelopeMaterial(mats);
    expect(env.handle.baseWrapGain).toBeCloseTo(0.08 / 0.5, 10);
    setWrap(atom.handle, 0.4, 0.6);
    expect((atom.handle.uniforms.uCoachWrap.value as { x: number }).x).toBeCloseTo(0.5 * 0.4, 10);
    setBakedAO(atom.handle, 1);
    expect(atom.handle.uniforms.uCoachAO.value).toBe(1);
  });

  test("program cache keys differ between macro / no-macro variants (otherwise three would reuse the wrong program)", () => {
    const core = createCoreMaterial(mats).material.customProgramCacheKey();
    const visor = createVisorMaterial(mats).material.customProgramCacheKey();
    expect(core).not.toBe(visor);
  });
});
