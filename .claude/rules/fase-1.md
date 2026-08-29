## REGLAS DE FASE 1 (dota2coach) — desde `docs/specs/SPEC.md`
Generadas por `/rulebook` a partir del contrato de desarrollo. Detalle completo y condicional por
tipo de archivo en `.claude/rules/` (`engine.md`, `web.md`, `security.md`, `testing-seams.md`) —
esta sección son los puntos que no se pueden violar sin romper el contrato, resumidos:

- **Cero red en el camino caliente**: el motor de sugerencias (`apps/engine`, C3) nunca llama a
  la red. Todo lo que necesita ya está en SQLite antes de que empiece el draft.
- **`apps/engine` solo en `127.0.0.1`.** Un binding a `0.0.0.0` es FAIL automático de revisión.
- **`raw: null` nunca es 0 ni 0.5.** Una señal sin datos suficientes no vota neutro — su peso se
  redistribuye proporcionalmente entre las señales que sí tienen dato.
- **Un `SignalScorer` que lanza excepción no tira el motor.** Esa señal cuenta como `raw: null`;
  las otras tres siguen. Corte duro a 500 ms de cálculo total.
- **`applyDraftEvent` es pura**: sin I/O, sin reloj ni ids propios — se inyectan como parámetros.
  Un evento rechazado nunca tira la sesión (se devuelve `RejectionReason`, el estado anterior sigue
  siendo válido).
- **Orden de push por WebSocket, siempre**: `draft_state` antes que `suggestions`.
- **`POST /ingest/draft-event`** exige la cabecera `x-capture-token` (generada en runtime, leída de
  `process.env`) y limita a 20 eventos/segundo por sesión — el exceso se descarta con `429`.
- **`dangerouslySetInnerHTML` prohibido** en toda la app (`apps/web`). Los nombres de héroe de
  OpenDota son input externo, se tratan como texto no confiable.
- **`img_url` de héroe**: se valida que el host esté en la lista permitida del CDN de Valve antes
  de renderizar — nunca una URL arbitraria de la respuesta de la API.
- **Sincronización con OpenDota (S6) es transaccional por tabla.** Un 429/caída de OpenDota nunca
  deja un draft sin sugerencias — se sigue usando el cache viejo con `degraded: stale_meta`.
- **Los pesos de señales viven en una sola constante versionada** (`SCORING_WEIGHTS_V1`); una
  prueba unitaria verifica que suman `1.0`.
- **No se modela la tabla de turnos de Valve en fase 1** — el orden de bans vive como datos
  (`DraftFormat`), nunca como lógica adivinada en el reductor.

