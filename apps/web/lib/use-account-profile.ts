"use client";

import { useEffect, useState } from "react";

// Perfil público de la sesión (nombre y avatar de Steam). `accountId` viaja en la respuesta por contrato de la API,
// pero NINGUNA pantalla lo muestra: el identificador interno de Steam no es parte de la interfaz.
// `profileStatus` separa dos cosas distintas: Steam confirmó quién eres (siempre, si hay sesión) vs. se pudo leer tu perfil público.
export interface AccountProfile {
  accountId: number;
  personaName: string;
  avatarUrl: string | null;
  profileStatus: "ok" | "unavailable";
  isAdmin: boolean;
}

export type AccountProfileState =
  | { kind: "loading" }
  | { kind: "ready"; profile: AccountProfile }
  | { kind: "unavailable" };

const PROFILE_UPDATED_EVENT = "d2k:profile-updated";

/** Vuelve a leer el perfil público de Steam (misma sesión, sin otro login) y avisa a todas las pantallas que lo muestran. */
export async function refreshAccountProfile(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/refresh-profile", { method: "POST", cache: "no-store" });
    if (!response.ok) return false;
    const profile = (await response.json()) as AccountProfile;
    window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
    return profile.profileStatus === "ok";
  } catch {
    return false;
  }
}

async function fetchProfileState(): Promise<AccountProfileState> {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) return { kind: "unavailable" };
    return { kind: "ready", profile: (await response.json()) as AccountProfile };
  } catch {
    return { kind: "unavailable" };
  }
}

export function useAccountProfile(enabled: boolean): AccountProfileState {
  const [state, setState] = useState<AccountProfileState>({ kind: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // La primera lectura y las siguientes (tras "Reintentar") llegan por la misma promesa: el estado solo cambia cuando Steam/sesión responden.
    function load() {
      void fetchProfileState().then((next) => {
        if (!cancelled) setState(next);
      });
    }
    load();
    window.addEventListener(PROFILE_UPDATED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(PROFILE_UPDATED_EVENT, load);
    };
  }, [enabled]);

  return state;
}
