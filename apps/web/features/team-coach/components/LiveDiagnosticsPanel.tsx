"use client";

import { useState } from "react";
import { buildLiveDiagnostics, formatLiveDiagnosticReport, rosterCandidate, type DiagnosticRow, type LiveDiagnostics, type LiveDiagnosticsInput, type Presence } from "../live-diagnostics";
import { CHIP, CODE_BOX, PANEL, STATUS_PILL_MUTED, STATUS_PILL_OK, STATUS_PILL_WARN } from "../styles";

// /live-draft "Diagnóstico de conexión": qué informa Dota de verdad, en vivo (se actualiza con cada
// lectura de estado del motor), y un botón que copia el mismo resumen en texto -- sin identificadores --
// para pegarlo en un chat. Nada se presenta como capturado si Dota no lo mandó.

const PRESENCE_CLASS: Readonly<Record<Presence, string>> = Object.freeze({
  YES: STATUS_PILL_OK,
  PARTIAL: STATUS_PILL_WARN,
  NO: STATUS_PILL_MUTED,
});

const PRESENCE_TEXT: Readonly<Record<Presence, string>> = Object.freeze({
  YES: "sí",
  PARTIAL: "parcial",
  NO: "no",
});

const CONNECTION_TEXT: Readonly<Record<string, string>> = Object.freeze({
  connected: "conectado",
  stale: "sin datos recientes",
  waiting: "esperando a Dota",
  none: "sin sesión",
});

type CopyState = "idle" | "copied" | "failed";

function presenceOfFlag(value: boolean): Presence {
  if (value) return "YES";
  return "NO";
}

function ageText(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1_000) return `${ms} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
}

function connectionText(diagnostics: LiveDiagnostics): string {
  return CONNECTION_TEXT[diagnostics.connection] ?? diagnostics.connection;
}

/** A cached reading (the engine stopped answering) is never shown as if it were current. */
function lastKnown(diagnostics: LiveDiagnostics, value: string): string {
  if (diagnostics.reading === "last_known") return `${value} (último conocido)`;
  return value;
}

function summaryText(diagnostics: LiveDiagnostics): string {
  const age = ageText(diagnostics.lastUpdateAgeMs);
  if (diagnostics.reading === "last_known") return `motor sin respuesta · último estado conocido: ${connectionText(diagnostics)} · último paquete ${age}`;
  return `${connectionText(diagnostics)} · último paquete ${age}`;
}

function Row({ label, presence, testId }: { label: string; presence: Presence; testId: string }) {
  return (
    <li className="flex items-center justify-between gap-2" data-testid={testId} data-presence={presence}>
      <span className="text-caption text-content-secondary">{label}</span>
      <span className={PRESENCE_CLASS[presence]}>{PRESENCE_TEXT[presence]}</span>
    </li>
  );
}

function ValueRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <li className="flex items-center justify-between gap-2" data-testid={testId}>
      <span className="text-caption text-content-secondary">{label}</span>
      <span className="text-caption text-content-primary">{value}</span>
    </li>
  );
}

function Group({ title, rows, prefix }: { title: string; rows: DiagnosticRow[]; prefix: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-caption font-semibold text-content-muted">{title}</span>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <Row key={row.key} label={row.label} presence={row.presence} testId={`${prefix}-${row.key}`} />
        ))}
      </ul>
    </div>
  );
}

function StructureGroup({ diagnostics }: { diagnostics: LiveDiagnostics }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:col-span-3" data-testid="diag-structure">
      <span className="text-caption font-semibold text-content-muted">ESTRUCTURA QUE ENVÍA DOTA (sólo presencia, sin verificar para el coach)</span>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-3">
        {diagnostics.structure.map((row) => (
          <Row key={row.key} label={row.label} presence={presenceOfFlag(row.present)} testId={`diag-structure-${row.key}`} />
        ))}
      </ul>
      <span className="text-caption text-content-muted" data-testid="diag-structure-roster-candidate">
        Candidato a lista de jugadores: {PRESENCE_TEXT[presenceOfFlag(rosterCandidate(diagnostics))]} (sin verificar)
      </span>
    </div>
  );
}

function CopyFeedback({ state, report }: { state: CopyState; report: string }) {
  if (state === "copied") return <span className="text-caption text-signal-positive" role="status">Copiado</span>;
  if (state === "failed") {
    return (
      <div className="flex flex-col gap-1" role="alert">
        <span className="text-caption text-signal-warning">No se pudo copiar. Seleccioná el texto y copialo a mano:</span>
        <pre className={CODE_BOX} data-testid="live-diagnostics-report">{report}</pre>
      </div>
    );
  }
  return null;
}

export type LiveDiagnosticsPanelProps = LiveDiagnosticsInput;

export function LiveDiagnosticsPanel(props: LiveDiagnosticsPanelProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const diagnostics = buildLiveDiagnostics(props);
  const report = formatLiveDiagnosticReport(diagnostics);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <details className={PANEL} data-testid="live-diagnostics">
      <summary className="cursor-pointer text-body text-content-primary">
        Diagnóstico de conexión
        <span className="ml-2 text-caption text-content-muted" data-testid="live-diagnostics-summary">
          {summaryText(diagnostics)}
        </span>
      </summary>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-caption font-semibold text-content-muted">CONEXIÓN</span>
          <ul className="flex flex-col gap-1">
            <Row label="Primer paquete de Dota recibido" presence={presenceOfFlag(diagnostics.firstGsiPacket)} testId="diag-connection-first-packet" />
            <ValueRow label="Estado" value={lastKnown(diagnostics, connectionText(diagnostics))} testId="diag-connection-state" />
            <ValueRow label="Último paquete hace" value={lastKnown(diagnostics, ageText(diagnostics.lastUpdateAgeMs))} testId="diag-connection-age" />
            <Row label="Dota → D2KIRO por HTTPS activo" presence={presenceOfFlag(diagnostics.remoteGsiHttps)} testId="diag-connection-remote-https" />
          </ul>
        </div>
        <Group title="DRAFT (lo que Dota informa)" rows={diagnostics.draft} prefix="diag-draft" />
        <Group title="PARTIDA (sólo presencia)" rows={diagnostics.telemetry} prefix="diag-telemetry" />
        <StructureGroup diagnostics={diagnostics} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={CHIP} onClick={handleCopy} data-testid="live-diagnostics-copy">
          Copiar diagnóstico
        </button>
        <CopyFeedback state={copyState} report={report} />
      </div>
    </details>
  );
}
