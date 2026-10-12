import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseModularPackage } from "./package";
import type { ModularManifest } from "./types";

// G6 MODULARITY candado. Reads the FROZEN Gold Master export on purpose: unlike capabilities.json / percentiles.json this artifact
// is hash-pinned to the CLOSED Blender lookdev (blend sha256 below) and never regenerates per patch — a test bound to its counts
// cannot rot with the meta, it can only fail if the export is wrong.
const GOLD_MASTER_FINAL_BLEND_SHA256 = "64e8136bde369a876356d3f88c5ea7eb4d88b5a78dee7617800c08cbc4cbdf1d";
const BASE = resolve(import.meta.dir, "../../../../public/coach-gold-master/modular");
const manifest = JSON.parse(readFileSync(resolve(BASE, "coach-modular.json"), "utf8")) as ModularManifest;
const bin = readFileSync(resolve(BASE, "coach-modular.bin"));
const arrayBuffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
const data = parseModularPackage(manifest, arrayBuffer);

describe("canonical modular runtime package", () => {
  test("is the approved Gold Master (blend hash pinned)", () => {
    expect(manifest.source.blend_sha256).toBe(GOLD_MASTER_FINAL_BLEND_SHA256);
  });

  test("564 addressable atoms, atom_id 1..564 unique and preserved, cluster_id preserved on every row", () => {
    expect(data.atoms.length).toBe(564);
    expect(data.atoms.map((a) => a.atom_id)).toEqual(Array.from({ length: 564 }, (_, i) => i + 1));
    expect(data.atoms.every((a) => Number.isInteger(a.cluster_id) && a.cluster_id > 0)).toBe(true);
    expect(manifest.counts.clusters).toBe(new Set(data.atoms.map((a) => a.cluster_id)).size);
    expect(manifest.counts.clusters).toBe(195);
  });

  test("every atom carries position + unit quaternion + positive scale (exact TRS, no fused mesh)", () => {
    for (const a of data.atoms) {
      expect(a.position.every(Number.isFinite)).toBe(true);
      const q = Math.hypot(...a.quaternion);
      expect(Math.abs(q - 1)).toBeLessThan(1e-5);
      expect(a.scale.every((s) => s > 0)).toBe(true);
    }
  });

  test("atoms share ONE template (218 verts) and own a per-atom color row (564 x 218 RGBA texels, linear, finite)", () => {
    expect(data.atomTemplate.vertexCount).toBe(218);
    expect(data.atomAlbedoTexels.length).toBe(564 * 218 * 4);
    expect(data.atomAlbedoTexels.every(Number.isFinite)).toBe(true);
    const maxIndex = Math.max(...data.atomTemplate.indices);
    expect(maxIndex).toBe(217);
    expect(new Set(data.atoms.map((a) => a.colorRow)).size).toBe(564);
  });

  test("195 envelopes (cluster_id each), core, visor, 2 eyes, 5 cross cells, 11 shards — all independent", () => {
    expect(data.envelopes.length).toBe(195);
    expect(new Set(data.envelopes.map((e) => e.clusterId)).size).toBe(195);
    expect(data.core.positions.length).toBeGreaterThan(0);
    expect(data.visor.positions.length).toBeGreaterThan(0);
    expect(data.eyeL.generated).not.toBeNull();
    expect(data.eyeR.generated).not.toBeNull();
    expect(data.crossCells.length).toBe(5);
    expect(data.shards.length).toBe(11);
  });

  test("shards retain id, transform, glass color, rim color, scale and orbit metadata (approved 1.30x, SHARD_PULL 0)", () => {
    for (const s of data.shards) {
      expect(s.id).toBe(data.shards.indexOf(s));
      expect(Math.abs(Math.hypot(...s.quaternion) - 1)).toBeLessThan(1e-5);
      expect(s.glass.colorsLinear?.length).toBe((s.glass.positions.length / 3) * 3);
      expect(s.rim.colorsLinear?.length).toBe((s.rim.positions.length / 3) * 3);
      expect(s.orbit.approved_scale).toBe(1.3);
      expect(s.orbit.shard_pull).toBe(0);
      expect(s.orbit.orbit_radius).toBeGreaterThan(0);
    }
    // the one orbit-normal correction the Gold Master recorded
    expect(data.shards[7].orbit.shift_along_orbit_normal).toBeCloseTo(0.0231, 6);
    expect(data.shards.filter((s) => s.orbit.shift_along_orbit_normal !== 0).length).toBe(1);
  });

  test("decoded colors are linear (dark byte stays dark) and never exceed 1", () => {
    for (const e of data.envelopes) expect(Math.max(...(e.colorsLinear as Float32Array))).toBeLessThanOrEqual(1);
    expect(Math.max(...data.atomAlbedoTexels)).toBeLessThanOrEqual(1);
  });

  test("the light rig is the frozen B rig (watts as authored, hierarchy intact)", () => {
    const l = manifest.lights;
    expect([l.Key.energy_w, l.Fill.energy_w, l.TopSoft.energy_w, l.RimCyan.energy_w, l.PinkSecondary.energy_w]).toEqual([650, 70, 1000, 600, 400]);
    expect(l.TopSoft.diffuse_factor).toBeCloseTo(0.15, 6);
    expect(l.TopSoft.specular_factor).toBeCloseTo(2.0, 6);
    expect(manifest.world.lit_strength).toBeCloseTo(0.6, 6);
  });
});
