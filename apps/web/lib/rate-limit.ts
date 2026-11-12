// Límite de frecuencia en memoria (ventana deslizante) por clave. Protege los formularios de la beta (solicitud de acceso, feedback)
// de ráfagas y spam. Vive en el proceso: un reinicio lo limpia, que para una beta de un solo contenedor es suficiente y no guarda nada personal.
export interface RateLimiter {
  /** true si la acción cabe en la ventana (y la cuenta); false si se pasó del límite. */
  allow(key: string, now?: number): boolean;
  reset(): void;
}

export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    allow(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      return true;
    },
    reset() {
      hits.clear();
    },
  };
}

/** Primera IP de `x-forwarded-for` (Railway la pone); sin ella, una clave fija. Solo sirve de clave de límite, nunca se guarda. */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first !== undefined && first.length > 0 && first.length <= 64 ? first : "unknown";
}
