import type { DraftState, SuggestionSet } from "@/features/draft/types";
import { LOCAL_DRAFT_ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";

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
  const response = await fetch(`${LOCAL_DRAFT_ENGINE_HTTP_BASE_URL}/api/session/${sessionId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comment, draftState, suggestions }),
  });
  return (await response.json()) as DraftFeedbackResult;
}
