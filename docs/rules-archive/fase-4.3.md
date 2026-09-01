## REGLAS DE FASE 4.3 (`archetype_fit` usable: selector + transporte) — desde `docs/specs/SPEC.md` §11.14
Generadas por `/rulebook`. `/blueprint` corrido en Sonnet por decisión explícita del usuario
(2026-08-28), anotada en `journal.md`. Alcance: hacer usable la señal que 4.2 dejó integrada pero
inerte — selector de intención en `apps/web` + transporte de esa elección al motor + validación de
borde + QA de calibración. Detalle en `.claude/rules/` (secciones "Fase 4.3" en `engine.md`,
`web.md`, `security.md`, `testing-seams.md`) — resumen de lo no negociable:

- **Transporte = mensaje WS `set_intent` + `SessionStore.archetypeIntent` por sesión**, mismo
  patrón que `ownerAccountId`. `computeSuggestionsForState` lo lee del store, así **todos** los
  caminos en vivo (hello, cada draft-event, reconexión) lo respetan sin tocarlos uno por uno.
  **Sin ruta HTTP nueva.** `POST /api/suggestions/preview` gana `archetypeIntent?` opcional en su
  contrato (lo usa el bot/panel, no la vista en vivo).
- **Nueva frontera de confianza**: `archetypeIntent` llega del cliente → se valida en el borde
  contra la unión cerrada de 4 literales (`isValidClientMessage` rama `set_intent`,
  `isValidSuggestionsPreviewRequest`) **antes** de tocar `SessionStore`/`buildSuggestions`.
  Inválido → mensaje descartado (WS) o `400` (HTTP). Cierra el hallazgo #2 de `@redteam` en
  TSK-180 (`raw: NaN`). `@redteam` obligatorio.
- **El selector aparece también en `esperando_draft`** (fijar dirección antes del pick #1),
  además de `activo`/`degradado`. Componente nuevo `<DraftIntentSelector>` — color por rol
  semántico + escala de 4 px, ni un hex/px suelto. Terminología: "intención de draft", "Push /
  Teamfight / Pickoff / Scaling"; nunca "arquetipo" a secas en texto visible.
- **`set_intent` dispara sólo `suggestions`** (el tablero no cambió) — excepción explícita al
  orden de push, como `draft_paths`. `set_intent` con el mismo valor almacenado es no-op.
- **La intención vive en `SessionStore` (memoria, TTL 45 min)**, nunca en SQLite, nunca logueada.
  Sobrevive reconexión del cliente; un reinicio del motor la pierde (el cliente la re-envía tras
  `hello`).
- **4.3 no toca `signals/` ni `SCORING_WEIGHTS_V6`.** Si el QA (§11.14.8) pide otro `w`, follow-up
  que acuña `SCORING_WEIGHTS_V7` con la misma estructura `V5 × (1 − w)` y su candado de regresión
  cero re-corrido.
- **Costura S5** (ya existente), ninguna nueva. Un solo ticket, `simplicity_exception: true`
  (~10-12 archivos: `server/` + transporte y componente en `apps/web`). El QA de calibración es un
  paso manual dentro del mismo ticket.

