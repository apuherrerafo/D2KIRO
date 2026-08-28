---
description: Gate de seguridad transversal — SPEC.md §5, hereda architecture.md Bloque 4 y CLAUDE.md
globs: **/*.ts,**/*.tsx,**/*.json
alwaysApply: true
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

## Fase 1b — Primer dato personal del proyecto (SPEC.md §9.7)
- **`account_id` de Steam**: validado en el borde como Steam32 (solo dígitos, `1`–`4294967295`)
  antes de tocar lógica de negocio o construir cualquier URL. Un valor que no pase **nunca** llega
  a `fetch`.
- **Prohibido**: registrar el `account_id` en `journal.md`, en tickets, en `meta_sync.error`, en
  `/api/health`, o devolverlo en el cuerpo de un error. Si aparece en un diff, es hallazgo
  automático de `@redteam` — mismo nivel de cuidado que un secreto, aunque técnicamente sea un
  endpoint público sin autenticación.
- Vive únicamente en la SQLite local. Se transmite a un solo destino externo: la propia OpenDota.
- **Sin secreto nuevo** para el hero pool en sí — OpenDota no requiere API key. `STRATZ_API_KEY`
  (predicción de rol rival) es condicional y futuro, fuera del alcance de 1b — no se implementa
  hasta que se priorice explícitamente, y en ese momento pasa por `/gear-up`.
- `PUT /api/hero-pool` reemplaza el pool completo dentro de una única transacción — cero escritura
  parcial, mismo principio que la sincronización de meta.

## Fase 2 — Draft en equipo (construida vía `/kickoff` + Codex)
- **Pools de compañeros de equipo (`team_members.heroPool`) NO son dato personal** — son texto
  cargado a mano por el usuario (nombre + héroes), nunca una cuenta de Steam real de un tercero.
  Decisión de alcance explícita para no expandir el primer dato personal del proyecto (`account_id`
  de Steam, fase 1b) a más de una persona todavía. Si en el futuro se conecta la cuenta real de un
  compañero, eso activa esta misma sección de nuevo, con el mismo nivel de cuidado que
  `account_id`.
- `capabilities.json` (Fase C) es dato de producto curado sobre héroes públicos de Dota 2 — no es
  dato de usuario ni personal, vive versionado en el repo como cualquier otro archivo de código.
- `GET /api/session/:id/draft-paths` es de solo lectura, sin escritura a SQLite, sin cabecera de
  autenticación (mismo criterio que el resto de la API de lectura local — `apps/engine` solo
  escucha en `127.0.0.1`, ese es el perímetro real). No abre superficie de ataque nueva.

## Fase 3 — Posiciones reales (SPEC.md §10.8)

- **Ningún cruce de frontera de confianza nuevo en runtime.** El único contacto con una fuente
  externa (Dota2ProTracker) es el script de regeneración de `hero-positions.json`, que corre a
  mano en la máquina del desarrollador — **nunca desde `apps/engine`, nunca programado, nunca
  automático**. Si alguien propone automatizarlo dentro del motor, eso reabre esta sección.
- **Ningún secreto nuevo.** La decisión de curar el dato a mano evita exactamente el
  `STRATZ_API_KEY` que 1b había dejado documentado como dependencia condicional futura. Si en el
  futuro se decide integrar STRATZ igual, pasa obligatoriamente por `/gear-up` primero.
- **Ningún dato personal.** Estadísticas públicas agregadas de héroes, misma naturaleza que
  `patchStats`, que ya vive en el motor desde fase 1.
- `hero-positions.json` es **input externo** en el sentido del proyecto, igual que una respuesta
  de OpenDota: se valida en el borde al cargarlo (`loadHeroPositions()`), nunca se confía en su
  forma. Un archivo corrupto o manipulado degrada a "sin datos", jamás rompe el motor ni inyecta
  valores arbitrarios en el scoring.
- **Sin dependencias nuevas.** El script de regeneración usa un navegador headless instalado
  aparte, fuera del árbol de dependencias del proyecto — no entra en ningún `package.json`. Si
  alguien lo agrega como dependencia real, eso exige `/gear-up`/`@depcheck` como cualquier otra.

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

## Fase 4 — Intención de draft, sub-ticket 4.1 (SPEC.md §11.8)

- **Ningún cruce de frontera de confianza nuevo en runtime.** `archetype_fit` consume
  exclusivamente `HeroCapabilities[]`, ya validado en el borde por `loadHeroCapabilities()` (S9),
  y `DraftPathArchetype`, una unión cerrada de 4 literales interna al proceso. El diseño original
  de esta fase (pieza 2, sinergia en cadena) iba a abrir un sync nuevo hacia OpenDota — se
  descartó tras verificar contra el código fuente real de `odota/core` que esa partición de dato
  no existe; el sub-ticket 4.1 no hereda ese riesgo.
- **Ninguna dependencia nueva, ningún archivo de datos nuevo.** El diseño original de la pieza 1
  iba a introducir `archetype-affinity.json` (con su propia validación de borde); se descartó a
  favor de reutilizar `archetypeFitBonus`, ya existente — sin archivo nuevo, sin costura de
  validación nueva.
- **Ningún secreto nuevo, ningún dato personal.** Mismo tipo de dato agregado y público que el
  resto del motor.
- `intent` (la intención de draft) en 4.1 no llega desde la red ni de la UI — lo inyecta el
  llamador de la fábrica. Su validación en el borde, cuando llegue por API en un sub-ticket
  posterior, es responsabilidad de ese sub-ticket, no de 4.1.

## Fase 4.2 — Integración de `archetype_fit` en el motor (SPEC.md §11.13.7)

- **Ninguna frontera de confianza nueva en runtime.** En 4.2 `archetypeIntent` sólo entra por
  `BuildSuggestionsOptions`, que fija el llamador dentro del proceso — no llega de la red ni de la
  UI todavía. La validación de borde de ese input (contra la unión cerrada
  `push`/`teamfight`/`pickoff`/`scaling`, degradado a "sin intención" ante un valor inválido, sin
  lanzar nunca) es responsabilidad de **4.3**, cuando llegue por request/`hello`.
- **Ninguna dependencia nueva, ningún archivo de datos nuevo, ningún secreto, ningún dato
  personal.** Mismo dato agregado y público que el resto del motor (`capabilities.json`, ya
  validado en el borde por `loadHeroCapabilities()`, costura S9).
- **Cero red en el camino caliente, intacta.** `archetype-fit.ts` vive bajo
  `apps/engine/src/signals/`, donde `verify-simplicity.sh` ya bloquea cualquier `fetch(` sobre el
  árbol completo.

## Fase 6 — Formalizar Pro-Drafter: apertura de equipo consciente de bans (SPEC.md §13.12)

- **Ninguna frontera de confianza nueva.** Las tres entradas de datos de esta fase ya están
  validadas en el borde por loaders existentes: `hero-positions.json` (S10), `capabilities.json`
  (S9), `MetaSnapshot.matchups` (S6, ya sincronizado). Descartar `heroSynergy` (mismo precedente
  de Fase 4) elimina el único sync/tabla nueva que el diseño original iba a abrir — esta fase tiene
  **menos** superficie nueva que el plan que la originó, no más.
- **Cero red en el camino caliente, reforzado.** La única lectura nueva de la ruta es
  `getCachedMetaSnapshot(db, null)` — SQLite y cache en memoria, la misma llamada que el fallback a
  v5 ya hacía en ese handler. `scripts/evaluate-pro-drafter.ts` sigue siendo un script de
  desarrollador manual, nunca invocado desde el motor ni desde CI.
- **Ningún secreto nuevo, ninguna variable de entorno nueva.** `ENABLE_PRO_DRAFTER` es el único
  gate y no cambia de semántica ni de default.
- **Ningún dato personal.** La ruta computa con `accountId: null` por contrato — ningún
  `hero_pool` de ninguna cuenta entra en este camino, así que ningún Steam32 puede aparecer en un
  log/error/ticket de esta fase, por construcción, no por vigilancia.
- **Ninguna dependencia nueva** (`dependencies` ni `devDependencies`) — sin Python, decisión
  explícita del usuario. Sin `/gear-up`, sin `@depcheck`.
- **`apps/engine` sigue atado a `127.0.0.1`.** Esta fase reutiliza `/api/v1/draft/pro-recommendations`,
  que ya existe y ya está gateada — no agrega ninguna ruta HTTP nueva.
