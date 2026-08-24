"use client";

import { useCallback } from "react";
import { postManualEvent, type ManualEventResult } from "./manual-entry";
import type { DraftInputMode } from "./store";
import { useDraftStore } from "./store";
import type { DraftEvent, HeroId } from "./types";

// Pura, exportada para probarla sin el hook (sin Zustand, sin red) -- separa "qué DraftEvent le
// corresponde a este modo" de cómo se dispara la llamada. Un pick sin lado (`side: "unknown"`)
// no tiene DraftEvent válido -- `hero_picked` siempre exige un TeamSide real (mismo contrato que
// ya tenía `handleQuickPick` original: sin localSide identificado, no hay a quién atribuirle el
// pick). Un ban siempre viaja con `side: "unknown"` -- `mode.side` es un campo que solo tiene
// sentido para pick (ver comentario de `DraftInputMode` en store.ts); ningún flujo de entrada
// manual expone hoy "qué lado baneó esto", mismo comportamiento exacto que ya tenía
// ManualEntryPanel antes de este cambio.
export function buildDraftEvent(mode: DraftInputMode, heroId: HeroId): DraftEvent | null {
  if (mode.action === "ban") return { type: "hero_banned", hero: heroId, side: "unknown" };
  if (mode.side === "unknown") return null;
  return { type: "hero_picked", hero: heroId, side: mode.side };
}

// RCA post-TSK-076 (auditoría de arquitectura, 2026-08-23): único punto de la app con permiso de
// convertir "un héroe + un modo de entrada" en un DraftEvent real y mandarlo al motor. HeroGrid,
// SuggestionCard (quick-pick) y ManualEntryPanel comparten esta misma función -- ninguno vuelve a
// armar el payload a mano ni a llamar `postManualEvent` por su cuenta.
//
// `modeOverride` existe por una razón concreta, no por flexibilidad especulativa: el botón
// "Pickear" de SuggestionCard siempre significa "pick a mi propio lado", nunca "lo que sea que
// diga el modo global" (que puede estar en "ban" porque el usuario lo dejó así en
// ManualEntryPanel) -- mismo criterio que ya tenía el `handleQuickPick` original. Sin el override,
// una tarjeta de sugerencia podría terminar baneando al hacer clic en un botón que dice
// "Pickear", una regresión real, no hipotética. HeroGrid y ManualEntryPanel sí usan el modo
// global (sin override) porque para ellos "qué pasa si toco esto" es exactamente la pregunta que
// `DraftInputMode` existe para responder.
export function useSubmitDraftEvent(
  sessionId: string,
  modeOverride?: DraftInputMode,
): (heroId: HeroId) => Promise<ManualEventResult | null> {
  const lastSeq = useDraftStore((s) => s.draftState?.lastSeq ?? 0);
  const storeMode = useDraftStore((s) => s.inputMode);
  const mode = modeOverride ?? storeMode;

  return useCallback(
    async (heroId: HeroId) => {
      const payload = buildDraftEvent(mode, heroId);
      if (!payload) return null;
      return postManualEvent(sessionId, lastSeq, payload);
    },
    [sessionId, lastSeq, mode],
  );
}
