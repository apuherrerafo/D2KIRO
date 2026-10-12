// Display chain + unit conversions that translate the frozen Blender B rig into Three.js. Every number here is either
// read from COMPLETE_BASE_FORM_GOLD_MASTER.json / the .blend (via the manifest) or derived below, never eyeballed.

/** Frozen display EV (solved once on S01_FREEZE, locked for every turnaround view). */
export const DISPLAY_EV = -1.4296875;
/** THREE.WebGLRenderer.toneMappingExposure for that EV: 2^EV. */
export const TONE_MAPPING_EXPOSURE = 2 ** DISPLAY_EV;
/** The frozen chain multiplies the BACKGROUND (only) by this before 2^EV -> Neutral -> sRGB. */
export const BG_SCALE = 2.7877794982221613;

/**
 * ONE global light-unit conversion (not per light).
 * Measured in Blender 5.2/Cycles (diffuse white plane under a 0.2 m and a 0.4 m square area light, 500 W and 1000 W):
 * emitted radiance L_e = P / (pi * A) — 0.3177 and 0.3163 against 1/pi = 0.3183 (finite-source error).
 * Three.js RectAreaLight.intensity is that radiance in nits, so intensity = P / (pi * size^2).
 */
export const BLENDER_AREA_WATTS_TO_THREE_NITS = 1 / Math.PI;

export function areaLightIntensity(watts: number, size: number): number {
  return (watts * BLENDER_AREA_WATTS_TO_THREE_NITS) / (size * size);
}

/** Blender "Specular IOR Level" -> THREE.MeshPhysicalMaterial.specularIntensity.
 *  Principled v2: F0 = ((ior-1)/(ior+1))^2 * 2 * level, Three: F0 = ((ior-1)/(ior+1))^2 * specularIntensity. */
export function specularIntensityFromBlenderLevel(level: number): number {
  return 2 * level;
}

/** Camera: 85 mm on a 36 mm sensor, square render (sensor fit AUTO) -> vertical FOV. */
export function verticalFovDegrees(lensMm: number, sensorMm: number): number {
  return (2 * Math.atan(sensorMm / (2 * lensMm)) * 180) / Math.PI;
}

/** HERO camera position in BLENDER coordinates (Z up): (tx + d sin az, ty - d cos az, h). */
export function blenderCameraPosition(azimuthDeg: number, distance: number, height: number, target: [number, number, number]): [number, number, number] {
  const a = (azimuthDeg * Math.PI) / 180;
  return [target[0] + distance * Math.sin(a), target[1] - distance * Math.cos(a), height];
}

/** Blender (x, y, z; Z up) -> Three world (x, z, -y; Y up). Equivalent to the root group's rotation.x = -90 deg. */
export function blenderToThree(v: [number, number, number]): [number, number, number] {
  return [v[0], v[2], -v[1]];
}

export const HERO_VIEW = { azimuthDeg: -22 } as const;

// SSS approximation (see materials.ts). Blender Random Walk: weight 0.5, radius (1.0, 0.6, 0.4), scale 0.03.
export const SSS_WEIGHT = 0.5;
export const SSS_RADIUS: [number, number, number] = [1.0, 0.6, 0.4];

/** Fog Glow (threshold 0.9 / strength 0.10 / size 0.5) approximated with the stock UnrealBloomPass. */
export const GLOW = {
  threshold: 0.9,
  cap: 1.0,
  smoothWidth: 0.05,
  strength: 0.05,
  radius: 0.5,
} as const;

export const LAB_VIEWPORT = { width: 1000, height: 1000 } as const;
