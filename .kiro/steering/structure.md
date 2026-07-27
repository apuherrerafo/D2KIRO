# structure — dota2coach, Fase 1 (Draft Coach)

Espejo de `docs/specs/SPEC.md` §2-3 para lectura nativa en Kiro. `CLAUDE.md` es la fuente
canónica si hay discrepancia. **Nota de estado**: `apps/web` y `apps/engine` no existen todavía
en el repo (ver `docs/agents/tasks/TSK-001.md`).

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

## API (SPEC §3)
- HTTP: `POST /ingest/draft-event`, `GET /api/health`, `GET /api/heroes`, `GET /api/meta/status`,
  `POST /api/meta/sync`, `POST /api/session/manual` — todo en `apps/engine`, solo `127.0.0.1`.
- WebSocket: `/ws/draft` — `ServerMessage`/`ClientMessage` tipados, schema `draft-ws/v1`.

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
