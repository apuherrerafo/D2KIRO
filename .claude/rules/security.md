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
- **Dependencias nuevas**: nunca sin pasar por `/gear-up` o `@depcheck` — incluida cualquier
  librería de validación de esquemas (SPEC §7.3 la deja abierta a propósito).

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
