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

## Arquitectura de pesos del motor de sugerencias (`apps/engine/src/signals/weights.ts`)
Versionado por nombre, congelado por versión — cambiar la calidad de las sugerencias es editar
una constante nueva, nunca reescribir el motor ni editar una versión ya congelada (V1-V4 no se
tocan nunca; solo se lee la que está activa). Cada versión tiene su candado de suma == 1.0 en
`mix.test.ts`.

**`SCORING_WEIGHTS_V5` es la constante activa** (auditoría 2026-08-22, TSK-065):
`position_fit: 0.38, counter: 0.24, patch_meta: 0.13, team_synergy: 0.13, hero_pool_fit: 0.12`.
V5 no agrega ni quita señales respecto a V4 (`position_fit`/`counter`/`patch_meta`/
`team_synergy`/`hero_pool_fit`) — solo redistribuye peso, tras confirmar por cálculo exacto que un
hard counter real (delta ~0.08, con `RAW_RANGE.counter` recalibrado a `[-0.12, 0.12]`) reducía el
margen de `position_fit` sobre un core que repite rol a solo ~1.5 puntos. El peso, no la fórmula,
es el único lever real: `normalize()` es una transformación lineal, así que reescribir `raw` sin
tocar el peso no cambia el resultado final — mismo patrón que ya forzó el reemplazo de `role_gap`
por `position_fit` en Fase 3.

`apps/engine/src/tools/batch-harness.ts` (standalone, nunca corre desde `apps/engine` en runtime)
valida el motor real a escala — N drafts sintéticos con PRNG determinista contra
`buildSuggestions()` directo, sin red ni SQLite. Es lo que hizo medible este hallazgo; el Random
Draft Simulator (`apps/web`) no sirve para esto porque su bot tiene su propio scoring, no usa
`buildSuggestions`.

## Convenciones de código (heredadas, sin excepción)
TypeScript estricto sin `any`, sin ternarios para renderizado condicional, sin funciones
anónimas, un componente una responsabilidad, lógica >~20 líneas a un hook de la feature,
arquitectura por features (`index.ts`, componente, `styles.ts`, `constants.tsx`, `types.ts`).

## Dependencias nuevas
Ninguna sin pasar por `/gear-up` o `@depcheck` — incluida la biblioteca de validación de esquemas
que SPEC §7.3 deja abierta a propósito.
