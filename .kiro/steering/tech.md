# tech — dota2coach, Fase 1 (Draft Coach)

Espejo de `docs/specs/SPEC.md` y `docs/agents/architecture.md` (Bloque 5) para lectura nativa en
Kiro. `CLAUDE.md` es la fuente canónica si hay discrepancia.

## Stack
- **Runtime motor**: Bun (`apps/engine`) — WebSocket y SQLite nativos, arranque rápido. Instalado
  desde TSK-001.
- **Frontend**: Next.js (App Router), TypeScript estricto, Tailwind + shadcn/ui.
- **Datos del sitio**: RTK Query. **Draft en vivo**: WebSocket + Zustand (única excepción).
- **DB**: SQLite + Drizzle ORM.
- **Meta externa**: OpenDota API (sin API key en su nivel gratuito). Fase 1b agrega
  `/players/{account_id}/heroes` (mismo cliente, sin key) — primer punto donde el proyecto guarda
  un dato personal (el `account_id`), ver `.claude/rules/security.md`.
- **Testing**: Bun Test.
- **Despliegue**: Railway.

## Rendimiento (SPEC §4) — presupuesto por tramo
| Tramo | Presupuesto |
|---|---|
| Captura → `POST /ingest` | ≤ 500 ms |
| Validación + reductor | ≤ 20 ms |
| Motor de sugerencias | ≤ 300 ms (corte duro 500 ms) |
| Push WebSocket | ≤ 50 ms |
| Render frontend | ≤ 150 ms |
| **Total observado** | **≤ 1 s** (margen contra criterio de 2-3 s) |

Regla que lo sostiene: **cero red en el camino caliente** — las ~120 filas de héroes y sus
enfrentamientos ya están en SQLite local antes del primer pick.

## Comandos
- `bun run dev` — servidor de desarrollo.
- `bun test` — pruebas unitarias.
- `bun run lint` — formateo.
- `bash scripts/verify-simplicity.sh` — verificación de límites.
- `bun scripts/hub.ts` — tablero Kanban desde tickets.

## Convenciones de código (heredadas, sin excepción)
TypeScript estricto sin `any`, sin ternarios para renderizado condicional, sin funciones
anónimas, un componente una responsabilidad, lógica >~20 líneas a un hook de la feature,
arquitectura por features (`index.ts`, componente, `styles.ts`, `constants.tsx`, `types.ts`).

## Dependencias nuevas
Ninguna sin pasar por `/gear-up` o `@depcheck` — incluida la biblioteca de validación de esquemas
que SPEC §7.3 deja abierta a propósito.
