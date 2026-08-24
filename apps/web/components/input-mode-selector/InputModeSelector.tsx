"use client";

import { useDraftStore, type DraftInputMode } from "@/features/draft/store";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { TeamSide } from "@/features/draft/types";

// spec §1.2 (specs/draft-native-experience.md): pura, exportada para probarla sin renderizar
// nada (mismo criterio que cellState en HeroGrid.tsx). "Ban" está activo sin importar
// `current.side` -- ese campo no significa nada para un ban (buildDraftEvent, TSK-079, siempre
// manda side:"unknown" al motor pase lo que pase acá).
export function isModeActive(current: DraftInputMode, action: "pick" | "ban", side?: TeamSide): boolean {
  if (action === "ban") return current.action === "ban";
  return current.action === "pick" && current.side === side;
}

interface SelectorOptionProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function SelectorOption({ label, active, onClick }: SelectorOptionProps) {
  return (
    <button type="button" onClick={onClick} className={active ? BUTTON_PRIMARY : BUTTON_SECONDARY}>
      {label}
    </button>
  );
}

// <Dominio><Cosa>: control visible del modo de entrada compartido (DraftInputMode, TSK-079)
// directo sobre HeroGrid, en la pantalla principal -- antes, la única forma de cambiarlo era
// abrir el modal de ManualEntryPanel. Mismo store, misma acción (setInputMode), sin tubería
// nueva -- cambiar el modo acá afecta de inmediato qué evento dispara el próximo clic en
// HeroGrid, sin ningún paso intermedio.
export function InputModeSelector() {
  const inputMode = useDraftStore((s) => s.inputMode);
  const setInputMode = useDraftStore((s) => s.setInputMode);

  function selectPick(side: TeamSide) {
    setInputMode({ action: "pick", side });
  }

  function selectBan() {
    // No se toca `side` acá a propósito -- irrelevante para un ban (ver isModeActive arriba), y
    // dejarlo como estaba hace que, al volver a "Pick", el lado elegido antes siga seleccionado.
    setInputMode({ action: "ban" });
  }

  return (
    <div className="flex gap-2">
      <SelectorOption label="Pick Radiant" active={isModeActive(inputMode, "pick", "radiant")} onClick={() => selectPick("radiant")} />
      <SelectorOption label="Ban" active={isModeActive(inputMode, "ban")} onClick={selectBan} />
      <SelectorOption label="Pick Dire" active={isModeActive(inputMode, "pick", "dire")} onClick={() => selectPick("dire")} />
    </div>
  );
}
