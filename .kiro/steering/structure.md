# structure — dota2coach (Draft Coach) — Fase 3 en curso

Espejo de `docs/specs/SPEC.md` §2-3 (y §9 para fase 1b) para lectura nativa en Kiro. `CLAUDE.md` es
la fuente canónica si hay discrepancia. **Nota de estado (2026-08-20)**: `apps/web` y
`apps/engine` existen y fase 1 está completa (TSK-001 a TSK-016, done). Fase 1b (hero pool)
completa y validada (TSK-017 a TSK-026, done). Bloque de feedback directo de producto también
completo (TSK-027 a TSK-033, done). Fase 2 ("Draft en equipo": modo de party + equipos guardados +
timer del simulador + caminos de draft, TSK-034/035/036, más el Random Draft Simulator -- spec
nativo de Kiro, sin tickets propios) **completa** -- construida vía `/kickoff` + Codex/Claude Code,
sin `SPEC.md` propio, ver `.claude/rules/*.md` para el detalle real. El Random Draft Simulator
está verificado en navegador pero sin commitear ni pasar `@redteam` todavía -- en cola. **Deploy
real completo**: dota2coach en producción en Railway. **Fase 3 en curso**: "Posiciones reales en
el motor de sugerencias" -- planificación cerrada (`/kickoff` + `/pre-flight` + `/blueprint` +
`/rulebook`), contrato en `docs/specs/SPEC.md` §10, tickets TSK-043 a TSK-047 en backlog,
pendiente de ejecutar. Cambio central: `role_gap` y `role_safety` se fusionan en `position_fit`,
que usa posiciones reales (`hero-positions.json`) en vez de las etiquetas `roles[]` de OpenDota
-- 57% de los héroes están marcados "Carry" ahí, por eso el motor sugería doble carry. Ver
`docs/agents/PROGRESS.md` para el estado exacto.

## Monorepo — dos procesos locales
```
apps/engine (Bun)          — motor de sugerencias, reductor de estado, WebSocket, SQLite/Drizzle
apps/web (Next.js)         — sitio + vista de draft en vivo (única página vía WebSocket+Zustand)
```
El capturador le habla directo a `apps/engine` (HTTP loopback), nunca a `apps/web`.

## Componentes (SPEC §2)
- **C1 Capturadores**: `simulator`, `manual` (fase 1), `overwolf`, `ocr` (contrato, después).
- **C2 Sesión de draft**: reductor puro `applyDraftEvent`, sin predicción de reglas de Valve.
- **C3 Motor de sugerencias**: tubería de 5 etapas (candidatos → señales → mezcla → orden →
  explicación). Riesgo central del proyecto.
- **C4 Meta y persistencia**: SQLite/Drizzle, `MetaProvider` como única frontera hacia el motor.
- **C5 Frontend**: páginas normales (RTK Query) + vista de draft (WebSocket/Zustand).

## Costuras de prueba (S1-S6) — ver `.claude/rules/testing-seams.md` para el detalle completo
Se prueban antes que el comportamiento. Ningún componente se implementa sin su costura definida.

## API (SPEC §3, §9.5)
- HTTP fase 1: `POST /ingest/draft-event`, `GET /api/health`, `GET /api/heroes`,
  `GET /api/meta/status`, `POST /api/meta/sync`, `POST /api/session/manual`,
  `GET`/`PUT /api/settings` — todo en `apps/engine`, solo `127.0.0.1`.
- HTTP fase 1b: `GET`/`PUT /api/hero-pool`, `POST /api/hero-pool/calculate`.
- HTTP "Draft en equipo" (sin número de SPEC, ver `.claude/rules/engine.md`):
  `GET/POST /api/team-groups`, `GET/PUT/DELETE /api/team-groups/:id`,
  `GET /api/session/:id/draft-paths` (bajo demanda, **nunca** por WebSocket).
- WebSocket: `/ws/draft` — `ServerMessage`/`ClientMessage` tipados, schema `draft-ws/v1`. Orden de
  push siempre `draft_state` → `suggestions` — `draft_paths` queda deliberadamente afuera de este
  canal (ver arriba).

## Orden de tickets (SPEC §8) — frontera de dependencia
1. Esqueleto del monorepo + Bun instalado
2. Esquema SQLite/Drizzle
3. `OpenDotaClient` + sincronización de meta (S6)
4. `applyDraftEvent` puro + contrato de eventos (S1, S4)
5-8. Los 4 `SignalScorer` (S3) — uno por ticket
9. Mezcla, orden y explicación del motor
10. Servidor Bun: ingreso HTTP + WebSocket + seguridad
11. Simulador de draft + guiones de prueba
12. Vista de draft en Next.js (S5), 6 estados
13. Entrada manual y camino de degradación
14. Páginas del sitio (meta, héroes, configuración) con RTK Query

## Fase 1b — orden de tickets (SPEC §9.10), TSK-017 a TSK-026
Ninguno depende del spike de Overwolf — ambas líneas de trabajo avanzan en paralelo.
1. `TSK-017` — Migración `hero_pool` + claves de `settings`
2. `TSK-018` — `OpenDotaClient.getPlayerHeroes` + validación de `accountId`
3. `TSK-019` — Cálculo puro del pool propuesto (S7)
4. `TSK-020` — `GET`/`PUT /api/hero-pool` + escritura transaccional (S8)
5. `TSK-021` — `POST /api/hero-pool/calculate` + sus errores
6. `TSK-022` — `SignalScorer: hero_pool_fit` (S3)
7. `TSK-023` — `SCORING_WEIGHTS_V2` + `applicable` en `mix.ts` (candado de regresión cero)
8. `TSK-024` — Pantalla de configuración del pool (RTK Query)
9. `TSK-025` — Pantalla de propuesta/confirmación
10. `TSK-026` — `SignalBreakdown` con 5 señales
