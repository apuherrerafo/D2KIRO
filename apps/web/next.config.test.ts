import { describe, expect, test } from "bun:test";
import nextConfig from "./next.config";

interface RewriteRule {
  source: string;
  destination: string;
}

async function loadRewrites(): Promise<RewriteRule[]> {
  const rewrites = nextConfig.rewrites;
  if (typeof rewrites !== "function") return [];
  const loaded = await rewrites();
  if (Array.isArray(loaded)) return loaded as RewriteRule[];
  return [...(loaded.beforeFiles ?? []), ...(loaded.afterFiles ?? []), ...(loaded.fallback ?? [])] as RewriteRule[];
}

describe("engine rewrites", () => {
  test("usa allowlist explícita, sin comodín amplio ni rutas sensibles del draft", async () => {
    const rewrites = await loadRewrites();
    const sources = rewrites.map((rewrite) => rewrite.source);

    expect(sources).toContain("/engine/api/heroes");
    expect(sources).toContain("/engine/api/meta/status");
    expect(sources).toContain("/engine/api/meta/sync");
    expect(sources).toContain("/engine/api/meta/hero-stats");
    expect(sources).toContain("/engine/api/account");
    expect(sources).not.toContain("/engine/api/settings");
    expect(sources).toContain("/engine/api/hero-pool");
    expect(sources).toContain("/engine/api/hero-pool/calculate");
    expect(sources).toContain("/engine/api/simulator/sessions");
    expect(sources).toContain("/engine/api/simulator/sessions/:sessionId/state");
    expect(sources).toContain("/engine/api/team-groups");
    expect(sources).toContain("/engine/api/team-groups/:id");

    // TSK-214: estas cinco entraron a la allowlist a propósito. Antes este test afirmaba lo
    // contrario (regla de TSK-037/038: "el draft en vivo nunca pasa por /engine"), que asumía un
    // motor en la máquina del propio visitante. Con el Simulador servido desde Railway, la
    // llamada directa a http://127.0.0.1:4000 desde el navegador fallaba siempre y en silencio.
    expect(sources).toContain("/engine/api/session/manual");
    expect(sources).toContain("/engine/api/session/:sessionId/feedback");
    expect(sources).toContain("/engine/api/session/:sessionId/draft-paths");
    expect(sources).toContain("/engine/api/v1/draft/pro-recommendations");
    expect(sources).toContain("/engine/api/pro-drafter/low-confidence-report");

    expect(sources.some((source) => source.includes(":path*"))).toBe(false);
    // Sigue fuera y no se negocia: es el camino del capturador, exige `x-capture-token`, y ese
    // secreto no vive ni puede vivir en el navegador.
    expect(sources).not.toContain("/engine/ingest/draft-event");
    expect(sources).not.toContain("/engine/api/settings");
  });
});
