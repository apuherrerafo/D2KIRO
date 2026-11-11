"use client";

import { useState, type ChangeEvent } from "react";
import { AppLink } from "@/components/app-shell/AppLink";
import { AppNotice } from "@/components/app-shell/AppNotice";
import { PageHead } from "@/components/app-shell/PageHead";
import { HeroGrid } from "@/components/hero-grid/HeroGrid";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import {
  useCalculateHeroPoolMutation,
  useGetHeroesQuery,
  useGetHeroPoolQuery,
  useUpdateHeroPoolMutation,
} from "@/lib/engine-api";
import { ActionPrimary, type ActionStatus } from "@/design/canonical/primitives/ActionPrimary";
import { Glass } from "@/design/canonical/primitives/Glass";
import { BUTTON_GHOST } from "@/features/draft/styles";
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
    <li className="ap-row" data-testid="pool-row">
      <div className="ap-row-main">
        <HeroIcon imgUrl={hero?.imgUrl ?? ""} alt={hero?.localizedName ?? `Héroe ${entry.hero}`} size={40} />
        <div className="ap-row-text">
          <span className="ap-row-name">{hero?.localizedName ?? `Héroe ${entry.hero}`}</span>
          <span className="ap-row-meta">{stats}</span>
        </div>
      </div>
      <button type="button" onClick={handleRemove} className={BUTTON_GHOST}>
        Quitar
      </button>
    </li>
  );
}

function saveStatus(isSaving: boolean): ActionStatus {
  if (isSaving) return "busy";
  return "idle";
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
      setSaveMessage("No se pudo guardar el pool. Tu pool anterior sigue intacto; intenta de nuevo en un momento.");
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
      setSaveMessage("No se pudo guardar el pool. Tu pool anterior sigue intacto; intenta de nuevo en un momento.");
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

  const saved = saveMessage === POOL_SAVED_MESSAGE;
  const saveFailed = saveMessage !== null && !saved;

  function handleSavePress() {
    void handleSave();
  }

  function handleCalculatePress() {
    void handleCalculate();
  }

  return (
    <main className="ap-main" data-testid="hero-pool-page">
      <PageHead
        kicker="Mi pool"
        title="Mi pool de héroes"
        lede="Hasta 5 héroes que dominas. El coach los prioriza cuando te toca elegir y marca cuando recomienda uno fuera de tu pool."
      />

      <PoolLoadState loading={poolLoading} failed={Boolean(poolError)} />

      {!poolLoading && !poolError && (
        <>
          <Glass className="ap-section">
            <div className="ap-section-head">
              <h2 className="ap-h2">Calcular desde mis partidas</h2>
              <span className="ap-hint">Usa tu historial público de OpenDota. Nada se guarda hasta que lo confirmes.</span>
            </div>
            <div className="ap-field">
              <label className="ap-label" htmlFor="pool-window">
                Ventana de partidas
              </label>
              <select id="pool-window" value={windowDays} onChange={handleWindowDaysChange} className="ap-select">
                {CALCULATE_WINDOW_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    Últimos {option} días
                  </option>
                ))}
              </select>
            </div>
            <CalculateStatusMessage status={calculateStatus} />
            <div className="ap-actions">
              <ActionPrimary onPress={handleCalculatePress} status={isCalculating ? "busy" : "idle"} busyLabel="Calculando…">
                Calcular desde mis partidas
              </ActionPrimary>
            </div>
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
          </Glass>

          <section className="ap-block" aria-labelledby="pool-manual-title">
            <div className="ap-section-head">
              <h2 className="ap-h2" id="pool-manual-title">
                Mi selección manual
              </h2>
              <span className="ap-tag" data-tone={entries.length === 0 ? "empty" : "ok"} data-testid="pool-count">
                Pool activo · {entries.length}/{MAX_POOL_SIZE}
              </span>
            </div>
            {entries.length === 0 && <p className="ap-hint">{EMPTY_POOL_MESSAGE}</p>}
            {entries.length > 0 && (
              <ul className="ap-list">
                {entries.map((entry) => (
                  <HeroPoolRow key={entry.hero} entry={entry} hero={findHero(heroes, entry.hero)} onRemove={handleRemove} />
                ))}
              </ul>
            )}
            {poolIsFull && <p className="ap-hint">{POOL_FULL_MESSAGE}</p>}
            {!heroesLoading && (
              <HeroGrid
                heroes={heroes}
                onSelect={handleAdd}
                highlightedHeroIds={activeHeroIds}
                dimmedHeroIds={dimmedHeroIds}
                rosterFull={poolIsFull}
              />
            )}
            {saveFailed && (
              <AppNotice tone="error" title="No se guardó tu pool">
                <p>{saveMessage}</p>
              </AppNotice>
            )}
            {saved && (
              <AppNotice tone="success" title={POOL_SAVED_MESSAGE} testId="pool-saved">
                <p>El coach ya usa este pool en tus próximos drafts.</p>
              </AppNotice>
            )}
            <div className="ap-actions">
              <ActionPrimary onPress={handleSavePress} status={saveStatus(isSaving)} busyLabel="Guardando…" testId="pool-save">
                Guardar
              </ActionPrimary>
              {saved && <AppLink href="/live-draft">Ver el draft en vivo</AppLink>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function PoolLoadState({ loading, failed }: { loading: boolean; failed: boolean }) {
  if (loading) {
    return (
      <p className="ap-loading" role="status">
        Cargando tu pool…
      </p>
    );
  }
  if (failed) {
    return (
      <AppNotice tone="error" title="No se pudo cargar tu pool de héroes" testId="pool-error">
        <p>Tu pool guardado no se tocó. Vuelve a abrir esta pantalla para reintentar.</p>
      </AppNotice>
    );
  }
  return null;
}
