"use client";

import { AppNotice } from "@/components/app-shell/AppNotice";
import { PageHead } from "@/components/app-shell/PageHead";
import { useGetMetaStatusQuery, type MetaStatus } from "@/lib/engine-api";
import { describePatch, describeSync, formatSyncedAt } from "./meta-text";

function StatusRow({ label, value, tag, tone, testId }: { label: string; value: string; tag: string; tone: "ok" | "pending" | "empty"; testId: string }) {
  return (
    <li className="ap-row" data-testid={testId}>
      <div className="ap-row-text">
        <span className="ap-row-name">{label}</span>
        <span className="ap-row-meta">{value}</span>
      </div>
      <span className="ap-tag" data-tone={tone}>
        {tag}
      </span>
    </li>
  );
}

function MetaReady({ status }: { status: MetaStatus }) {
  const sync = describeSync(status);
  const patch = describePatch(status.patchProvenance);
  return (
    <>
      <ul className="ap-list" data-testid="meta-status-list">
        <StatusRow label="Última actualización" value={formatSyncedAt(status.syncedAt)} tag={sync.tag} tone={sync.tone} testId="meta-sync" />
        <StatusRow label="Parche del dato" value={patch.value} tag={patch.tag} tone={patch.tone} testId="meta-patch" />
      </ul>
      <p className="ap-hint">
        El dato del parche se actualiza fuera de esta pantalla. Si tiene más de 24 horas, el coach lo marca en sus consejos con menos
        confianza. Un parche &ldquo;sin verificar&rdquo; significa que nadie ha confirmado a mano a qué parche corresponde el dato.
      </p>
    </>
  );
}

function MetaBody() {
  const { data, isLoading, error } = useGetMetaStatusQuery();
  if (isLoading) {
    return (
      <p className="ap-loading" role="status">
        Cargando el estado del meta…
      </p>
    );
  }
  if (error || !data) {
    return (
      <AppNotice tone="error" title="No se pudo cargar el estado del meta" testId="meta-error">
        <p>El coach sigue funcionando con los datos que ya tiene. Vuelve a abrir esta pantalla para reintentar.</p>
      </AppNotice>
    );
  }
  return <MetaReady status={data} />;
}

// <Dominio><Cosa>: estado del meta del parche. Página normal del sitio: RTK Query contra apps/engine (web.md), nunca
// WebSocket/Zustand. Solo lectura: lanzar una actualización no es una acción del jugador.
export function MetaStatusPage() {
  return (
    <main className="ap-main" data-testid="meta-page">
      <PageHead
        kicker="Datos"
        title="Meta del parche"
        lede="De dónde sale lo que el coach sabe de los héroes en este parche, y cuándo se actualizó por última vez."
      />
      <section className="ap-block" aria-label="Estado del meta">
        <MetaBody />
      </section>
    </main>
  );
}
