"use client";

import { useState, type ChangeEvent } from "react";
import Link from "next/link";
import { HeroGrid } from "@/components/hero-grid/HeroGrid";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import {
  useCalculateHeroPoolMutation,
  useGetHeroesQuery,
  useGetHeroPoolQuery,
  useUpdateHeroPoolMutation,
} from "@/lib/engine-api";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import {
  CALCULATE_WINDOW_OPTIONS,
  DEFAULT_CALCULATE_WINDOW_DAYS,
  EMPTY_POOL_MESSAGE,
  MAX_POOL_SIZE,
  POOL_FULL_MESSAGE,
  POOL_SAVED_MESSAGE,
} from "./constants";
import { CalculateStatusMessage, HeroPoolProposalReview } from "./HeroPoolProposalReview";
import type { CalculateStatus, HeroPoolEntry } from "./types";

function toPutEntry(entry: HeroPoolEntry) {
  return { hero: entry.hero, source: entry.source, personalWinrate: entry.personalWinrate, personalGames: entry.personalGames };
}

function findHero(heroes: HeroMeta[], id: number): HeroMeta | undefined {
  return heroes.find((hero) => hero.id === id);
}

interface HeroPoolRowProps {
  entry: HeroPoolEntry;
  hero: HeroMeta | undefined;
  onRemove: (heroId: number) => void;
}

function HeroPoolRow({ entry, hero, onRemove }: HeroPoolRowProps) {
  function handleRemove() {
    onRemove(entry.hero);
  }

  const stats =
    entry.personalWinrate === null
      ? "Sin winrate registrado"
      : `${(entry.personalWinrate * 100).toFixed(0)}% en ${entry.personalGames} partidas`;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface-raised p-3">
      <div className="flex items-center gap-3">
        <HeroIcon imgUrl={hero?.imgUrl ?? ""} alt={hero?.localizedName ?? `Héroe ${entry.hero}`} size={40} />
        <div className="flex flex-col">
          <span className="text-body text-content-primary">{hero?.localizedName ?? `Héroe ${entry.hero}`}</span>
          <span className="text-caption text-content-muted">{stats}</span>
        </div>
      </div>
      <button type="button" onClick={handleRemove} className={BUTTON_GHOST}>
        Quitar
      </button>
    </div>
  );
}

// <Dominio><Cosa>: pantalla de configuración del hero pool. RTK Query (régimen "página normal",
// nunca WebSocket -- web.md). Los cambios de añadir/quitar/calcular solo viven en memoria hasta
// que el usuario pulsa "Guardar" -- PUT /api/hero-pool sigue siendo el único camino de escritura
// real (TSK-020), esta pantalla nunca escribe sola.
export function HeroPoolConfig() {
  const { data: savedPool, isLoading: poolLoading, error: poolError } = useGetHeroPoolQuery();
  const { data: heroes = [], isLoading: heroesLoading } = useGetHeroesQuery();
  const [updateHeroPool, { isLoading: isSaving }] = useUpdateHeroPoolMutation();
  const [calculatePool, { isLoading: isCalculating }] = useCalculateHeroPoolMutation();

  const [draftEntries, setDraftEntries] = useState<HeroPoolEntry[] | null>(null);
  const [windowDays, setWindowDays] = useState(DEFAULT_CALCULATE_WINDOW_DAYS);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [calculateStatus, setCalculateStatus] = useState<CalculateStatus>({ kind: "idle" });

  // Derivado, no sincronizado con un efecto (mismo hallazgo que TSK-016): mientras el usuario no
  // haya tocado nada, `entries` es el pool del servidor; en cuanto edita/calcula, la copia local
  // manda y un refetch de RTK Query en segundo plano nunca la pisa sola.
  const entries = draftEntries ?? savedPool ?? [];
  const poolIsFull = entries.length >= MAX_POOL_SIZE;
  const activeHeroIds = new Set(entries.map((entry) => entry.hero));
  const dimmedHeroIds = new Set(heroes.filter((hero) => !activeHeroIds.has(hero.id)).map((hero) => hero.id));

  function handleWindowDaysChange(event: ChangeEvent<HTMLSelectElement>) {
    setWindowDays(Number(event.target.value));
  }

  function handleRemove(heroId: number) {
    setDraftEntries(entries.filter((entry) => entry.hero !== heroId));
    setSaveMessage(null);
  }

  function handleAdd(heroId: number) {
    if (poolIsFull || entries.some((entry) => entry.hero === heroId)) return;
    const newEntry: HeroPoolEntry = {
      hero: heroId,
      source: "manual",
      personalWinrate: null,
      personalGames: 0,
      updatedAt: new Date().toISOString(),
    };
    setDraftEntries([...entries, newEntry]);
    setSaveMessage(null);
  }

  async function handleSave() {
    setSaveMessage(null);
    try {
      await updateHeroPool({ entries: entries.map(toPutEntry) }).unwrap();
      setSaveMessage(POOL_SAVED_MESSAGE);
    } catch {
      setSaveMessage("No se pudo guardar el pool -- revisá que el motor esté corriendo e intentá de nuevo.");
    }
  }

  // TSK-025 (§9.6): calcula y deja el resultado en calculateStatus, nunca lo aplica solo -- las
  // tres acciones explícitas (confirmar/editar/descartar) viven en handleConfirmProposal/
  // handleEditProposal/handleDiscardProposal, disparadas desde HeroPoolProposalReview.
  async function handleCalculate() {
    setCalculateStatus({ kind: "loading" });
    try {
      const result = await calculatePool({ days: windowDays }).unwrap();
      if (result.proposed.length === 0) {
        setCalculateStatus({ kind: "empty" });
        return;
      }
      setCalculateStatus({ kind: "proposal", result });
    } catch (err) {
      const status = typeof err === "object" && err !== null && "status" in err ? err.status : undefined;
      if (status === 400) setCalculateStatus({ kind: "invalid_account" });
      else if (status === 409) setCalculateStatus({ kind: "in_progress" });
      else setCalculateStatus({ kind: "unavailable" });
    }
  }

  // "Confirmar tal cual": PUT directo con la propuesta exacta -- no pasa por el estado editable de
  // arriba, así que un cambio a medio hacer en la lista manual nunca se mezcla con la propuesta.
  async function handleConfirmProposal() {
    if (calculateStatus.kind !== "proposal") return;
    const { proposed } = calculateStatus.result;
    setSaveMessage(null);
    try {
      await updateHeroPool({ entries: proposed.map(toPutEntry) }).unwrap();
      setDraftEntries(proposed);
      setSaveMessage(POOL_SAVED_MESSAGE);
      setCalculateStatus({ kind: "idle" });
    } catch {
      setSaveMessage("No se pudo guardar el pool -- revisá que el motor esté corriendo e intentá de nuevo.");
    }
  }

  // "Editar antes de confirmar": la propuesta pasa a ser la lista editable de siempre -- el
  // usuario quita/añade con los controles normales y confirma con el botón "Guardar" de abajo.
  function handleEditProposal() {
    if (calculateStatus.kind !== "proposal") return;
    setDraftEntries(calculateStatus.result.proposed);
    setCalculateStatus({ kind: "idle" });
  }

  // "Descartar": nunca llama a PUT -- el pool guardado queda exactamente como estaba (regla dura).
  function handleDiscardProposal() {
    setCalculateStatus({ kind: "idle" });
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
      <span className="text-heading text-content-primary">Mi pool de héroes</span>

      {poolLoading && <span className="text-body text-content-secondary">Cargando...</span>}
      {poolError && <span className="text-body text-signal-negative">No se pudo cargar tu pool de héroes.</span>}

      {!poolLoading && !poolError && (
        <>
          <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface-raised p-4">
            <span className="text-body text-content-primary">Calcular desde mis partidas</span>
            <label className="flex items-center gap-2 text-caption text-content-secondary">
              Ventana de partidas
              <select
                value={windowDays}
                onChange={handleWindowDaysChange}
                className="rounded-md border border-surface-border bg-surface-overlay px-2 py-1 text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
              >
                {CALCULATE_WINDOW_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    Últimos {option} días
                  </option>
                ))}
              </select>
            </label>
            <CalculateStatusMessage status={calculateStatus} />
            <button type="button" onClick={handleCalculate} disabled={isCalculating} className={BUTTON_SECONDARY}>
              {isCalculating ? "Calculando..." : "Calcular desde mis partidas"}
            </button>
            {calculateStatus.kind === "proposal" && (
              <HeroPoolProposalReview
                result={calculateStatus.result}
                heroes={heroes}
                onConfirm={handleConfirmProposal}
                onEdit={handleEditProposal}
                onDiscard={handleDiscardProposal}
                isConfirming={isSaving}
              />
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body text-content-primary">Mi selección manual</span>
              <span className="text-caption text-content-muted">Pool activo · {entries.length}/{MAX_POOL_SIZE}</span>
            </div>
            {entries.length === 0 && <span className="text-caption text-content-muted">{EMPTY_POOL_MESSAGE}</span>}
            {entries.length > 0 && (
              <div className="flex flex-col gap-2">
                {entries.map((entry) => (
                  <HeroPoolRow key={entry.hero} entry={entry} hero={findHero(heroes, entry.hero)} onRemove={handleRemove} />
                ))}
              </div>
            )}
            {poolIsFull && <span className="text-caption text-content-muted">{POOL_FULL_MESSAGE}</span>}
            {!heroesLoading && (
              <HeroGrid
                heroes={heroes}
                onSelect={handleAdd}
                highlightedHeroIds={activeHeroIds}
                dimmedHeroIds={dimmedHeroIds}
                rosterFull={poolIsFull}
              />
            )}
            {saveMessage && <span className="text-caption text-content-secondary">{saveMessage}</span>}
            <button type="button" onClick={handleSave} disabled={isSaving} className={BUTTON_PRIMARY}>
              Guardar
            </button>
            {saveMessage === POOL_SAVED_MESSAGE && (
              <Link href="/live-draft" className={BUTTON_SECONDARY}>
                Ver el draft en vivo
              </Link>
            )}
          </div>
        </>
      )}
    </main>
  );
}
