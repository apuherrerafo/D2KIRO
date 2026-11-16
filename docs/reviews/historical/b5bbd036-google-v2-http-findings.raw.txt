# SECURITY-001 B — Contraste HTTP del hallazgo MEDIA de Gemini v2

Este documento NO modifica ni sustituye la revisión original (`b5bbd036-google.raw.txt`, íntegra, SHA-256 del archivo recuperado `0bff2ea0…4e06`). Solo registra una medición aparte.

Código probado: `b5bbd0362658d56a306bded6ec041f6425b5dafa` (worktree limpio `_secB2-cleanB`), build de producción (`NODE_ENV=production`, `next start`), peticiones HTTP reales sin seguir redirecciones.

Afirmación de Gemini (MEDIA): las respuestas creadas directamente en `proxy.ts` (404 de `/_next/image`, redirecciones a `/login` y `/access-denied`, 503 por secreto ausente) no reciben las cabeceras de `next.config.ts`.

| Petición | Estado | CSP | CSP-Report-Only | HSTS | nosniff | X-Frame-Options |
|---|---|---|---|---|---|---|
| `GET /_next/image?url=%2Fa.png&w=64&q=75` | 404 | presente | presente | `max-age=31536000` | presente | `DENY` |
| `GET /simulator` sin sesión | 307 → `/login` | presente | presente | presente | presente | `DENY` |
| `GET /login` | 200 | presente | presente | presente | presente | `DENY` |
| `GET /simulator` sin `PUBLIC_BASE_URL` (503 del proxy) | 503 | presente | presente | presente | presente | `DENY` |

Conclusión medida: en este build las respuestas terminales del proxy (404, 307, 503) SÍ llevan las cabeceras de seguridad; la afirmación de Gemini no se reproduce. No se probó `revokedAccessRedirect` (`/access-denied`) por HTTP; la afirmación sobre esa ruta queda sin medir. El hallazgo se mantiene registrado tal cual lo dijo Gemini (disposición `accepted`, sin cambio de código). R-001 y #137 siguen abiertos.

Salida cruda de la medición: `http-probe.out` (SHA-256 `19cda860673c0e7ac2e1a3c75010041fbdc8cb61e338857dc8602d02ab8687a7`).

## E2E completo (worktree limpio `_secB2-cleanB`, HEAD `b5bbd036`)

`bun run e2e`: 172 esperadas, 0 inesperadas, 0 flaky, 0 omitidas; código de salida 0; duración 1.286 s. Resultado JSON SHA-256 `65faee83528ae5a4adb3887ffe65b4b53038b98d5d2db280c411dca4f9f99ccb`. Logs y 172 trazas viven fuera del repo (`Downloads\D2KIRO_SECB2_e2e_evidence`, 1,4 GB). Una primera corrida idéntica también terminó con código 0 (su salida no se conservó: el lanzador borra su log al pasar).
