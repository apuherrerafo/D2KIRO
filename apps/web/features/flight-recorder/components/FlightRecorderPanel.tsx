"use client";

import { BUTTON_SECONDARY } from "@/features/draft/styles";
import { useFlightRecorderPanel, type UseFlightRecorderPanelOptions } from "../use-flight-recorder-panel";

// <Dominio><Cosa>: panel de diagnóstico TEMPORAL. Con el doble interruptor apagado (producción) no renderiza nada
// y la grabadora ni se arma. No toca scoring, pesos ni el draft: sólo lee y exporta.

export function FlightRecorderPanel(props: UseFlightRecorderPanelOptions) {
  const { enabled, entryCount, exportJson, clear } = useFlightRecorderPanel(props);
  if (!enabled) return null;
  return (
    <aside
      className="fixed bottom-4 right-4 z-50 flex w-64 flex-col gap-2 rounded-lg border border-signal-warning bg-surface-raised p-3"
      data-testid="flight-recorder-panel"
      aria-label="Flight Recorder (diagnóstico)"
    >
      <span className="text-caption font-semibold text-signal-warning">Flight Recorder · sólo preview/debug</span>
      <span className="text-caption text-content-secondary" data-testid="flight-recorder-count">
        {entryCount} eventos grabados
      </span>
      <div className="flex gap-2">
        <button type="button" onClick={exportJson} className={BUTTON_SECONDARY} data-testid="flight-recorder-export">
          Exportar JSON
        </button>
        <button type="button" onClick={clear} className={BUTTON_SECONDARY} data-testid="flight-recorder-clear">
          Vaciar
        </button>
      </div>
    </aside>
  );
}
