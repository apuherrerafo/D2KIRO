"use client";

import { useEffect, useState } from "react";

// Perfil público de la sesión (nombre y avatar de Steam). `accountId` viaja en la respuesta por contrato de la API,
// pero NINGUNA pantalla lo muestra: el identificador interno de Steam no es parte de la interfaz.
export interface AccountProfile {
  accountId: number;
  personaName: string;
  avatarUrl: string | null;
}

export type AccountProfileState =
  | { kind: "loading" }
  | { kind: "ready"; profile: AccountProfile }
  | { kind: "unavailable" };

export function useAccountProfile(enabled: boolean): AccountProfileState {
  const [state, setState] = useState<AccountProfileState>({ kind: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as AccountProfile) : null))
      .then((profile) => {
        if (!cancelled) setState(profile === null ? { kind: "unavailable" } : { kind: "ready", profile });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}
