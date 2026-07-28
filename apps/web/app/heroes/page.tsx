"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { useGetHeroesQuery } from "@/lib/engine-api";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

interface HeroRowProps {
  hero: HeroMeta;
}

function HeroRow({ hero }: HeroRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-surface-border bg-surface-raised p-3">
      <HeroIcon imgUrl={hero.imgUrl} alt={hero.localizedName} size={48} />
      <div className="flex flex-col">
        <span className="text-body text-content-primary">{hero.localizedName}</span>
        <span className="text-caption text-content-muted">{hero.roles.join(", ")}</span>
      </div>
    </div>
  );
}

// Página normal del sitio: RTK Query contra GET /api/heroes -- cada héroe con su ícono oficial,
// sin excepción (requisito duro de UI, HeroIcon ya valida el host contra el CDN de Valve).
export default function HeroesPage() {
  const { data, isLoading, error } = useGetHeroesQuery();

  if (isLoading) {
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
        <span className="text-body text-content-secondary">Cargando...</span>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
        <span className="text-body text-signal-negative">No se pudo cargar la lista de héroes.</span>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
      <span className="text-heading text-content-primary">Héroes</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((hero) => (
          <HeroRow key={hero.id} hero={hero} />
        ))}
      </div>
    </main>
  );
}
