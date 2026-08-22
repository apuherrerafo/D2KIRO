# CONTEXT.md — glosario de dominio y stack

Mantenido por `/gear-up` (stack) y `/grill-me` (glosario, en el momento en que un término queda
claro durante una entrevista — no al final). `CLAUDE.md`/`docs/agents/architecture.md` son la
fuente canónica si hay discrepancia; esto es la versión de referencia rápida.

## Stack (decisión cerrada en `/blueprint`, fase 1 — no re-preguntar)
Dos procesos locales, no uno: `apps/engine` (Bun — motor de sugerencias, WebSocket, SQLite,
`127.0.0.1` únicamente) y `apps/web` (Next.js App Router, TypeScript estricto, RTK Query + Tailwind
+ shadcn/ui, WebSocket+Zustand solo para el draft en vivo). SQLite + Drizzle ORM. Bun Test.
Railway. Detalle completo en `CLAUDE.md` § STACK ACTUAL y `docs/agents/architecture.md`.

## Glosario de dominio (Dota 2 / draft)

| Término | Significado en este proyecto |
|---|---|
| **Draft** | Secuencia de picks/bans antes de una partida de Dota 2. Este proyecto sugiere en tiempo real durante ese proceso, no juega por el usuario. |
| **Captain Mode / All Pick** | Dos formatos de draft con órdenes de pick/ban distintos (`DraftFormat`, dato — nunca lógica adivinada del reductor). `format: 'unknown'` es un estado legítimo, el motor sigue sugiriendo igual. |
| **Capturador** | La pieza que emite eventos de draft reales hacia el motor. `simulator` y `manual` son de primera clase en fase 1; `overwolf`/`ocr` son contrato, no construidos aún. |
| **Posición (1-5)** | hard support (5), support (4), offlane (3), midlane (2), carry (1) — dato real curado en `hero-positions.json`, nunca `roles[]` de OpenDota (esas son etiquetas temáticas, no posición de línea). Terminología visible siempre con el nombre en castellano al lado del número. |
| **`SignalScorer`** | Función pura `(DraftState, HeroId, MetaSnapshot) → SignalContribution`. Cada señal (counter, patch_meta, team_synergy, hero_pool_fit, position_fit) vive en su propio archivo, se prueba sola. |
| **`raw: null`** | "Sin datos suficientes" — nunca vota neutro (0/0.5). Su peso se redistribuye proporcionalmente entre las señales con dato. |
| **`applicable: false`** | Exclusivo de `hero_pool_fit` — significa "el usuario nunca configuró esta función", no "hueco de datos". No dispara `partial_signals`. Nunca confundir con `raw: null`. |
| **`SCORING_WEIGHTS_V{N}`** | Constante de pesos del motor, versionada por nombre, congelada al promover la siguiente. **V5 es la activa** (`position_fit: 0.38, counter: 0.24, patch_meta: 0.13, team_synergy: 0.13, hero_pool_fit: 0.12`) — ver `apps/engine/src/signals/weights.ts`. |
| **`position_fit`** | Señal que reemplazó `role_gap`+`role_safety` en Fase 3 — cobertura de posición del equipo propio, nunca filtro duro, siempre ponderada. |
| **`degraded: 'partial_signals'`** | El cálculo del motor se cortó a los 500ms duros; se devolvió lo que había, nunca se bloqueó el push. |
| **`degraded: 'stale_meta'`** | La sincronización con OpenDota falló (429/caída); se sigue sirviendo el cache viejo, un draft nunca se queda sin sugerencias por una API de terceros caída. |
| **`hero_pool_fit`** | Señal de comodidad personal (fase 1b) — pool de hasta 5 héroes, a mano o calculado desde partidas reales de OpenDota (nunca auto-aplicado). |
| **`account_id`** | Steam32 del usuario — primer dato personal del proyecto. Nunca se loguea ni se eco en error/journal/ticket. |
| **`draft_event/v1` / `draft-ws/v1`** | Contratos versionados del reductor de estado (`applyDraftEvent`) y del canal WebSocket (`ServerMessage`/`ClientMessage`). |
| **Win condition / "le falta al draft"** | Terminología correcta de "caminos de draft" (Fase 2). **Nunca** "needs-based drafting" — no es el término real que usa la comunidad competitiva. |
