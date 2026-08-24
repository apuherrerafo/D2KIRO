"use client";

import { useState, type ChangeEvent } from "react";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

// Ningún héroe es unavailable si el consumidor no pasa el prop (HeroPoolConfig, TeamGroupsConfig,
// el simulador de draft aleatorio no tienen un draft en curso del cual excluir nada) -- constante
// de módulo para que el default no cree un Set nuevo en cada render sin necesidad.
const EMPTY_UNAVAILABLE: ReadonlySet<number> = new Set();

interface HeroPickerRowProps {
  hero: HeroMeta;
  unavailable: boolean;
  onSelect: (heroId: number) => void;
}

function rowClassName(unavailable: boolean): string {
  const base =
    "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-caption transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary disabled:cursor-not-allowed disabled:opacity-50";
  if (unavailable) return `${base} text-content-muted`;
  return `${base} text-content-secondary hover:bg-surface-overlay`;
}

// TSK-070: deshabilitado (no oculto) cuando ya está baneado/pickeado -- el usuario sigue viendo
// que el héroe existe en el catálogo, en vez de preguntarse por qué desapareció de la búsqueda.
// `disabled` en el <button> real bloquea el clic incluso si algo más lo dispara programáticamente,
// no solo `onSelect` ignorando el id -- una sola fuente de verdad para "no se puede elegir".
function HeroPickerRow({ hero, unavailable, onSelect }: HeroPickerRowProps) {
  function handleClick() {
    onSelect(hero.id);
  }
  return (
    <button type="button" onClick={handleClick} disabled={unavailable} className={rowClassName(unavailable)}>
      <span className="flex items-center gap-2">
        <HeroIcon imgUrl={hero.imgUrl} alt={hero.localizedName} size={28} />
        <span>{hero.localizedName}</span>
      </span>
      {unavailable && <span className="text-caption text-content-muted">ya en el draft</span>}
    </button>
  );
}

interface HeroPickerResultsProps {
  matches: HeroMeta[];
  query: string;
  unavailableHeroIds: ReadonlySet<number>;
  onSelect: (heroId: number) => void;
}

// Si no hay coincidencias, lo comunica explícitamente -- nunca deja que un texto libre se
// convierta en un HeroId inventado (regla dura del ticket).
function HeroPickerResults({ matches, query, unavailableHeroIds, onSelect }: HeroPickerResultsProps) {
  if (matches.length === 0 && query.length > 0) {
    return (
      <span className="text-caption text-content-muted">
        No se encontró &quot;{query}&quot; — puede ser un héroe nuevo que el catálogo todavía no sincronizó.
      </span>
    );
  }
  return (
    <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
      {matches.map((hero) => (
        <HeroPickerRow key={hero.id} hero={hero} unavailable={unavailableHeroIds.has(hero.id)} onSelect={onSelect} />
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
}

// <Dominio><Cosa>: buscador de héroe que solo permite seleccionar del catálogo real.
export function HeroPicker({ heroes, onSelect, unavailableHeroIds = EMPTY_UNAVAILABLE }: HeroPickerProps) {
  const [query, setQuery] = useState("");

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }

  const matches = heroes.filter((hero) => normalize(hero.localizedName).includes(normalize(query)));

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={query}
        onChange={handleQueryChange}
        placeholder="Buscar héroe..."
        className="rounded-md border border-surface-border bg-surface-overlay px-3 py-2 text-body text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
      />
      <HeroPickerResults matches={matches} query={query} unavailableHeroIds={unavailableHeroIds} onSelect={onSelect} />
    </div>
  );
}
