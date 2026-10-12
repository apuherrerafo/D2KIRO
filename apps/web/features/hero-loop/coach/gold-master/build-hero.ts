import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Euler,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearSRGBColorSpace,
  Matrix4,
  Mesh,
  NearestFilter,
  Quaternion,
  RGBAFormat,
  RectAreaLight,
  Vector3,
  type Material,
} from "three";
import { areaLightIntensity } from "./constants";
import {
  createAtomMaterial,
  createCoreMaterial,
  createEnvelopeMaterial,
  createEyeMaterial,
  createShardGlassMaterial,
  createShardRimMaterial,
  createVisorMaterial,
  setBakedAO,
  setWrap,
  type BodyExtensionHandle,
} from "./materials";
import type { CoachRuntimeData, LightName, MeshData } from "./types";

export interface HeroCounts {
  atomInstances: number;
  clusters: number;
  envelopes: number;
  shards: number;
  shardMeshes: number;
  crossCells: number;
  meshObjects: number;
  triangles: number;
  vertices: number;
}

export interface CoachHero {
  /** Blender Z-up data wrapped by a -90deg X rotation (-> Three Y-up). Everything below is a child of it. */
  root: Group;
  atoms: InstancedMesh;
  envelopes: Mesh[];
  envelopeGroup: Group;
  core: Mesh;
  visor: Mesh;
  eyes: Mesh[];
  crossCells: Mesh[];
  shardGroups: Group[];
  lights: Record<LightName, RectAreaLight>;
  counts: HeroCounts;
  /** atom_id (1..564) -> instance index, and the reverse. Atoms stay individually addressable. */
  atomIndexById: Map<number, number>;
  /** Re-tune the SSS wrap of every body-family material (atoms, envelopes, cross) without a rebuild. */
  setWrap: (gain: number, tilt: number) => void;
  setBakedAO: (strength: number) => void;
  dispose: () => void;
}

const LIGHT_ORDER: LightName[] = ["Key", "Fill", "TopSoft", "RimCyan", "PinkSecondary"];

function geometryOf(mesh: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  if (mesh.colorsLinear) g.setAttribute("color", new BufferAttribute(mesh.colorsLinear, 3));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** Blender XYZ Euler is R = Rz Ry Rx, i.e. Three's 'ZYX' order with the same angles. */
function blenderEulerQuaternion(e: [number, number, number]): Quaternion {
  return new Quaternion().setFromEuler(new Euler(e[0], e[1], e[2], "ZYX"));
}

function triangleCount(g: BufferGeometry, instances = 1): number {
  const index = g.getIndex();
  return ((index ? index.count : g.getAttribute("position").count) / 3) * instances;
}

export function buildCoachHero(data: CoachRuntimeData): CoachHero {
  const { manifest } = data;
  const root = new Group();
  root.name = "CoachHero";
  root.rotation.x = -Math.PI / 2;

  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };
  const mats = manifest.materials;
  const wrapHandles: BodyExtensionHandle[] = [];
  const aoHandles: BodyExtensionHandle[] = [];

  // ---------------------------------------------------------------- atoms: ONE template, 564 TRS rows, per-instance color rows
  const t = data.atomTemplate;
  const atomGeometry = track(new BufferGeometry());
  atomGeometry.setAttribute("position", new BufferAttribute(t.positions, 3));
  atomGeometry.setAttribute("normal", new BufferAttribute(t.normals, 3));
  const vertexIds = new Float32Array(t.vertexCount);
  for (let i = 0; i < vertexIds.length; i += 1) vertexIds[i] = i;
  atomGeometry.setAttribute("aVertex", new BufferAttribute(vertexIds, 1));
  atomGeometry.setIndex(new BufferAttribute(t.indices, 1));
  const atomRows = new Float32Array(data.atoms.length);
  data.atoms.forEach((a, i) => {
    atomRows[i] = a.colorRow;
  });
  atomGeometry.setAttribute("aAtomRow", new InstancedBufferAttribute(atomRows, 1));
  atomGeometry.boundingSphere = null;

  const atomTexture = track(new DataTexture(data.atomAlbedoTexels, t.vertexCount, manifest.atomColors.rows, RGBAFormat, FloatType));
  atomTexture.minFilter = NearestFilter;
  atomTexture.magFilter = NearestFilter;
  atomTexture.generateMipmaps = false;
  atomTexture.colorSpace = LinearSRGBColorSpace; // already linear: decoded once on the CPU, never re-decoded by the GPU
  atomTexture.needsUpdate = true;

  const atomCreated = createAtomMaterial(mats, atomTexture, "atom-texture");
  wrapHandles.push(atomCreated.handle);
  aoHandles.push(atomCreated.handle);
  const atomMaterial = track(atomCreated.material);
  const atoms = new InstancedMesh(atomGeometry, atomMaterial, data.atoms.length);
  atoms.name = "Atoms";
  atoms.frustumCulled = false;
  const atomIndexById = new Map<number, number>();
  const m4 = new Matrix4();
  data.atoms.forEach((a, i) => {
    m4.compose(new Vector3(...a.position), new Quaternion(...a.quaternion), new Vector3(...a.scale));
    atoms.setMatrixAt(i, m4);
    atomIndexById.set(a.atom_id, i);
  });
  atoms.instanceMatrix.needsUpdate = true;
  atoms.userData = { atomIds: data.atoms.map((a) => a.atom_id), clusterIds: data.atoms.map((a) => a.cluster_id) };
  atoms.castShadow = false;
  atoms.receiveShadow = false;
  root.add(atoms);

  // ---------------------------------------------------------------- envelopes (chromatic slit backing) + core (recessed backstop)
  const envelopeCreated = createEnvelopeMaterial(mats);
  wrapHandles.push(envelopeCreated.handle);
  const envelopeMaterial = track(envelopeCreated.material);
  const envelopes: Mesh[] = [];
  let triangles = triangleCount(atomGeometry, data.atoms.length);
  let vertices = t.vertexCount * data.atoms.length;
  const envelopeGroup = new Group();
  envelopeGroup.name = "Envelopes";
  data.envelopes.forEach((e) => {
    const g = track(geometryOf(e));
    const mesh = new Mesh(g, envelopeMaterial);
    mesh.name = e.label;
    mesh.userData = { clusterId: e.clusterId };
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    envelopes.push(mesh);
    envelopeGroup.add(mesh);
    triangles += triangleCount(g);
    vertices += e.positions.length / 3;
  });
  root.add(envelopeGroup);

  const coreGeometry = track(geometryOf(data.core));
  const core = new Mesh(coreGeometry, track(createCoreMaterial(mats).material));
  core.name = "Core";
  root.add(core);

  // ---------------------------------------------------------------- visor + eyes
  const visorGeometry = track(geometryOf(data.visor));
  const visor = new Mesh(visorGeometry, track(createVisorMaterial(mats).material));
  visor.name = "Visor";
  root.add(visor);

  const eyeMaterial = track(createEyeMaterial());
  const eyes = [data.eyeL, data.eyeR].map((e) => {
    const g = track(geometryOf(e));
    if (e.generated) g.setAttribute("aGen", new BufferAttribute(e.generated, 3));
    const mesh = new Mesh(g, eyeMaterial);
    mesh.name = e.label;
    root.add(mesh);
    triangles += triangleCount(g);
    vertices += e.positions.length / 3;
    return mesh;
  });

  // ---------------------------------------------------------------- cross (body-material family, per-vertex Col + Occ)
  const crossCreated = createAtomMaterial(mats, null, "atom-attribute");
  wrapHandles.push(crossCreated.handle);
  aoHandles.push(crossCreated.handle);
  const crossMaterial = track(crossCreated.material);
  const crossCells = data.crossCells.map((c, i) => {
    const g = track(geometryOf(c));
    g.deleteAttribute("color");
    g.setAttribute("aCoachCol", new BufferAttribute(c.colorsLinear as Float32Array, 3));
    g.setAttribute("aCoachOcc", new BufferAttribute(c.occLinear as Float32Array, 1));
    const mesh = new Mesh(g, crossMaterial);
    mesh.name = `Cross_Cell_${i}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    root.add(mesh);
    triangles += triangleCount(g);
    vertices += c.positions.length / 3;
    return mesh;
  });

  // ---------------------------------------------------------------- shards: ISOLATED light policy (no shadow, no extra light)
  const glassMaterial = track(createShardGlassMaterial(mats).material);
  const rimMaterial = track(createShardRimMaterial(mats).material);
  const shardGroups = data.shards.map((s) => {
    const group = new Group();
    group.name = s.name;
    group.position.set(...s.position);
    group.quaternion.set(...s.quaternion);
    group.userData = { shardId: s.id, orbit: s.orbit };
    const glassGeometry = track(geometryOf(s.glass));
    const rimGeometry = track(geometryOf(s.rim));
    const glass = new Mesh(glassGeometry, glassMaterial);
    const rim = new Mesh(rimGeometry, rimMaterial);
    glass.name = `${s.name}_Glass`;
    rim.name = `${s.name}_Rim`;
    [glass, rim].forEach((m: Mesh) => {
      m.castShadow = false;
      m.receiveShadow = false;
    });
    group.add(glass, rim);
    root.add(group);
    triangles += triangleCount(glassGeometry) + triangleCount(rimGeometry);
    vertices += s.glass.positions.length / 3 + s.rim.positions.length / 3;
    return group;
  });

  // ---------------------------------------------------------------- the frozen B rig, geometry first (Blender transforms as-is)
  const lights = {} as Record<LightName, RectAreaLight>;
  LIGHT_ORDER.forEach((name) => {
    const spec = manifest.lights[name];
    const light = new RectAreaLight(0xffffff, areaLightIntensity(spec.energy_w, spec.size), spec.size, spec.size);
    light.color.setRGB(spec.color[0], spec.color[1], spec.color[2]);
    light.position.set(...spec.position);
    light.quaternion.copy(blenderEulerQuaternion(spec.rotation_euler));
    light.name = name;
    root.add(light);
    lights[name] = light;
  });

  const meshObjects = 1 + envelopes.length + 1 + 1 + eyes.length + crossCells.length + shardGroups.length * 2;
  const counts: HeroCounts = {
    atomInstances: data.atoms.length,
    clusters: manifest.counts.clusters,
    envelopes: envelopes.length,
    shards: shardGroups.length,
    shardMeshes: shardGroups.length * 2,
    crossCells: crossCells.length,
    meshObjects,
    triangles,
    vertices,
  };
  const retuneWrap = (gain: number, tilt: number) => {
    wrapHandles.forEach((h) => setWrap(h, gain, tilt));
  };
  const retuneAO = (strength: number) => {
    aoHandles.forEach((h) => setBakedAO(h, strength));
  };
  const dispose = () => {
    disposables.forEach((d) => d.dispose());
    atoms.dispose();
    [atomMaterial, envelopeMaterial, glassMaterial, rimMaterial, crossMaterial, eyeMaterial].forEach((m: Material) => m.dispose());
  };
  return { root, atoms, envelopes, envelopeGroup, core, visor, eyes, crossCells, shardGroups, lights, counts, atomIndexById, setWrap: retuneWrap, setBakedAO: retuneAO, dispose };
}
