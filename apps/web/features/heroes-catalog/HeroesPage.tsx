"use client";

import { useState, type ChangeEvent } from "react";
import { AppNotice } from "@/components/app-shell/AppNotice";
import { PageHead } from "@/components/app-shell/PageHead";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { useGetHeroesQuery } from "@/lib/engine-api";

export function filterHeroes(heroes: HeroMeta[], query: string): HeroMeta[] {
  const needle = query.toLowerCase().trim();
  if (needle === "") return heroes;
  return heroes.filter((hero) => hero.localizedName.toLowerCase().includes(needle));
}

function HeroRow({ hero }: { hero: HeroMeta }) {
  return (
    <li className="ap-hero" data-testid="catalog-hero">
      <HeroIcon imgUrl={hero.imgUrl} alt={hero.localizedName} size={48} />
      <div className="ap-row-text">
        <span className="ap-row-name">{hero.localizedName}</span>
        <span className="ap-row-meta">{hero.roles.join(", ")}</span>
      </div>
    </li>
  );
}

function HeroList({ heroes }: { heroes: HeroMeta[] }) {
  const [query, setQuery] = useState("");
  const visible = filterHeroes(heroes, query);

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }

  return (
    <>
      <div className="ap-field">
        <label className="ap-label" htmlFor="catalog-search">
          Buscar héroe
        </label>
        <input id="catalog-search" type="search" className="ap-input" value={query} onChange={handleQueryChange} placeholder="Nombre del héroe" />
      </div>
      <ul className="ap-heroes">
        {visible.map((hero) => (
          <HeroRow key={hero.id} hero={hero} />
        ))}
      </ul>
      <EmptySearch show={visible.length === 0} />
    </>
  );
}

function EmptySearch({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="ap-hint">Ningún héroe coincide con esa búsqueda.</p>;
}

function CatalogBody() {
  const { data, isLoading, error } = useGetHeroesQuery();
  if (isLoading) {
    return (
      <p className="ap-loading" role="status">
        Cargando héroes…
      </p>
    );
  }
  if (error || !data) {
    return (
      <AppNotice tone="error" title="No se pudo cargar la lista de héroes">
        <p>Vuelve a abrir esta pantalla para reintentar.</p>
      </AppNotice>
    );
  }
  return <HeroList heroes={data} />;
}

// <Dominio><Cosa>: catálogo de héroes. Página normal del sitio (RTK Query contra GET /api/heroes). Cada héroe con su
// ícono oficial -- requisito duro de UI; el host de la imagen se valida contra el CDN de Valve en el HeroIcon.
export function HeroesPage() {
  return (
    <main className="ap-main ap-main--wide" data-testid="heroes-page">
      <PageHead kicker="Catálogo" title="Héroes" lede="Todos los héroes que conoce el coach." />
      <CatalogBody />
    </main>
  );
}
