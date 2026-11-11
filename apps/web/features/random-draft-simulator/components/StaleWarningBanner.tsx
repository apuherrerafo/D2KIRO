"use client";

import { D2Icon } from "@/design/round-3b/icons";
import { useGetMetaStatusQuery } from "@/lib/engine-api";

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

// <Dominio><Cosa>: aviso de meta desactualizada (Req. 7) integrado en la propia pantalla del
// simulador -- nunca navega a otra pantalla. `isStale` (>24h o nunca sincronizado) ya lo calcula
// el motor (`getMetaFreshness`); acá solo se muestra/oculta. Es informativo: actualizar el meta no es una
// acción del jugador (se hace fuera de esta pantalla), así que no ofrece un botón que no pueda cumplir.
export function StaleWarningBanner() {
  const { data } = useGetMetaStatusQuery();

  if (!data || data.isStale === false) return null;

  return (
    <div className="ap-notice" data-tone="warning" role="status" data-testid="stale-meta-notice">
      <D2Icon name="attention" size={16} />
      <div className="ap-notice-body">
        <span className="ap-notice-title">Los datos de héroes/parche están desactualizados</span>
        <p>
          Última actualización: {formatSyncedAt(data.syncedAt)}. El coach lo tiene en cuenta y marca sus consejos con menos
          confianza.
        </p>
      </div>
    </div>
  );
}
