"use client";

import { useGetMetaStatusQuery, useSyncMetaMutation } from "@/lib/engine-api";
import { BUTTON_PRIMARY } from "@/features/draft/styles";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// Req. 7.2: DD/MM/YYYY HH:MM en la zona horaria local del navegador -- no el formato de
// Intl por defecto (toLocaleString varía por locale del sistema, no es el contrato exigido).
function formatSyncedAt(syncedAt: string | null): string {
  if (!syncedAt) return "Sin sincronización previa";
  const date = new Date(syncedAt);
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function syncButtonLabel(isSyncing: boolean): string {
  if (isSyncing) return "Sincronizando...";
  return "Sincronizar";
}

// <Dominio><Cosa>: aviso de meta desactualizada (Req. 7) integrado en la propia pantalla del
// simulador -- nunca navega a otra pantalla. `isStale` (>24h o nunca sincronizado) ya lo calcula
// el motor (`getMetaFreshness`); acá solo se muestra/oculta y se dispara el sync.
export function StaleWarningBanner() {
  const { data } = useGetMetaStatusQuery();
  const [syncMeta, { isLoading: isSyncing, isError, isSuccess }] = useSyncMetaMutation();

  function handleSyncClick() {
    void syncMeta();
  }

  // Req. 7.4: se oculta al terminar con éxito. `data` no se re-lee automáticamente después de
  // syncMeta (la sincronización real corre en segundo plano en el motor, invalidatesTags solo
  // refresca el estado de la fila, no espera a que termine) -- isSuccess de la mutación en curso
  // ya cubre el caso feliz inmediato sin esperar un nuevo poll de isStale.
  if (!data || (data.isStale === false && !isSyncing) || isSuccess) return null;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-signal-warning bg-surface-raised p-4">
      <div className="flex flex-col gap-1">
        <span className="text-body text-content-primary">Los datos de héroes/parche están desactualizados.</span>
        <span className="text-caption text-content-secondary">Última sincronización: {formatSyncedAt(data.syncedAt)}</span>
        {isError && <span className="text-caption text-signal-negative">No se pudo sincronizar. Podés seguir de todos modos.</span>}
      </div>
      <button type="button" onClick={handleSyncClick} disabled={isSyncing} className={BUTTON_PRIMARY}>
        {syncButtonLabel(isSyncing)}
      </button>
    </div>
  );
}
