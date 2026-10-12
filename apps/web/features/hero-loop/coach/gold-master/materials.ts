import {
  Color,
  MeshPhysicalMaterial,
  ShaderChunk,
  ShaderMaterial,
  Vector3,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { SSS_RADIUS, SSS_WEIGHT, specularIntensityFromBlenderLevel } from "./constants";

// ------------------------------------------------------------------------------------------------------------------
// ONE isolated shader extension. It carries the three things stock MeshPhysicalMaterial cannot express:
//   1. SSS approximation  - Blender Random Walk (weight 0.5, radius 1.0/0.6/0.4) -> "wrap" on the rect-area diffuse integral.
//   2. (removed) Per-light diffuse/specular factors: TopSoft's 0.15 / 2.0 are EEVEE-only light properties. Measured in Blender
//      5.2: Cycles renders a plane identically for diffuse_factor 1 / 0.15 / 0 and specular_factor 1 / 2. The Gold Master
//      (Cycles) therefore lit the scene with TopSoft at 1.0 / 1.0, and so do we.
//   3. Atom albedo - Mat_Life_P2: mix(Col, Col^1.6, 0.8 - 0.8*Occ), per-vertex, per-instance (Float32 texel row per atom).
//   4. Vertex-colored emission - shards (glass x2.40, rim x3.00) and envelopes (x0.01) emit their own vertex color.
// Nothing else is customised. Everything is guarded: if a three upgrade moves a chunk, `patch()` throws instead of rendering
// a silently different look.
// ------------------------------------------------------------------------------------------------------------------

export type AlbedoMode = "vertex" | "atom-texture" | "atom-attribute";

export interface BodyExtensionOptions {
  albedo: AlbedoMode;
  /** SSS wrap weight multiplier (1 = the Blender body weight 0.5 x radius). */
  wrapGain: number;
  /** Rect-area normal tilt toward the light used by the wrap (0..1). */
  wrapTilt: number;
  /** Extra emission = vertex color x this (0 = none). */
  emissionScale: number;
  /** `atom-texture` only: the Float32 RGBA texel texture (rows = atoms, cols = template vertex). */
  atomTexture?: unknown;
  /** Whether the wrap term is active (envelope/core use a much smaller body weight). */
  sss: boolean;
  /** Body self-shadow by the macro horizon (radial normal of the sphere the atoms sit on). Off for the cross and the shards. */
  macroShadow?: boolean;
  /** Baked-AO strength on the INDIRECT light of atom-family materials (0 = off, 1 = the authored Occ). Cycles GI occludes the world light; three's IBL does not. */
  bakedAO?: number;
}

export interface BodyExtensionHandle {
  uniforms: Record<string, IUniform>;
  /** wrapGain the material was authored with (1 = body, 0.16 = envelope) — `setWrap` scales around it. */
  baseWrapGain: number;
}

export function setBakedAO(handle: BodyExtensionHandle, strength: number): void {
  handle.uniforms.uCoachAO.value = strength;
}

export function setWrap(handle: BodyExtensionHandle, gain: number, tilt: number): void {
  (handle.uniforms.uCoachWrap.value as Vector3).set(...SSS_RADIUS).multiplyScalar(SSS_WEIGHT * handle.baseWrapGain * gain);
  handle.uniforms.uCoachWrapTilt.value = tilt;
}

const MARK_DIRECT_RECT = "void RE_Direct_RectArea_Physical(";
const SPEC_LINE = /reflectedLight\.directSpecular \+= lightColor \* fresnel \* LTC_Evaluate\( normal, viewDir, position, mInv, rectCoords \);/;
const DIFF_LINE =
  /reflectedLight\.directDiffuse \+= lightColor \* material\.diffuseContribution \* LTC_Evaluate\( normal, viewDir, position, mat3\( 1\.0 \), rectCoords \);/;

const HELPERS = /* glsl */ `
uniform vec3 uCoachWrap;
uniform float uCoachWrapTilt;

// Body self-shadow by the macro horizon. Cycles ray-traces the sphere blocking a light past the terminator; three's RectAreaLight has
// no shadows, so a pad whose tilted micro-normal faces the light but whose macro (radial) normal does not would still be lit.
// Visibility = smooth step over +-sin(half angle subtended by the area light): the width comes from the light, not from eyeballing.
float coachMacroVisibility( const in vec3 P, const in vec3 lightPos, const in vec3 hw, const in vec3 hh ) {
	if ( uCoachMacro < 0.5 ) return 1.0;
	vec3 toL = lightPos - P;
	float d = max( length( toL ), 1e-3 );
	float w = max( length( hw ), length( hh ) ) / d;
	return smoothstep( -w, w, dot( coachMacroN, toL / d ) );
}

// SSS approximation: the cosine-weighted rect-area form factor, re-evaluated with the normal tilted toward the light and
// blended per channel by weight x radius. Red (radius 1.0) wraps furthest past the terminator, blue (0.4) least: warm, soft.
vec3 coachWrappedDiffuseFF( const in vec3 N, const in vec3 V, const in vec3 P, const in vec3 lightPos, const in vec3 rectCoords[ 4 ] ) {
	float ff0 = LTC_Evaluate( N, V, P, mat3( 1.0 ), rectCoords ).x;
	vec3 lc = normalize( lightPos - P );
	vec3 Nt = normalize( N + lc * uCoachWrapTilt );
	float ffT = LTC_Evaluate( Nt, V, P, mat3( 1.0 ), rectCoords ).x;
	return mix( vec3( ff0 ), vec3( ffT ), clamp( uCoachWrap, 0.0, 1.0 ) );
}
`;

function patchLightsPhysicalPars(): string {
  let src = ShaderChunk.lights_physical_pars_fragment;
  if (!src.includes(MARK_DIRECT_RECT) || !SPEC_LINE.test(src) || !DIFF_LINE.test(src)) {
    throw new Error("coach material extension: three's lights_physical_pars_fragment changed — re-derive the patch");
  }
  src = src.replace(MARK_DIRECT_RECT, `${HELPERS}\n${MARK_DIRECT_RECT}`);
  src = src.replace(
    SPEC_LINE,
    "float coachVis = coachMacroVisibility( position, lightPos, halfWidth, halfHeight ); reflectedLight.directSpecular += lightColor * coachVis * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );",
  );
  src = src.replace(DIFF_LINE, "reflectedLight.directDiffuse += lightColor * coachVis * material.diffuseContribution * coachWrappedDiffuseFF( normal, viewDir, position, lightPos, rectCoords );");
  return src;
}

const MACRO_FRAGMENT_DECL = /* glsl */ `
varying vec3 vCoachMacro;
uniform float uCoachMacro;
vec3 coachMacroN = vec3( 0.0, 0.0, 1.0 );
`;
// Macro (radial) normal of the body: the atom's center direction for instances, the vertex direction for the envelopes/core.
const MACRO_VERTEX = /* glsl */ `
	#ifdef USE_INSTANCING
		vec3 coachMacroObj = normalize( instanceMatrix[ 3 ].xyz );
	#else
		vec3 coachMacroObj = normalize( position );
	#endif
	vCoachMacro = normalize( normalMatrix * coachMacroObj );
`;
const ATOM_TEXTURE_VERTEX_DECL = /* glsl */ `
uniform highp sampler2D uAtomAlbedo;
attribute float aVertex;
attribute float aAtomRow;
varying vec3 vCoachCol;
varying float vCoachOcc;
`;
const ATOM_ATTRIBUTE_VERTEX_DECL = /* glsl */ `
attribute vec3 aCoachCol;
attribute float aCoachOcc;
varying vec3 vCoachCol;
varying float vCoachOcc;
`;
const ATOM_FRAGMENT_DECL = /* glsl */ `
varying vec3 vCoachCol;
varying float vCoachOcc;
uniform float uCoachAO;
float coachLinearToSrgb( const in float x ) {
	return x <= 0.0031308 ? x * 12.92 : 1.055 * pow( x, 1.0 / 2.4 ) - 0.055;
}
`;
// The authored AO of the module is the STORED Occ byte (0.33 .. 1). Only the indirect (world) light is occluded: the direct lights are not.
const ATOM_AO_FRAGMENT = /* glsl */ `
	float coachAO = mix( 1.0, clamp( coachLinearToSrgb( vCoachOcc ), 0.0, 1.0 ), uCoachAO );
	reflectedLight.indirectDiffuse *= coachAO;
	reflectedLight.indirectSpecular *= coachAO;
`;
// Mat_Life_P2: Base Color = Mix( fac = clamp(0.8 - 0.8*Occ), A = Col, B = Col^1.6 ).  Inputs are already LINEAR (decoded once on the CPU).
const ATOM_ALBEDO_FRAGMENT = /* glsl */ `
	vec3 coachL = max( vCoachCol, vec3( 0.0 ) );
	float coachF = clamp( 0.8 - 0.8 * vCoachOcc, 0.0, 1.0 );
	diffuseColor.rgb *= mix( coachL, pow( coachL, vec3( 1.6 ) ), coachF );
`;

function mustReplace(source: string, needle: string, replacement: string): string {
  if (!source.includes(needle)) throw new Error(`coach material extension: missing ${needle}`);
  return source.replace(needle, replacement);
}

export function applyBodyExtension(material: MeshPhysicalMaterial, options: BodyExtensionOptions): BodyExtensionHandle {
  const uniforms: Record<string, IUniform> = {
    uCoachWrap: { value: new Vector3(...SSS_RADIUS).multiplyScalar(SSS_WEIGHT * options.wrapGain) },
    uCoachWrapTilt: { value: options.wrapTilt },
    uCoachEmit: { value: options.emissionScale },
    uCoachAO: { value: options.bakedAO ?? 0 },
    uCoachMacro: { value: options.macroShadow ? 1 : 0 },
  };
  if (options.albedo === "atom-texture") uniforms.uAtomAlbedo = { value: options.atomTexture };

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);

    if (options.sss || options.macroShadow) {
      shader.fragmentShader = mustReplace(shader.fragmentShader, "#include <lights_physical_pars_fragment>", patchLightsPhysicalPars());
    }
    shader.fragmentShader = mustReplace(
      shader.fragmentShader,
      "#include <common>",
      `#include <common>\nuniform float uCoachEmit;\n${MACRO_FRAGMENT_DECL}\n${options.albedo === "vertex" ? "" : ATOM_FRAGMENT_DECL}`,
    );
    shader.fragmentShader = mustReplace(shader.fragmentShader, "#include <lights_fragment_begin>", "coachMacroN = normalize( vCoachMacro );\n#include <lights_fragment_begin>");
    shader.vertexShader = mustReplace(shader.vertexShader, "#include <common>", "#include <common>\nvarying vec3 vCoachMacro;");
    shader.vertexShader = mustReplace(shader.vertexShader, "#include <begin_vertex>", `#include <begin_vertex>\n${MACRO_VERTEX}`);

    if (options.albedo === "atom-texture") {
      shader.vertexShader = mustReplace(shader.vertexShader, "#include <common>", `#include <common>\n${ATOM_TEXTURE_VERTEX_DECL}`);
      shader.vertexShader = mustReplace(
        shader.vertexShader,
        "#include <begin_vertex>",
        `#include <begin_vertex>\n\tvec4 coachTexel = texelFetch( uAtomAlbedo, ivec2( int( aVertex + 0.5 ), int( aAtomRow + 0.5 ) ), 0 );\n\tvCoachCol = coachTexel.rgb;\n\tvCoachOcc = coachTexel.a;`,
      );
    }
    if (options.albedo === "atom-attribute") {
      shader.vertexShader = mustReplace(shader.vertexShader, "#include <common>", `#include <common>\n${ATOM_ATTRIBUTE_VERTEX_DECL}`);
      shader.vertexShader = mustReplace(shader.vertexShader, "#include <begin_vertex>", "#include <begin_vertex>\n\tvCoachCol = aCoachCol;\n\tvCoachOcc = aCoachOcc;");
    }
    if (options.albedo !== "vertex") {
      shader.fragmentShader = mustReplace(shader.fragmentShader, "#include <color_fragment>", ATOM_ALBEDO_FRAGMENT);
    }
    if (options.albedo !== "vertex") {
      shader.fragmentShader = mustReplace(shader.fragmentShader, "#include <aomap_fragment>", `#include <aomap_fragment>
${ATOM_AO_FRAGMENT}`);
    }
    if (options.emissionScale > 0) {
      shader.fragmentShader = mustReplace(
        shader.fragmentShader,
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * uCoachEmit;",
      );
    }
  };
  material.customProgramCacheKey = () =>
    `coach:${options.albedo}:${options.sss ? "sss" : "nosss"}:${options.macroShadow ? "macro" : "nomacro"}:${options.emissionScale > 0 ? "emit" : "noemit"}`;
  return { uniforms, baseWrapGain: options.wrapGain };
}

// ------------------------------------------------------------------------------------------------------------------
// Material factories — values straight from the manifest (Blender Principled BSDF) through the documented mappings.
// ------------------------------------------------------------------------------------------------------------------

export interface CreatedMaterial {
  material: MeshPhysicalMaterial;
  handle: BodyExtensionHandle;
}

type Mats = Record<string, Record<string, number | number[]>>;

function num(mats: Mats, material: string, key: string): number {
  const value = mats[material]?.[key];
  if (typeof value !== "number") throw new Error(`manifest: missing ${material}.${key}`);
  return value;
}

export function createAtomMaterial(mats: Mats, texture: unknown, mode: "atom-texture" | "atom-attribute"): CreatedMaterial {
  // Mat_Life_P2: roughness 0.40 (GGX alpha = r^2 on both sides: 1:1), Specular IOR Level 0.35 -> specularIntensity 0.70,
  // IOR 1.5, neutral tint, coat 0. Sheen 0.2 (yellow Tint attribute) is NOT mapped: see report, remaining difference P2.
  const material = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: num(mats, "Mat_Life_P2", "Roughness"),
    metalness: 0,
    ior: num(mats, "Mat_Life_P2", "IOR"),
    specularIntensity: specularIntensityFromBlenderLevel(num(mats, "Mat_Life_P2", "Specular IOR Level")),
    specularColor: new Color(1, 1, 1),
    clearcoat: 0,
  });
  const handle = applyBodyExtension(material, {
    albedo: mode,
    macroShadow: mode === "atom-texture",
    wrapGain: 1,
    wrapTilt: 0.6,
    emissionScale: 0,
    atomTexture: texture,
    sss: true,
  });
  return { material, handle };
}

export function createEnvelopeMaterial(mats: Mats): CreatedMaterial {
  // Mat_Env_S01: roughness 0.78, level 0.16 -> 0.32, SSS 0.08 (a sixth of the body's), emission = Col x 0.01.
  const material = new MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: num(mats, "Mat_Env_S01", "Roughness"),
    metalness: 0,
    ior: num(mats, "Mat_Env_S01", "IOR"),
    specularIntensity: specularIntensityFromBlenderLevel(num(mats, "Mat_Env_S01", "Specular IOR Level")),
  });
  const handle = applyBodyExtension(material, {
    albedo: "vertex",
    macroShadow: true,
    wrapGain: num(mats, "Mat_Env_S01", "Subsurface Weight") / SSS_WEIGHT,
    wrapTilt: 0.6,
    emissionScale: num(mats, "Mat_Env_S01", "Emission Strength"),
    sss: true,
  });
  return { material, handle };
}

export function createCoreMaterial(mats: Mats): CreatedMaterial {
  // Mat_Core_S01: recessed dark backstop. Roughness 0.9, Specular IOR Level 0 -> no specular.
  const material = new MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: num(mats, "Mat_Core_S01", "Roughness"),
    metalness: 0,
    specularIntensity: specularIntensityFromBlenderLevel(num(mats, "Mat_Core_S01", "Specular IOR Level")),
  });
  const handle = applyBodyExtension(material, {
    albedo: "vertex",
    macroShadow: true,
    wrapGain: 1,
    wrapTilt: 0.6,
    emissionScale: 0,
    sss: false,
  });
  return { material, handle };
}

export function createVisorMaterial(mats: Mats): CreatedMaterial {
  // Mat_DarkGlossyVisor: near-black, glossy, blue-tinted specular, practically no emission. Deep dark anchor.
  const baseColor = mats.Mat_DarkGlossyVisor.base_color_linear as number[];
  const emission = mats.Mat_DarkGlossyVisor.emission_color_linear as number[];
  const tint = mats.Mat_DarkGlossyVisor.specular_tint as number[];
  const material = new MeshPhysicalMaterial({
    color: new Color().setRGB(baseColor[0], baseColor[1], baseColor[2]),
    roughness: num(mats, "Mat_DarkGlossyVisor", "Roughness"),
    metalness: 0,
    ior: num(mats, "Mat_DarkGlossyVisor", "IOR"),
    specularIntensity: specularIntensityFromBlenderLevel(num(mats, "Mat_DarkGlossyVisor", "Specular IOR Level")),
    specularColor: new Color().setRGB(tint[0], tint[1], tint[2]),
    emissive: new Color().setRGB(emission[0], emission[1], emission[2]),
    emissiveIntensity: num(mats, "Mat_DarkGlossyVisor", "Emission Strength"),
  });
  const handle = applyBodyExtension(material, {
    albedo: "vertex",
    wrapGain: 1,
    wrapTilt: 0.6,
    emissionScale: 0,
    sss: false,
  });
  return { material, handle };
}

export function createShardGlassMaterial(mats: Mats): CreatedMaterial {
  // Glass: Transmission 0.65, IOR 1.45, roughness 0.18, Specular IOR Level 0.50 -> 1.0, coat 0.30 (coat roughness 0.03),
  // emission = vertex color x 2.40. Perceptual parity, not parameter names: three's transmission samples the opaque pass.
  const material = new MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: num(mats, "Mat_ShardGlass_BF", "Roughness"),
    metalness: 0,
    transmission: num(mats, "Mat_ShardGlass_BF", "Transmission Weight"),
    ior: num(mats, "Mat_ShardGlass_BF", "IOR"),
    specularIntensity: specularIntensityFromBlenderLevel(num(mats, "Mat_ShardGlass_BF", "Specular IOR Level")),
    clearcoat: num(mats, "Mat_ShardGlass_BF", "Coat Weight"),
    clearcoatRoughness: 0.03,
    thickness: 0,
  });
  const handle = applyBodyExtension(material, {
    albedo: "vertex",
    wrapGain: 1,
    wrapTilt: 0.6,
    emissionScale: num(mats, "Mat_ShardGlass_BF", "Emission Strength"),
    sss: false,
  });
  return { material, handle };
}

export function createShardRimMaterial(mats: Mats): CreatedMaterial {
  const material = new MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: num(mats, "Mat_ShardRim_BF", "Roughness"),
    metalness: 0,
    ior: num(mats, "Mat_ShardRim_BF", "IOR"),
    specularIntensity: specularIntensityFromBlenderLevel(num(mats, "Mat_ShardRim_BF", "Specular IOR Level")),
    clearcoat: num(mats, "Mat_ShardRim_BF", "Coat Weight"),
  });
  const handle = applyBodyExtension(material, {
    albedo: "vertex",
    wrapGain: 1,
    wrapTilt: 0.6,
    emissionScale: num(mats, "Mat_ShardRim_BF", "Emission Strength"),
    sss: false,
  });
  return { material, handle };
}

/** Mat_EmissiveSensor: pure emission, color = mix(white, (0.1, 0.8, 1.0), t), strength = 19*(1 - t) + 7, t = mapRange(2*max(|gx-.5|,|gz-.5|), 0.45..1). */
export function createEyeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aGen;
      varying vec3 vGen;
      void main() {
        vGen = aGen;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vGen;
      void main() {
        float m = 2.0 * max( abs( vGen.x - 0.5 ), abs( vGen.z - 0.5 ) );
        float t = clamp( ( m - 0.45 ) / 0.55, 0.0, 1.0 );
        vec3 col = mix( vec3( 1.0 ), vec3( 0.1, 0.8, 1.0 ), t );
        float strength = 19.0 * ( 1.0 - t ) + 7.0;
        gl_FragColor = vec4( col * strength, 1.0 );
      }`,
    toneMapped: true,
  });
}
