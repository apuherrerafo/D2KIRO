"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { prepareImage } from "./image-prep";
import { STATUS_LABELS, TYPE_LABELS, TYPE_ORDER, type FeedbackKind, type MyFeedback } from "./labels";

// <Dominio><Cosa>: botón flotante de feedback para toda cuenta con sesión, abajo a la derecha. Abre un panel tipo chat: arriba los reportes
// que ya enviaste (y en qué estado van), abajo el formulario. Texto + hasta 3 capturas con vista previa. Con cada reporte viaja contexto
// técnico NO sensible (pantalla, tamaño de ventana, idioma, navegador); nunca cookies, claves ni tokens. Versión y autor los pone el servidor.

interface Limits {
  images: number;
  imageBytes: number;
  message: number;
}

interface Config {
  imagesEnabled: boolean;
  limits: Limits;
  items: MyFeedback[];
}

interface Attachment {
  id: number;
  file: File;
  url: string;
}

type SendError = "empty" | "rate_limited" | "images_unavailable" | "image_upload_failed" | "image_format" | "too_large" | "network" | "failed" | "session";

const SEND_ERROR_TEXT: Record<SendError, string> = {
  empty: "Escribe tu mensaje antes de enviar.",
  rate_limited: "Enviaste muchos reportes seguidos. Espera un rato e inténtalo de nuevo.",
  images_unavailable: "Las capturas no están disponibles por ahora. Envía el reporte sin imágenes.",
  image_upload_failed: "No se pudieron subir las capturas. Tu reporte NO se envió: inténtalo de nuevo o envíalo sin imágenes.",
  image_format: "Solo se aceptan capturas PNG, JPG o WebP.",
  too_large: "Una captura pesa demasiado, incluso reducida. Prueba con otra más pequeña.",
  network: "No hay conexión con D2KIRO. Revisa tu internet e inténtalo de nuevo.",
  failed: "No pudimos guardar tu reporte. Inténtalo de nuevo en unos minutos.",
  session: "Tu sesión venció. Vuelve a entrar con Steam y reenvíalo.",
};

const FAILURE_BY_STATUS: Record<string, SendError> = { "401": "session", "429": "rate_limited", "413": "too_large", "415": "image_format" };

async function loadConfig(): Promise<Config | null> {
  try {
    const response = await fetch("/api/feedback", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as Config;
  } catch {
    return null;
  }
}

async function postReport(form: FormData): Promise<{ ok: true } | { ok: false; error: SendError }> {
  try {
    const response = await fetch("/api/feedback", { method: "POST", body: form });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (body.error === "images_unavailable" || body.error === "image_upload_failed") return { ok: false, error: body.error };
    return { ok: false, error: FAILURE_BY_STATUS[String(response.status)] ?? "failed" };
  } catch {
    return { ok: false, error: "network" };
  }
}

function technicalContext(): { viewport: string; language: string; userAgent: string } {
  return { viewport: `${window.innerWidth}x${window.innerHeight}`, language: navigator.language, userAgent: navigator.userAgent };
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

function Thread({ items }: { items: MyFeedback[] }) {
  if (items.length === 0) return <p className="ap-hint" data-testid="feedback-empty">Aún no enviaste nada. Cuéntanos un problema, una idea o una duda: lo leemos todo.</p>;
  return (
    <ul className="ap-fb-thread" data-testid="feedback-thread">
      {items.map((item) => (
        <li key={item.id} className="ap-fb-bubble" data-testid="feedback-sent">
          <span className="ap-row-meta">
            {TYPE_LABELS[item.type]} · {STATUS_LABELS[item.status]} · {item.route}
          </span>
          <p>{item.message}</p>
          <ImageStrip images={item.images} />
        </li>
      ))}
    </ul>
  );
}

function ImageStrip({ images }: { images: MyFeedback["images"] }) {
  if (images.length === 0) return null;
  return (
    <div className="ap-fb-shots">
      {images.map((image) => (
        // eslint-disable-next-line @next/next/no-img-element -- captura privada servida por la ruta autorizada de D2KIRO, no un asset optimizable
        <img key={image.url} src={image.url} alt="Captura adjunta" className="ap-fb-shot" loading="lazy" />
      ))}
    </div>
  );
}

function TypePicker({ value, onChange }: { value: FeedbackKind; onChange: (kind: FeedbackKind) => void }) {
  return (
    <div className="ap-fb-types" role="radiogroup" aria-label="Tipo de reporte">
      {TYPE_ORDER.map((kind) => (
        <TypeChip key={kind} kind={kind} selected={value === kind} onChange={onChange} />
      ))}
    </div>
  );
}

function TypeChip({ kind, selected, onChange }: { kind: FeedbackKind; selected: boolean; onChange: (kind: FeedbackKind) => void }) {
  function handlePress() {
    onChange(kind);
  }
  return (
    <button type="button" role="radio" aria-checked={selected} className={selected ? "ap-btn ap-btn--compact ap-btn--solid" : "ap-btn ap-btn--compact"} onClick={handlePress} data-testid={`feedback-type-${kind}`}>
      {TYPE_LABELS[kind]}
    </button>
  );
}

function Previews({ items, onRemove }: { items: Attachment[]; onRemove: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="ap-fb-previews" data-testid="feedback-previews">
      {items.map((item) => (
        <PreviewItem key={item.id} item={item} onRemove={onRemove} />
      ))}
    </ul>
  );
}

function PreviewItem({ item, onRemove }: { item: Attachment; onRemove: (id: number) => void }) {
  function handleRemove() {
    onRemove(item.id);
  }
  return (
    <li className="ap-fb-preview">
      {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) de la captura elegida */}
      <img src={item.url} alt="Vista previa de la captura" />
      <button type="button" className="ap-btn ap-btn--compact" onClick={handleRemove}>
        Quitar
      </button>
    </li>
  );
}

function Notice({ role, text, testId }: { role: "alert" | "status"; text: string | null; testId: string }) {
  if (text === null) return null;
  return (
    <p className="ap-hint" role={role} data-testid={testId}>
      {text}
    </p>
  );
}

interface FormProps {
  config: Config;
  route: string;
  onSent: () => void;
}

function ReportForm({ config, route, onSent }: FormProps) {
  const [kind, setKind] = useState<FeedbackKind>("problema");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const counter = useRef(0);
  const picker = useRef<HTMLInputElement | null>(null);
  const { limits } = config;

  const urlsRef = useRef<string[]>([]);
  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const addFiles = useCallback(async (files: File[]) => {
    setImageNote(null);
    const room = limits.images - attachments.length;
    if (files.length > room) setImageNote(`Máximo ${limits.images} capturas por reporte.`);
    const next: Attachment[] = [];
    for (const file of files.slice(0, Math.max(room, 0))) {
      const prepared = await prepareImage(file, limits.imageBytes);
      if (!prepared.ok) {
        setImageNote(prepared.reason === "format" ? "Solo se aceptan capturas PNG, JPG o WebP." : "No pudimos reducir esa captura. Prueba con una más pequeña.");
        continue;
      }
      const url = URL.createObjectURL(prepared.file);
      urlsRef.current.push(url);
      counter.current += 1;
      next.push({ id: counter.current, file: prepared.file, url });
    }
    setAttachments((current) => [...current, ...next]);
  }, [attachments.length, limits.imageBytes, limits.images]);

  function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void addFiles(files);
  }
  function handleOpenPicker() {
    picker.current?.click();
  }
  const handleRemove = useCallback((id: number) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);
  function handleMessage(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setMessage(event.target.value);
  }

  const send = useCallback(async () => {
    if (message.trim().length === 0) {
      setError("empty");
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("type", kind);
    form.set("message", message);
    form.set("route", route);
    const context = technicalContext();
    form.set("viewport", context.viewport);
    form.set("language", context.language);
    form.set("userAgent", context.userAgent);
    attachments.forEach((item) => form.append("images", item.file, item.file.name));
    const result = await postReport(form);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("");
    setAttachments([]);
    onSent();
  }, [attachments, kind, message, onSent, route]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  return (
    <form className="ap-fb-form" onSubmit={handleSubmit} data-testid="feedback-form">
      <TypePicker value={kind} onChange={setKind} />
      <textarea className="ap-input ap-textarea" value={message} onChange={handleMessage} maxLength={limits.message} rows={4} placeholder="¿Qué pasó, qué se te ocurre o qué quieres preguntar?" aria-label="Tu mensaje" disabled={busy} data-testid="feedback-message" />
      <Previews items={attachments} onRemove={handleRemove} />
      <ImagePicker enabled={config.imagesEnabled} full={attachments.length >= limits.images} busy={busy} pickerRef={picker} onOpen={handleOpenPicker} onPick={handlePick} />
      <Notice role="status" text={imageNote} testId="feedback-image-note" />
      <Notice role="alert" text={error === null ? null : SEND_ERROR_TEXT[error]} testId="feedback-error" />
      <p className="ap-hint">Se adjunta la pantalla ({route}), el tamaño de tu ventana, el idioma y tu navegador. Nunca cookies, claves ni tu SteamID.</p>
      <button type="submit" className="ap-btn ap-btn--solid" disabled={busy} aria-busy={busy} data-testid="feedback-submit">
        {busy ? "Enviando…" : "Enviar"}
      </button>
    </form>
  );
}

interface PickerProps {
  enabled: boolean;
  full: boolean;
  busy: boolean;
  pickerRef: React.RefObject<HTMLInputElement | null>;
  onOpen: () => void;
  onPick: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

function ImagePicker({ enabled, full, busy, pickerRef, onOpen, onPick }: PickerProps) {
  if (!enabled) return <p className="ap-hint" data-testid="feedback-images-off">Las capturas no están disponibles por ahora; tu texto sí se envía.</p>;
  return (
    <div className="ap-actions">
      <input ref={pickerRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={onPick} data-testid="feedback-file" />
      <button type="button" className="ap-btn ap-btn--compact" onClick={onOpen} disabled={busy || full} data-testid="feedback-attach">
        Adjuntar captura
      </button>
    </div>
  );
}

function Panel({ route, onClose }: { route: string; onClose: () => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [failed, setFailed] = useState(false);
  const [thanks, setThanks] = useState(false);

  const apply = useCallback((next: Config | null) => {
    setConfig(next);
    setFailed(next === null);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void loadConfig().then((next) => {
      if (!cancelled) apply(next);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const handleSent = useCallback(() => {
    setThanks(true);
    void loadConfig().then(apply);
  }, [apply]);

  return (
    <section className="ap-fb-panel" role="dialog" aria-label="Enviar feedback" data-testid="feedback-panel">
      <div className="ap-section-head">
        <h2 className="ap-h3">Feedback de la beta</h2>
        <button type="button" className="ap-btn ap-btn--quiet" onClick={onClose} data-testid="feedback-close">
          Cerrar
        </button>
      </div>
      <PanelBody config={config} failed={failed} route={route} thanks={thanks} onSent={handleSent} />
    </section>
  );
}

function PanelBody({ config, failed, route, thanks, onSent }: { config: Config | null; failed: boolean; route: string; thanks: boolean; onSent: () => void }) {
  if (failed) return <p className="ap-hint" role="alert" data-testid="feedback-load-error">No pudimos abrir el feedback. Recarga la página e inténtalo de nuevo.</p>;
  if (config === null) return <p className="ap-loading" role="status">Cargando…</p>;
  return (
    <>
      <Thread items={config.items} />
      <Notice role="status" text={thanks ? "¡Gracias! Recibimos tu reporte." : null} testId="feedback-thanks" />
      <ReportForm config={config} route={route} onSent={onSent} />
    </>
  );
}

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "/";
  function handleToggle() {
    setOpen((value) => !value);
  }
  const handleClose = useCallback(() => setOpen(false), []);
  return (
    <>
      <PanelIfOpen open={open} route={pathname} onClose={handleClose} />
      <button type="button" className="ap-fb-fab" onClick={handleToggle} aria-expanded={open} data-testid="feedback-fab">
        <ChatIcon />
        Feedback
      </button>
    </>
  );
}

function PanelIfOpen({ open, route, onClose }: { open: boolean; route: string; onClose: () => void }) {
  if (!open) return null;
  return <Panel route={route} onClose={onClose} />;
}
