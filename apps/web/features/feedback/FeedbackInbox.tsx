"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppNotice } from "@/components/app-shell/AppNotice";
import { PageHead } from "@/components/app-shell/PageHead";
import { STATUS_LABELS, TYPE_LABELS, TYPE_ORDER, type FeedbackKind, type FeedbackState } from "./labels";

// <Dominio><Cosa>: bandeja de feedback del administrador. Lista, filtros por tipo y estado, capturas visibles (servidas por la ruta autorizada),
// cambio de estado y exportación JSON/CSV para revisar con una IA. El servidor responde 403 a cualquier cuenta que no sea administradora.

interface InboxItem {
  id: string;
  createdAt: number;
  type: FeedbackKind;
  status: FeedbackState;
  message: string;
  route: string;
  appVersion: string;
  viewport: string;
  language: string;
  userAgent: string;
  authorRef: string;
  images: Array<{ url: string; mime: string; bytes: number }>;
}

interface InboxData {
  items: InboxItem[];
  total: number;
  pending: number;
}

type InboxState = { kind: "loading" } | { kind: "forbidden" } | { kind: "error" } | { kind: "ready"; data: InboxData };

const STATUS_ORDER: FeedbackState[] = ["pendiente", "en_revision", "resuelto"];

function query(type: string, status: string): string {
  const params = new URLSearchParams();
  if (type !== "") params.set("type", type);
  if (status !== "") params.set("status", status);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

async function loadInbox(type: string, status: string): Promise<InboxState> {
  try {
    const response = await fetch(`/api/feedback-admin${query(type, status)}`, { cache: "no-store" });
    if (response.status === 401 || response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "error" };
    return { kind: "ready", data: (await response.json()) as InboxData };
  } catch {
    return { kind: "error" };
  }
}

async function changeStatus(id: string, status: FeedbackState): Promise<boolean> {
  try {
    const response = await fetch("/api/feedback-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
    return response.ok;
  } catch {
    return false;
  }
}

function statusTone(status: FeedbackState): "ok" | "pending" | undefined {
  if (status === "resuelto") return "ok";
  if (status === "pendiente") return "pending";
  return undefined;
}

function formatWhen(at: number): string {
  return new Date(at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function StatusButtons({ item, onChange }: { item: InboxItem; onChange: (id: string, status: FeedbackState) => void }) {
  return (
    <div className="ap-actions" role="group" aria-label="Cambiar estado">
      {STATUS_ORDER.map((status) => (
        <StatusButton key={status} item={item} status={status} onChange={onChange} />
      ))}
    </div>
  );
}

function StatusButton({ item, status, onChange }: { item: InboxItem; status: FeedbackState; onChange: (id: string, status: FeedbackState) => void }) {
  function handlePress() {
    onChange(item.id, status);
  }
  const current = item.status === status;
  return (
    <button type="button" className={current ? "ap-btn ap-btn--compact ap-btn--solid" : "ap-btn ap-btn--compact"} aria-pressed={current} onClick={handlePress} data-testid={`feedback-status-${status}`}>
      {STATUS_LABELS[status]}
    </button>
  );
}

function Shots({ images }: { images: InboxItem["images"] }) {
  if (images.length === 0) return null;
  return (
    <div className="ap-fb-shots">
      {images.map((image) => (
        <a key={image.url} href={image.url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- captura privada servida por la ruta autorizada */}
          <img src={image.url} alt="Captura adjunta al reporte" className="ap-fb-shot" loading="lazy" data-testid="feedback-inbox-shot" />
        </a>
      ))}
    </div>
  );
}

function InboxRow({ item, onChange }: { item: InboxItem; onChange: (id: string, status: FeedbackState) => void }) {
  return (
    <li className="ap-block ap-fb-item" data-testid="feedback-inbox-item">
      <div className="ap-section-head">
        <span className="ap-tag" data-tone={statusTone(item.status)}>
          {TYPE_LABELS[item.type]} · {STATUS_LABELS[item.status]}
        </span>
        <span className="ap-row-meta">{formatWhen(item.createdAt)}</span>
      </div>
      <p className="ap-text ap-bell-message" data-testid="feedback-inbox-message">{item.message}</p>
      <Shots images={item.images} />
      <div className="ap-fb-meta">
        <span>Pantalla: {item.route}</span>
        <span>Versión: {item.appVersion}</span>
        <span>Ventana: {item.viewport}</span>
        <span>Idioma: {item.language}</span>
        <span>Autor: {item.authorRef}</span>
      </div>
      <p className="ap-hint">{item.userAgent}</p>
      <StatusButtons item={item} onChange={onChange} />
    </li>
  );
}

interface FiltersProps {
  type: string;
  status: string;
  onType: (value: string) => void;
  onStatus: (value: string) => void;
}

function Filters({ type, status, onType, onStatus }: FiltersProps) {
  function handleType(event: React.ChangeEvent<HTMLSelectElement>) {
    onType(event.target.value);
  }
  function handleStatus(event: React.ChangeEvent<HTMLSelectElement>) {
    onStatus(event.target.value);
  }
  return (
    <div className="ap-fb-filters">
      <label className="ap-field">
        <span className="ap-label">Tipo</span>
        <select className="ap-select" value={type} onChange={handleType} data-testid="feedback-filter-type">
          <option value="">Todos</option>
          {TYPE_ORDER.map((kind) => (
            <option key={kind} value={kind}>{TYPE_LABELS[kind]}</option>
          ))}
        </select>
      </label>
      <label className="ap-field">
        <span className="ap-label">Estado</span>
        <select className="ap-select" value={status} onChange={handleStatus} data-testid="feedback-filter-status">
          <option value="">Todos</option>
          {STATUS_ORDER.map((value) => (
            <option key={value} value={value}>{STATUS_LABELS[value]}</option>
          ))}
        </select>
      </label>
      <ExportLinks type={type} status={status} />
    </div>
  );
}

function ExportLinks({ type, status }: { type: string; status: string }) {
  const base = query(type, status);
  const join = base === "" ? "?" : `${base}&`;
  return (
    <div className="ap-actions">
      <a className="ap-btn ap-btn--compact" href={`/api/feedback-admin/export${join}format=json`} download data-testid="feedback-export-json">Exportar JSON</a>
      <a className="ap-btn ap-btn--compact" href={`/api/feedback-admin/export${join}format=csv`} download data-testid="feedback-export-csv">Exportar CSV</a>
    </div>
  );
}

function InboxBody({ data, type, status, onType, onStatus, onChange }: { data: InboxData; type: string; status: string; onType: (v: string) => void; onStatus: (v: string) => void; onChange: (id: string, status: FeedbackState) => void }) {
  return (
    <>
      <Filters type={type} status={status} onType={onType} onStatus={onStatus} />
      <p className="ap-hint" data-testid="feedback-inbox-count">{data.items.length} de {data.total} mensajes · {data.pending} pendientes</p>
      <EmptyInbox show={data.items.length === 0} />
      <ul className="ap-list">
        {data.items.map((item) => (
          <InboxRow key={item.id} item={item} onChange={onChange} />
        ))}
      </ul>
      <p className="ap-hint">Las exportaciones no incluyen SteamID ni nombres de Steam (solo una referencia de autor). El texto lo escribió cada persona y puede contener datos personales: no lo publiques.</p>
    </>
  );
}

function EmptyInbox({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="ap-hint" data-testid="feedback-inbox-empty">No hay mensajes con estos filtros.</p>;
}

function InboxContent(props: { state: InboxState; type: string; status: string; onType: (v: string) => void; onStatus: (v: string) => void; onChange: (id: string, status: FeedbackState) => void }) {
  const { state, ...rest } = props;
  if (state.kind === "loading") return <p className="ap-loading" role="status">Cargando mensajes…</p>;
  if (state.kind === "forbidden") {
    return (
      <AppNotice tone="info" title="Solo el propietario de la beta ve el feedback" testId="feedback-inbox-forbidden">
        <p>Esta bandeja es para quien administra la beta. Tu cuenta funciona con normalidad.</p>
      </AppNotice>
    );
  }
  if (state.kind === "error") {
    return (
      <AppNotice tone="error" title="No se pudo cargar la bandeja">
        <p>Recarga la página para reintentar.</p>
      </AppNotice>
    );
  }
  return <InboxBody data={state.data} {...rest} />;
}

export function FeedbackInbox() {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [state, setState] = useState<InboxState>({ kind: "loading" });

  // Filtros vigentes y número de la última petición: una respuesta vieja nunca pisa a una más nueva. Antes, cambiar un estado y enseguida el filtro dejaba
  // la lista SIN filtrar (la del cierre viejo) mientras el selector decía "En revisión" (visto en el E2E de CI: 3 mensajes en vez de 1).
  // Los filtros vigentes se anotan en los MANEJADORES (no durante el render: el compilador de React no garantiza escrituras a refs al renderizar).
  const filters = useRef({ type: "", status: "" });
  const latestRequest = useRef(0);

  const handleType = useCallback((value: string) => {
    filters.current = { ...filters.current, type: value };
    setType(value);
  }, []);

  const handleStatus = useCallback((value: string) => {
    filters.current = { ...filters.current, status: value };
    setStatus(value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    latestRequest.current += 1;
    const mine = latestRequest.current;
    void loadInbox(type, status).then((next) => {
      if (!cancelled && mine === latestRequest.current) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [type, status]);

  const handleChange = useCallback(async (id: string, next: FeedbackState) => {
    await changeStatus(id, next);
    // No invalida las cargas de otros cambios de estado (ambas se aplican en el orden en que llegan); solo una carga por CAMBIO DE FILTRO la deja obsoleta.
    const mine = latestRequest.current;
    const reloaded = await loadInbox(filters.current.type, filters.current.status);
    if (mine === latestRequest.current) setState(reloaded);
  }, []);

  function handleChangePress(id: string, next: FeedbackState) {
    void handleChange(id, next);
  }

  return (
    <main className="ap-main" data-testid="feedback-inbox">
      <PageHead kicker="Beta privada" title="Bandeja de feedback" lede="Lo que cuentan tus jugadores: problemas, ideas, sugerencias y dudas, con sus capturas." />
      <InboxContent state={state} type={type} status={status} onType={handleType} onStatus={handleStatus} onChange={handleChangePress} />
    </main>
  );
}
