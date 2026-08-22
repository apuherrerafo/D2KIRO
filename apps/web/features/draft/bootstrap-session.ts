import { postManualEvent } from "./manual-entry";
import type { DraftState } from "./types";

const DEFAULT_PATCH = "7.41e";

// TSK-053: sin ningún capturador automático corriendo todavía, una sesión que arranca por entrada
// manual pura nunca recibía su session_started -- el motor rechazaba el primer pick con
// "wrong_phase" (draft/reducer.ts exige phase:"active" para cualquier evento que no sea
// session_started). Se llama solo cuando el draft todavía está en phase:"idle" (DraftView.tsx),
// nunca sobre una sesión ya activa. Lado propio fijo en "radiant" -- no hay selector en la UI
// todavía, limitación conocida, fuera de alcance de este ticket.
export async function bootstrapManualSession(sessionId: string): Promise<void> {
  await postManualEvent(sessionId, 0, { type: "session_started", format: "all_pick", patch: DEFAULT_PATCH });
  await postManualEvent(sessionId, 1, { type: "local_side_identified", side: "radiant" });
}

// TSK-061: extraído del condicional que vivía inline en DraftView.openManualEntry -- la lógica
// exacta que arregló TSK-053, sin ninguna prueba de regresión propia hasta este ticket (vivía sin
// nombre dentro de un closure de componente, no importable). Vive acá y no en DraftView.tsx
// (donde el ticket original lo proponía) por cohesión: queda junto a la función que gatea, con la
// misma prueba de archivo que ya cubre bootstrapManualSession -- desviación consciente del texto
// literal del ticket, documentada en la nota de ejecución.
export function shouldBootstrapManualSession(draftState: DraftState | null): boolean {
  return !draftState || draftState.phase === "idle";
}
