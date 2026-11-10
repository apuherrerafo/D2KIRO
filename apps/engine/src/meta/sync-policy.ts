// P0-05F -- ¿este proceso está AUTORIZADO a sincronizar con OpenDota?
//
// Regla única, igual en todos los entornos: META_SYNC=on activa; cualquier otro valor o su ausencia
// lo desactiva. Ningún nombre de entorno (Railway u otro) autoriza por sí solo.
// Cierra el refresco automático del arranque Y el endpoint manual POST /api/meta/sync. Pura: el entorno se inyecta.

export interface MetaSyncPolicy {
  enabled: boolean;
  reason: string;
}

export function resolveMetaSyncPolicy(env: Record<string, string | undefined> = process.env): MetaSyncPolicy {
  const flag = env.META_SYNC?.trim().toLowerCase();
  if (flag === "on") return { enabled: true, reason: "META_SYNC=on" };
  return { enabled: false, reason: "sin autorización explícita (META_SYNC=on)" };
}
