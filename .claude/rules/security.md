---
description: Gate de seguridad transversal
---

Gate, no checklist final — bloquea si falla, no se pondera entre otras dimensiones (`@redteam`,
Sentinel). Fuente: `docs/specs/SPEC.md` §5.

- **Sin exposición de red innecesaria**: `apps/engine` se ata a `127.0.0.1`, nunca a `0.0.0.0`.
  Un binding a `0.0.0.0` es FAIL automático de revisión, sin excepción.
- **Autenticación local del capturador**: `POST /ingest/draft-event` exige la cabecera
  `x-capture-token`, generada al arrancar el motor y leída desde variable de entorno. El token
  nunca vive en el repo, ni como literal ni como default de fallback.
- **Validación de todo input externo**: todo `DraftEventEnvelope` y toda respuesta de OpenDota se
  validan contra esquema en el borde, antes de tocar lógica de negocio. Datos de una API pública
  son input externo, igual que un formulario o un query param.
- **Consultas parametrizadas**: exclusivamente vía Drizzle. Cero SQL concatenado, cero
  `db.execute()` con strings interpolados desde datos externos.
- **Escapado de HTML**: React escapa por defecto; `dangerouslySetInnerHTML` prohibido en toda la
  app, sin excepción de "es solo un nombre de héroe".
- **Imágenes de héroe**: `img_url` apunta al CDN de Valve — se valida que el host esté en una
  lista permitida antes de renderizar cualquier imagen.
- **Secretos**: fase 1 no requiere ninguna API key (OpenDota es gratuito sin clave). El único
  secreto es el token de captura, generado en ejecución, siempre en `process.env`. Un literal
  sospechoso (`api[_-]?key|password|secret|token` seguido de un valor literal) en el diff es FAIL
  automático en `scripts/verify-simplicity.sh` y en Sentinel.
- **Privilegio mínimo**: el capturador usa solo los permisos que Overwolf ya concede, sin admin.
  El motor solo necesita salida a internet hacia OpenDota y lectura/escritura de su SQLite.
- **Límite de peticiones al ingreso**: `/ingest/draft-event` acepta como máximo 20 eventos/segundo
  por sesión; el exceso se descarta con `429`.
- **Datos personales**: ninguno en fase 1 — solo estadísticas públicas agregadas. Cualquier campo
  que identifique a una cuenta de Steam real es fuera de alcance hasta fase 1b.
- **Dependencias nuevas**: distinción por categoría desde Governance 2.0 (2026-08-24, ver
  `CLAUDE.md`). Una `dependency` de producción nunca sin pasar por `/gear-up` o `@depcheck` —
  incluida cualquier librería de validación de esquemas (SPEC §7.3 la deja abierta a propósito).
  Una `devDependency` de tooling de infraestructura rutinaria (`typescript`, `better-sqlite3`,
  generadores/linters del stack Bun) tiene bypass total — no es superficie de ataque en runtime,
  Sentinel no la marca como hallazgo.

> Historia por fase (1b–9.1, cerradas): `docs/rules-archive/rules-security-fases-cerradas.md`. No se carga sola.

## Fase 5 — Auth & Personal Hero Pool multi-usuario (SPEC.md §12.12)

- **Tres fronteras de confianza nuevas, cada una con mitigación obligatoria — ninguna es opcional:**
  1. **Navegador/Steam → `apps/web`** (callback OpenID): `check_authentication` server-a-server
     contra Steam es **obligatorio**, nunca opcional — sin él, cualquiera puede fabricar una
     respuesta de "login exitoso" con el `steamid64` que quiera (es exactamente la vulnerabilidad
     real y documentada que tiene `passport-steam`, la librería más popular para esto). Además: host
     de `openid.claimed_id` anclado por regex, `return_to` verificado, nonce anti-CSRF de login.
     Saltarse cualquiera de los cuatro es rechazo automático de `@redteam`.
  2. **`apps/web` → `apps/engine`, HTTP** (`x-account-token`): HMAC-SHA256, secreto que nunca toca
     el navegador, ventana de 60 s, nonce de un solo uso, comparación en tiempo constante, firma
     verificada **antes** de tocar el store de nonces.
  3. **`apps/web` → `apps/engine`, WebSocket** (`accountToken` en `hello`): mismo mecanismo y misma
     mitigación que la frontera 2 — es la misma frontera, otro transporte.
- **La conversión SteamID64 → Steam32 exige `BigInt`, nunca aritmética `Number` nativa.**
  `76561197960265728 > Number.MAX_SAFE_INTEGER` — con `Number()`, la resta pierde precisión y
  produce un Steam32 distinto **sin ningún error ni excepción**, mapeando al usuario a la cuenta de
  otra persona. Prueba dedicada obligatoria (criterio 10 de SPEC.md §12.14): documenta el valor que
  daría la conversión ingenua junto al valor correcto, para que el bug no vuelva en un refactor.
- **Dato personal, ahora a escala real.** El `account_id` de Steam deja de ser "el del desarrollador"
  y pasa a ser el de cada persona real logueada. Toda la regla de 1b sigue vigente, multiplicada:
  nunca en logs, `journal.md`, tickets, `meta_sync.error`, `/api/health` ni en el cuerpo de ningún
  error — para **todas** las cuentas, no solo una. Se agrega: nunca en el mensaje de un ticket de
  migración.
- **Dos secretos nuevos, ambos `process.env`, nunca literal ni default de fallback en el repo**:
  `SESSION_SECRET` (≥32 caracteres, `iron-session`) e `INTERNAL_AUTH_SECRET` (≥32 caracteres, HMAC
  del token interno). Steam OpenID **no** exige credencial del sitio — no es OAuth2, no hay
  `client_id`/`client_secret` que registrar ni gestionar.
- **`scripts/start-railway.sh` falla cerrado si falta `SESSION_SECRET`, `INTERNAL_AUTH_SECRET` o
  `PUBLIC_BASE_URL`.** Reemplaza el guard actual sobre `SITE_ACCESS_*` (Basic Auth, retirado en esta
  fase) — mismo mecanismo, mismo motivo original (hallazgo real de Sentinel en el primer
  `/castoff`): sin los tres, el proceso no debe levantar en producción.
- **Toda ruta de cuenta responde `401` sin token válido.** Cierra un hallazgo real de la auditoría
  previa a esta fase: `GET /api/settings` devolvía todo sin filtrar a cualquiera que llegara al
  puerto — se cierra retirando la ruta, no agregándole un guard.
- **`iron-session` es la única dependencia de producción nueva** (`apps/web`) — exige `/gear-up`/
  `@depcheck` y `// ALLOWED`. Cero dependencia nueva en `apps/engine`: el HMAC del token interno usa
  `node:crypto`, ya disponible.
- **Registro abierto, decisión de producto explícita, no un hallazgo de seguridad**: cualquier
  persona con cuenta de Steam puede crear cuenta en la instancia. Sin lista de invitados ni límite
  de registro — coherente con el alcance declarado ("cualquier jugador de Dota 2"), no se restringe
  en silencio.

## Fase 4.3 — `archetype_fit` usable: nueva frontera de confianza (SPEC.md §11.14.6)

- **Frontera de confianza nueva, con mitigación obligatoria.** En 4.3 `archetypeIntent` **sí llega
  desde el cliente** — por el mensaje WS `set_intent` **y** por el body de
  `POST /api/suggestions/preview`. Es input externo → se valida en el borde contra la unión cerrada
  de 4 literales (`isValidClientMessage` / `isValidSuggestionsPreviewRequest`) **antes** de tocar
  `SessionStore` o `buildSuggestions`. Un valor inválido: en WS se descarta el mensaje (sin
  cambiar la sesión, sin lanzar), en HTTP es `400`. Saltarse esa validación es rechazo automático
  de `@redteam`.
- **Cierra el hallazgo #2 de `@redteam` en TSK-180**: un valor fuera de la unión llegaría a
  `ARCHETYPE_MAX_BONUS[intent]` como `undefined` → `raw: NaN`. La validación de borde lo hace
  inalcanzable.
- **Sin ruta HTTP nueva** — el WS reutiliza el socket ya autenticado; el único toque HTTP es un
  campo opcional en un endpoint existente.
- **Sin secreto nuevo, sin dato personal, sin escritura a SQLite.** `SessionStore` es memoria; la
  intención nunca se persiste ni se loguea.
- **DoS**: un `set_intent` cuyo valor es igual al almacenado es no-op (ni recálculo ni push). El
  WS del motor sigue atado a `127.0.0.1`, no expuesto a la red (Fase 5 no lo cambió) — `set_intent`
  no es superficie nueva más allá de lo que `ping` ya es.

