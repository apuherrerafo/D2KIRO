# Handoff — Fase 7, línea de datos profesionales Tier 1

> Generado 2026-08-27, sesión Claude Code posiblemente por agotarse. Este documento es
> autocontenido: quien lo lea (Codex, otra sesión de Claude Code, o el usuario) tiene todo lo
> necesario para seguir sin releer el chat anterior.

## Estado exacto en este momento

- **Commits reales, ya en el repo local** (rama `master`, `origin/master` sigue en `10638ff`,
  nada de esto está pusheado todavía): `10638ff..50f36c6`, 17 commits nuevos. Últimos 3:
  `b657fac` (TSK-146, higiene), `3422184` (TSK-147, matriz de fuentes), `50f36c6` (TSK-148,
  contratos de tipo). `git log --oneline 10638ff..HEAD` para ver la lista completa.
- **Tickets `done`**: `TSK-146`, `TSK-147`, `TSK-148`. Cero fricción entre Claude Code y Codex —
  se trabajaron en paralelo sin tocar los mismos archivos, verificado antes y después.
- **Tickets `backlog`**: `TSK-149` a `TSK-162` (14 tickets). `TSK-149` es el siguiente ejecutable
  — sin bloqueos técnicos.
- `bun test` en `apps/engine`: **547/547 verde**. `bunx tsc --noEmit`: limpio en `apps/engine` y
  `apps/web`. `bash scripts/verify-simplicity.sh`: PASS.
- `ENABLE_PRO_DRAFTER` sigue apagado. `apps/web` sin cambios en toda la fase. Cero dependencia
  nueva.

## Qué YA existe (no reconstruir)

- `apps/engine/src/pro/types.ts` — contrato de tipos completo: `Confidence` (4 miembros:
  `high|medium|exploratory|none`), `ProSourceRef`, `ProTournament`, `ProDraftTurn`,
  `ProDraftSlot`, `ProDraft`. `source`/`confidence` son **obligatorios en todo el contrato**,
  nunca opcionales.
- `apps/engine/src/pro/types.test.ts` — 4 pruebas con `@ts-expect-error` que verifican que
  omitir `source`/`confidence`/`region` correcto no compila.
- `scripts/pro/schema.sql` — esquema SQL plano (sin Drizzle) para `apps/engine/data/pro-drafts.sqlite`
  (base solo-dev, ya en `.gitignore`, **nunca se despliega**): `tournaments`, `pro_drafts`,
  `pro_draft_turns`, `pro_draft_slots`, `ingest_checkpoint`. `CREATE TABLE IF NOT EXISTS`
  (idempotente, verificado). `pro_draft_slots` usa PK `(match_id, team, position_est)` — impone
  la invariante de "1 héroe por posición por equipo" a nivel de base.
- `docs/research/pro-data-sources.md` — matriz de 6 fuentes con mediciones reales (marcadas
  "medido" o "documentado, sin verificar"). **Leer antes de escribir cualquier script de
  ingesta** — ya contiene los números reales que los tickets citan (límites de OpenDota,
  distribución de tiers, cobertura de campos por endpoint).

## El ticket siguiente: `TSK-149`

Archivo completo: `docs/agents/tasks/TSK-149.md`. Resumen: crear
`scripts/pro/ingest-tournaments.ts` — cruza `/leagues` (tier+nombre) con `/proMatches` paginado
(cursor `less_than_match_id`) para derivar `firstSeenAt`/`lastSeenAt` de cada torneo (`/leagues`
**no tiene ningún campo de fecha**, verificado). Reutiliza `OpenDotaClient` de
`apps/engine/src/meta/opendota-client.ts` (retry 1s/4s/16s ya probado, no reimplementar fetch).
Script manual, nunca CI, nunca cron.

**Antes de dispatchear `TSK-149`**, revisar si alguna de las 10 decisiones de producto pendientes
(listadas en la sección "Decisiones que requieren aprobación" del plan original, y repetidas
dentro de cada ticket que bloquean) ya fue aprobada por el usuario en la conversación. Si no, las
que bloquean `TSK-149`/`TSK-150` específicamente son:
- **Volumen objetivo de ingesta** (¿1 parche `premium` para empezar, o más amplio?).
- **Ventana de parches** (ya resuelto en el diseño: se guarda `patch` por draft, se filtra en la
  consulta, nunca en la ingesta — no bloquea, es una nota para quien escriba el código).
- **Retirar `fetch-pro-drafts.ts`/`fetch-daily-pro-drafts.ts`** (recomendado: sí, absorbiendo su
  lógica probada — ver el propio `TSK-150.md` para el detalle exacto de qué reutilizar).

## Orden de dependencia real del resto de la fase (no es solo el orden numérico)

```
149 → 150 → 151 → 152 → 153 → 154 → 155 → 156 → 157 → 160 → 161
                                                              ↓ (solo si 161 pasa el gate)
                                                        158 → 159 → 162
```

Cada ticket es autocontenido (`docs/agents/tasks/TSK-XXX.md`) — trae contexto, alcance exacto,
reglas duras, criterios de aceptación y qué queda fuera de alcance. No hace falta releer esta
sesión para ejecutar cualquiera de ellos en orden.

## Reglas que no se negocian en ningún ticket de esta fase

- **`ENABLE_PRO_DRAFTER` no se toca.** Ningún ticket lo enciende.
- **`SignalId` / `SCORING_WEIGHTS_V1`-`V5` / `mix.ts` / `weights.ts` no se tocan** hasta
  `TSK-159` (Gate 4, condicional a que `TSK-161` pase el gate de evaluación).
- **`apps/web` no se toca** en ningún ticket de G1/G2/G3. Solo si G4 se activa.
- **Cero red en el camino caliente del motor.** Toda la ingesta es offline, scripts manuales.
- **`raw: null` nunca es `0` ni `0.5`** — regla dura heredada de `engine.md`, aplica a todos los
  agregados nuevos de `TSK-153`/`154`.
- **Ninguna prueba lee `pro-patterns.json`/`pro-drafts.sqlite`/`capabilities.json`/
  `hero-positions.json`/`pro-draft-corpus.json` reales** — siempre fixtures inyectados.

## Verificación estándar antes de cerrar cualquier ticket

```bash
cd apps/engine && bunx tsc --noEmit && bun test
cd ../web && bunx tsc --noEmit && bun test
cd ../.. && bash scripts/verify-simplicity.sh
```

Y antes de dar por bueno el trabajo de otro agente (Codex incluido): **no aceptar el reporte sin
correrlo uno mismo.** Ya pasó una vez en esta sesión que un reporte de fallos no se reprodujo
(carrera de puertos puntual), y una vez que un prompt con una contradicción interna hizo que
Codex omitiera correctamente una prueba que igual hacía falta agregar después.

## Bookkeeping al cerrar cada ticket (patrón ya establecido, seguir igual)

1. Frontmatter del ticket: `state: backlog → doing` (con `assigned_tool` fijado) → `done`, con
   una sección `## Cierre (fecha)` al final del archivo describiendo qué se hizo y qué se encontró.
2. Una línea nueva en `docs/agents/journal.md` (formato `- [YYYY-MM-DDTHH:MM] event:evt-... schema:v1
   tool:build ticket:TSK-XXX result:ok — ...`), **append-only, nunca se edita ni se borra una
   línea existente**.
3. `bun scripts/hub.ts` para regenerar `docs/agents/hub.html`.
4. Un commit por ticket (o por cluster de tickets inseparables, documentando por qué se combinaron
   — ver los commits de Fase 6 reconstruidos en `TSK-146` como ejemplo real de ese criterio).

## Este mismo archivo

Se puede borrar una vez que la fase avance lo suficiente como para que ya no haga falta — es un
documento de transición, no una fuente de verdad permanente (esa sigue siendo `journal.md` +
`docs/agents/tasks/*.md`).
