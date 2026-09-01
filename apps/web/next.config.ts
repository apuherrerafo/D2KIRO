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
