// Única base de URL del motor para código que corre en el NAVEGADOR. Relativa a propósito: la
// resuelve el rewrite de `next.config.ts` (`ENGINE_REWRITE_SOURCES`) en el servidor de Next, que
// sí puede alcanzar el motor en `ENGINE_INTERNAL_URL` (127.0.0.1:4000 por defecto).
//
// TSK-214: existía una segunda base, `LOCAL_DRAFT_ENGINE_HTTP_BASE_URL = "http://127.0.0.1:4000"`,
// usada desde el navegador por seis call sites (eventos de draft del simulador, pick del bot,
// feedback, low-confidence report, draft-paths, pro-recommendations). En Railway el navegador del
// visitante no tiene ningún motor en su loopback: las seis fallaban en silencio. Se eliminó.
// `scripts/verify-simplicity.sh` bloquea que vuelva a aparecer un literal de loopback bajo
// `apps/web/{features,lib,app}`.
export const ENGINE_HTTP_BASE_URL = "/engine";
