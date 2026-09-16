import type { NextConfig } from "next";

const ENGINE_INTERNAL_URL = process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:4000";

const ENGINE_REWRITE_SOURCES = [
  "/engine/api/heroes",
  "/engine/api/meta/status",
  "/engine/api/meta/sync",
  "/engine/api/meta/hero-stats",
  "/engine/api/suggestions/preview",
  "/engine/api/account",
  "/engine/api/hero-pool",
  "/engine/api/hero-pool/calculate",
  "/engine/api/simulator/sessions",
  "/engine/api/simulator/sessions/:sessionId/state",
  "/engine/api/team-groups",
  "/engine/api/team-groups/:id",
  // TSK-214: rutas que apps/web llamaba desde el NAVEGADOR contra http://127.0.0.1:4000.
  // En Railway ese loopback no existe para el navegador del usuario, así que fallaban todas en
  // silencio -- los picks del simulador nunca llegaban al motor y el tablero quedaba congelado.
  // Van por el mismo proxy que el resto; el gate de sesión de proxy.ts sigue siendo el perímetro.
  "/engine/api/session/manual",
  "/engine/api/session/protocol",
  "/engine/api/session/protocol/:sessionId",
  "/engine/api/session/protocol/:sessionId/command",
  "/engine/api/session/protocol/:sessionId/bot-selection",
  "/engine/api/session/protocol/:sessionId/simulator-authority",
  // R1 S7 (Blocker 2 investigation) -- missing from this allowlist since TSK-214 added the rest of
  // this family: fetchRecommendations() (protocol-client.ts) has been 404ing through this proxy in
  // EVERY browser session (AP and CM alike) since it was written. Never caught before because
  // copilot-intelligence.spec.ts's assertions only check the Copilot panel's text is non-empty and
  // free of sentinel substrings -- "No se pudo calcular la recomendación." (the real failure
  // message shown when fetchRecommendations throws) satisfies both checks. Real bug, not a CM-only
  // gap: confirmed via curl direct-to-engine (200, real RecommendationSet/v2) vs through this proxy
  // (404) with the exact same session id.
  "/engine/api/session/protocol/:sessionId/recommendations",
  "/engine/api/session/:sessionId/feedback",
  "/engine/api/session/:sessionId/draft-paths",
  "/engine/api/v1/draft/pro-recommendations",
  "/engine/api/pro-drafter/low-confidence-report",
] as const;

const nextConfig: NextConfig = {
  // TSK-217: el E2E levanta su propio servidor de desarrollo. Next sólo admite UNO a la vez por
  // directorio de build, así que sin esto la prueba choca con el `bun run dev` que el
  // desarrollador tenga abierto — y peor, le pisaría su `.next`. Con un `distDir` propio, ambos
  // conviven. Sin la variable, el valor es exactamente el de siempre.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async rewrites() {
    return ENGINE_REWRITE_SOURCES.map((source) => ({
      source,
      destination: `${ENGINE_INTERNAL_URL}${source.replace(/^\/engine/, "")}`,
    }));
  },
};

export default nextConfig;
