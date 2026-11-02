"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { GOLDEN_CARD_LABEL, GOLDEN_CARD_NOTE, teamPositionName } from "../constants";
import { CANDIDATE_STILL_FREE, CANDIDATE_STRENGTH, GOLDEN_CARD, GOLDEN_CARD_TITLE, PRIMARY_BUTTON } from "../styles";
import type { TeamCoachGoldenCard, TeamCoachGoldenWin, TeamPosition } from "../types";

// <Dominio><Cosa>: la card dorada del Team Coach. UN héroe que NO está en tu pool pero encaja de verdad con lo que ya se ve del draft
// (el motor decide con un estándar fijo; aquí solo se pinta, nada se puntúa). Los nombres de héroe vienen del catálogo y React los escapa.

function heroName(heroId: number, heroCatalog: Map<number, HeroMeta>): string {
  return heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`;
}

// "Axe", "Axe y Lion", "Axe, Lion y Ancient Apparition".
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

const WIN_LABELS: Record<TeamCoachGoldenWin["level"], string> = { hard: "Fuerte contra", medium: "Ventaja posible contra" };

interface GoldenCardViewProps {
  goldenCard: TeamCoachGoldenCard | null | undefined;
  heroCatalog: Map<number, HeroMeta>;
  /** Ausente -> solo lectura (o esa posición ya no se puede elegir ahora): sin botón de elegir. */
  onPickHero?: (position: TeamPosition, heroId: number) => void;
}

interface DetailProps {
  goldenCard: TeamCoachGoldenCard;
  heroCatalog: Map<number, HeroMeta>;
}

function GoldenWins({ goldenCard, heroCatalog }: DetailProps) {
  return (
    <>
      {goldenCard.wins.map((win) => (
        <span key={win.vsHeroId} className={CANDIDATE_STRENGTH} data-testid="golden-card-win">
          {WIN_LABELS[win.level]} {heroName(win.vsHeroId, heroCatalog)} (ya está en el rival): {win.why}
        </span>
      ))}
    </>
  );
}

function GoldenStillFree({ goldenCard, heroCatalog }: DetailProps) {
  if (goldenCard.stillFreeHardCounters.length === 0) return null;
  const names = joinNames(goldenCard.stillFreeHardCounters.map((heroId) => heroName(heroId, heroCatalog)));
  return (
    <span className={CANDIDATE_STILL_FREE} data-testid="golden-card-still-free">
      Ojo: {names} lo counterea fuerte y sigue libre.
    </span>
  );
}

function GoldenOutOfPlay({ goldenCard, heroCatalog }: DetailProps) {
  if (goldenCard.counteredOutBy.length === 0) return null;
  const names = joinNames(goldenCard.counteredOutBy.map((heroId) => heroName(heroId, heroCatalog)));
  return (
    <span className="text-caption text-content-secondary" data-testid="golden-card-out-of-play">
      Ya están fuera de juego sus counters: {names}.
    </span>
  );
}

function GoldenSynergy({ goldenCard, heroCatalog }: DetailProps) {
  const [first] = goldenCard.synergies;
  if (!first) return null;
  return (
    <span className={CANDIDATE_STRENGTH} data-testid="golden-card-synergy">
      Combina con tu {heroName(first.withHeroId, heroCatalog)}: {first.why}
    </span>
  );
}

interface GoldenPickButtonProps extends DetailProps {
  onPickHero: GoldenCardViewProps["onPickHero"];
}

function GoldenPickButton({ goldenCard, heroCatalog, onPickHero }: GoldenPickButtonProps) {
  if (!onPickHero) return null;
  const name = heroName(goldenCard.heroId, heroCatalog);
  function handlePick() {
    onPickHero?.(goldenCard.position, goldenCard.heroId);
  }
  return (
    <button type="button" onClick={handlePick} className={PRIMARY_BUTTON} aria-label={`Elegir a ${name} como ${teamPositionName(goldenCard.position)} (card dorada)`} data-testid="golden-card-pick">
      Elegir a {name}
    </button>
  );
}

export function GoldenCardView({ goldenCard, heroCatalog, onPickHero }: GoldenCardViewProps) {
  if (!goldenCard) return null;
  const name = heroName(goldenCard.heroId, heroCatalog);
  return (
    <div className={GOLDEN_CARD} data-testid="golden-card" data-hero-id={goldenCard.heroId} data-position={goldenCard.position}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={GOLDEN_CARD_TITLE}>{GOLDEN_CARD_LABEL} · {teamPositionName(goldenCard.position)}</span>
        <span className="flex min-w-0 items-center gap-2 text-body text-content-primary">
          <HeroIcon imgUrl={heroCatalog.get(goldenCard.heroId)?.imgUrl ?? ""} alt={name} size={32} />
          <span className="truncate">{name}</span>
        </span>
        <GoldenPickButton goldenCard={goldenCard} heroCatalog={heroCatalog} onPickHero={onPickHero} />
      </div>
      <span className="text-caption text-content-muted">{GOLDEN_CARD_NOTE}</span>
      <GoldenWins goldenCard={goldenCard} heroCatalog={heroCatalog} />
      <GoldenSynergy goldenCard={goldenCard} heroCatalog={heroCatalog} />
      <GoldenOutOfPlay goldenCard={goldenCard} heroCatalog={heroCatalog} />
      <GoldenStillFree goldenCard={goldenCard} heroCatalog={heroCatalog} />
    </div>
  );
}
