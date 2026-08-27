// apps/web/features/random-draft-simulator/use-config-persistence.ts
// Hook de persistencia para userSide y personalBanList en localStorage.
// Requirements: 1.5, 1.6

"use client";

import { useSyncExternalStore } from "react";
import type { HeroId } from "./types";
import { STORAGE_KEY } from "./constants";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface PersistedConfig {
  userSide: "radiant" | "dire";
  playerPosition: 1 | 2 | 3 | 4 | 5;
  personalBanList: HeroId[];
}

export interface UseConfigPersistenceResult {
  config: PersistedConfig | null;
  setConfig: (config: PersistedConfig) => void;
  clearConfig: () => void;
}

// ---------------------------------------------------------------------------
// Validación de estructura
// ---------------------------------------------------------------------------

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function validatePersistedConfig(raw: unknown): PersistedConfig | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  if (obj["userSide"] !== "radiant" && obj["userSide"] !== "dire") {
    return null;
  }

  if (![1, 2, 3, 4, 5].includes(obj["playerPosition"] as number)) {
    return null;
  }

  if (!Array.isArray(obj["personalBanList"])) {
    return null;
  }

  if (obj["personalBanList"].length > 4) {
    return null;
  }

  if (!obj["personalBanList"].every(isPositiveInteger)) {
    return null;
  }
  return {
    userSide: obj["userSide"],
    playerPosition: obj["playerPosition"] as 1 | 2 | 3 | 4 | 5,
    personalBanList: obj["personalBanList"] as HeroId[],
  };
}

// ---------------------------------------------------------------------------
// Lectura vía useSyncExternalStore -- localStorage es un store externo mutable, no estado de
// React. Un useState+useEffect leyendo en el mount produce un mismatch de hidratación real (el
// servidor no tiene localStorage, así que el primer render del cliente debe coincidir con el
// del servidor); useSyncExternalStore es el mecanismo soportado por React para esto exacto,
// sin el render en cascada de sincronizar con un efecto.
// ---------------------------------------------------------------------------

// Cachea el último snapshot parseado junto con el string crudo que lo produjo: getSnapshot debe
// devolver la misma referencia si el contenido no cambió, o useSyncExternalStore entra en loop
// (cada JSON.parse nuevo se ve como "cambió" aunque el contenido sea idéntico).
let cachedRaw: string | null = null;
let cachedConfig: PersistedConfig | null = null;

function parseAndValidate(raw: string): PersistedConfig | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // La configuración es un dato local descartable: un valor corrupto no debe tumbar la UI.
    console.warn("[useConfigPersistence] JSON parse error; se ignorará la configuración guardada");
    return null;
  }

  const validated = validatePersistedConfig(parsed);

  if (validated === null) {
    // Versiones anteriores no tenían playerPosition. Se ignoran y el usuario puede configurar
    // una sesión nueva; nunca se muestra como error de Next.js ni se bloquea el simulador.
    console.warn("[useConfigPersistence] configuración local obsoleta; se solicitará una nueva");
  }

  return validated;
}

function getClientSnapshot(): PersistedConfig | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (raw === cachedRaw) {
    return cachedConfig;
  }

  cachedRaw = raw;
  cachedConfig = raw === null ? null : parseAndValidate(raw);
  return cachedConfig;
}

function getServerSnapshot(): PersistedConfig | null {
  return null;
}

// Sin sincronización entre pestañas (fuera de alcance): esta app se usa en una sola pestaña de
// draft a la vez. `subscribe` solo necesita existir para que useSyncExternalStore vuelva a leer
// el snapshot después de un `setConfig`/`clearConfig` local -- ver `notifyListeners` abajo.
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConfigPersistence(): UseConfigPersistenceResult {
  const config = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  function setConfig(next: PersistedConfig): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    notifyListeners();
  }

  function clearConfig(): void {
    window.localStorage.removeItem(STORAGE_KEY);
    notifyListeners();
  }

  return { config, setConfig, clearConfig };
}
