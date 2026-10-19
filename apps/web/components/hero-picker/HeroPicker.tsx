"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

// Ningún héroe es unavailable si el consumidor no pasa el prop (HeroPoolConfig, TeamGroupsConfig,
// el simulador de draft aleatorio no tienen un draft en curso del cual excluir nada) -- constante
// de módulo para que el default no cree un Set nuevo en cada render sin necesidad.
const EMPTY_UNAVAILABLE: ReadonlySet<number> = new Set();

// Dos presentaciones del mismo buscador. `default` es la de siempre (la usan el draft en vivo, el simulador y el hero pool);
// `canonical` es la de la pantalla de equipos con el Design System Canonical LIGHT (clases `tg-*` en
// features/team-groups/team-groups.css). La lógica -- filtro, selección, deshabilitado -- es una sola.
export type HeroPickerVariant = "default" | "canonical";

interface PickerLook {
  root: string;
  input: string;
  list: string;
  row: (unavailable: boolean) => string;
  who: string;
  note: string;
  empty: string;
}

const DEFAULT_ROW =
  "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-caption transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary disabled:cursor-not-allowed disabled:opacity-50";

const LOOKS: Record<HeroPickerVariant, PickerLook> = {
  default: {
    root: "flex flex-col gap-2",
    input:
      "rounded-md border border-surface-border bg-surface-overlay px-3 py-2 text-body text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary",
    list: "flex max-h-56 flex-col gap-1 overflow-y-auto",
    row: (unavailable) => `${DEFAULT_ROW} ${unavailable ? "text-content-muted" : "text-content-secondary hover:bg-surface-overlay"}`,
    who: "flex items-center gap-2",
    note: "text-caption text-content-muted",
    empty: "text-caption text-content-muted",
  },
  canonical: {
    root: "tg-picker",
    input: "tg-input",
    list: "tg-picker-list",
    row: () => "tg-picker-row",
    who: "tg-picker-who",
    note: "tg-picker-note",
    empty: "tg-picker-empty",
  },
};

interface PickerHeroIconProps {
  hero: HeroMeta;
  renderIcon: ((hero: HeroMeta) => ReactNode) | undefined;
}

function PickerHeroIcon({ hero, renderIcon }: PickerHeroIconProps) {
  if (renderIcon) return <>{renderIcon(hero)}</>;
  return <HeroIcon imgUrl={hero.imgUrl} alt={hero.localizedName} size={28} />;
}

interface HeroPickerRowProps {
  hero: HeroMeta;
  unavailable: boolean;
  unavailableLabel: string;
  look: PickerLook;
  renderIcon: ((hero: HeroMeta) => ReactNode) | undefined;
  onSelect: (heroId: number) => void;
}

// TSK-070: deshabilitado (no oculto) cuando ya está baneado/pickeado -- el usuario sigue viendo
// que el héroe existe en el catálogo, en vez de preguntarse por qué desapareció de la búsqueda.
// `disabled` en el <button> real bloquea el clic incluso si algo más lo dispara programáticamente,
// no solo `onSelect` ignorando el id -- una sola fuente de verdad para "no se puede elegir".
function HeroPickerRow({ hero, unavailable, unavailableLabel, look, renderIcon, onSelect }: HeroPickerRowProps) {
  function handleClick() {
    onSelect(hero.id);
  }
  return (
    <button type="button" onClick={handleClick} disabled={unavailable} className={look.row(unavailable)}>
      <span className={look.who}>
        <PickerHeroIcon hero={hero} renderIcon={renderIcon} />
        <span>{hero.localizedName}</span>
      </span>
      {unavailable && <span className={look.note}>{unavailableLabel}</span>}
    </button>
  );
}

interface HeroPickerResultsProps {
  matches: HeroMeta[];
  query: string;
  unavailableHeroIds: ReadonlySet<number>;
  unavailableLabel: string;
  look: PickerLook;
  renderIcon: ((hero: HeroMeta) => ReactNode) | undefined;
  onSelect: (heroId: number) => void;
}

// Si no hay coincidencias, lo comunica explícitamente -- nunca deja que un texto libre se
// convierta en un HeroId inventado (regla dura del ticket).
function HeroPickerResults({ matches, query, unavailableHeroIds, unavailableLabel, look, renderIcon, onSelect }: HeroPickerResultsProps) {
  if (matches.length === 0 && query.length > 0) {
    return (
      <span className={look.empty}>
        No se encontró &quot;{query}&quot; — puede ser un héroe nuevo que el catálogo todavía no sincronizó.
      </span>
    );
  }
  return (
    <div className={look.list}>
      {matches.map((hero) => (
        <HeroPickerRow key={hero.id} hero={hero} unavailable={unavailableHeroIds.has(hero.id)} unavailableLabel={unavailableLabel} look={look} renderIcon={renderIcon} onSelect={onSelect} />
      ))}
    </div>
  );
}

interface HeroPickerProps {
  heroes: HeroMeta[];
  onSelect: (heroId: number) => void;
  // TSK-070: opcional a propósito -- HeroPicker es un componente atómico reutilizado fuera del
  // draft en vivo (HeroPoolConfig, TeamGroupsConfig, el simulador de draft aleatorio), donde no
  // existe un `banned`/`picks` del cual excluir nada. Sin este prop, el comportamiento queda
  // exactamente igual que antes (nada deshabilitado) -- solo ManualEntryPanel lo pasa.
  unavailableHeroIds?: ReadonlySet<number>;
  /** Qué dice la fila deshabilitada. Por defecto el del draft; un pool de héroes dice "ya en el pool". */
  unavailableLabel?: string;
  variant?: HeroPickerVariant;
  /** Ícono de la fila. Sin él, el `HeroIcon` de siempre; la variante canónica lo recibe del llamador (no se importa acá). */
  renderIcon?: (hero: HeroMeta) => ReactNode;
}

// <Dominio><Cosa>: buscador de héroe que solo permite seleccionar del catálogo real.
export function HeroPicker({ heroes, onSelect, unavailableHeroIds = EMPTY_UNAVAILABLE, unavailableLabel = "ya en el draft", variant = "default", renderIcon }: HeroPickerProps) {
  const [query, setQuery] = useState("");
  const look = LOOKS[variant];

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }

  const matches = heroes.filter((hero) => normalize(hero.localizedName).includes(normalize(query)));

  return (
    <div className={look.root}>
      <input type="text" value={query} onChange={handleQueryChange} placeholder="Buscar héroe..." className={look.input} />
      <HeroPickerResults matches={matches} query={query} unavailableHeroIds={unavailableHeroIds} unavailableLabel={unavailableLabel} look={look} renderIcon={renderIcon} onSelect={onSelect} />
    </div>
  );
}
