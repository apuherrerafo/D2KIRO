"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { FREE_THREATS_MAX_SHOWN, FREE_THREATS_NOTE, FREE_THREATS_TITLE, teamPositionName } from "../constants";
import { FREE_THREAT_HEAD, FREE_THREAT_NO_STEAL, FREE_THREAT_ROW, FREE_THREAT_STEAL, FREE_THREATS, FREE_THREATS_TITLE_STYLE } from "../styles";
import type { TeamCoachFreeThreat } from "../types";

// <Dominio><Cosa>: ADVERTIR. Los counters FUERTES (con porqué) de tus héroes ya elegidos que siguen libres. Solo se pinta lo que el motor decidió: nada
// se puntúa ni se reordena aquí. Los nombres de héroe vienen del catálogo y React los escapa.

function heroName(heroId: number, heroCatalog: Map<number, HeroMeta>): string {
  return heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`;
}

// "Pos3 Offlane", "Pos3 Offlane o Pos4 Support", "Pos3 Offlane, Pos4 Support o Pos5 Hard Support".
function joinPositions(threat: TeamCoachFreeThreat): string {
  const names = threat.stealPositions.map(teamPositionName);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} o ${names[names.length - 1]}`;
}

interface RowProps {
  threat: TeamCoachFreeThreat;
  heroCatalog: Map<number, HeroMeta>;
}

function ThreatHero({ heroId, heroCatalog }: { heroId: number; heroCatalog: Map<number, HeroMeta> }) {
  const name = heroName(heroId, heroCatalog);
  return (
    <span className="flex min-w-0 items-center gap-1">
      <HeroIcon imgUrl={heroCatalog.get(heroId)?.imgUrl ?? ""} alt={name} size={24} />
      <span className="truncate">{name}</span>
    </span>
  );
}

function StealLine({ threat }: { threat: TeamCoachFreeThreat }) {
  if (threat.stealPositions.length === 0) {
    return (
      <span className={FREE_THREAT_NO_STEAL} data-testid="free-threat-no-steal">
        No encaja con tus posiciones libres: no puedes quitárselo al rival.
      </span>
    );
  }
  return (
    <span className={FREE_THREAT_STEAL} data-testid="free-threat-steal">
      Puedes quitárselo al rival jugándolo como {joinPositions(threat)}.
    </span>
  );
}

function FreeThreatRow({ threat, heroCatalog }: RowProps) {
  return (
    <div className={FREE_THREAT_ROW} data-testid="free-threat" data-own-hero-id={threat.ownHeroId} data-threat-hero-id={threat.threatHeroId}>
      <div className={FREE_THREAT_HEAD}>
        <ThreatHero heroId={threat.threatHeroId} heroCatalog={heroCatalog} />
        <span className="text-caption text-content-secondary">counterea fuerte a tu</span>
        <ThreatHero heroId={threat.ownHeroId} heroCatalog={heroCatalog} />
      </div>
      <span className="text-caption text-content-secondary" data-testid="free-threat-why">
        {threat.why}.
      </span>
      <StealLine threat={threat} />
    </div>
  );
}

function MoreThreats({ hidden }: { hidden: number }) {
  if (hidden <= 0) return null;
  return (
    <span className="text-caption text-content-muted" data-testid="free-threats-more">
      y {hidden} más.
    </span>
  );
}

interface FreeThreatsViewProps {
  threats: readonly TeamCoachFreeThreat[] | undefined;
  heroCatalog: Map<number, HeroMeta>;
}

export function FreeThreatsView({ threats, heroCatalog }: FreeThreatsViewProps) {
  if (!threats || threats.length === 0) return null;
  const shown = threats.slice(0, FREE_THREATS_MAX_SHOWN);
  return (
    <section className={FREE_THREATS} data-testid="free-threats" aria-label={FREE_THREATS_TITLE}>
      <span className={FREE_THREATS_TITLE_STYLE}>{FREE_THREATS_TITLE}</span>
      <span className="text-caption text-content-muted">{FREE_THREATS_NOTE}</span>
      {shown.map((threat) => (
        <FreeThreatRow key={`${threat.ownHeroId}-${threat.threatHeroId}`} threat={threat} heroCatalog={heroCatalog} />
      ))}
      <MoreThreats hidden={threats.length - shown.length} />
    </section>
  );
}
