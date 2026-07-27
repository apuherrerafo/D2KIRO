export interface HealthStatus {
  status: "ok";
  uptimeMs: number;
  activeSessions: number;
}

const startedAt = Date.now();

export function getHealthStatus(activeSessions: number): HealthStatus {
  return {
    status: "ok",
    uptimeMs: Date.now() - startedAt,
    activeSessions,
  };
}
