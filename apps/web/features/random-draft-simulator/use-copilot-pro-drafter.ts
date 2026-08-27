import { useEffect } from "react";
import { isProDrafterEnabled } from "@/app/live-draft/live-config";
import type { DraftState } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { buildProDrafterRequest, toProDrafterView } from "@/features/pro-drafter/types";
import type { ProDrafterView } from "@/features/pro-drafter/types";
import { usePostProRecommendationsMutation } from "@/lib/engine-api";
import { useLowConfidenceStore } from "./low-confidence-store";

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
export function useCopilotProDrafter(
  draftState: DraftState | null,
  heroCatalog: Map<number, HeroMeta>,
  playerPosition?: 1 | 2 | 3 | 4 | 5,
): CopilotProDrafterResult {
  const enabled = isProDrafterEnabled();
  const [trigger, { data, isLoading, error }] = usePostProRecommendationsMutation();
  const recordLowConfidence = useLowConfidenceStore((s) => s.record);
  const draftFingerprint = draftState
    ? `${draftState.lastSeq}|${draftState.banned.join(",")}|${draftState.picks.radiant.join(",")}|${draftState.picks.dire.join(",")}`
    : "none";

  useEffect(() => {
    if (!enabled || !draftState) return;
    void fetch("/api/auth/engine-token", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ token?: string }> : Promise.reject(new Error("engine_token_unavailable")))
      .then(({ token }) => {
        if (!token) throw new Error("engine_token_unavailable");
        return trigger({ body: buildProDrafterRequest(draftState, playerPosition), accountToken: token });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trigger es estable (RTK Query); solo un pick/ban nuevo debe re-disparar
  }, [enabled, draftFingerprint, playerPosition]);

  const view = data ? toProDrafterView(data) : null;

  // Diagnóstico de curación de corpus (sesión Gobernanza 2.0): solo `knn_similarity` es accionable
  // para "recoger más partidas profesionales" -- Línea/Denial dependen de otros archivos, no del
  // corpus (ver low-confidence-store.ts). Se registra por cada respuesta nueva del pipeline, nunca
  // en la rama de fallback a v5 (`view.suggestions[].signals` viene vacío ahí, nada que evaluar).
  useEffect(() => {
    if (!view) return;
    for (const suggestion of view.suggestions) {
      const knn = suggestion.signals.find((s) => s.signal === "knn_similarity");
      const reportRank = suggestion.rank === 1 || suggestion.rank === 2 || suggestion.rank === 3 ? suggestion.rank : null;
      // El reporte de baja confianza conserva su contrato histórico Top-3; las aperturas pueden
      // traer ranks 4 y 5 para la UI, pero no se envían a ese endpoint diagnóstico.
      if (knn && knn.raw === null && reportRank !== null) {
        const heroName = heroCatalog.get(suggestion.hero)?.localizedName ?? `Héroe ${suggestion.hero}`;
        recordLowConfidence({ hero: suggestion.hero, heroName, rank: reportRank });
      }
    }
  }, [view, heroCatalog, recordLowConfidence]);

  return { enabled, view, isLoading, error };
}
