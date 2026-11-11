"use client";

import { useState } from "react";
import { ActionQuiet } from "@/design/canonical/primitives";
import { buildLiveDiagnostics, formatLiveDiagnosticReport, rosterCandidate, type DiagnosticRow, type LiveDiagnostics, type LiveDiagnosticsInput, type Presence } from "../live-diagnostics";
import { LL_PILL_MUTED as STATUS_PILL_MUTED, LL_PILL_OK as STATUS_PILL_OK, LL_PILL_WARN as STATUS_PILL_WARN } from "../styles";

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
    <li className="ll-diag-row" data-testid={testId} data-presence={presence}>
      <span className="ll-text">{label}</span>
      <span className={PRESENCE_CLASS[presence]}>{PRESENCE_TEXT[presence]}</span>
    </li>
  );
}

function ValueRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <li className="ll-diag-row" data-testid={testId}>
      <span className="ll-text">{label}</span>
      <span className="ll-value">{value}</span>
    </li>
  );
}

function Group({ title, rows, prefix }: { title: string; rows: DiagnosticRow[]; prefix: string }) {
  return (
    <div className="ll-item">
      <span className="sl-caption">{title}</span>
      <ul className="ll-diag-list">
        {rows.map((row) => (
          <Row key={row.key} label={row.label} presence={row.presence} testId={`${prefix}-${row.key}`} />
        ))}
      </ul>
    </div>
  );
}

function StructureGroup({ diagnostics }: { diagnostics: LiveDiagnostics }) {
  return (
    <div className="ll-item ll-diag-wide" data-testid="diag-structure">
      <span className="sl-caption">ESTRUCTURA QUE ENVÍA DOTA (sólo presencia, sin verificar para el coach)</span>
      <ul className="ll-diag-structure">
        {diagnostics.structure.map((row) => (
          <Row key={row.key} label={row.label} presence={presenceOfFlag(row.present)} testId={`diag-structure-${row.key}`} />
        ))}
      </ul>
      <span className="ll-text ll-text--muted" data-testid="diag-structure-roster-candidate">
        Candidato a lista de jugadores: {PRESENCE_TEXT[presenceOfFlag(rosterCandidate(diagnostics))]} (sin verificar)
      </span>
    </div>
  );
}

function CopyFeedback({ state, report }: { state: CopyState; report: string }) {
  if (state === "copied") return <span className="ll-pill ll-pill--ok" role="status">Copiado</span>;
  if (state === "failed") {
    return (
      <div className="ll-stack" role="alert">
        <span className="ll-pill ll-pill--warn">No se pudo copiar. Selecciona el texto y cópialo a mano:</span>
        <pre className="ll-code" data-testid="live-diagnostics-report">{report}</pre>
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
    <details className="ll-panel ll-fold" data-testid="live-diagnostics">
      <summary>
        Diagnóstico de conexión
        <span className="ll-fold-aside" data-testid="live-diagnostics-summary">
          {summaryText(diagnostics)}
        </span>
      </summary>
      <div className="ll-diag-grid">
        <div className="ll-item">
          <span className="sl-caption">CONEXIÓN</span>
          <ul className="ll-diag-list">
            <Row label="Primer paquete de Dota recibido" presence={presenceOfFlag(diagnostics.firstGsiPacket)} testId="diag-connection-first-packet" />
            <ValueRow label="Estado" value={lastKnown(diagnostics, connectionText(diagnostics))} testId="diag-connection-state" />
            <ValueRow label="Último paquete hace" value={lastKnown(diagnostics, ageText(diagnostics.lastUpdateAgeMs))} testId="diag-connection-age" />
            <Row label="Dota → D2KIRO por HTTPS activo" presence={presenceOfFlag(diagnostics.remoteGsiHttps)} testId="diag-connection-remote-https" />
          </ul>
        </div>
        <div className="ll-item" data-testid="diag-visual">
          <span className="sl-caption">DRAFT AUTOMÁTICO</span>
          <ul className="ll-diag-list">
            <ValueRow label="Companion" value={diagnostics.visual.companionVersion} testId="diag-visual-companion-version" />
            <ValueRow label="Lector de pantalla (versión)" value={diagnostics.visual.runtimeVersion} testId="diag-visual-runtime-version" />
            <ValueRow label="Lector de pantalla (estado)" value={`${diagnostics.visual.helperState} · ${diagnostics.visual.health}`} testId="diag-visual-state" />
            <ValueRow label="Último draft leído" value={`${diagnostics.visual.draftHealth} · ${diagnostics.visual.draftDetail}`} testId="diag-visual-draft" />
          </ul>
        </div>
        <Group title="DRAFT (lo que Dota informa)" rows={diagnostics.draft} prefix="diag-draft" />
        <Group title="PARTIDA (sólo presencia)" rows={diagnostics.telemetry} prefix="diag-telemetry" />
        <StructureGroup diagnostics={diagnostics} />
      </div>
      <div className="ll-row">
        <ActionQuiet onPress={handleCopy} testId="live-diagnostics-copy">
          Copiar diagnóstico
        </ActionQuiet>
        <CopyFeedback state={copyState} report={report} />
      </div>
    </details>
  );
}
