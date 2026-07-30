import type { NextConfig } from "next";

const ENGINE_INTERNAL_URL = process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:4000";

const ENGINE_REWRITE_SOURCES = [
  "/engine/api/heroes",
  "/engine/api/meta/status",
  "/engine/api/meta/sync",
  "/engine/api/settings",
  "/engine/api/hero-pool",
  "/engine/api/hero-pool/calculate",
  "/engine/api/team-groups",
  "/engine/api/team-groups/:id",
] as const;

const nextConfig: NextConfig = {
  async rewrites() {
    return ENGINE_REWRITE_SOURCES.map((source) => ({
      source,
      destination: `${ENGINE_INTERNAL_URL}${source.replace(/^\/engine/, "")}`,
    }));
  },
};

export default nextConfig;
