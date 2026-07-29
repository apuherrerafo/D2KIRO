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
