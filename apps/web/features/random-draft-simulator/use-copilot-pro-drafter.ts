import { useEffect } from "react";
import { isProDrafterEnabled } from "@/app/draft/live-config";
import type { DraftState } from "@/features/draft/types";
import { buildProDrafterRequest, toProDrafterView } from "@/features/pro-drafter/types";
import type { ProDrafterView } from "@/features/pro-drafter/types";
import { usePostProRecommendationsMutation } from "@/lib/engine-api";

export interface CopilotProDrafterResult {
  enabled: boolean;
  view: ProDrafterView | null;
  isLoading: boolean;
  error: unknown;
}

// Fase 4 (consolidación del Simulador, sesión Gobernanza 2.0): a diferencia de ProDrafterPanel
// (/draft, "click para ver" -- panel exploratorio y costoso, cerrado por defecto, web.md), acá el
// pedido explícito es "en tiempo real mientras se pica" -- se re-dispara solo con cada pick/ban
// nuevo (`draftState.lastSeq` cambia), nunca a mano. Gateado por `isProDrafterEnabled()` DENTRO
// del efecto (no antes de llamar al hook, las reglas de hooks no permiten llamarlo condicional) --
// con el flag apagado (default), cero requests, mismo comportamiento dark-launch que el resto del
// proyecto. RTK Query garantiza que `data` siempre refleja el ÚLTIMO `trigger()` de este hook (un
// disparo anterior más lento no puede pisar uno más nuevo que ya resolvió) -- no hace falta
// trackear staleness a mano.
export function useCopilotProDrafter(draftState: DraftState | null): CopilotProDrafterResult {
  const enabled = isProDrafterEnabled();
  const [trigger, { data, isLoading, error }] = usePostProRecommendationsMutation();

  useEffect(() => {
    if (!enabled || !draftState) return;
    void trigger(buildProDrafterRequest(draftState));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trigger es estable (RTK Query); solo un pick/ban nuevo debe re-disparar
  }, [enabled, draftState?.lastSeq]);

  return { enabled, view: data ? toProDrafterView(data) : null, isLoading, error };
}
