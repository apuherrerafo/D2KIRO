"use client";

import { D2Icon } from "@/design/round-3b/icons";
import { useGetMetaStatusQuery } from "@/lib/engine-api";
import { playerFacingDegradation } from "../degradation-copy";

interface DegradationInput {
  reason: string;
  detail: string;
}

interface SimulatorDegradationNoticeProps {
  /** Degradaciones de `RecommendationSetV2` y de `CoachOutput.meta`: se muestran tal cual las trae el motor, solo traducidas a lenguaje de jugador. */
  degradations: readonly DegradationInput[];
}

/** Los avisos del SISTEMA (señales parciales, estado sin confirmar, posiciones en conflicto) que antes vivían dentro del Copilot plegado.
 * Van junto al tablero, donde se decide: una recomendación degradada se marca, nunca se calla. El de «meta desactualizada» lo dice ya el
 * `StaleWarningBanner` (misma fuente: el estado del meta del motor), así que aquí no se repite mientras ese aviso esté visible. */
export function SimulatorDegradationNotice({ degradations }: SimulatorDegradationNoticeProps) {
  const { data } = useGetMetaStatusQuery();
  const metaNoticeShown = data?.isStale === true;
  const texts = new Set<string>();
  for (const degradation of degradations) {
    if (metaNoticeShown && degradation.reason === "stale_meta") continue;
    const text = playerFacingDegradation(degradation);
    if (text) texts.add(text);
  }
  if (texts.size === 0) return null;
  return (
    <div className="ap-notice" data-tone="warning" role="status" data-testid="simulator-degradations">
      <D2Icon name="attention" size={16} />
      <div className="ap-notice-body">
        {[...texts].map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
    </div>
  );
}
