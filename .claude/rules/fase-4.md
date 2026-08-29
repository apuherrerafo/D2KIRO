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

