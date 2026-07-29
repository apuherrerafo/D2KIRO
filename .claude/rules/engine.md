---
description: Reglas del motor de sugerencias y el servidor Bun (apps/engine) — SPEC.md §C2-C4, §3, §5
globs: apps/engine/**/*.ts
alwaysApply: false
---

Fuente: `docs/specs/SPEC.md` (contrato de desarrollo, gana sobre cualquier otra interpretación).

## Motor de sugerencias (C3) — nunca red en el camino caliente
- Ningún código bajo `apps/engine/src/suggestions/` (o carpeta equivalente del motor) hace
  `fetch`/HTTP. Todo lo que el motor necesita ya está en SQLite antes del primer pick.
- Un `SignalScorer` (S3) es una función pura: entrada `(DraftState, HeroId, MetaSnapshot)`, salida
  `SignalContribution`. Nunca I/O, nunca lanza sin ser capturado por el llamador.
- `raw: null` significa "sin datos suficientes" — nunca se traduce a `0` ni `0.5`. Su peso se
  redistribuye proporcionalmente entre las señales con dato.
- Si un scorer lanza una excepción, esa señal cuenta como `raw: null`; las otras tres se calculan
  igual. Una señal rota nunca tira el motor completo.
- El cálculo completo se corta a los 500 ms duros (presupuesto normal: 300 ms). Si se corta, se
  devuelve lo que haya con `degraded: 'partial_signals'` — nunca se bloquea el push.
- Sin candidatos válidos → `suggestions: []` + flag explícito, no una excepción.
- `SCORING_WEIGHTS_V1` vive en un único archivo, versionado por nombre. Debe existir una prueba
  unitaria que verifique que los 4 pesos suman exactamente `1.0`.

## Reductor de estado (C2) — `applyDraftEvent`
- Firma pura: `(state: DraftState, envelope: DraftEventEnvelope) => { state, rejected? }`. Sin
  `Date.now()`, `crypto.randomUUID()` ni ningún reloj/generador propio dentro — se inyectan como
  parámetros si la función los necesita.
- `eventId` repetido → se descarta en silencio (`duplicate_event`), nunca se re-aplica.
- `seq <= lastSeq` → se rechaza (`stale_seq`), **salvo** `pick_reverted`, que siempre se evalúa.
- Un evento rechazado nunca lanza ni corrompe el estado — se devuelve `RejectionReason` y el
  estado anterior sigue siendo válido.
- `format: 'unknown'` es un estado legítimo — el motor sigue sugiriendo igual, nunca lo bloquea.
- No se modela la tabla de turnos de Valve (orden exacto de bans de All Pick 7.35d) como lógica
  del reductor — vive como datos (`DraftFormat`), nunca como código que la adivine.

## Persistencia (C4) — SQLite/Drizzle
- Toda query pasa por Drizzle. Cero SQL concatenado, cero `db.execute()` con strings interpolados
  desde input externo.
- Toda respuesta de OpenDota se valida en el borde antes de escribir en SQLite — es input externo,
  igual que un formulario.
- La sincronización de cada tabla (S6) es transaccional: una escritura parcial nunca deja el cache
  a medias.
- 429 de OpenDota → reintento con espera creciente (1s, 4s, 16s), máximo 3 intentos. Si falla,
  `meta_sync.status = 'failed'` y se sigue sirviendo el cache viejo — un draft nunca se queda sin
  sugerencias por una API de terceros caída.

## Fase 1b — Hero pool (`hero_pool_fit`, S7, S8) — SPEC.md §9

- `hero_pool_fit` es un `SignalScorer` más (S3), mismo contrato que las otras cuatro. `applicable:
  false` (pool nunca configurado) es distinto de `raw: null` (hueco de datos) — no se confunden en
  ningún punto del pipeline: `applicable: false` no cuenta para `computeConfidence` ni dispara
  `degraded: partial_signals`, pero sí se muestra en el desglose de la UI.
- `SCORING_WEIGHTS_V1` **no se edita ni se borra** — sigue versionado por nombre. `hero_pool_fit`
  vive en `SCORING_WEIGHTS_V2` (5 pesos, suman `1.0`, prueba unitaria obligatoria). Con el pool sin
  configurar, la redistribución proporcional de `mix.ts` debe reproducir exactamente los pesos de
  v1 — hay una prueba dedicada a esto (candado de regresión cero), no es una promesa.
- El cálculo del pool propuesto (S7: filtro de mínimo, `baseline`, suavizado `K=10`, orden, corte
  en 5) es una función pura, sin I/O, igual que un `SignalScorer` — se prueba con fixtures de
  `/players/{id}/heroes`, nunca con red real.
- `POST /api/hero-pool/calculate` toca la red (OpenDota), pero vive en el flujo de configuración,
  **nunca en el camino caliente del draft** — la regla "cero red en el camino caliente" sigue
  intacta para el pipeline de `buildSuggestions`.
- `PUT /api/hero-pool` reemplaza el pool completo en una sola transacción de Drizzle — nunca queda
  un pool a medio reemplazar, mismo principio que la sincronización de meta (S6).
- `account_id` (Steam32): validado en el borde (solo dígitos, `1`–`4294967295`) antes de construir
  cualquier URL o tocar SQLite. Es el primer dato personal del proyecto — nunca se loguea, nunca se
  eco en un error, nunca aparece en `journal.md`/tickets/`meta_sync.error`/`/api/health`.

## Servidor Bun — HTTP + WebSocket
- `apps/engine` escucha únicamente en `127.0.0.1`. Un binding a `0.0.0.0` es FAIL automático.
- `POST /ingest/draft-event` exige la cabecera `x-capture-token` (generada en runtime, leída de
  `process.env`, nunca hardcodeada) y limita a 20 eventos/segundo por sesión — el exceso se
  descarta con `429`.
- Tras cada evento aplicado, el orden de push por WebSocket es siempre `draft_state` primero,
  `suggestions` después — el tablero nunca espera al motor para reflejar el estado real.
- Al reconectar (`hello`), el servidor responde siempre con una instantánea completa
  (`snapshot`), nunca con deltas.
