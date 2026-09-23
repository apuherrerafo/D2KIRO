"use client";

import { useMemo, useState } from "react";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { HeroPicker } from "@/components/hero-picker/HeroPicker";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { TeamSide } from "../types";
import type { HeroId } from "../types";

// MVP P0.1 -- Live Companion. Reuses HeroPicker (deterministic substring search, no fuzzy/AI
// matching -- task spec section 4) exactly as ManualEntryPanel already does for the legacy
// /live-draft flow (features/draft). This is a SEPARATE component, never a fork of the Coach's
// recommendation rendering: CopilotPanel/CoachPanel below it are unchanged and unaware this mode
// exists (task spec section 6).

interface StagedEntryProps {
  label: string;
  hero: HeroMeta;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// "Correct an accidental manual selection before committing" (task spec section 3): the hero
// picked in HeroPicker is only STAGED here -- nothing reaches the engine until Confirmar.
function StagedEntry({ label, hero, submitting, onConfirm, onCancel }: StagedEntryProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent-primary bg-surface-overlay p-3">
      <span className="text-caption text-content-secondary">Vas a reportar para {label}:</span>
      <div className="flex items-center gap-2">
        <HeroIcon imgUrl={hero.imgUrl} alt={hero.localizedName} size={36} />
        <span className="text-body text-content-primary">{hero.localizedName}</span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onConfirm} disabled={submitting} className={BUTTON_PRIMARY}>
          {submitting ? "Enviando..." : "Confirmar"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} className={BUTTON_SECONDARY}>
          Corregir
        </button>
      </div>
    </div>
  );
}

interface ObservedBanRowProps {
  heroId: HeroId;
  localizedName: string;
  imgUrl: string | null;
  submitting: boolean;
  onRemove: (heroId: HeroId) => void;
}

function ObservedBanRow({ heroId, localizedName, imgUrl, submitting, onRemove }: ObservedBanRowProps) {
  function handleRemove() {
    onRemove(heroId);
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-surface-border bg-surface-overlay px-2 py-1">
      {imgUrl && <HeroIcon imgUrl={imgUrl} alt={localizedName} size={28} />}
      <span className="text-caption text-content-primary">{localizedName}</span>
      <button type="button" onClick={handleRemove} className={BUTTON_GHOST} disabled={submitting}>
        Quitar
      </button>
    </div>
  );
}

export interface LiveBanEntryPanelProps {
  observedBans: HeroId[];
  error: string | null;
  heroCatalog: Map<number, HeroMeta>;
  onConfirm: (heroIds: HeroId[]) => void;
  submitting: boolean;
}

// La lista de bans observados se arma toda en el cliente (agregar/quitar) y se envía ENTERA recién
// al confirmar -- "corregir antes de comprometer" para bans significa esto: nada llega al motor
// hasta que el Player dice que ya vio todos los bans reales del draft.
export function LiveBanEntryPanel({ observedBans, error, heroCatalog, onConfirm, submitting }: LiveBanEntryPanelProps) {
  const [staged, setStaged] = useState<HeroId[]>(observedBans);
  const heroes = useMemo(() => Array.from(heroCatalog.values()), [heroCatalog]);
  const unavailable = useMemo(() => new Set(staged), [staged]);

  function addBan(heroId: HeroId) {
    setStaged((current) => (current.includes(heroId) ? current : [...current, heroId]));
  }

  function removeBan(heroId: HeroId) {
    setStaged((current) => current.filter((id) => id !== heroId));
  }

  function handleConfirm() {
    onConfirm(staged);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-heading text-content-primary">Bans observados</span>
      <span className="text-caption text-content-muted">
        Escribí cada héroe baneado a medida que lo veas en tu cliente de Dota 2 -- de los dos equipos, en cualquier orden. Confirmá recién cuando ya
        se cerró la fase de bans en el draft real.
      </span>
      <div className="flex flex-wrap gap-2" role="list" aria-label="Bans observados">
        {staged.map((heroId) => (
          <ObservedBanRow
            key={heroId}
            heroId={heroId}
            localizedName={heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`}
            imgUrl={heroCatalog.get(heroId)?.imgUrl ?? null}
            submitting={submitting}
            onRemove={removeBan}
          />
        ))}
        {staged.length === 0 && <span className="text-caption text-content-muted">Todavía no agregaste ningún ban.</span>}
      </div>
      {error && <span className="text-caption text-signal-negative">{error}</span>}
      <HeroPicker heroes={heroes} unavailableHeroIds={unavailable} onSelect={addBan} />
      <button type="button" onClick={handleConfirm} disabled={submitting} className={`self-start ${BUTTON_PRIMARY}`}>
        {submitting ? "Enviando..." : "Confirmar bans y empezar Ronda 1"}
      </button>
    </div>
  );
}

export interface LivePendingPanelProps {
  round: 1 | 2 | 3;
  openSlots: { side: TeamSide; slotIndex: number }[];
  notice: string | null;
  heroCatalog: Map<number, HeroMeta>;
  banned: HeroId[];
  picks: { radiant: HeroId[]; dire: HeroId[] };
  /** El lado real del Player en ESTA sesión -- decide qué botón dice "TU EQUIPO" vs "ENEMIGO". */
  localSide: TeamSide;
  onSubmit: (side: TeamSide, heroId: HeroId) => Promise<void>;
}

function oppositeSide(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

function sideButtonClassName(current: TeamSide, target: TeamSide): string {
  return current === target ? BUTTON_PRIMARY : BUTTON_SECONDARY;
}

interface LivePendingEntryAreaProps {
  side: TeamSide;
  localSide: TeamSide;
  currentSideOpen: boolean;
  stagedHero: HeroMeta | null;
  submitting: boolean;
  heroes: HeroMeta[];
  unavailable: ReadonlySet<HeroId>;
  onStageHero: (heroId: HeroId) => void;
  onConfirmStaged: () => void;
  onCancelStaged: () => void;
}

// Early return por caso, nunca un ternario para elegir qué renderizar (web.md).
function LivePendingEntryArea({
  side,
  localSide,
  currentSideOpen,
  stagedHero,
  submitting,
  heroes,
  unavailable,
  onStageHero,
  onConfirmStaged,
  onCancelStaged,
}: LivePendingEntryAreaProps) {
  if (stagedHero) {
    const label = side === localSide ? "TU EQUIPO" : "ENEMIGO";
    return <StagedEntry label={label} hero={stagedHero} submitting={submitting} onConfirm={onConfirmStaged} onCancel={onCancelStaged} />;
  }
  if (!currentSideOpen) return null;
  return <HeroPicker heroes={heroes} unavailableHeroIds={unavailable} onSelect={onStageHero} />;
}

// El Player elige explícitamente "TU EQUIPO" o "ENEMIGO" antes de buscar el héroe -- nunca hay
// ambigüedad de a quién pertenece la entrada (task spec section 3, "make it obvious whose action
// is being entered"). Un lado sin asiento abierto en esta ronda queda deshabilitado, no oculto.
export function LivePendingPanel({ round, openSlots, notice, heroCatalog, banned, picks, localSide, onSubmit }: LivePendingPanelProps) {
  const [side, setSide] = useState<TeamSide>(localSide);
  const [stagedHeroId, setStagedHeroId] = useState<HeroId | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const heroes = useMemo(() => Array.from(heroCatalog.values()), [heroCatalog]);
  const unavailable = useMemo(() => new Set([...banned, ...picks.radiant, ...picks.dire]), [banned, picks]);
  const enemySide = oppositeSide(localSide);

  const openForSide = (target: TeamSide) => openSlots.some((slot) => slot.side === target);
  const currentSideOpen = openForSide(side);
  const stagedHero = stagedHeroId !== null ? heroCatalog.get(stagedHeroId) : null;

  function selectSide(target: TeamSide) {
    setStagedHeroId(null);
    setSide(target);
  }

  function selectOwnSide() {
    selectSide(localSide);
  }

  function selectEnemySide() {
    selectSide(enemySide);
  }

  function stageHero(heroId: HeroId) {
    setStagedHeroId(heroId);
  }

  function cancelStaged() {
    setStagedHeroId(null);
  }

  async function confirmStaged() {
    if (stagedHeroId === null) return;
    setSubmitting(true);
    try {
      await onSubmit(side, stagedHeroId);
    } finally {
      setSubmitting(false);
      setStagedHeroId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-heading text-content-primary">Ronda {round} -- reportar pick observado</span>
      <div className="flex gap-2" role="group" aria-label="A quién pertenece el pick">
        <button type="button" onClick={selectOwnSide} className={sideButtonClassName(side, localSide)} disabled={!openForSide(localSide)}>
          TU EQUIPO
        </button>
        <button type="button" onClick={selectEnemySide} className={sideButtonClassName(side, enemySide)} disabled={!openForSide(enemySide)}>
          ENEMIGO
        </button>
      </div>
      {notice && <span className="text-caption text-signal-negative">{notice}</span>}
      {!currentSideOpen && <span className="text-caption text-content-muted">Este lado ya completó sus asientos de esta ronda.</span>}
      <LivePendingEntryArea
        side={side}
        localSide={localSide}
        currentSideOpen={currentSideOpen}
        stagedHero={stagedHero ?? null}
        submitting={submitting}
        heroes={heroes}
        unavailable={unavailable}
        onStageHero={stageHero}
        onConfirmStaged={confirmStaged}
        onCancelStaged={cancelStaged}
      />
    </div>
  );
}
