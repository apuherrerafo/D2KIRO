## REGLAS DE FASE 4 (sub-ticket 4.1 — señal `archetype_fit`) — desde `docs/specs/SPEC.md` §11
Generadas por `/rulebook`, cuarta ejecución del proyecto. **Alcance deliberadamente parcial**: solo
el sub-ticket 4.1 pasó por `/blueprint` — las otras 3 piezas de la fase y los sub-tickets 4.2-4.8
quedan documentados a nivel conceptual (sin números) hasta que cada uno tenga su propio
`/blueprint`. Detalle completo en `.claude/rules/` (secciones "Fase 4" en `engine.md`,
`security.md`, `testing-seams.md`) — esta sección son los puntos que no se pueden violar sin
romper el contrato de 4.1, resumidos:

- **`archetypeFitBonus` se reutiliza desde `draft-paths/build-paths.ts`, nunca se reimplementa.**
  El concepto de arquetipo (`push`/`teamfight`/`pickoff`/`scaling`) ya existía en el motor desde
  Fase 2 ("Caminos de draft") — el diseño original de esta fase iba a curar un
  `archetype-affinity.json` nuevo; se descartó al descubrir la función existente.
- **La normalización a `[0, 1]` ocurre dentro de `archetype-fit.ts`, nunca en `RAW_RANGE` de
  `mix.ts`.** `archetypeFitBonus` no tiene escala uniforme entre arquetipos (0-2 salvo pickoff,
  0-3) — un solo rango en `RAW_RANGE` no puede servir para los cuatro sin normalizar antes.
- **`SignalId` NO se amplía en 4.1** — haría que `SCORING_WEIGHTS_V4`/`V5` (congeladas, `Record`
  totales) dejen de compilar. 4.1 usa una vista de tipo derivada que desaparece sola en 4.2.
- **`capabilities.json` no tiene cobertura completa** (124/126 héroes) — la rama `raw: null` por
  falta de dato es alcanzable hoy, no defensiva. No se completa en 4.1.
- **4.1 no toca `mix.ts`, `weights.ts` ni `apps/web`** — el motor no cambia de comportamiento
  todavía. `SCORING_WEIGHTS_V5` sigue siendo la única activa.
- **Hallazgo real, fuera de alcance**: `team_synergy` devuelve `raw: 0` (no `null`) para un héroe
  sin capacidades — viola la regla dura de `engine.md`. Ticket aparte, no se corrige en 4.1.


---

## Detalle histórico completo (movido desde `.claude/rules/engine.md` — R0.4 Task 24)

## Fase 4 — `archetype_fit` (S3, sub-ticket 4.1) — SPEC.md §11

Esta fase tiene 4 piezas (intención de draft, sinergia en cadena, denial de composición,
diversificación); **solo la pieza 1 (sub-ticket 4.1) pasó por `/blueprint`** — las reglas de acá
son las de 4.1 únicamente. Las piezas 2-4 quedan al nivel conceptual de `architecture.md`, sin
números, hasta que cada una tenga su propio `/blueprint` (SPEC.md §11.10).

- **`DraftPathArchetype` (`push`/`teamfight`/`pickoff`/`scaling`, `draft-paths/types.ts`) se
  reutiliza tal cual como tipo de la intención de draft** — no se duplica un tipo nuevo. Import
  directo entre `signals/` y `draft-paths/` es legítimo (mismo proceso, `team-synergy.ts` ya lo
  hace); la regla de "espejo a mano" es exclusiva de la frontera `apps/engine` ↔ `apps/web`.
- **`archetypeFitBonus` se reutiliza, nunca se reimplementa.** Pasa de función privada a exportada
  en `draft-paths/build-paths.ts` (una línea, sin cambiar firma ni cuerpo) — `archetype-fit.ts` la
  importa. Una segunda copia de esa fórmula es rechazo automático de revisión.
- **La normalización de `raw` a `[0, 1]` ocurre DENTRO del scorer, nunca en `RAW_RANGE` de
  `mix.ts`.** `archetypeFitBonus` no tiene una escala uniforme entre los 4 arquetipos (`0..2` para
  push/teamfight/scaling, `0..3` solo para pickoff, que suma dos booleanos en vez de leer un
  `CapabilityLevel`) — `RAW_RANGE` es un rango único por señal, no por arquetipo, así que ningún
  valor sirve para los cuatro sin normalizar antes.
- **`archetype_fit` no depende de `DraftState` ni de `MetaSnapshot`** — `raw` es constante por par
  `(intent, hero)` durante todo el draft. No es un descuido: es la primera señal del motor que
  discrimina candidatos con el draft vacío (las otras cinco necesitan picks propios/rivales o un
  pool configurado para votar con fuerza en el pick #1).
- **Dos resultados posibles, nunca un tercero inventado**: sin intención elegida →
  `raw: null` **y** `applicable: false` (nunca un número); candidato sin entrada en las
  capacidades inyectadas → `raw: null`, `applicable` ausente/`true` (nunca `applicable: false` por
  falta de dato — ese campo es exclusivo de "función no configurada", igual que `hero_pool_fit`).
- **`capabilities.json` NO tiene cobertura completa** (corrección real de `/blueprint`, verificada
  contra el archivo): 124 entradas contra 126 héroes en `hero-positions.json` — faltan `131`,
  `145`, `155`. La rama `raw: null` por falta de dato es alcanzable con el dato real de hoy, no
  defensiva. No se completa en 4.1 — es trabajo de dominio del usuario, ticket aparte.
- **`SignalId` NO se amplía en 4.1.** Ampliarlo rompería la compilación de `SCORING_WEIGHTS_V4`/
  `V5` (`Record<SignalId, number>` totales, ambas congeladas) y de `RAW_RANGE`/`SIGNAL_LABELS`.
  4.1 usa una vista de tipo derivada (`Omit<SignalContribution, "signal"> & { signal:
  "archetype_fit" }`) que compila hoy y desaparece sola en 4.2. Antes de ampliar `SignalId` en
  4.2, V4 y V5 pasan primero a tiparse con sus propios literales históricos (mismo mecanismo que
  V1/V2/V3 ya usan) — así una versión congelada no queda acoplada a qué señales existen hoy.
- **4.1 no toca `mix.ts`, `weights.ts` ni `apps/web`.** El motor no cambia de comportamiento
  todavía — `SCORING_WEIGHTS_V5` sigue siendo la única activa hasta 4.2.
- **Hallazgo real, fuera de alcance de 4.1 pero anotado**: `team_synergy` devuelve `raw: 0` (no
  `raw: null`) para un héroe sin capacidades — viola la regla dura de este mismo archivo ("`raw:
  null` nunca es 0 ni 0.5") y hoy se dispara con los mismos 3 héroes sin entrada en
  `capabilities.json`. Necesita su propio ticket, no se corrige de paso en 4.1.

