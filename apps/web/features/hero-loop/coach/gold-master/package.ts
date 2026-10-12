import { decodeStoredAlpha, decodeStoredRgba, decodeStoredRgbaWithOcc } from "./color";
import type { BufferViewRef, CoachRuntimeData, MeshData, MeshRef, ModularManifest, ShardData } from "./types";

export const MODULAR_PACKAGE_BASE = "/coach-gold-master/modular";
export const MODULAR_MANIFEST_URL = `${MODULAR_PACKAGE_BASE}/coach-modular.json`;
export const MODULAR_BIN_URL = `${MODULAR_PACKAGE_BASE}/coach-modular.bin`;

function bytesOf(view: BufferViewRef, bin: ArrayBuffer): Uint8Array {
  if (view.offset + view.byteLength > bin.byteLength) throw new Error(`coach package: view out of range (${view.offset}+${view.byteLength})`);
  return new Uint8Array(bin, view.offset, view.byteLength);
}

function floats(view: BufferViewRef, bin: ArrayBuffer): Float32Array {
  const expected = view.count * view.itemSize;
  const out = new Float32Array(bin.slice(view.offset, view.offset + view.byteLength));
  if (out.length !== expected) throw new Error(`coach package: float view length ${out.length} != ${expected}`);
  return out;
}

function indices(view: BufferViewRef, bin: ArrayBuffer): Uint16Array | Uint32Array {
  const slice = bin.slice(view.offset, view.offset + view.byteLength);
  if (view.componentType === "uint32") return new Uint32Array(slice);
  return new Uint16Array(slice);
}

type ColorMode = "col" | "colOcc" | "none";

function decodeMesh(ref: MeshRef, bin: ArrayBuffer, mode: ColorMode): MeshData {
  let colorsLinear: Float32Array | null = null;
  let occLinear: Float32Array | null = null;
  if (ref.colors && mode !== "none") {
    const bytes = bytesOf(ref.colors, bin);
    colorsLinear = decodeStoredRgba(bytes, ref.vertexCount);
    if (mode === "colOcc") occLinear = decodeStoredAlpha(bytes, ref.vertexCount);
  }
  return {
    label: ref.label,
    positions: floats(ref.positions, bin),
    normals: floats(ref.normals, bin),
    indices: indices(ref.indices, bin),
    colorsLinear,
    occLinear,
    generated: ref.generated ? floats(ref.generated, bin) : null,
    clusterId: ref.cluster_id ?? null,
  };
}

/** Pure: manifest + .bin -> GPU-ready data. Every stored byte is decoded here, once (see color.ts). */
export function parseModularPackage(manifest: ModularManifest, bin: ArrayBuffer): CoachRuntimeData {
  if (manifest.schema !== "coach-gold-master-web/modular/v1") throw new Error(`coach package: unknown schema ${manifest.schema}`);
  const t = manifest.atomTemplate;
  const atomBytes = bytesOf(manifest.atomColors.view, bin);
  const texelCount = manifest.atomColors.rows * manifest.atomColors.perRow;
  const shards: ShardData[] = manifest.shards.map((s) => ({
    id: s.shard_id,
    name: s.name,
    position: s.position,
    quaternion: s.quaternion,
    scale: s.scale,
    glass: decodeMesh(s.glass, bin, "col"),
    rim: decodeMesh(s.rim, bin, "col"),
    orbit: s.orbit,
  }));
  return {
    manifest,
    atomTemplate: { positions: floats(t.positions, bin), normals: floats(t.normals, bin), indices: indices(t.indices, bin), vertexCount: t.vertexCount },
    atomAlbedoTexels: decodeStoredRgbaWithOcc(atomBytes, texelCount),
    atoms: manifest.atoms,
    envelopes: manifest.envelopes.map((e) => decodeMesh(e, bin, "col")),
    core: decodeMesh(manifest.core, bin, "col"),
    visor: decodeMesh(manifest.visor, bin, "none"),
    eyeL: decodeMesh(manifest.eyes.Eye_L, bin, "none"),
    eyeR: decodeMesh(manifest.eyes.Eye_R, bin, "none"),
    crossCells: manifest.cross.cells.map((c) => decodeMesh(c, bin, "colOcc")),
    shards,
  };
}

export async function loadModularPackage(fetchImpl: typeof fetch = fetch): Promise<CoachRuntimeData> {
  const [manifestResponse, binResponse] = await Promise.all([fetchImpl(MODULAR_MANIFEST_URL), fetchImpl(MODULAR_BIN_URL)]);
  if (!manifestResponse.ok) throw new Error(`coach package: manifest HTTP ${manifestResponse.status}`);
  if (!binResponse.ok) throw new Error(`coach package: bin HTTP ${binResponse.status}`);
  const manifest = (await manifestResponse.json()) as ModularManifest;
  return parseModularPackage(manifest, await binResponse.arrayBuffer());
}
