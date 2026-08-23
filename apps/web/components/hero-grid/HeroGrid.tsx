"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { MAX_PICKS_PER_SIDE } from "@/features/draft/constants";
import type { DraftState, HeroId, TeamSide } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { ATTRIBUTE_LABELS, ATTRIBUTE_ORDER, type HeroAttribute } from "./constants";

// RCA post-TSK-076 (auditoría de arquitectura, 2026-08-23): guardrails de UI que reflejan las
// mismas reglas que ya valida el reductor (`checkHeroAvailable`/`MAX_PICKS_PER_SIDE` en
// apps/engine/src/draft/reducer.ts, TSK-078) -- nunca las reemplazan. Deshabilitar acá evita un
// viaje de red que el motor de todos modos iba a rechazar; el motor sigue siendo la única fuente
// de verdad real.
export function isHeroTaken(picks: DraftState["picks"], banned: HeroId[], heroId: HeroId): boolean {
  return banned.includes(heroId) || picks.radiant.includes(heroId) || picks.dire.includes(heroId);
}

export function isRosterFull(picks: DraftState["picks"], side: TeamSide | "unknown"): boolean {
  if (side === "unknown") return false;
  return picks[side].length >= MAX_PICKS_PER_SIDE;
}

// Pura, exportada para probarla sin renderizar nada (mismo criterio que buildNavLinks en
// NavBar.tsx -- el proyecto no tiene un renderer de DOM en bun test, la lógica se prueba
// aislada de JSX). Un héroe con un primaryAttr fuera de los 4 conocidos no aparece en ninguna
// columna -- no ocurre hoy contra el catálogo real (127/127 clasificados), y agregar una 5ta
// columna "sin clasificar" para un caso que no pasa sería validar contra un dato que no existe.
export function groupHeroesByAttribute(heroes: HeroMeta[]): Record<HeroAttribute, HeroMeta[]> {
  const groups: Record<HeroAttribute, HeroMeta[]> = { str: [], agi: [], int: [], all: [] };
  for (const hero of heroes) {
    if (hero.primaryAttr in groups) groups[hero.primaryAttr as HeroAttribute].push(hero);
  }
  return groups;
}

// Pura, exportada por la misma razón -- separa "qué estado tiene esta celda" de cómo se dibuja,
// para poder probar los criterios de aceptación (resaltado/deshabilitado) sin JSX. `rosterFull`
// deshabilita TODA la grilla, no un héroe puntual -- no importa cuál se toque, ningún pick va a
// entrar si el lado activo ya tiene 5 (isRosterFull, arriba).
export function cellState(
  heroId: HeroId,
  highlightedHeroIds: ReadonlySet<HeroId>,
  unavailableHeroIds: ReadonlySet<HeroId>,
  rosterFull = false,
): { isSuggested: boolean; isUnavailable: boolean } {
  return { isSuggested: highlightedHeroIds.has(heroId), isUnavailable: unavailableHeroIds.has(heroId) || rosterFull };
}

function cellClassName(isSuggested: boolean, isUnavailable: boolean): string {
  const base =
    "flex flex-col items-center gap-1 rounded-md p-1 text-center transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary disabled:cursor-not-allowed";
  if (isUnavailable) return `${base} opacity-40 grayscale`;
  if (isSuggested) return `${base} ring-2 ring-accent-primary shadow-[0_0_12px_var(--accent-primary)] hover:scale-105`;
  return `${base} hover:scale-105 hover:ring-1 hover:ring-surface-border`;
}

interface HeroGridCellProps {
  hero: HeroMeta;
  isSuggested: boolean;
  isUnavailable: boolean;
  onSelect: (heroId: HeroId) => void;
}

// TSK-070: deshabilitado (no oculto) cuando ya está baneado/pickeado -- mismo criterio que
// HeroPickerRow, `disabled` real en el <button> como única fuente de verdad de "no se puede
// elegir", nunca solo un estilo.
function HeroGridCell({ hero, isSuggested, isUnavailable, onSelect }: HeroGridCellProps) {
  function handleClick() {
    onSelect(hero.id);
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isUnavailable}
      title={hero.localizedName}
      className={cellClassName(isSuggested, isUnavailable)}
    >
      <HeroIcon imgUrl={hero.imgUrl} alt={hero.localizedName} size={48} />
      <span className="w-full truncate text-caption text-content-secondary">{hero.localizedName}</span>
    </button>
  );
}

interface AttributeColumnProps {
  attribute: HeroAttribute;
  heroes: HeroMeta[];
  highlightedHeroIds: ReadonlySet<HeroId>;
  unavailableHeroIds: ReadonlySet<HeroId>;
  rosterFull: boolean;
  onSelect: (heroId: HeroId) => void;
}

function AttributeColumn({ attribute, heroes, highlightedHeroIds, unavailableHeroIds, rosterFull, onSelect }: AttributeColumnProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption font-semibold uppercase tracking-wide text-content-muted">{ATTRIBUTE_LABELS[attribute]}</span>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {heroes.map((hero) => {
          const state = cellState(hero.id, highlightedHeroIds, unavailableHeroIds, rosterFull);
          return <HeroGridCell key={hero.id} hero={hero} isSuggested={state.isSuggested} isUnavailable={state.isUnavailable} onSelect={onSelect} />;
        })}
      </div>
    </div>
  );
}

const EMPTY_HERO_IDS: ReadonlySet<HeroId> = new Set();

export interface HeroGridProps {
  heroes: HeroMeta[];
  onSelect: (heroId: HeroId) => void;
  // TSK-075: top 3 del SuggestionSet actual -- resaltadas directo sobre la grilla en vez de solo
  // en tarjetas de texto aparte (motivo del rediseño: QA manual, "se siente como panel estático").
  highlightedHeroIds?: ReadonlySet<HeroId>;
  // Mismo patrón que HeroPicker.unavailableHeroIds (TSK-070) -- opcional a propósito, componente
  // atómico reutilizable fuera del draft en vivo.
  unavailableHeroIds?: ReadonlySet<HeroId>;
  // RCA post-TSK-076 (TSK-079): guardrail de UI -- el lado activo ya tiene 5 picks, ningún clic va
  // a lograr nada. Default false para los consumidores que no tienen este concepto (config/pool).
  rosterFull?: boolean;
}

// <Dominio><Cosa>: grilla nativa de héroes agrupada por atributo (estilo Dota real), con los
// candidatos sugeridos por el motor resaltados directo sobre el ícono. Componente atómico nuevo
// -- no reemplaza a HeroPicker, que sigue sirviendo a HeroPoolConfig/TeamGroupsConfig/simulador
// donde no hay sugerencias que resaltar.
export function HeroGrid({
  heroes,
  onSelect,
  highlightedHeroIds = EMPTY_HERO_IDS,
  unavailableHeroIds = EMPTY_HERO_IDS,
  rosterFull = false,
}: HeroGridProps) {
  const groups = groupHeroesByAttribute(heroes);
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {ATTRIBUTE_ORDER.map((attribute) => (
        <AttributeColumn
          key={attribute}
          attribute={attribute}
          heroes={groups[attribute]}
          highlightedHeroIds={highlightedHeroIds}
          unavailableHeroIds={unavailableHeroIds}
          rosterFull={rosterFull}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
