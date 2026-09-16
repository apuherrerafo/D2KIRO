"use client";

// R1 S7 (Blocker 2) -- Captain's Mode board. CM has no hidden information at all (frozen contract:
// "CM picks/bans are immediately REVEALED", perspective.ts) so this is deliberately much simpler
// than BlindRoundPanel: no timer, no reveal pause, no pending-selection buffer -- one HeroGrid
// click submits directly (`use-captains-mode-session.ts`'s submitHero), and the engine's own
// `eligibleHeroIds` (never recomputed here) is what the grid disables against.
import { useMemo } from "react";
import { HeroGrid } from "@/components/hero-grid/HeroGrid";
import { CompactBoard } from "@/components/draft-layout/DraftLayout";
import type { HeroId, TeamSide } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { CmActionOption } from "../use-captains-mode-session";
import type { ProtocolSnapshot } from "../../random-draft-simulator/protocol-client";

const ACTION_KIND_LABELS: Record<CmActionOption["kind"], string> = { BAN: "Ban", PICK: "Pick" };

function picksFromSnapshot(snapshot: ProtocolSnapshot): { radiant: HeroId[]; dire: HeroId[] } {
  const view = snapshot.view;
  const ownSide = view.viewerSide;
  const enemySide: TeamSide = ownSide === "radiant" ? "dire" : "radiant";
  const own = view.ownPicks.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
  const enemy = view.enemyPicks.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
  return { [ownSide]: own, [enemySide]: enemy } as { radiant: HeroId[]; dire: HeroId[] };
}

interface TurnStatusProps {
  localAction: CmActionOption | null;
  isComplete: boolean;
}

function TurnStatus({ localAction, isComplete }: TurnStatusProps) {
  if (isComplete) {
    return <span className="text-heading text-content-primary">Draft completo</span>;
  }
  if (localAction) {
    return (
      <span className="text-body font-semibold text-accent-primary">
        Paso {localAction.step} — tu turno: {ACTION_KIND_LABELS[localAction.kind]}
      </span>
    );
  }
  return <span className="text-body text-content-muted">Turno del rival — resolviendo...</span>;
}

export interface CaptainsModeBoardProps {
  snapshot: ProtocolSnapshot;
  localAction: CmActionOption | null;
  isComplete: boolean;
  heroCatalog: Map<number, HeroMeta>;
  onSelectHero: (heroId: HeroId) => void;
}

export function CaptainsModeBoard({ snapshot, localAction, isComplete, heroCatalog, onSelectHero }: CaptainsModeBoardProps) {
  const picks = picksFromSnapshot(snapshot);
  const heroes = useMemo(() => Array.from(heroCatalog.values()), [heroCatalog]);
  const eligibleSet = useMemo(() => new Set(localAction?.eligibleHeroIds ?? []), [localAction]);
  const unavailableHeroIds = useMemo(
    () => new Set(heroes.map((hero) => hero.id).filter((heroId) => !eligibleSet.has(heroId))),
    [heroes, eligibleSet],
  );

  return (
    <div className="flex flex-col gap-4">
      <CompactBoard banned={snapshot.view.bannedHeroes} picks={picks} localSide={snapshot.view.viewerSide} heroCatalog={heroCatalog} />
      <TurnStatus localAction={localAction} isComplete={isComplete} />
      {localAction && (
        <div className="rounded-lg border border-surface-border bg-surface-raised p-4">
          <HeroGrid heroes={heroes} onSelect={onSelectHero} unavailableHeroIds={unavailableHeroIds} />
        </div>
      )}
    </div>
  );
}
