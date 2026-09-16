import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// R1 S5 (blocker 8, independent architecture review) -- ENABLE_PRO_DRAFTER must have NO effect on
// the R1 ProtocolSession simulator's human Copilot: it always consumes RecommendationSet/v2, never
// Pro-Drafter (`/api/v1/draft/pro-recommendations`, `isProDrafterEnabled`) and never the legacy
// `/api/suggestions/preview` path. Static source-text checks -- same discipline as apps/engine's
// own recommendation/architecture-guard.test.ts -- because this is about what the source
// references, not what it computes.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function read(relativePath: string): string {
  return stripComments(readFileSync(join(__dirname, relativePath), "utf8"));
}

describe("random-draft-simulator -- Pro-Drafter is never a second recommender for this simulator", () => {
  test("CopilotPanel.tsx no importa ni referencia Pro-Drafter / isProDrafterEnabled / ENABLE_PRO_DRAFTER", () => {
    const source = read("components/CopilotPanel.tsx");
    expect(/pro-drafter|isProDrafterEnabled|ENABLE_PRO_DRAFTER/i.test(source)).toBe(false);
  });

  test("use-random-draft-session.ts no llama a /api/suggestions/preview ni al pipeline de recomendación de Pro-Drafter", () => {
    // NOTA: "@/features/pro-drafter/types" también aloja postLowConfidenceReport, un reporte
    // diagnóstico sin relación con la recomendación -- de ahí el chequeo por símbolo, no por
    // substring del path del módulo (que daría un falso positivo real, ya visto en esta prueba).
    const source = read("use-random-draft-session.ts");
    expect(source).not.toContain("/api/suggestions/preview");
    expect(source).not.toContain("pro-recommendations");
    expect(source).not.toContain("usePostProRecommendationsMutation");
    expect(source).not.toContain("isProDrafterEnabled");
    expect(source).not.toContain("buildProDrafterRequest");
  });

  test("use-random-draft-session.ts obtiene la recomendación humana EXCLUSIVAMENTE de fetchRecommendations (RecommendationSet/v2)", () => {
    const source = read("use-random-draft-session.ts");
    expect(source).toContain("fetchRecommendations");
  });
});
