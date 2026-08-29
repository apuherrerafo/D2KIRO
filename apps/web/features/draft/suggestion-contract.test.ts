import { expect, test } from "bun:test";
import type { SuggestionSet as EngineSuggestionSet } from "../../../engine/src/signals/mix";
import type { SuggestionSet as WebSuggestionSet } from "./types";

// Candado de contrato entre procesos: TypeScript comprueba que el payload real del motor pueda
// llegar al cliente sin adaptador que borre contexto o evidencia. La aserción runtime deja además
// explícito el dato que la UI debe consumir, nunca inferir desde `reason`.
test("el contrato del motor entrega al cliente el contexto y evidencia estructurada", () => {
  const payload: EngineSuggestionSet = {
    schema: "suggestions/v1",
    sessionId: "contract",
    basedOnSeq: 4,
    decisionContext: "response_pick",
    suggestions: [{
      hero: 7,
      rank: 1,
      score: 72,
      signals: [],
      reason: "Resumen táctico.",
      confidence: "media",
      // TSK-210 (Fase 9.1): el motor añade estos 2 campos a Suggestion. El espejo de tipos en
      // apps/web/features/draft/types.ts los incorpora en TSK-211; este literal ya los provee para
      // que el candado de contrato entre procesos compile (AC6: tsc limpio en ambos paquetes).
      evidenceCoverage: 0.62,
      guessingIndex: 0.38,
      evidence: [{ kind: "counter", text: "Fuerte contra un rival revelado." }],
    }],
    comparison: null,
    degraded: [],
    computedInMs: 1,
  };
  const webPayload: WebSuggestionSet = payload;

  expect(webPayload.decisionContext).toBe("response_pick");
  expect(webPayload.suggestions[0]?.evidence?.[0]?.kind).toBe("counter");
});
