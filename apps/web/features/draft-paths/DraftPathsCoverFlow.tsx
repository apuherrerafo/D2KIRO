"use client";

import { useState } from "react";
import { DraftPathCard } from "@/components/draft-path-card/DraftPathCard";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { useGetDraftPathsQuery } from "@/lib/engine-api";
import { getVisibleDraftPathCards } from "./cover-flow";

interface DraftPathsCoverFlowProps {
  sessionId: string;
  heroCatalog: Map<number, HeroMeta>;
}

function nextIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  if (current >= total - 1) return total - 1;
  return current + 1;
}

function previousIndex(current: number): number {
  if (current <= 0) return 0;
  return current - 1;
}

export function DraftPathsCoverFlow({ sessionId, heroCatalog }: DraftPathsCoverFlowProps) {
  const [isOpen, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const { data, isFetching, error } = useGetDraftPathsQuery(sessionId, { skip: !isOpen });
  const paths = data?.paths ?? [];
  const visibleCards = getVisibleDraftPathCards(paths, activeIndex);

  function handleOpen() {
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
    setActiveIndex(0);
  }

  function handlePrevious() {
    setActiveIndex((current) => previousIndex(current));
  }

  function handleNext() {
    setActiveIndex((current) => nextIndex(current, paths.length));
  }

  if (!isOpen) {
    return (
      <button type="button" onClick={handleOpen} className={BUTTON_SECONDARY}>
        Explorar caminos
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-heading text-content-primary">Caminos de draft</span>
        <button type="button" onClick={handleClose} className={BUTTON_SECONDARY}>
          Cerrar
        </button>
      </div>
      {isFetching && <span className="text-body text-content-secondary">Calculando caminos...</span>}
      {error && <span className="text-body text-signal-negative">No se pudieron calcular los caminos.</span>}
      {paths.length === 0 && !isFetching && !error && <span className="text-body text-content-secondary">No hay caminos viables con los datos actuales.</span>}
      {paths.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-3 overflow-hidden">
            {visibleCards.map((card) => (
              <DraftPathCard key={card.path.archetype} path={card.path} heroCatalog={heroCatalog} isActive={card.position === "active"} />
            ))}
          </div>
          <div className="flex justify-center gap-2">
            <button type="button" onClick={handlePrevious} disabled={activeIndex <= 0} className={BUTTON_SECONDARY}>
              Anterior
            </button>
            <button type="button" onClick={handleNext} disabled={activeIndex >= paths.length - 1} className={BUTTON_PRIMARY}>
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
