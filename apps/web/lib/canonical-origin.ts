const LOCAL_DEV_ORIGIN = "http://localhost:3000";

function parseOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

// Única fuente de verdad para el origen público confiable. Nunca deriva de `request.url`
// (que en producción refleja la dirección de bind, p. ej. `http://[::]:PORT` con
// `next start -H ::`), de la cabecera `Host` ni de `X-Forwarded-Host` -- las tres son
// input externo/no confiable para decidir a dónde navega el browser tras un login.
export function getCanonicalOrigin(): string | null {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return parseOrigin(configured);
  return process.env.NODE_ENV === "production" ? null : LOCAL_DEV_ORIGIN;
}
