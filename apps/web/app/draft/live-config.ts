export function isDraftLiveEnabled(value: string | undefined = process.env.DRAFT_LIVE_ENABLED): boolean {
  return value !== "false";
}

// TSK-068: espejo a mano de CURRENT_PATCH en apps/engine/src/server/routes/meta.ts (mismo
// criterio que el espejo de SignalId en features/draft/types.ts, web.md) -- OpenDota no expone
// "qué parche está activo" en ningún endpoint, así que es un literal mantenido en los dos
// procesos por separado. Antes de esta constante, bootstrap-session.ts hardcodeaba "7.41e" sin
// relación con el "" que el motor guardaba por defecto al sincronizar -- patch_meta nunca
// encontraba una fila que matcheara. Actualizar acá y en el motor en el mismo cambio.
export const CURRENT_PATCH = "7.41e";
