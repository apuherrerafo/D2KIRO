// P0 — COLOR PIPELINE. The only place in the web runtime where a stored Blender byte becomes a linear float.
//
//   Blender stored byte            BYTE_COLOR, sRGB-encoded (what the .blend / the .bin hold)
//   -> effective Blender albedo    srgbToLinear(byte)      (Blender's Color Attribute node does exactly this)
//   -> export representation       the STORED byte, untouched (phi = 0.18 and pow(c,1.6) for envelopes already inside)
//   -> Three.js interpretation     Float32 linear, set on `color` / the albedo texture. THREE.ColorManagement does NOT
//                                  re-decode vertex colors or DataTextures with NoColorSpace, so this is the one decode.
//
// Never call this twice on the same data, never apply a PurityFloor here, never treat a byte as already-linear.

const DECODE_LUT = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const c = i / 255;
  DECODE_LUT[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function srgbByteToLinear(byte: number): number {
  return DECODE_LUT[byte & 255];
}

export type Rgb = [number, number, number];

/** Mat_Life_P2 node graph: Base Color = Mix( factor = clamp(0.8 - 0.8*Occ.R), A = Col, B = Col^1.6 ). Inputs are LINEAR. */
export function atomEffectiveAlbedo(colLinear: Rgb, occLinear: number): Rgb {
  const f = Math.min(1, Math.max(0, 0.8 - 0.8 * occLinear));
  return [0, 1, 2].map((i) => colLinear[i] * (1 - f) + colLinear[i] ** 1.6 * f) as Rgb;
}

/** stored (byte) -> effective albedo of one atom vertex, decoding exactly once. */
export function atomEffectiveAlbedoFromStored(storedCol: Rgb, storedOcc: number): Rgb {
  const col = storedCol.map(srgbByteToLinear) as Rgb;
  return atomEffectiveAlbedo(col, srgbByteToLinear(storedOcc));
}

/** RGBA8 stored bytes -> linear RGB Float32 (3 per element). Alpha is ignored. */
export function decodeStoredRgba(bytes: Uint8Array, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    out[i * 3] = DECODE_LUT[bytes[i * 4]];
    out[i * 3 + 1] = DECODE_LUT[bytes[i * 4 + 1]];
    out[i * 3 + 2] = DECODE_LUT[bytes[i * 4 + 2]];
  }
  return out;
}

/** RGBA8 whose alpha holds a stored gray byte (Occ) -> linear Float32 (1 per element). */
export function decodeStoredAlpha(bytes: Uint8Array, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = DECODE_LUT[bytes[i * 4 + 3]];
  return out;
}

/** RGBA8 stored bytes (RGB = Col, A = Occ) -> RGBA Float32 linear, both decoded once. */
export function decodeStoredRgbaWithOcc(bytes: Uint8Array, count: number): Float32Array {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    out[i * 4] = DECODE_LUT[bytes[i * 4]];
    out[i * 4 + 1] = DECODE_LUT[bytes[i * 4 + 1]];
    out[i * 4 + 2] = DECODE_LUT[bytes[i * 4 + 2]];
    out[i * 4 + 3] = DECODE_LUT[bytes[i * 4 + 3]];
  }
  return out;
}
