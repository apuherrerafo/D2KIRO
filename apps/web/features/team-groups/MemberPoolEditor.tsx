"use client";

import { useEffect } from "react";
import { HeroPicker } from "@/components/hero-picker/HeroPicker";
import { ActionQuiet } from "@/design/canonical/primitives/ActionQuiet";
import { StateTarget, type TargetState } from "@/design/canonical/primitives/StateTarget";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { HeroId } from "@/features/draft/types";
import { MAX_COMPANION_POOL_SIZE, SEAT_LABELS, SEAT_SHORT } from "./constants";
import { PoolHeroChip, renderCanonicalPickerIcon } from "./PoolHeroChip";
import { poolAtSeat, type SaveFailure } from "./pool-editor";
import { SEATS } from "./position-assignment";
import { TgNotice } from "./TgNotice";
import type { Seat, TeamMemberEntry } from "./types";
import { useMemberPoolEditor } from "./use-member-pool-editor";

// Pool editor of one SAVED person, one position at a time. It only ever writes through the per-position endpoint
// (with `expectedVersion`); the legacy list is shown for confirmation, never edited.

function heroName(heroes: HeroMeta[], id: HeroId): string {
  return heroes.find((hero) => hero.id === id)?.localizedName ?? `Héroe ${id}`;
}

function heroNames(heroes: HeroMeta[], ids: readonly HeroId[]): string {
  if (ids.length === 0) return "sin héroes (sin pool)";
  return ids.map((id) => heroName(heroes, id)).join(", ");
}

function heroCount(count: number): string {
  if (count === 1) return "1 héroe";
  return `${count} héroes`;
}

interface SeatTargetProps {
  seat: Seat;
  selected: boolean;
  /** Heroes saved for this person at this seat, or `null` when there is no pool there. */
  savedHeroes: number | null;
  dirty: boolean;
  habitual: boolean;
  onSelect: (seat: Seat) => void;
}

function seatState(selected: boolean, savedHeroes: number | null): TargetState {
  if (selected) return "selected";
  if (savedHeroes === null) return "uncertain";
  return "rest";
}

function SeatCount({ savedHeroes }: { savedHeroes: number | null }) {
  if (savedHeroes === null) return <span>Sin pool</span>;
  return <b>{heroCount(savedHeroes)}</b>;
}

function SeatMeta({ savedHeroes, selected, dirty, habitual }: Pick<SeatTargetProps, "savedHeroes" | "selected" | "dirty" | "habitual">) {
  // `uncertain` (no pool, not selected) already says "Sin pool" in the target's own note.
  const showCount = savedHeroes !== null || selected;
  return (
    <span className="tg-target-meta">
      {showCount && <SeatCount savedHeroes={savedHeroes} />}
      {dirty && <span>Sin guardar</span>}
      {habitual && <span>Habitual</span>}
    </span>
  );
}

function SeatTarget({ seat, selected, savedHeroes, dirty, habitual, onSelect }: SeatTargetProps) {
  function handlePress() {
    onSelect(seat);
  }
  return (
    <div data-testid={`pool-seat-${seat}`}>
      <StateTarget state={seatState(selected, savedHeroes)} title={SEAT_SHORT[seat].title} value={SEAT_SHORT[seat].role} note="Sin pool" onPress={handlePress}>
        <SeatMeta savedHeroes={savedHeroes} selected={selected} dirty={dirty} habitual={habitual} />
      </StateTarget>
    </div>
  );
}

interface FailureNoticeProps {
  failure: SaveFailure;
  savedHeroes: string | null;
}

function FailureNotice({ failure, savedHeroes }: FailureNoticeProps) {
  return (
    <div data-testid="pool-failure" data-code={failure.code ?? "unknown"}>
      <TgNotice tone="error" title={failure.title}>
        <p>{failure.body}</p>
        {failure.code === "stale_pool" && savedHeroes !== null && <p>Guardado ahora: {savedHeroes}.</p>}
      </TgNotice>
    </div>
  );
}

interface PoolStatusProps {
  hasUnsavedEdit: boolean;
  hasSavedPool: boolean;
  isDeferred: boolean;
}

function PoolStatusTag({ hasUnsavedEdit, hasSavedPool, isDeferred }: PoolStatusProps) {
  if (hasUnsavedEdit) return <span className="tg-tag" data-tone="pending">Sin guardar</span>;
  if (hasSavedPool) return <span className="tg-tag" data-tone="saved">Guardado</span>;
  if (isDeferred) return <span className="tg-tag" data-tone="empty">Pendiente</span>;
  return <span className="tg-tag" data-tone="empty">Sin pool</span>;
}

export interface MemberPoolEditorProps {
  teamGroupId: number;
  member: TeamMemberEntry;
  /** Where the person is placed on screen right now; marks that seat as the usual one and picks the seat shown first. */
  habitualSeat: Seat | null;
  heroes: HeroMeta[];
  /** Reports how many of this person's positions hold an unsaved edit, so the roster can say so while another player is open. */
  onDirtyChange?: (memberId: number, dirtyCount: number) => void;
}

export function MemberPoolEditor({ teamGroupId, member, habitualSeat, heroes, onDirtyChange }: MemberPoolEditorProps) {
  const firstPoolSeat = member.positionPools[0]?.position ?? 1;
  const editor = useMemberPoolEditor(teamGroupId, member, habitualSeat ?? firstPoolSeat);
  const seatLabel = SEAT_LABELS[editor.seat];
  const shown = editor.shown;
  const isFull = shown !== null && shown.length >= MAX_COMPANION_POOL_SIZE;
  const savedHeroes = editor.stored === null ? null : heroNames(heroes, editor.stored.heroPool);
  const canConfirmLegacy = editor.legacyPool !== null && editor.stored === null;
  const dirtyCount = editor.dirtySeats.length;

  useEffect(() => {
    onDirtyChange?.(member.id, dirtyCount);
  }, [member.id, dirtyCount, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(member.id, 0);
    },
    [member.id, onDirtyChange],
  );

  function handleSave() {
    void editor.save();
  }
  function handleConfirmLegacy() {
    void editor.confirmLegacy();
  }

  return (
    <div className="tg-pool" data-testid={`pool-editor-${member.id}`}>
      <div role="group" aria-label={`Pools de ${member.name} por posición`} className="tg-seats">
        {SEATS.map((seat) => (
          <SeatTarget
            key={seat}
            seat={seat}
            selected={editor.seat === seat}
            savedHeroes={poolAtSeat(member, seat)?.heroPool.length ?? null}
            dirty={editor.dirtySeats.includes(seat)}
            habitual={habitualSeat === seat}
            onSelect={editor.selectSeat}
          />
        ))}
      </div>

      {editor.legacyPool !== null && (
        <div data-testid="pool-legacy-notice">
          <TgNotice tone="warning" title="Lista antigua sin posición">
            <p>
              {member.name} tiene una lista de héroes de antes de los pools por posición: {heroNames(heroes, editor.legacyPool)}. No se usa en ninguna recomendación hasta que confirmes a qué posición pertenece.
            </p>
            {canConfirmLegacy && (
              <div className="tg-notice-actions">
                <button type="button" className="tg-btn" onClick={handleConfirmLegacy} disabled={editor.isSaving} aria-busy={editor.isSaving ? "true" : undefined}>
                  {`Confirmar como pool de ${seatLabel}`}
                </button>
              </div>
            )}
            {!canConfirmLegacy && <p>Elige arriba una posición sin pool para confirmarla ahí.</p>}
          </TgNotice>
        </div>
      )}

      <div className="tg-pool-head">
        <span className="tg-h3">{`Pool de ${member.name} en ${seatLabel}`}</span>
        <PoolStatusTag hasUnsavedEdit={editor.hasUnsavedEdit} hasSavedPool={editor.stored !== null} isDeferred={editor.isDeferred} />
      </div>

      {shown === null && (
        <div className="tg-empty" data-testid="pool-empty">
          <p>
            {editor.isDeferred ? "Pool pendiente. El draft no se bloquea: mientras tanto se usan candidatos creíbles del rol." : "Sin pool para esta posición. Puedes crearlo ahora o más tarde; el draft no se bloquea."}
          </p>
          <div className="tg-actions">
            <button type="button" className="tg-btn" onClick={editor.createNow}>
              Crear ahora
            </button>
            {!editor.isDeferred && <ActionQuiet onPress={editor.createLater}>Más tarde</ActionQuiet>}
          </div>
        </div>
      )}

      {shown !== null && (
        <div className="tg-pool" data-testid="pool-heroes">
          <ul className="tg-heroes">
            {shown.map((heroId) => (
              <li key={heroId}>
                <PoolHeroChip heroId={heroId} hero={heroes.find((hero) => hero.id === heroId)} onRemove={editor.removeHero} />
              </li>
            ))}
          </ul>
          <span className="tg-count">{`${shown.length} de ${MAX_COMPANION_POOL_SIZE} héroes`}</span>
          {shown.length === 0 && <span className="tg-hint">Sin héroes: se guardará como «sin pool para esta posición».</span>}
          {!isFull && <HeroPicker variant="canonical" renderIcon={renderCanonicalPickerIcon} heroes={heroes} onSelect={editor.addHero} unavailableHeroIds={new Set(shown)} unavailableLabel="ya en el pool" />}
          {isFull && <span className="tg-hint">Máximo 5 héroes.</span>}
          {editor.hasUnsavedEdit && <span className="tg-hint">Cambios sin guardar en este pool.</span>}
          <div className="tg-actions">
            <button type="button" className="tg-btn tg-btn--solid" onClick={handleSave} disabled={!editor.hasUnsavedEdit || editor.isSaving} aria-busy={editor.isSaving ? "true" : undefined}>
              {editor.isSaving ? "Guardando…" : "Guardar pool"}
            </button>
            {editor.hasUnsavedEdit && <ActionQuiet onPress={editor.discardEdit}>Descartar cambios</ActionQuiet>}
          </div>
        </div>
      )}

      {editor.failure && <FailureNotice failure={editor.failure} savedHeroes={savedHeroes} />}
      {editor.savedNotice && (
        <div data-testid="pool-saved">
          <TgNotice tone="success" title={editor.savedNotice}>
            <p>{`${member.name} · ${seatLabel}`}</p>
          </TgNotice>
        </div>
      )}
    </div>
  );
}
