import {
  Color,
  HalfFloatType,
  SRGBColorSpace,
  NeutralToneMapping,
  PMREMGenerator,
  Scene,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { BG_SCALE, GLOW, TONE_MAPPING_EXPOSURE, blenderCameraPosition, blenderToThree, verticalFovDegrees } from "./constants";
import type { CoachHero } from "./build-hero";
import type { ModularManifest } from "./types";

// Imperative renderer/camera/environment/post setup. Kept out of the React component on purpose: it mutates objects owned by
// R3F's store (renderer, scene, camera), which is exactly what `react-hooks/immutability` forbids inside a component body.

/** Display chain: Khronos-Neutral-equivalent tone mapping at the frozen EV; rect area lights; no shadows anywhere. */
export function configureRenderer(gl: WebGLRenderer): void {
  RectAreaLightUniformsLib.init();
  gl.toneMapping = NeutralToneMapping;
  gl.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  gl.shadowMap.enabled = false;
  gl.info.autoReset = false;
}

/** Frozen camera (HERO / FRONT / SIDE share lens, distance, height, target; only the azimuth differs): 85 mm / 36 mm, azimuth -22 deg, height 0.45, target (0, 0, 0.14) — Blender coordinates converted to Y-up. */
export function configureHeroCamera(camera: PerspectiveCamera, manifest: ModularManifest, view: "HERO" | "FRONT" | "SIDE" = "HERO"): void {
  const cam = manifest.camera;
  camera.fov = verticalFovDegrees(cam.lens_mm, cam.sensor_mm);
  camera.near = 0.1;
  camera.far = 100;
  camera.position.set(...blenderToThree(blenderCameraPosition(cam.azimuth_deg[view], cam.distance, cam.height, cam.target)));
  camera.up.set(0, 1, 0);
  camera.lookAt(...blenderToThree(cam.target));
  camera.updateProjectionMatrix();
}

/** World "lit" 0.6 (uniform color) as an environment: diffuse AND specular reflection of the studio, not a light. Returns a disposer. */
export function installEnvironment(gl: WebGLRenderer, scene: Scene, manifest: ModularManifest): () => void {
  const pmrem = new PMREMGenerator(gl);
  const envScene = new Scene();
  const k = manifest.world.lit_strength;
  envScene.background = new Color().setRGB(manifest.world.color[0] * k, manifest.world.color[1] * k, manifest.world.color[2] * k);
  const target = pmrem.fromScene(envScene, 0, 0.1, 10);
  scene.environment = target.texture;
  scene.environmentIntensity = 1;
  pmrem.dispose();
  return () => {
    scene.environment = null;
    target.dispose();
  };
}

/** Camera-ray background of the frozen chain: world color x camera strength x bg_scale (then 2^EV -> Neutral -> sRGB like everything else). */
export function backgroundColor(manifest: ModularManifest): Color {
  const k = manifest.world.camera_strength * BG_SCALE;
  // WebGLRenderer.setClearColor re-encodes the color linear -> sRGB for the render target. We want the RT to hold the LINEAR value,
  // so hand it the color whose sRGB encoding is that value (Color.setRGB with SRGBColorSpace decodes it into the working space).
  return new Color().setRGB(manifest.world.color[0] * k, manifest.world.color[1] * k, manifest.world.color[2] * k, SRGBColorSpace);
}

export interface PostChain {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  dispose: () => void;
}

export interface BloomTuning {
  /** Highlights feeding the glow are clamped to this radiance: Cycles' Fog Glow does not blow up on the eyes (radiance ~26). */
  glowCap: number;
  glowStrength: number;
  glowRadius: number;
  glowThreshold: number;
}

/** Render (HDR, MSAA x4) -> UnrealBloom (highlights of the FOREGROUND only: bg alpha = 0) -> Output (tone mapping + exposure + sRGB). */
export function createPostChain(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, width: number, height: number, tuning: BloomTuning): PostChain {
  const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: 4 });
  const composer = new EffectComposer(gl, target);
  composer.setPixelRatio(1);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(width, height), tuning.glowStrength, tuning.glowRadius, tuning.glowThreshold);
  // Fog Glow in the frozen chain never touched the background: mask the highlight pass by the RT alpha.
  const highPass = bloom.materialHighPassFilter;
  const marker = "float v = luminance( texel.xyz );";
  if (!highPass.fragmentShader.includes(marker)) throw new Error("coach rig: UnrealBloomPass high-pass shader changed — re-derive the mask patch");
  highPass.fragmentShader = highPass.fragmentShader.replace(marker, "texel.rgb = min( texel.rgb, vec3( glowCap ) ); float v = luminance( texel.xyz ) * step( 0.5, texel.a );");
  highPass.fragmentShader = highPass.fragmentShader.replace("uniform float smoothWidth;", "uniform float smoothWidth;\nuniform float glowCap;");
  highPass.uniforms.glowCap = { value: tuning.glowCap };
  highPass.uniforms.smoothWidth.value = GLOW.smoothWidth;
  composer.addPass(bloom);
  // The background is cleared with alpha 0 (it is the bloom mask); the canvas itself must be opaque.
  const output = new OutputPass();
  const sample = "gl_FragColor = texture2D( tDiffuse, vUv );";
  if (!output.material.fragmentShader.includes(sample)) throw new Error("coach rig: OutputShader changed — re-derive the opaque-alpha patch");
  output.material.fragmentShader = output.material.fragmentShader.replace(sample, `${sample}
			gl_FragColor.a = 1.0;`);
  composer.addPass(output);
  return {
    composer,
    bloom,
    dispose: () => {
      composer.dispose();
      target.dispose();
    },
  };
}

export function applyBloomTuning(bloom: UnrealBloomPass, tuning: BloomTuning): void {
  bloom.materialHighPassFilter.uniforms.glowCap.value = tuning.glowCap;
  bloom.strength = tuning.glowStrength;
  bloom.radius = tuning.glowRadius;
  bloom.threshold = tuning.glowThreshold;
}

export interface LabSwitches {
  ambientGain: number;
  lightsOff: string[];
  hide: string[];
}

/** Lab-only diagnostic switches (query params, validated in lab-params.ts): world gain, light mute, layer hide. Defaults change nothing. */
export function applyLabSwitches(scene: Scene, hero: CoachHero, switches: LabSwitches): void {
  scene.environmentIntensity = switches.ambientGain;
  (Object.keys(hero.lights) as (keyof typeof hero.lights)[]).forEach((name) => {
    hero.lights[name].visible = !switches.lightsOff.includes(name);
  });
  const layers: Record<string, { visible: boolean }[]> = {
    atoms: [hero.atoms],
    envelopes: [hero.envelopeGroup],
    core: [hero.core],
    visor: [hero.visor],
    eyes: hero.eyes,
    cross: hero.crossCells,
    shards: hero.shardGroups,
  };
  Object.entries(layers).forEach(([name, objects]) => {
    objects.forEach((o) => {
      o.visible = !switches.hide.includes(name);
    });
  });
}
