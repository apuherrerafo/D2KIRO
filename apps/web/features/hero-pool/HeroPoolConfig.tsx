"use client";

import { useState, type ChangeEvent } from "react";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { HeroPicker } from "@/components/hero-picker/HeroPicker";
import {
  useCalculateHeroPoolMutation,
  useGetHeroesQuery,
  useGetHeroPoolQuery,
  useUpdateHeroPoolMutation,
} from "@/lib/engine-api";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { EMPTY_POOL_MESSAGE, MAX_POOL_SIZE, POOL_FULL_MESSAGE } from "./constants";
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
  const [accountId, setAccountId] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [calculateStatus, setCalculateStatus] = useState<CalculateStatus>({ kind: "idle" });

  // Derivado, no sincronizado con un efecto (mismo hallazgo que TSK-016): mientras el usuario no
  // haya tocado nada, `entries` es el pool del servidor; en cuanto edita/calcula, la copia local
  // manda y un refetch de RTK Query en segundo plano nunca la pisa sola.
  const entries = draftEntries ?? savedPool ?? [];
  const poolIsFull = entries.length >= MAX_POOL_SIZE;

  function handleAccountIdChange(event: ChangeEvent<HTMLInputElement>) {
    setAccountId(event.target.value);
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
      setSaveMessage("Pool guardado.");
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
      const result = await calculatePool({ accountId }).unwrap();
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
      setSaveMessage("Pool guardado.");
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
        <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
          {entries.length === 0 && <span className="text-caption text-content-muted">{EMPTY_POOL_MESSAGE}</span>}

          {entries.length > 0 && (
            <div className="flex flex-col gap-2">
              {entries.map((entry) => (
                <HeroPoolRow key={entry.hero} entry={entry} hero={findHero(heroes, entry.hero)} onRemove={handleRemove} />
              ))}
            </div>
          )}

          {poolIsFull && <span className="text-caption text-content-muted">{POOL_FULL_MESSAGE}</span>}
          {!poolIsFull && !heroesLoading && <HeroPicker heroes={heroes} onSelect={handleAdd} />}

          {saveMessage && <span className="text-caption text-content-secondary">{saveMessage}</span>}
          <button type="button" onClick={handleSave} disabled={isSaving} className={BUTTON_PRIMARY}>
            Guardar
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface-raised p-4">
        <span className="text-body text-content-primary">Calcular desde mis partidas</span>
        <input
          type="text"
          value={accountId}
          onChange={handleAccountIdChange}
          placeholder="account_id de Steam"
          className="rounded-md border border-surface-border bg-surface-overlay px-3 py-2 text-body text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
        />
        <CalculateStatusMessage status={calculateStatus} />
        <button
          type="button"
          onClick={handleCalculate}
          disabled={isCalculating || accountId.length === 0}
          className={BUTTON_SECONDARY}
        >
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
    </main>
  );
}
