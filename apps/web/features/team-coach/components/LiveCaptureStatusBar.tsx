"use client";

import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { CAPTURE_NOT_ENABLED, DOTA_NOT_RUNNING, GSI_DRAFT_PARTIAL, LIVE_PHASE_LABELS, teamPositionName } from "../constants";
import { STATUS_PILL_BAD, STATUS_PILL_MUTED, STATUS_PILL_OK, STATUS_PILL_WARN } from "../styles";
import type { LiveCaptureStatus } from "../types";

// CONNECTION / CAPTURE / SIDE del draft en vivo, más el aviso de pick detectado y el de captura
// degradada o parcial. Nunca un estado silencioso: cada problema de captura se dice en llano, con su
// acción -- y en lenguaje de jugador (TSK-219): sin herramientas de desarrollo, puertos ni procesos.

interface Pill {
  className: string;
  text: string;
}

/** The Companion when it is alive, else null: an old heartbeat is never presented as current. */
export function activeCompanion(status: LiveCaptureStatus | null) {
  const companion = status?.companion ?? null;
  if (companion === null || !companion.active) return null;
  return companion;
}

/** What the Companion on the Player's PC knows when Dota is NOT talking to the session yet. */
function companionDotaPill(status: LiveCaptureStatus | null): Pill | null {
  const companion = activeCompanion(status);
  if (companion === null || companion.dota === "connected") return null;
  if (companion.restartNeeded) return { className: STATUS_PILL_WARN, text: "● Reinicia Dota 2 una vez" };
  if (companion.dota === "waiting") return { className: STATUS_PILL_WARN, text: "● Dota abierto · esperando datos" };
  return { className: STATUS_PILL_MUTED, text: "● Companion conectado · abre Dota 2" };
}

/** One line of setup guidance from the Companion's reading; null when Dota is already talking or there is no live Companion. */
export function companionGuidance(status: LiveCaptureStatus | null): string | null {
  if (status?.connection === "connected") return null;
  const pill = companionDotaPill(status);
  if (pill === null) return null;
  return pill.text.replace("● ", "");
}

export function connectionPill(status: LiveCaptureStatus | null): Pill {
  const fromCompanion = status?.connection === "connected" ? null : companionDotaPill(status);
  if (fromCompanion !== null) return fromCompanion;
  if (status === null || status.connection === "waiting") return { className: STATUS_PILL_MUTED, text: "● Esperando Dota..." };
  if (status.connection === "stale") return { className: STATUS_PILL_WARN, text: "● Reconectando..." };
  if (status.captureDetail === DOTA_NOT_RUNNING) return { className: STATUS_PILL_WARN, text: "● Dota 2 no está abierto" };
  return { className: STATUS_PILL_OK, text: "● Dota conectado" };
}

export function capturePill(status: LiveCaptureStatus | null): Pill {
  if (status !== null && status.captureDetail === CAPTURE_NOT_ENABLED) return { className: STATUS_PILL_BAD, text: "● Captura deshabilitada" };
  if (status === null || status.draftPhase === "waiting") return { className: STATUS_PILL_MUTED, text: "● Esperando selección de héroes..." };
  if (status.draftPhase === "ended") return { className: STATUS_PILL_MUTED, text: "● Draft terminado" };
  if (status.captureDetail === GSI_DRAFT_PARTIAL) return { className: STATUS_PILL_WARN, text: "● Hero Selection · captura parcial" };
  return { className: STATUS_PILL_OK, text: "● Hero Selection" };
}

/** Captura automática del draft (retratos de la pantalla de Dota: nunca un frame, sólo hechos). El Player no gestiona ningún proceso interno. */
export function visualPill(status: LiveCaptureStatus | null): Pill {
  const visual = status?.visual ?? null;
  if (visual === null || !visual.active || visual.health !== "ok") return { className: STATUS_PILL_MUTED, text: "● Captura automática no disponible" };
  if (status?.draftPhase === "ended") return { className: STATUS_PILL_MUTED, text: "● Draft terminado" };
  if (status?.draftPhase !== "hero_selection") return { className: STATUS_PILL_OK, text: "● Ventana de Dota encontrada · esperando selección de héroes" };
  return { className: STATUS_PILL_OK, text: `● ${Math.min(status.picks, 10)}/10 héroes reconocidos` };
}

/** D2KIRO Companion: the local background app that keeps Dota connected (heartbeat every 15 s). */
export function companionPill(status: LiveCaptureStatus | null): Pill {
  const companion = activeCompanion(status);
  if (companion !== null) return { className: STATUS_PILL_OK, text: "● Companion conectado" };
  if (status?.companion) return { className: STATUS_PILL_WARN, text: "● Companion sin señal · ¿está prendida la PC?" };
  return { className: STATUS_PILL_MUTED, text: "● Companion no detectado" };
}

const GSI_PHASE_KEYS: Readonly<Record<string, string>> = Object.freeze({ idle: "MENU", loading: "LOADING", draft: "HERO_SELECTION", match: "MATCH" });

/** Dota lifecycle: the Companion's local reading when alive, else the GSI the session received. */
export function phasePill(status: LiveCaptureStatus | null): Pill {
  const companion = activeCompanion(status);
  let key: string | null = null;
  if (companion !== null && companion.dota === "connected") key = companion.phase;
  else if (status?.gsi?.active) key = GSI_PHASE_KEYS[status.gsi.phase] ?? null;
  if (key === null) return { className: STATUS_PILL_MUTED, text: "—" };
  return { className: "text-body text-content-primary", text: LIVE_PHASE_LABELS[key] ?? "—" };
}

export function isCaptureDegraded(status: LiveCaptureStatus | null): boolean {
  if (status === null) return false;
  return status.connection === "stale" || status.captureHealth === "degraded" || status.captureHealth === "lost";
}

function sideText(status: LiveCaptureStatus | null): string {
  if (status?.localSide === "radiant") return "Radiant";
  if (status?.localSide === "dire") return "Dire";
  return "—";
}

function StatusItem({ label, pill }: { label: string; pill: Pill }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-semibold text-content-muted">{label}</span>
      <span className={pill.className}>{pill.text}</span>
    </div>
  );
}

interface DetectedPickProps {
  status: LiveCaptureStatus | null;
  heroCatalog: Map<number, HeroMeta>;
}

function DetectedPick({ status, heroCatalog }: DetectedPickProps) {
  const pick = status?.lastDetectedPick;
  if (!pick || status?.localSide !== pick.side) return null;
  const hero = heroCatalog.get(pick.heroId)?.localizedName ?? `Héroe ${pick.heroId}`;
  const where = pick.position === null ? "Posición sin informar" : teamPositionName(pick.position);
  return (
    <div className="rounded-lg border border-accent-primary bg-surface-overlay p-3" role="status" data-testid="live-pick-detected">
      <span className="text-caption font-semibold text-accent-primary">TEAM PICK DETECTED</span>
      <span className="ml-2 text-body text-content-primary">{where} → {hero}</span>
    </div>
  );
}

function yesNo(seen: boolean): string {
  if (seen) return "sí";
  return "no";
}

/** True when Dota reports only part of the draft: no recommendation may be built on it. */
export function isDraftPartial(status: LiveCaptureStatus | null): boolean {
  return isCaptureDegraded(status) && status?.captureDetail === GSI_DRAFT_PARTIAL;
}

/** Exactly what this player's Dota reported -- nothing is presented as captured when it was not. Never asks for manual entry. */
function PartialCaptureNotice({ status }: { status: LiveCaptureStatus }) {
  const seen = status.gsi?.draft;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-signal-warning bg-surface-overlay p-3" role="alert" data-testid="live-capture-partial">
      <span className="text-caption font-semibold text-signal-warning">Draft automático incompleto</span>
      <span className="text-caption text-content-secondary">D2KIRO todavía no está recibiendo todo el draft de esta partida. No hay recomendación hasta tener el draft completo.</span>
      <span className="text-caption text-content-muted" data-testid="live-capture-capabilities">
        Dota informa — bando: {yesNo(seen?.side === true)} · tu héroe: {yesNo(seen?.ownHero === true)} · bans: {yesNo(seen?.bans === true)} · picks aliados: {yesNo(seen?.allyPicks === true)} · picks rivales: {yesNo(seen?.enemyPicks === true)}
      </span>
    </div>
  );
}

function DegradedNotice({ status }: { status: LiveCaptureStatus | null }) {
  if (!isCaptureDegraded(status)) return null;
  if (status?.captureDetail === GSI_DRAFT_PARTIAL) return <PartialCaptureNotice status={status} />;
  if (status?.captureDetail === CAPTURE_NOT_ENABLED) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-signal-negative bg-surface-overlay p-3" role="alert" data-testid="live-capture-not-enabled">
        <span className="text-caption font-semibold text-signal-negative">Captura degradada · {CAPTURE_NOT_ENABLED}</span>
        <span className="text-caption text-content-secondary">Dota no está enviando datos a D2KIRO. Mira «Opciones avanzadas de conexión» en Conexión con Dota.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-signal-warning bg-surface-overlay p-3" role="alert" data-testid="live-capture-degraded">
      <span className="text-caption font-semibold text-signal-warning">Reconectando con Dota...</span>
      <span className="text-caption text-content-secondary">El draft no se perdió. La conexión se recupera sola y el Team Coach se recalcula igual.</span>
    </div>
  );
}

function DeferredNotice({ status }: { status: LiveCaptureStatus | null }) {
  if (!status || status.deferredPicks === 0) return null;
  return <span className="text-caption text-signal-warning">{status.deferredPicks} pick(s) esperando que el rival revele su ronda.</span>;
}

export function LiveCaptureStatusBar({ status, heroCatalog }: DetectedPickProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="live-capture-status">
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-surface-border bg-surface-raised p-3 sm:grid-cols-3">
        <StatusItem label="COMPANION" pill={companionPill(status)} />
        <StatusItem label="CONNECTION" pill={connectionPill(status)} />
        <StatusItem label="PHASE" pill={phasePill(status)} />
        <StatusItem label="CAPTURE" pill={capturePill(status)} />
        <StatusItem label="DRAFT AUTOMÁTICO" pill={visualPill(status)} />
        <StatusItem label="SIDE" pill={{ className: "text-body text-content-primary", text: sideText(status) }} />
      </div>
      <DegradedNotice status={status} />
      <DetectedPick status={status} heroCatalog={heroCatalog} />
      <DeferredNotice status={status} />
    </div>
  );
}
