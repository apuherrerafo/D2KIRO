"use client";

import { useState } from "react";
import { HeroPicker } from "@/components/hero-picker/HeroPicker";
import type { TeamSide } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { teamPositionName } from "../constants";
import { CHIP, CHIP_ACTIVE } from "../styles";
import type { LiveObservationInput, TeamPosition } from "../types";

// Fallback manual del draft en vivo: cuando la captura de Overwolf falla (o para corregirla), el Player
// carga lo que ve en Dota. Son los MISMOS hechos que manda el capturador -- el motor reconstruye el
// draft desde ellos, así que nada de lo ya capturado se pierde.

type EntryMode = "own_pick" | "enemy_pick" | "ban";

const MODES: { mode: EntryMode; label: string }[] = [
  { mode: "own_pick", label: "Pick de mi equipo" },
  { mode: "enemy_pick", label: "Pick rival" },
  { mode: "ban", label: "Ban" },
];
const POSITIONS: TeamPosition[] = [1, 2, 3, 4, 5];
const SIDE_LABELS: Readonly<Record<TeamSide, string>> = { radiant: "Radiant", dire: "Dire" };

function otherSide(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

interface ModeChipProps {
  mode: EntryMode;
  label: string;
  active: boolean;
  onSelect(mode: EntryMode): void;
}

function ModeChip({ mode, label, active, onSelect }: ModeChipProps) {
  function handleClick() {
    onSelect(mode);
  }
  return (
    <button type="button" onClick={handleClick} className={active ? CHIP_ACTIVE : CHIP} aria-pressed={active}>
      {label}
    </button>
  );
}

interface PositionChipProps {
  position: TeamPosition;
  active: boolean;
  onSelect(position: TeamPosition): void;
}

function PositionChip({ position, active, onSelect }: PositionChipProps) {
  function handleClick() {
    onSelect(position);
  }
  return (
    <button type="button" onClick={handleClick} className={active ? CHIP_ACTIVE : CHIP} aria-pressed={active} data-testid={`live-manual-position-${position}`}>
      {teamPositionName(position)}
    </button>
  );
}

interface SideChipProps {
  side: TeamSide;
  active: boolean;
  onSelect(side: TeamSide): void;
}

function SideChip({ side, active, onSelect }: SideChipProps) {
  function handleClick() {
    onSelect(side);
  }
  return (
    <button type="button" onClick={handleClick} className={active ? CHIP_ACTIVE : CHIP} aria-pressed={active}>
      {SIDE_LABELS[side]}
    </button>
  );
}

function PositionRow({ mode, position, onSelect }: { mode: EntryMode; position: TeamPosition | null; onSelect(position: TeamPosition): void }) {
  if (mode !== "own_pick") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {POSITIONS.map((candidate) => (
        <PositionChip key={candidate} position={candidate} active={candidate === position} onSelect={onSelect} />
      ))}
    </div>
  );
}

function heroLabel(heroCatalog: Map<number, HeroMeta>, heroId: number): string {
  return heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`;
}

interface CorrectionChipProps {
  heroId: number;
  label: string;
  onRemove(heroId: number): void;
}

function CorrectionChip({ heroId, label, onRemove }: CorrectionChipProps) {
  function handleClick() {
    onRemove(heroId);
  }
  return (
    <button type="button" onClick={handleClick} className={CHIP} aria-label={`Quitar ${label}`} data-testid={`live-correction-${heroId}`}>
      ✕ {label}
    </button>
  );
}

interface CorrectionGroupProps {
  title: string;
  heroIds: readonly number[];
  heroCatalog: Map<number, HeroMeta>;
  onRemove(heroId: number): void;
}

function CorrectionGroup({ title, heroIds, heroCatalog, onRemove }: CorrectionGroupProps) {
  if (heroIds.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-caption text-content-muted">{title}:</span>
      {heroIds.map((heroId) => (
        <CorrectionChip key={heroId} heroId={heroId} label={heroLabel(heroCatalog, heroId)} onRemove={onRemove} />
      ))}
    </div>
  );
}

interface ManualCorrectionsProps {
  heroCatalog: Map<number, HeroMeta>;
  bans: readonly number[];
  ownPicks: readonly number[];
  enemyPicks: readonly number[];
  onUnban(heroId: number): void;
  onRevertOwn(heroId: number): void;
  onRevertEnemy(heroId: number): void;
}

/** Undo a fact entered (or captured) by mistake: the engine rebuilds the draft without it. */
function ManualCorrections({ heroCatalog, bans, ownPicks, enemyPicks, onUnban, onRevertOwn, onRevertEnemy }: ManualCorrectionsProps) {
  if (bans.length + ownPicks.length + enemyPicks.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="live-manual-corrections">
      <span className="text-caption font-semibold text-content-secondary">Corregir (quitar un dato cargado por error)</span>
      <CorrectionGroup title="Bans" heroIds={bans} heroCatalog={heroCatalog} onRemove={onUnban} />
      <CorrectionGroup title="Mi equipo" heroIds={ownPicks} heroCatalog={heroCatalog} onRemove={onRevertOwn} />
      <CorrectionGroup title="Rival" heroIds={enemyPicks} heroCatalog={heroCatalog} onRemove={onRevertEnemy} />
    </div>
  );
}

function ManualError({ message }: { message: string | null }) {
  if (!message) return null;
  return <span className="text-caption text-signal-negative" role="alert">{message}</span>;
}

export interface LiveManualEntryProps {
  heroCatalog: Map<number, HeroMeta>;
  unavailableHeroIds: ReadonlySet<number>;
  /** What the draft holds now, so a mistake can be removed. */
  bans?: readonly number[];
  ownPicks?: readonly number[];
  enemyPicks?: readonly number[];
  localSide: TeamSide | null;
  /** Shared with the board: clicking a column picks the position for the next own pick. */
  position: TeamPosition | null;
  onSelectPosition(position: TeamPosition): void;
  draftStarted: boolean;
  /** Open by default when the capture is degraded. */
  open: boolean;
  error: string | null;
  onReport(observation: LiveObservationInput): void;
}

export function LiveManualEntry({ heroCatalog, unavailableHeroIds, bans = [], ownPicks = [], enemyPicks = [], localSide, position, onSelectPosition, draftStarted, open, error, onReport }: LiveManualEntryProps) {
  const [mode, setMode] = useState<EntryMode>("own_pick");
  const side: TeamSide = localSide ?? "radiant";

  function handleHero(heroId: number) {
    if (mode === "ban") {
      onReport({ type: "ban", heroId });
      return;
    }
    onReport({ type: "pick", side: mode === "own_pick" ? side : otherSide(side), heroId, position: mode === "own_pick" ? position : null });
  }
  function handleSide(next: TeamSide) {
    onReport({ type: "side", side: next });
  }
  function handleStart() {
    onReport({ type: "draft_started" });
  }
  function handleCloseBans() {
    onReport({ type: "bans_closed" });
  }
  function handleUnban(heroId: number) {
    onReport({ type: "unban", heroId });
  }
  function handleRevertOwn(heroId: number) {
    onReport({ type: "revert", side, heroId });
  }
  function handleRevertEnemy(heroId: number) {
    onReport({ type: "revert", side: otherSide(side), heroId });
  }

  return (
    <details open={open} className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4" data-testid="live-manual-entry">
      <summary className="cursor-pointer text-body text-content-primary">Entrada manual (si la captura falla)</summary>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption text-content-muted">Mi lado:</span>
          <SideChip side="radiant" active={localSide === "radiant"} onSelect={handleSide} />
          <SideChip side="dire" active={localSide === "dire"} onSelect={handleSide} />
          <button type="button" onClick={handleStart} disabled={draftStarted} className={CHIP}>
            Empezó la selección
          </button>
          <button type="button" onClick={handleCloseBans} disabled={!draftStarted} className={CHIP}>
            Terminaron los bans
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {MODES.map((entry) => (
            <ModeChip key={entry.mode} mode={entry.mode} label={entry.label} active={entry.mode === mode} onSelect={setMode} />
          ))}
        </div>
        <PositionRow mode={mode} position={position} onSelect={onSelectPosition} />
        <HeroPicker heroes={[...heroCatalog.values()]} onSelect={handleHero} unavailableHeroIds={unavailableHeroIds} />
        <ManualCorrections
          heroCatalog={heroCatalog}
          bans={bans}
          ownPicks={ownPicks}
          enemyPicks={enemyPicks}
          onUnban={handleUnban}
          onRevertOwn={handleRevertOwn}
          onRevertEnemy={handleRevertEnemy}
        />
        <ManualError message={error} />
      </div>
    </details>
  );
}
