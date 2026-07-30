"use client";

import { useEffect, useState } from "react";
import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";

export interface HeroMeta {
  id: number;
  name: string;
  localizedName: string;
  imgUrl: string;
  primaryAttr: string;
  attackType: string;
  roles: string[];
}

// El catálogo de héroes (GET /api/heroes) es una "página normal" en el sentido de datos -- no es
// estado de draft en vivo -- pero configurar RTK Query completo (2 dependencias nuevas, store,
// Provider) es alcance de TSK-014 ("Páginas del sitio... con RTK Query"), no de este ticket. Se
// usa un fetch simple aquí; TSK-014 puede migrar este hook a un endpoint de RTK Query después.
export function useHeroCatalog(): { heroes: Map<number, HeroMeta>; loading: boolean } {
  const [heroes, setHeroes] = useState<Map<number, HeroMeta>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadHeroCatalog() {
      try {
        const response = await fetch(`${ENGINE_HTTP_BASE_URL}/api/heroes`);
        const list = (await response.json()) as HeroMeta[];
        if (!cancelled) setHeroes(new Map(list.map((hero) => [hero.id, hero])));
      } catch {
        // Sin catálogo disponible (motor caído/sin sincronizar) -- la vista sigue funcionando,
        // solo sin nombres/íconos; DraftHeroSlot degrada a un placeholder por héroe desconocido.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadHeroCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  return { heroes, loading };
}
