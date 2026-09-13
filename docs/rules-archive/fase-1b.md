## REGLAS DE FASE 1b (hero pool) — desde `docs/specs/SPEC.md` §9
Generadas por `/rulebook`, segunda ejecución del proyecto. Detalle completo de `web.md`/
`security.md`/`testing-seams.md` sigue en `.claude/rules/` (secciones "Fase 1b"); el de `engine.md`
se movió íntegro a este mismo archivo (R0.4 Task 24, ver más abajo) — esta sección son los puntos
que no se pueden violar sin romper el contrato, resumidos:

- **`applicable: false` no es `raw: null`.** El pool sin configurar hace que `hero_pool_fit`
  devuelva `applicable: false` — no cuenta para la confianza ni dispara `partial_signals`, pero se
  muestra en el desglose igual que cualquier otra señal.
- **`SCORING_WEIGHTS_V1` no se toca.** `hero_pool_fit` vive en `SCORING_WEIGHTS_V2` (5 pesos, suma
  `1.0`). Con el pool sin configurar, la redistribución de `mix.ts` debe reproducir exactamente los
  pesos de v1 — regresión cero demostrada por prueba, no prometida.
- **`account_id` de Steam es el primer dato personal del proyecto.** Validado en el borde (Steam32:
  solo dígitos, `1`–`4294967295`). Prohibido loguearlo o ecoarlo en cualquier error, `journal.md`,
  ticket o `/api/health`.
- **`PUT /api/hero-pool` reemplaza el pool completo en una sola transacción.** Nunca queda un pool
  a medio escribir.
- **La propuesta de "calcular desde mis partidas" nunca se auto-aplica.** Confirmar, editar antes
  de confirmar, o descartar — las tres únicas acciones. Descartar nunca escribe.
- **`POST /api/hero-pool/calculate` no es camino caliente.** Toca red hacia OpenDota, pero vive en
  configuración — la regla de cero red durante el cálculo de sugerencias por pick sigue intacta.
- **Predicción de rol/posición del rival: fuera de alcance de 1b.** Documentada como dependencia
  condicional de STRATZ (contrato de señal descrito en `architecture.md`), no se construye hasta
  que se priorice explícitamente y pase por `/gear-up`.


---

## Detalle histórico completo (movido desde `.claude/rules/engine.md` — R0.4 Task 24)

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

