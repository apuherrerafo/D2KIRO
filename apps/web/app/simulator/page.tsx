"use client";

import { useEffect, useMemo, useState } from "react";
import { ComparisonNote } from "@/components/comparison-note/ComparisonNote";
import { DraftBoard } from "@/components/draft-board/DraftBoard";
import { SuggestionCard } from "@/components/suggestion-card/SuggestionCard";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { useGetHeroesQuery, useGetSimulatorStateQuery, useStartSimulatorSessionMutation } from "@/lib/engine-api";

const STORAGE_KEY = "dota2coach.simulator.sessionId";
const POLLING_INTERVAL_MS = 1500;

function useTabVisibility(): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    function handleVisibilityChange() {
      setHidden(document.hidden);
    }
    queueMicrotask(handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return hidden;
}

function heroCatalogFrom(data: HeroMeta[] | undefined): Map<number, HeroMeta> {
  return new Map((data ?? []).map((hero) => [hero.id, hero]));
}

export default function SimulatorPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startSimulatorSession, startResult] = useStartSimulatorSessionMutation();
  const hidden = useTabVisibility();
  const heroes = useGetHeroesQuery();
  const heroCatalog = useMemo(() => heroCatalogFrom(heroes.data), [heroes.data]);
  const simulator = useGetSimulatorStateQuery(sessionId ?? "", {
    skip: !sessionId,
    pollingInterval: hidden ? 0 : POLLING_INTERVAL_MS,
  });

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      queueMicrotask(() => setSessionId(stored));
      return;
    }
    void startSimulatorSession()
      .unwrap()
      .then(({ sessionId: createdSessionId }) => {
        sessionStorage.setItem(STORAGE_KEY, createdSessionId);
        setSessionId(createdSessionId);
      });
  }, [startSimulatorSession]);

  function startNewSession() {
    sessionStorage.removeItem(STORAGE_KEY);
    setSessionId(null);
    void startSimulatorSession()
      .unwrap()
      .then(({ sessionId: createdSessionId }) => {
        sessionStorage.setItem(STORAGE_KEY, createdSessionId);
        setSessionId(createdSessionId);
      });
  }

  const draftState = simulator.data?.draftState;
  const suggestions = simulator.data?.suggestions;
  const primary = suggestions?.suggestions.find((suggestion) => suggestion.rank === 1);
  const alternatives = suggestions?.suggestions.filter((suggestion) => suggestion.rank !== 1) ?? [];
  const loading = startResult.isLoading || (sessionId !== null && simulator.isLoading);
  const failed = startResult.isError || simulator.isError || heroes.isError;

  if (loading && !draftState) {
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
        <span className="text-body text-content-secondary">Cargando simulador...</span>
      </main>
    );
  }

  if (failed && !draftState) {
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
        <span className="text-heading text-signal-negative">No se pudo abrir el simulador</span>
        <button type="button" onClick={startNewSession} className={`self-start ${BUTTON_PRIMARY}`}>
          Reintentar
        </button>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-heading text-content-primary">Simulador de draft</span>
          <span className="text-caption text-content-secondary">
            {hidden ? "Pausado mientras la pestaña está oculta." : `Actualizando cada ${POLLING_INTERVAL_MS / 1000}s por HTTP.`}
          </span>
        </div>
        <button type="button" onClick={startNewSession} disabled={startResult.isLoading} className={BUTTON_SECONDARY}>
          Nueva simulación
        </button>
      </div>

      {draftState ? (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <DraftBoard draftState={draftState} heroCatalog={heroCatalog} />
          <div className="flex flex-col gap-3">
            {primary ? <SuggestionCard suggestion={primary} heroMeta={heroCatalog.get(primary.hero)} isPrimary /> : null}
            {suggestions?.comparison ? (
              <ComparisonNote comparison={suggestions.comparison} heroMeta={heroCatalog.get(suggestions.comparison.vsHero)} />
            ) : null}
            {alternatives.map((suggestion) => (
              <SuggestionCard key={suggestion.hero} suggestion={suggestion} heroMeta={heroCatalog.get(suggestion.hero)} isPrimary={false} />
            ))}
          </div>
        </div>
      ) : (
        <span className="text-body text-content-secondary">Preparando sesión simulada...</span>
      )}
    </main>
  );
}
