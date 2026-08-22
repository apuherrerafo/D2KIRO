// apps/web/features/random-draft-simulator/seeded-rng.ts
// Generador pseudo-aleatorio determinístico basado en el algoritmo Mulberry32.
// Mismo seed → misma secuencia en cada ejecución (Req. 8.3, 8.4, 8.5).

import { SEED_PATTERN } from "./constants";

// ---------------------------------------------------------------------------
// Interfaz pública
// ---------------------------------------------------------------------------

export interface SeededRng {
  /** Número flotante en [0, 1). */
  next(): number;
  /** Entero en [0, max). */
  nextInt(max: number): number;
  /** `true` con probabilidad `p`. */
  chance(p: number): boolean;
  /** Selecciona un elemento aleatorio del array; `undefined` si está vacío. */
  pick<T>(arr: T[]): T | undefined;
  /** Mezcla el array in-place (Fisher-Yates) y lo retorna. */
  shuffle<T>(arr: T[]): T[];
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Convierte un seed string a un entero sin signo de 32 bits.
 * Usa suma de (charCode × posición) para reducir colisiones entre seeds similares.
 */
function seedToUint32(seed: string): number {
  return seed
    .split("")
    .reduce((acc, ch, i) => (acc + ch.charCodeAt(0) * (i + 1)) >>> 0, 0);
}

/**
 * Fábrica del PRNG Mulberry32.
 * Retorna una función sin argumentos que avanza el estado y devuelve un float en [0, 1).
 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Factory pública
// ---------------------------------------------------------------------------

/**
 * Crea un `SeededRng` determinístico a partir del `seed` dado.
 *
 * @throws {TypeError} Si el seed no cumple `SEED_PATTERN` (/^[A-Z0-9]{8}$/).
 */
// Alfabeto de SEED_PATTERN (/^[A-Z0-9]{8}$/) -- Math.random() es intencional aquí: generar un
// draftSeed nuevo es el único punto de esta feature que no necesita ser reproducible (es la
// semilla misma), a diferencia de todo lo que ese seed alimenta después.
const SEED_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SEED_LENGTH = 8;

/** Genera un draftSeed nuevo que cumple SEED_PATTERN (Req. 8.1). */
export function generateDraftSeed(): string {
  let seed = "";
  for (let i = 0; i < SEED_LENGTH; i++) {
    seed += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
  }
  return seed;
}

export function createSeededRng(seed: string): SeededRng {
  if (!SEED_PATTERN.test(seed)) {
    throw new TypeError(
      `draftSeed inválido: "${seed}". Debe tener exactamente 8 caracteres alfanuméricos en mayúscula (A-Z0-9).`,
    );
  }

  const raw = mulberry32(seedToUint32(seed));

  function nextFloat(): number {
    return raw();
  }

  function nextInt(max: number): number {
    return Math.floor(raw() * max);
  }

  function chance(p: number): boolean {
    return raw() < p;
  }

  function pick<T>(arr: T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[Math.floor(raw() * arr.length)];
  }

  function shuffle<T>(arr: T[]): T[] {
    // Fisher-Yates in-place
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(raw() * (i + 1));
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  return {
    next: nextFloat,
    nextInt,
    chance,
    pick,
    shuffle,
  };
}
