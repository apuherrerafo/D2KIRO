// SECURITY-001: cabeceras de seguridad de toda respuesta de apps/web.
//
// Todo el código del navegador habla con el MISMO origen (el motor se alcanza por el proxy `/engine`), así que `connect-src`
// es 'self'. Las únicas imágenes externas son el CDN de héroes de Valve y los avatares públicos de Steam (ver
// `lib/steam-profile.ts`). Next inyecta scripts/estilos inline, por eso la política de scripts/estilos lleva 'unsafe-inline'
// mientras sea Report-Only: endurecerla con nonces es un paso aparte, medido con los reportes.

export interface SecurityHeader {
  key: string;
  value: string;
}

// ENFORCED. Sólo directivas que no dependen de qué carga la página y que (a diferencia de las de `*-src`) no pueden romper
// una pantalla: `frame-ancestors` NO se admite en Content-Security-Policy-Report-Only (el navegador la ignora), por eso vive acá.
const ENFORCED_CSP = ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'"].join("; ");

// REPORT-ONLY: describe la política completa sin bloquear nada. No hay endpoint de reportes todavía; las violaciones se ven en la
// consola del navegador hasta decidir a dónde enviarlas.
const REPORT_ONLY_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.cloudflare.steamstatic.com https://*.steamstatic.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

// Ninguna pantalla usa cámara, micrófono, ubicación, pago ni USB: se niegan a toda página y a cualquier iframe.
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

// HSTS sólo en builds de producción (Railway Preview y Producción son HTTPS): en `next dev` el origen es http://localhost y un
// HSTS ahí quedaría pegado en el navegador del desarrollador. Un año; sin `includeSubDomains` ni `preload` (el dominio es
// compartido, `*.up.railway.app`, y un preload no se deshace).
const HSTS_VALUE = "max-age=31536000";

export function buildSecurityHeaders(isProduction: boolean): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: ENFORCED_CSP },
    { key: "Content-Security-Policy-Report-Only", value: REPORT_ONLY_CSP },
  ];
  if (isProduction) headers.push({ key: "Strict-Transport-Security", value: HSTS_VALUE });
  return headers;
}
