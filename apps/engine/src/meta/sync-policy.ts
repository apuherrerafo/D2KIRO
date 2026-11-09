// P0-05F -- ¿este proceso está AUTORIZADO a sincronizar con OpenDota?
//
// Un deploy a preview (o un arranque local) NO puede bajar datos reales por sí solo. Autorización:
//   - META_SYNC=on  -> autorizado explícitamente (cualquier entorno).
//   - META_SYNC=off -> prohibido explícitamente (gana sobre todo lo demás).
//   - sin META_SYNC -> autorizado SOLO si Railway declara el entorno "production" (comportamiento de
//     producción sin cambios); cualquier otro entorno, o fuera de Railway, queda cerrado.
// Cierra el refresco automático del arranque Y el endpoint manual POST /api/meta/sync. Pura: el entorno se inyecta.

export interface MetaSyncPolicy {
  enabled: boolean;
  reason: string;
}

export function resolveMetaSyncPolicy(env: Record<string, string | undefined> = process.env): MetaSyncPolicy {
  const flag = env.META_SYNC?.trim().toLowerCase();
  if (flag === "off") return { enabled: false, reason: "META_SYNC=off" };
  if (flag === "on") return { enabled: true, reason: "META_SYNC=on" };
  if (env.RAILWAY_ENVIRONMENT_NAME === "production") return { enabled: true, reason: "entorno Railway production" };
  return { enabled: false, reason: "sin autorización explícita (META_SYNC=on) fuera de producción" };
}
