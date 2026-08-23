"use client";

import { useEffect, useState, type ChangeEvent, type MouseEvent } from "react";
import { HeroGrid } from "@/components/hero-grid/HeroGrid";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { useHeroCatalog, type HeroMeta } from "@/features/draft/use-hero-catalog";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { TeamSide } from "@/features/draft/types";
import { addHeroToBanList, removeHeroFromBanList } from "../ban-list";
import { SEED_PATTERN } from "../constants";
import { generateDraftSeed } from "../seeded-rng";
import { useConfigPersistence } from "../use-config-persistence";
import type { HeroId } from "../types";
import type { StartDraftConfig } from "../use-random-draft-session";

const MAX_BAN_LIST = 4;

function sideButtonClassName(current: TeamSide, target: TeamSide): string {
  if (current === target) return BUTTON_PRIMARY;
  return BUTTON_SECONDARY;
}

interface SideSelectorProps {
  userSide: TeamSide;
  onSelect: (side: TeamSide) => void;
}

function SideSelector({ userSide, onSelect }: SideSelectorProps) {
  function selectRadiant() {
    onSelect("radiant");
  }
  function selectDire() {
    onSelect("dire");
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-content-secondary">Tu lado</span>
      <div className="flex gap-2">
        <button type="button" onClick={selectRadiant} className={sideButtonClassName(userSide, "radiant")}>
          Radiant
        </button>
        <button type="button" onClick={selectDire} className={sideButtonClassName(userSide, "dire")}>
          Dire
        </button>
      </div>
    </div>
  );
}

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
        Cada héroe de esta lista tiene 50% de probabilidad de ser baneado al arrancar el draft.
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
  onStart: (config: StartDraftConfig) => void;
}

// <Dominio><Cosa>: pantalla de configuración previa al Random_Draft_Simulator (fase idle) --
// lado, draftSeed (reproducible, Req. 8.1/8.4) y Personal_Ban_List (Req. 1.1-1.4). userSide y
// personalBanList persisten en localStorage entre sesiones (Req. 1.5); draftSeed no persiste --
// una nueva sesión siempre propone una semilla nueva.
export function ConfigPanel({ onStart }: ConfigPanelProps) {
  const { config, setConfig } = useConfigPersistence();
  const { heroes: heroCatalog } = useHeroCatalog();
  const [draftSeed, setDraftSeed] = useState<string>(generateDraftSeed);
  const [banListError, setBanListError] = useState<string | null>(null);

  const userSide = config?.userSide ?? "radiant";
  const personalBanList = config?.personalBanList ?? [];
  const isSeedValid = SEED_PATTERN.test(draftSeed);

  function selectSide(side: TeamSide) {
    setConfig({ userSide: side, personalBanList });
  }

  function regenerateSeed() {
    setDraftSeed(generateDraftSeed());
  }

  function addBanHero(heroId: HeroId) {
    const result = addHeroToBanList(personalBanList, heroId);
    if (!result.ok) {
      setBanListError(result.reason);
      return;
    }
    setBanListError(null);
    setConfig({ userSide, personalBanList: result.list });
  }

  function removeBanHero(heroId: HeroId) {
    setBanListError(null);
    setConfig({ userSide, personalBanList: removeHeroFromBanList(personalBanList, heroId) });
  }

  function handleStart() {
    if (!isSeedValid) return;
    onStart({ draftSeed, userSide, personalBanList });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-heading text-content-primary">Configurar Random Draft</span>
      <SideSelector userSide={userSide} onSelect={selectSide} />
      <SeedField draftSeed={draftSeed} isValid={isSeedValid} onChange={setDraftSeed} onRegenerate={regenerateSeed} />
      <PersonalBanListField
        personalBanList={personalBanList}
        heroCatalog={heroCatalog}
        error={banListError}
        onAdd={addBanHero}
        onRemove={removeBanHero}
      />
      <button type="button" onClick={handleStart} disabled={!isSeedValid} className={`self-start ${BUTTON_PRIMARY}`}>
        Iniciar Draft
      </button>
    </div>
  );
}
