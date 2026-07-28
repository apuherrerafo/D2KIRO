"use client";

import { useState, type ChangeEvent } from "react";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

interface HeroPickerRowProps {
  hero: HeroMeta;
  onSelect: (heroId: number) => void;
}

function HeroPickerRow({ hero, onSelect }: HeroPickerRowProps) {
  function handleClick() {
    onSelect(hero.id);
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-caption text-content-secondary transition-colors hover:bg-surface-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
    >
      <HeroIcon imgUrl={hero.imgUrl} alt={hero.localizedName} size={28} />
      <span>{hero.localizedName}</span>
    </button>
  );
}

interface HeroPickerResultsProps {
  matches: HeroMeta[];
  query: string;
  onSelect: (heroId: number) => void;
}

// Si no hay coincidencias, lo comunica explícitamente -- nunca deja que un texto libre se
// convierta en un HeroId inventado (regla dura del ticket).
function HeroPickerResults({ matches, query, onSelect }: HeroPickerResultsProps) {
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
        <HeroPickerRow key={hero.id} hero={hero} onSelect={onSelect} />
      ))}
    </div>
  );
}

interface HeroPickerProps {
  heroes: HeroMeta[];
  onSelect: (heroId: number) => void;
}

// <Dominio><Cosa>: buscador de héroe que solo permite seleccionar del catálogo real.
export function HeroPicker({ heroes, onSelect }: HeroPickerProps) {
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
      <HeroPickerResults matches={matches} query={query} onSelect={onSelect} />
    </div>
  );
}
