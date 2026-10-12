import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Matrix4, Quaternion, Vector3 } from "three";
import { buildCoachHero } from "./build-hero";
import { areaLightIntensity } from "./constants";
import { parseModularPackage } from "./package";
import type { ModularManifest } from "./types";

// Builds the real hero (three objects only, no GL). The package is the frozen Gold Master export (see package.test.ts).
const BASE = resolve(import.meta.dir, "../../../../public/coach-gold-master/modular");
const manifest = JSON.parse(readFileSync(resolve(BASE, "coach-modular.json"), "utf8")) as ModularManifest;
const bin = readFileSync(resolve(BASE, "coach-modular.bin"));
const data = parseModularPackage(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);
const hero = buildCoachHero(data);

describe("buildCoachHero — G6 modularity + the frozen rig", () => {
  test("564 atom instances, 195 envelopes, 11 shards (22 meshes), 5 cross cells, 5 lights; atoms are ONE InstancedMesh, never a fused mesh", () => {
    expect(hero.atoms.isInstancedMesh).toBe(true);
    expect(hero.atoms.count).toBe(564);
    expect(hero.counts).toMatchObject({ atomInstances: 564, clusters: 195, envelopes: 195, shards: 11, shardMeshes: 22, crossCells: 5 });
    expect(Object.keys(hero.lights).length).toBe(5);
  });

  test("atom_id and cluster_id stay addressable per instance", () => {
    const ids = hero.atoms.userData.atomIds as number[];
    const clusters = hero.atoms.userData.clusterIds as number[];
    expect(ids.length).toBe(564);
    expect(hero.atomIndexById.get(564)).toBe(563);
    expect(clusters[hero.atomIndexById.get(1) as number]).toBe(data.atoms[0].cluster_id);
  });

  test("an instance matrix reproduces the exported TRS (center = exported position)", () => {
    const m = new Matrix4();
    hero.atoms.getMatrixAt(100, m);
    const p = new Vector3();
    const q = new Quaternion();
    m.decompose(p, q, new Vector3());
    const a = data.atoms[100];
    expect(p.distanceTo(new Vector3(...a.position))).toBeLessThan(1e-6);
    expect(q.angleTo(new Quaternion(...a.quaternion))).toBeLessThan(1e-3); // acos near 1 amplifies float rounding: 1e-8 in the dot is 2e-4 rad
  });

  test("the root maps Blender Z-up to Three Y-up: a Blender +Z point ends up at world +Y", () => {
    hero.root.updateMatrixWorld(true);
    const up = new Vector3(0, 0, 1).applyMatrix4(hero.root.matrixWorld);
    expect(up.y).toBeCloseTo(1, 10);
  });

  test("ISOLATED shard/cross light policy: nothing casts or receives shadows, shards add no lights", () => {
    const flat: { castShadow: boolean; receiveShadow: boolean }[] = [hero.atoms, ...hero.envelopes, hero.core, hero.visor, ...hero.crossCells];
    hero.shardGroups.forEach((g) => g.children.forEach((c) => flat.push(c as never)));
    expect(flat.every((o) => !o.castShadow && !o.receiveShadow)).toBe(true);
    let lights = 0;
    hero.root.traverse((o) => {
      if ((o as { isLight?: boolean }).isLight) lights += 1;
    });
    expect(lights).toBe(5);
  });

  test("lights: radiance = watts/(pi*size^2) (one scalar) and every light aims at the subject (Blender XYZ euler -> Three ZYX is right)", () => {
    hero.root.updateMatrixWorld(true);
    const target = new Vector3(0, 0.14, 0); // subject center in Three space
    (Object.keys(hero.lights) as (keyof typeof hero.lights)[]).forEach((name) => {
      const light = hero.lights[name];
      const spec = manifest.lights[name];
      expect(light.intensity).toBeCloseTo(areaLightIntensity(spec.energy_w, spec.size), 10);
      const pos = new Vector3();
      light.getWorldPosition(pos);
      const forward = new Vector3(0, 0, -1).applyQuaternion(light.getWorldQuaternion(new Quaternion()));
      expect(forward.dot(target.clone().sub(pos).normalize())).toBeGreaterThan(0.85);
    });
  });

  test("shards keep their exported transform and orbit metadata", () => {
    const g = hero.shardGroups[7];
    expect(g.position.distanceTo(new Vector3(...data.shards[7].position))).toBeLessThan(1e-6);
    expect((g.userData.orbit as { shift_along_orbit_normal: number }).shift_along_orbit_normal).toBeCloseTo(0.0231, 6);
  });
});
