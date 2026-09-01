import type { DraftState, SuggestionSet } from "@/features/draft/types";
import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";

export interface DraftFeedbackResult {
  accepted: boolean;
}

// TSK-052: misma foto que el usuario ve en ese instante -- draftState/suggestions se pasan tal
// cual llegaron del store, sin transformar, para que la revisión futura tenga el contexto real,
// no solo el comentario (decisión de producto acordada con el usuario, ver TSK-050).
export async function postDraftFeedback(
  sessionId: string,
  comment: string,
  draftState: DraftState,
  suggestions: SuggestionSet | null,
): Promise<DraftFeedbackResult> {
  // TSK-214: iba a http://127.0.0.1:4000 desde el navegador. En Railway eso no existe, así que
  // TODOS los reportes del DraftFeedbackBox enviados desde producción se descartaron en silencio.
  const response = await fetch(`${ENGINE_HTTP_BASE_URL}/api/session/${sessionId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comment, draftState, suggestions }),
  });
  // TSK-215: un no-2xx nunca se lee como éxito. Sin sesión, el proxy responde un 302 a /login con
  // HTML -- `response.json()` reventaría y el motivo real (no estás logueado) se perdería detrás
  // de un error de parseo. Un reporte que no llegó jamás puede mostrarse como enviado.
  if (!response.ok) return { accepted: false };
  return (await response.json()) as DraftFeedbackResult;
}
