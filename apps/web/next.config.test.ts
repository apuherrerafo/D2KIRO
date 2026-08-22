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
    expect(sources).toContain("/engine/api/settings");
    expect(sources).toContain("/engine/api/hero-pool");
    expect(sources).toContain("/engine/api/hero-pool/calculate");
    expect(sources).toContain("/engine/api/simulator/sessions");
    expect(sources).toContain("/engine/api/simulator/sessions/:sessionId/state");
    expect(sources).toContain("/engine/api/team-groups");
    expect(sources).toContain("/engine/api/team-groups/:id");

    expect(sources.some((source) => source.includes(":path*"))).toBe(false);
    expect(sources).not.toContain("/engine/ingest/draft-event");
    expect(sources).not.toContain("/engine/api/session/manual");
    expect(sources).not.toContain("/engine/api/session/:id/draft-paths");
  });
});
