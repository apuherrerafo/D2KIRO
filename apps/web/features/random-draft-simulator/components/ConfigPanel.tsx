"use client";

import { useEffect, useState, type ChangeEvent, type MouseEvent } from "react";
import { HeroGrid } from "@/components/hero-grid/HeroGrid";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { useHeroCatalog, type HeroMeta } from "@/features/draft/use-hero-catalog";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import { addHeroToBanList, removeHeroFromBanList } from "../ban-list";
import { SEED_PATTERN } from "../constants";
import { generateDraftSeed } from "../seeded-rng";
import { useConfigPersistence } from "../use-config-persistence";
import type { HeroId, SessionMode, TeamSide } from "../types";
import type { StartDraftConfig } from "../use-random-draft-session";

const MAX_BAN_LIST = 4;

interface SeedFieldProps {
  draftSeed: string;
  isValid: boolean;
  onChange: (seed: string) => void;
  onRegenerate: () => void;
}

function SeedField({ draftSeed, isValid, onChange, onRegenerate }: SeedFieldProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value.toUpperCase());
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-content-secondary">Semilla del draft (draftSeed)</span>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draftSeed}
          onChange={handleChange}
          maxLength={8}
          className="w-32 rounded-md border border-surface-border bg-surface-overlay px-3 py-2 font-mono text-body uppercase text-content-primary tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
        />
        <button type="button" onClick={onRegenerate} className={BUTTON_SECONDARY}>
          Generar
        </button>
      </div>
      {!isValid && (
        <span className="text-caption text-signal-negative">
          Debe tener exactamente 8 caracteres alfanuméricos en mayúscula (A-Z0-9).
        </span>
      )}
    </div>
  );
}

interface BanListRowProps {
  heroId: HeroId;
  localizedName: string;
  imgUrl: string | null;
  onRemove: (heroId: HeroId) => void;
}

function BanListRow({ heroId, localizedName, imgUrl, onRemove }: BanListRowProps) {
  function handleRemove() {
    onRemove(heroId);
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-surface-border bg-surface-overlay px-2 py-1">
      {imgUrl && <HeroIcon imgUrl={imgUrl} alt={localizedName} size={28} />}
      <span className="text-caption text-content-primary">{localizedName}</span>
      <button type="button" onClick={handleRemove} className={BUTTON_GHOST}>
        Quitar
      </button>
    </div>
  );
}

interface HeroPickerModalProps {
  heroCatalog: Map<number, HeroMeta>;
  unavailableHeroIds: ReadonlySet<HeroId>;
  onSelect: (heroId: HeroId) => void;
  onClose: () => void;
}

// <Dominio><Cosa>: overlay real (no un bloque inline que empuja la página) -- pedido explícito
// del usuario para que elegir un héroe de la Personal_Ban_List se sienta "exactamente como la
// pantalla principal de draft", mismo HeroGrid agrupado por atributo, ahora en un diálogo
// centrado que no reordena el resto del formulario. Cierra por click afuera, Escape, o al elegir
// un héroe -- las tres únicas salidas, ninguna deja el modal abierto sin explicación.
function HeroPickerModal({ heroCatalog, unavailableHeroIds, onSelect, onClose }: HeroPickerModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Elegir héroe para la Personal_Ban_List"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-base/80 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col gap-4 overflow-y-auto rounded-lg border border-surface-border bg-surface-raised p-6 shadow-xl">
        <div className="flex items-center justify-between gap-4">
          <span className="text-heading text-content-primary">Elegí un héroe para tu Personal_Ban_List</span>
          <button type="button" onClick={onClose} className={BUTTON_GHOST}>
            Cerrar
          </button>
        </div>
        <HeroGrid heroes={Array.from(heroCatalog.values())} unavailableHeroIds={unavailableHeroIds} onSelect={onSelect} />
      </div>
    </div>
  );
}

interface PersonalBanListFieldProps {
  personalBanList: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
  error: string | null;
  onAdd: (heroId: HeroId) => void;
  onRemove: (heroId: HeroId) => void;
}

function PersonalBanListField({ personalBanList, heroCatalog, error, onAdd, onRemove }: PersonalBanListFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function openPicker() {
    setPickerOpen(true);
  }

  function closePicker() {
    setPickerOpen(false);
  }

  function handleSelect(heroId: number) {
    onAdd(heroId);
    setPickerOpen(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-content-secondary">
        Tu Personal_Ban_List ({personalBanList.length}/{MAX_BAN_LIST})
      </span>
      <span className="text-caption text-content-muted">
        Nominá hasta 4 héroes. Se resuelven junto con las nominaciones de los otros 9 jugadores: si llenás los 4 lugares, al menos uno se banea.
      </span>
      <div className="flex flex-wrap gap-2">
        {personalBanList.map((heroId) => (
          <BanListRow
            key={heroId}
            heroId={heroId}
            localizedName={heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`}
            imgUrl={heroCatalog.get(heroId)?.imgUrl ?? null}
            onRemove={onRemove}
          />
        ))}
      </div>
      {error && <span className="text-caption text-signal-negative">{error}</span>}
      {personalBanList.length < MAX_BAN_LIST && (
        <button type="button" onClick={openPicker} className={`self-start ${BUTTON_SECONDARY}`}>
          Agregar héroe
        </button>
      )}
      {pickerOpen && (
        <HeroPickerModal
          heroCatalog={heroCatalog}
          unavailableHeroIds={new Set(personalBanList)}
          onSelect={handleSelect}
          onClose={closePicker}
        />
      )}
    </div>
  );
}

export interface ConfigPanelProps {
  onStart: (config: StartDraftConfig, mode: SessionMode) => void;
}

const MODE_OPTIONS: { value: SessionMode; label: string; description: string }[] = [
  { value: "simulation", label: "Simulación", description: "Draft de práctica: el Enemy Bot elige por el rival, automático." },
  {
    value: "live_companion",
    label: "Live Companion",
    description: "Para usar junto a un draft REAL de Dota 2. Sin bot: reportás a mano cada ban/pick que ves en tu cliente.",
  },
];

interface ModeFieldProps {
  mode: SessionMode;
  onChange: (mode: SessionMode) => void;
}

// MVP P0.1 -- decisión explícita, sin valor por defecto silencioso distinto al ya existente:
// "simulation" es la primera opción y la que ya persistía antes de que este selector existiera,
// así que el comportamiento de quien nunca toca este control queda exactamente igual.
function ModeField({ mode, onChange }: ModeFieldProps) {
  return (
    <div className="flex flex-col gap-1" role="group" aria-label="Modo de sesión">
      <span className="text-caption text-content-secondary">Modo</span>
      <div className="flex flex-wrap gap-2">
        {MODE_OPTIONS.map((option) => (
          <ChoiceButton key={option.value} value={option.value} label={option.label} selected={mode === option.value} onSelectValue={onChange} />
        ))}
      </div>
      <span className="text-caption text-content-muted">{MODE_OPTIONS.find((option) => option.value === mode)?.description}</span>
    </div>
  );
}

type PlayerPosition = 1 | 2 | 3 | 4 | 5;
type PartySize = 1 | 2 | 3 | 5;

const SIDE_OPTIONS: { value: TeamSide; label: string }[] = [
  { value: "radiant", label: "Radiant" },
  { value: "dire", label: "Dire" },
];

const PARTY_SIZE_OPTIONS: { value: PartySize; label: string; description: string }[] = [
  { value: 1, label: "Solo (1)", description: "Controlás 1 posición; tus 4 aliados y los 5 rivales son simulados automáticamente." },
  { value: 2, label: "Party 2", description: "Controlás 2 posiciones; tus 3 aliados y los 5 rivales son simulados automáticamente." },
  { value: 3, label: "Party 3", description: "Controlás 3 posiciones; tus 2 aliados y los 5 rivales son simulados automáticamente." },
  { value: 5, label: "Party 5", description: "Controlás las 5 posiciones de tu equipo; los 5 rivales son simulados automáticamente." },
];

// Terminología consistente con el resto del producto: nunca "pos 3" a secas sin el nombre al lado.
const POSITION_OPTIONS: { value: PlayerPosition; label: string }[] = [
  { value: 1, label: "Posición 1 — Carry" },
  { value: 2, label: "Posición 2 — Midlane" },
  { value: 3, label: "Posición 3 — Offlane" },
  { value: 4, label: "Posición 4 — Support" },
  { value: 5, label: "Posición 5 — Hard support" },
];

interface ChoiceButtonProps<T extends string | number> {
  value: T;
  label: string;
  selected: boolean;
  onSelectValue: (value: T) => void;
}

function ChoiceButton<T extends string | number>({ value, label, selected, onSelectValue }: ChoiceButtonProps<T>) {
  function handleClick() {
    onSelectValue(value);
  }
  const className = selected ? BUTTON_PRIMARY : BUTTON_SECONDARY;
  return (
    <button type="button" onClick={handleClick} aria-pressed={selected} className={className}>
      {label}
    </button>
  );
}

interface PartySizeFieldProps {
  partySize: PartySize;
  onChange: (size: PartySize) => void;
}

function PartySizeField({ partySize, onChange }: PartySizeFieldProps) {
  return (
    <div className="flex flex-col gap-1" role="group" aria-label="Tamaño de party">
      <span className="text-caption text-content-secondary">Tamaño de party</span>
      <div className="flex flex-wrap gap-2">
        {PARTY_SIZE_OPTIONS.map((option) => (
          <ChoiceButton
            key={option.value}
            value={option.value}
            label={option.label}
            selected={partySize === option.value}
            onSelectValue={onChange}
          />
        ))}
      </div>
      <span className="text-caption text-content-muted">
        {PARTY_SIZE_OPTIONS.find((option) => option.value === partySize)?.description}
      </span>
    </div>
  );
}

interface PartyPositionsFieldProps {
  partySize: 2 | 3;
  selectedPositions: PlayerPosition[];
  onTogglePosition: (pos: PlayerPosition) => void;
}

function PartyPositionsField({ partySize, selectedPositions, onTogglePosition }: PartyPositionsFieldProps) {
  return (
    <div className="flex flex-col gap-1" role="group" aria-label="Posiciones de tu party">
      <div className="flex items-center justify-between">
        <span className="text-caption text-content-secondary">
          Posiciones que controla tu party (elegí exactamente {partySize})
        </span>
        <span className={`text-caption ${selectedPositions.length === partySize ? "text-signal-positive" : "text-signal-warning"}`}>
          {selectedPositions.length} de {partySize} seleccionadas
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {POSITION_OPTIONS.map((option) => {
          const isSelected = selectedPositions.includes(option.value);
          return (
            <ChoiceButton
              key={option.value}
              value={option.value}
              label={option.label}
              selected={isSelected}
              onSelectValue={onTogglePosition}
            />
          );
        })}
      </div>
    </div>
  );
}

interface SideFieldProps {
  side: TeamSide | null;
  onChange: (side: TeamSide) => void;
}

function SideField({ side, onChange }: SideFieldProps) {
  return (
    <div className="flex flex-col gap-1" role="group" aria-label="Tu lado">
      <span className="text-caption text-content-secondary">Tu lado (obligatorio)</span>
      <div className="flex flex-wrap gap-2">
        {SIDE_OPTIONS.map((option) => (
          <ChoiceButton key={option.value} value={option.value} label={option.label} selected={side === option.value} onSelectValue={onChange} />
        ))}
      </div>
    </div>
  );
}

interface PositionFieldProps {
  position: PlayerPosition | null;
  allowedPositions?: PlayerPosition[];
  onChange: (position: PlayerPosition) => void;
}

function PositionField({ position, allowedPositions, onChange }: PositionFieldProps) {
  const options = allowedPositions
    ? POSITION_OPTIONS.filter((opt) => allowedPositions.includes(opt.value))
    : POSITION_OPTIONS;

  return (
    <div className="flex flex-col gap-1" role="group" aria-label="Tu posición personal">
      <span className="text-caption text-content-secondary">Tu posición personal (obligatoria)</span>
      <span className="text-caption text-content-muted">
        Indica cuál de los roles de tu party es el tuyo (determina tu Personal View en el Coach).
      </span>
      {options.length === 0 ? (
        <span className="text-caption text-signal-warning">
          Primero seleccioná las posiciones de tu party arriba.
        </span>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <ChoiceButton key={option.value} value={option.value} label={option.label} selected={position === option.value} onSelectValue={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

// AP Ranked Roles V1: lado y posición personal son elecciones del Player, obligatorias y sin
// valor por defecto -- ni Radiant ni Midlane están cableados.
export function ConfigPanel({ onStart }: ConfigPanelProps) {
  const { config, setConfig } = useConfigPersistence();
  const { heroes: heroCatalog } = useHeroCatalog();
  const [draftSeed, setDraftSeed] = useState<string>(generateDraftSeed);
  const [banListError, setBanListError] = useState<string | null>(null);
  const [chosenSide, setChosenSide] = useState<TeamSide | null>(null);
  const [chosenPosition, setChosenPosition] = useState<PlayerPosition | null>(null);
  const [chosenPartySize, setChosenPartySize] = useState<PartySize | null>(null);
  const [chosenPartyPositions, setChosenPartyPositions] = useState<PlayerPosition[] | null>(null);
  const [mode, setMode] = useState<SessionMode>("simulation");

  // Nominations live in local state first: they must work BEFORE side/position are chosen (persistence only
  // happens once both are known), otherwise an early nomination would be silently dropped.
  const [chosenBans, setChosenBans] = useState<HeroId[] | null>(null);
  const personalBanList = chosenBans ?? config?.personalBanList ?? [];
  const side = chosenSide ?? config?.userSide ?? null;
  const position = chosenPosition ?? config?.playerPosition ?? null;
  const partySize = chosenPartySize ?? config?.partySize ?? 5;
  const rawPartyPositions = chosenPartyPositions ?? config?.partyPositions ?? null;

  const partyPositions: PlayerPosition[] =
    partySize === 5
      ? [1, 2, 3, 4, 5]
      : partySize === 1
        ? (position !== null ? [position] : [])
        : (rawPartyPositions ?? []);

  const isSeedValid = SEED_PATTERN.test(draftSeed);
  const isPartyConfigValid =
    mode === "live_companion" ||
    (partySize === 5 && position !== null) ||
    (partySize === 1 && position !== null) ||
    ((partySize === 2 || partySize === 3) &&
      partyPositions.length === partySize &&
      new Set(partyPositions).size === partySize &&
      position !== null &&
      partyPositions.includes(position));

  const canStart = isSeedValid && side !== null && position !== null && isPartyConfigValid;

  function persist(next: {
    userSide?: TeamSide | null;
    playerPosition?: PlayerPosition | null;
    personalBanList?: HeroId[];
    partySize?: PartySize;
    partyPositions?: PlayerPosition[];
  }) {
    const nextSide = next.userSide === undefined ? side : next.userSide;
    const nextPosition = next.playerPosition === undefined ? position : next.playerPosition;
    const nextPartySize = next.partySize === undefined ? partySize : next.partySize;
    const nextPartyPositions = next.partyPositions === undefined ? partyPositions : next.partyPositions;
    if (nextSide === null || nextPosition === null) return;
    setConfig({
      userSide: nextSide,
      playerPosition: nextPosition,
      personalBanList: next.personalBanList ?? personalBanList,
      partySize: nextPartySize,
      partyPositions: nextPartyPositions,
    });
  }

  function regenerateSeed() {
    setDraftSeed(generateDraftSeed());
  }

  function changePartySize(nextSize: PartySize) {
    setChosenPartySize(nextSize);
    if (nextSize === 5) {
      setChosenPartyPositions([1, 2, 3, 4, 5]);
      persist({ partySize: 5, partyPositions: [1, 2, 3, 4, 5] });
    } else if (nextSize === 1) {
      const nextP: PlayerPosition[] = position !== null ? [position] : [];
      setChosenPartyPositions(nextP);
      persist({ partySize: 1, partyPositions: nextP });
    } else {
      let initial: PlayerPosition[] = [];
      if (position !== null) initial = [position];
      setChosenPartyPositions(initial);
      persist({ partySize: nextSize, partyPositions: initial });
    }
  }

  function togglePartyPosition(pos: PlayerPosition) {
    let next: PlayerPosition[];
    if (partyPositions.includes(pos)) {
      next = partyPositions.filter((p) => p !== pos);
      if (position === pos) {
        setChosenPosition(null);
      }
    } else {
      if (partyPositions.length >= partySize) {
        return;
      }
      next = [...partyPositions, pos];
      if (position === null) {
        setChosenPosition(pos);
      }
    }
    setChosenPartyPositions(next);
    persist({ partyPositions: next });
  }

  function changeSide(nextSide: TeamSide) {
    setChosenSide(nextSide);
    persist({ userSide: nextSide });
  }

  function changePosition(nextPosition: PlayerPosition) {
    setChosenPosition(nextPosition);
    if (partySize === 1) {
      setChosenPartyPositions([nextPosition]);
      persist({ playerPosition: nextPosition, partyPositions: [nextPosition] });
    } else {
      persist({ playerPosition: nextPosition });
    }
  }

  function addBanHero(heroId: HeroId) {
    const result = addHeroToBanList(personalBanList, heroId);
    if (!result.ok) {
      setBanListError(result.reason);
      return;
    }
    setBanListError(null);
    setChosenBans(result.list);
    persist({ personalBanList: result.list });
  }

  function removeBanHero(heroId: HeroId) {
    setBanListError(null);
    const remaining = removeHeroFromBanList(personalBanList, heroId);
    setChosenBans(remaining);
    persist({ personalBanList: remaining });
  }

  function handleStart() {
    if (!canStart || side === null || position === null) return;
    const resolvedPositions: (1 | 2 | 3 | 4 | 5)[] =
      partySize === 5
        ? [1, 2, 3, 4, 5]
        : partySize === 1
          ? [position]
          : partyPositions;

    onStart(
      {
        draftSeed,
        userSide: side,
        playerPosition: position,
        personalBanList,
        partySize,
        partyPositions: resolvedPositions,
      },
      mode,
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-heading text-content-primary">Ranked All Pick — Ranked Roles</span>
      <ModeField mode={mode} onChange={setMode} />
      <SideField side={side} onChange={changeSide} />
      {mode === "simulation" && (
        <>
          <PartySizeField partySize={partySize} onChange={changePartySize} />
          {(partySize === 2 || partySize === 3) && (
            <PartyPositionsField
              partySize={partySize}
              selectedPositions={partyPositions}
              onTogglePosition={togglePartyPosition}
            />
          )}
        </>
      )}
      <PositionField
        position={position}
        allowedPositions={mode === "simulation" && (partySize === 2 || partySize === 3) ? partyPositions : undefined}
        onChange={changePosition}
      />
      {mode === "simulation" && (
        <>
          <SeedField draftSeed={draftSeed} isValid={isSeedValid} onChange={setDraftSeed} onRegenerate={regenerateSeed} />
          <PersonalBanListField
            personalBanList={personalBanList}
            heroCatalog={heroCatalog}
            error={banListError}
            onAdd={addBanHero}
            onRemove={removeBanHero}
          />
        </>
      )}
      {mode === "live_companion" && (
        <span className="text-caption text-content-muted">
          En Live Companion vas a reportar los bans y picks reales a mano, apenas empiece el draft -- no hace falta seed ni nominaciones acá.
        </span>
      )}
      {!canStart && (
        <span className="text-caption text-signal-warning">
          {side === null
            ? "Elegí tu lado para continuar."
            : (partySize === 2 || partySize === 3) && partyPositions.length !== partySize
              ? `Elegí exactamente ${partySize} posiciones para tu party (${partyPositions.length} seleccionadas).`
              : position === null
                ? "Elegí cuál de las posiciones es tu posición personal."
                : !isSeedValid
                  ? "Verificá la semilla del draft."
                  : "Completá la configuración para iniciar el draft."}
        </span>
      )}
      <button type="button" onClick={handleStart} disabled={!canStart} className={`self-start ${BUTTON_PRIMARY}`}>
        Iniciar Draft
      </button>
    </div>
  );
}
