## REGLAS DE FASE 1b (hero pool) — desde `docs/specs/SPEC.md` §9
Generadas por `/rulebook`, segunda ejecución del proyecto. Detalle completo en `.claude/rules/`
(secciones "Fase 1b" añadidas a `engine.md`, `web.md`, `security.md`, `testing-seams.md`) — esta
sección son los puntos que no se pueden violar sin romper el contrato, resumidos:

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

