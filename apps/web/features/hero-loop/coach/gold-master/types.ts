// Manifest of the CANONICAL MODULAR RUNTIME PACKAGE written by
// art/coach-pipeline/webexport/export_modular.py. Hand-mirrored: the exporter is Python, there is no shared source.

export type ComponentType = "float32" | "uint8" | "uint16" | "uint32";

export interface BufferViewRef {
  offset: number;
  byteLength: number;
  componentType: ComponentType;
  count: number;
  itemSize: number;
}

export interface MeshRef {
  label: string;
  vertexCount: number;
  triangleCount: number;
  positions: BufferViewRef;
  normals: BufferViewRef;
  indices: BufferViewRef;
  /** stored sRGB bytes, RGBA8 (see `colorLayout`) */
  colors?: BufferViewRef;
  colorLayout?: string | null;
  generated?: BufferViewRef;
  generatedBBox?: { min: number[]; max: number[] };
  cluster_id?: number;
  centroid?: number[];
}

export interface AtomRow {
  atom_id: number;
  cluster_id: number;
  name: string;
  colorRow: number;
  position: [number, number, number];
  /** x, y, z, w */
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

export interface ShardOrbit {
  layout_loc: number[];
  radial: number[];
  orbit_radius: number;
  bend_radius: number;
  shift_along_orbit_normal: number;
  layout_size_unscaled: [number, number];
  approved_scale: number;
  tilt_deg: number;
  side: number;
  shear: number;
  taper: number;
  glass_hue: number;
  rim_hue: number;
  layout_quaternion: number[];
  shard_pull: number;
}

export interface ShardRef {
  shard_id: number;
  name: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: number;
  glass: MeshRef;
  rim: MeshRef;
  orbit: ShardOrbit;
}

export interface LightSpec {
  type: string;
  shape: string;
  size: number;
  size_y: number;
  energy_w: number;
  color: [number, number, number];
  position: [number, number, number];
  rotation_euler: [number, number, number];
  diffuse_factor: number;
  specular_factor: number;
}

export type LightName = "Key" | "Fill" | "TopSoft" | "RimCyan" | "PinkSecondary";

export interface ModularManifest {
  schema: string;
  source: { blend_sha256: string; blender: string };
  counts: {
    atoms: number;
    clusters: number;
    envelopes: number;
    shards: number;
    shard_glass_meshes: number;
    shard_rim_boxes: number;
    cross_cells: number;
  };
  atomTemplate: { vertexCount: number; triangleCount: number; positions: BufferViewRef; normals: BufferViewRef; indices: BufferViewRef };
  atomColors: { view: BufferViewRef; rows: number; perRow: number; layout: string };
  atoms: AtomRow[];
  envelopes: MeshRef[];
  core: MeshRef;
  visor: MeshRef;
  eyes: { Eye_L: MeshRef; Eye_R: MeshRef };
  cross: { cells: MeshRef[] };
  shards: ShardRef[];
  camera: {
    lens_mm: number;
    sensor_mm: number;
    distance: number;
    height: number;
    target: [number, number, number];
    azimuth_deg: { HERO: number; FRONT: number; SIDE: number };
  };
  lights: Record<LightName, LightSpec>;
  world: { color: [number, number, number]; camera_strength: number; lit_strength: number };
  materials: Record<string, Record<string, number | number[]>>;
  display: { ev: number; exposure_factor: number; bg_scale: number; glare: { threshold: number; strength: number; size: number } };
}

/** Decoded, GPU-ready (Float32 linear) mesh. Colors are decoded exactly once, in `package.ts`. */
export interface MeshData {
  label: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** linear RGB (decoded once from the stored bytes), 3 per vertex */
  colorsLinear: Float32Array | null;
  /** linear Occ (Mat_Life_P2 only), 1 per vertex */
  occLinear: Float32Array | null;
  generated: Float32Array | null;
  clusterId: number | null;
}

export interface ShardData {
  id: number;
  name: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: number;
  glass: MeshData;
  rim: MeshData;
  orbit: ShardOrbit;
}

export interface CoachRuntimeData {
  manifest: ModularManifest;
  atomTemplate: { positions: Float32Array; normals: Float32Array; indices: Uint16Array | Uint32Array; vertexCount: number };
  /** RGBA Float32, rows = atoms (colorRow), columns = template vertex. RGB = linear Col, A = linear Occ. */
  atomAlbedoTexels: Float32Array;
  atoms: AtomRow[];
  envelopes: MeshData[];
  core: MeshData;
  visor: MeshData;
  eyeL: MeshData;
  eyeR: MeshData;
  crossCells: MeshData[];
  shards: ShardData[];
}
