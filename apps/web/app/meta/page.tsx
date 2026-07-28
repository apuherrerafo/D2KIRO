"use client";

import { useGetMetaStatusQuery, useSyncMetaMutation } from "@/lib/engine-api";
import { BUTTON_PRIMARY } from "@/features/draft/styles";

function formatSyncedAt(syncedAt: string | null): string {
  if (!syncedAt) return "Nunca sincronizado";
  return new Date(syncedAt).toLocaleString();
}

function syncButtonLabel(isSyncing: boolean): string {
  if (isSyncing) return "Sincronizando...";
  return "Sincronizar ahora";
}

interface StaleBadgeProps {
  isStale: boolean;
}

function StaleBadge({ isStale }: StaleBadgeProps) {
  if (isStale) {
    return <span className="text-caption text-signal-warning">Desactualizado (más de 24h)</span>;
  }
  return <span className="text-caption text-signal-positive">Al día</span>;
}

// Página normal del sitio: RTK Query contra apps/engine (web.md) -- nunca WebSocket/Zustand,
// esa es la única excepción de TSK-012 para la vista de draft en vivo.
export default function MetaStatusPage() {
  const { data, isLoading, error } = useGetMetaStatusQuery();
  const [syncMeta, { isLoading: isSyncing }] = useSyncMetaMutation();

  function handleSyncClick() {
    void syncMeta();
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
        <span className="text-body text-content-secondary">Cargando...</span>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
        <span className="text-body text-signal-negative">No se pudo cargar el estado del meta.</span>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
      <span className="text-heading text-content-primary">Estado del meta</span>
      <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface-raised p-4">
        <span className="text-body text-content-primary">Última sincronización: {formatSyncedAt(data.syncedAt)}</span>
        <StaleBadge isStale={data.isStale} />
        {data.lastSync && <span className="text-caption text-content-muted">Último intento: {data.lastSync.status}</span>}
      </div>
      <button type="button" onClick={handleSyncClick} disabled={isSyncing} className={BUTTON_PRIMARY}>
        {syncButtonLabel(isSyncing)}
      </button>
    </main>
  );
}
