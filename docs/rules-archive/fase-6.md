## REGLAS DE FASE 6 (Formalizar Pro-Drafter: apertura consciente de bans) — desde `docs/specs/SPEC.md` §13

Generadas por `/rulebook`, sexta ejecución del proyecto. Alcance: darle al motor Pro-Drafter (ya
construido, dark detrás de `ENABLE_PRO_DRAFTER`) un camino real de apertura de equipo, que hoy no
existe (`TOP_N=3` hardcodeado, `denial_score` degrada a null sin picks rivales). Detalle completo
en `.claude/rules/` (secciones "Fase 6" en `engine.md`, `security.md`, `testing-seams.md`,
`web.md`) — esta sección son los puntos que no se pueden violar sin romper el contrato, resumidos:

- **`SignalId`/`SCORING_WEIGHTS_V1`-`V5` no se tocan.** Toda dimensión nueva vive en
  `pipeline/merge.ts`'s `PipelineSignalId`, ya separado — el término ban-aware alimenta el `raw`
  de `denial_score`, no agrega una cuarta clave.
- **`intent/denial-score.ts` no se edita.** Se formaliza reutilizándolo contra héroes baneados
  (nuevo `pipeline/ban-relief.ts`), nunca reimplementando la fórmula.
- **Sin tabla `heroSynergy` ni recolección de sinergia de aliados nueva** — mismo precedente que
  Fase 4 (OpenDota no expone ese endpoint, verificado dos veces).
- **Sin Python, sin runtime nuevo.** Bun/TypeScript únicamente, cero dependencia nueva.
- **`MAX_COUNTER_RELIEF` de `team-opener.ts` no se retira en esta fase** — sigue siendo el único
  camino de apertura con el flag apagado (el default). Su reemplazo depende del paquete de
  evidencia (`TSK-135`) y de un segundo `/blueprint`, más angosto.
- **`ENABLE_PRO_DRAFTER` sigue apagado por defecto durante toda la fase.** Ningún ticket de esta
  fase cambia el comportamiento observable de producción.
- **`POSITION_OVERLAP_GAIN=5` es un ancla matemática, no una perilla**: garantiza que un candidato
  sin dato de posición reproduzca exactamente el alivio plano actual. `BETA_OPENING=0.04` sí es una
  perilla de producto real, ajustable tras ver el resultado.
- **El umbral `MIN_MATCHUP_GAMES=200` recorta el 92.5% de los matchups reales** (1200 de 15984
  filas) — la causa raíz de "los bans no mueven nada" no es solo el bono chico, es que el dato que
  lo dispara casi nunca existe.
- **El candado de sensibilidad (dos conjuntos de bans producen un top-5 medible mente distinto) se
  prueba contra el pipeline completo, nunca contra el adaptador aislado** — mismo criterio que ya
  exigen Fase 3 y Fase 5.
- **`openingStrategy` tiene una sola implementación**, movida a `draft-paths/strategy.ts` — una
  segunda copia es rechazo automático de revisión.

