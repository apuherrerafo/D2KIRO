"use client";

import { useRandomDraftStore } from "../store";

// <Dominio><Cosa>: aviso de que el motor dejó de recibir el draft (TSK-215).
//
// Por qué existe: hasta TSK-214, `emit()` agotaba sus reintentos y sólo hacía `console.error`. El
// draft seguía viéndose normal en pantalla -- tablero congelado, Copilot recomendando contra un
// estado viejo, bot repitiendo el mismo héroe -- y nadie tenía forma de saberlo. Semanas de QA
// manual se hicieron sobre un estado que no era el real.
//
// La regla de `web.md` es explícita: "una sugerencia de confianza baja se muestra igual, marcada
// como tal -- nunca se calla el sistema durante un draft". Un tablero desincronizado es peor que
// una sugerencia floja: no es que el motor no sepa, es que está respondiendo a otra pregunta.
export function EngineUnreachableBanner() {
  const engineStatus = useRandomDraftStore((state) => state.engineStatus);

  if (engineStatus === "ok") return null;

  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-lg border border-signal-negative bg-surface-raised p-4"
    >
      <span className="text-body text-content-primary">
        El motor no está recibiendo este draft.
      </span>
      <span className="text-caption text-content-secondary">
        El tablero y las sugerencias que ves no corresponden a los picks reales. Reiniciá el draft
        cuando vuelva la conexión — el intento se reanuda solo en cuanto el motor responda.
      </span>
    </div>
  );
}
