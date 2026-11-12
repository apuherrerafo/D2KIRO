// Lógica pura de los avisos del administrador (sin DOM): qué solicitudes son NUEVAS desde la última vez que este navegador avisó.
// La marca (`baseline`) es la fecha de la solicitud más reciente ya avisada y vive en localStorage, así que:
//   · al refrescar la página no vuelve a sonar (la marca sobrevive);
//   · con varias pestañas, la primera que ve la solicitud sube la marca y las demás ya no la consideran nueva;
//   · la PRIMERA vez que se abre la app en este navegador solo se fija la marca: las solicitudes viejas nunca suenan.

export interface PendingRequest {
  ref: string;
  personaName: string;
  avatarUrl: string | null;
  at: number;
  message: string | null;
}

export interface AlertDecision {
  fresh: PendingRequest[];
  nextBaseline: number;
}

export const BASELINE_KEY = "d2k_admin_alert_baseline";
export const SOUND_KEY = "d2k_admin_sound";

export function decideAlerts(requests: readonly PendingRequest[], baseline: number | null): AlertDecision {
  const newest = requests.reduce((max, request) => Math.max(max, request.at), 0);
  if (baseline === null) return { fresh: [], nextBaseline: newest };
  const fresh = requests.filter((request) => request.at > baseline).sort((a, b) => a.at - b.at);
  return { fresh, nextBaseline: Math.max(baseline, newest) };
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readBaseline(store: KeyValueStore): number | null {
  try {
    const raw = store.getItem(BASELINE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeBaseline(store: KeyValueStore, value: number): void {
  try {
    store.setItem(BASELINE_KEY, String(value));
  } catch {
    // sin almacenamiento (ventana privada): el aviso funciona igual dentro de esta sesión, sin recordar entre recargas
  }
}

export function readSoundEnabled(store: KeyValueStore): boolean {
  try {
    return store.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSoundEnabled(store: KeyValueStore, enabled: boolean): void {
  try {
    store.setItem(SOUND_KEY, enabled ? "1" : "0");
  } catch {
    // ver writeBaseline
  }
}

/** Lee la marca, decide qué es nuevo y la sube. Un solo paso, para que dos pestañas (bajo un candado) no avisen dos veces. */
export function claimFreshRequests(store: KeyValueStore, requests: readonly PendingRequest[]): PendingRequest[] {
  const decision = decideAlerts(requests, readBaseline(store));
  writeBaseline(store, decision.nextBaseline);
  return decision.fresh;
}
