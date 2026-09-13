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


---

## Detalle histórico completo (movido desde `.claude/rules/engine.md` — R0.4 Task 24)

## Fase 4.3 — `archetype_fit` usable: transporte de la intención (server/) — SPEC.md §11.14

Hace usable la señal que 4.2 dejó integrada pero inerte. Toca `apps/engine/src/server/`, nunca
`signals/`.

- **`SessionStore` gana `archetypeIntent: DraftPathArchetype | null` por sesión** (default `null`),
  mismo patrón exacto que `ownerAccountId`: `setArchetypeIntent(sessionId, intent)` /
  `archetypeIntent(sessionId)`. El merge de `applyDraftEvent` lo preserva igual que
  `ownerAccountId` (`?? null`). **No se persiste en SQLite** — vive en memoria, TTL 45 min.
- **`ClientMessage.type` gana `"set_intent"`** (junto a `"hello"`/`"ping"`). Payload:
  `{ sessionId, archetypeIntent: DraftPathArchetype | null }`. `import type { DraftPathArchetype }
  from "../draft-paths/types"` es import directo legítimo (mismo proceso), no espejo a mano.
- **`isValidClientMessage` gana la rama `set_intent`**: `sessionId` string no vacío **y**
  `archetypeIntent ∈ {"push","teamfight","pickoff","scaling", null}`. Un `set_intent` malformado
  se descarta en silencio (`return`), igual que cualquier `ClientMessage` inválido (TSK-010).
- **`SuggestionsPreviewRequest` gana `archetypeIntent?: DraftPathArchetype`** (9º campo, opcional).
  `isValidSuggestionsPreviewRequest`: si está presente y no es uno de los 4 literales → body
  inválido → `400` (mismo criterio que `targetPosition`).
- **`computeSuggestionsForState` gana `archetypeIntent?` en `options`**, se pasa tal cual a
  `buildSuggestions`. **Todos** los caminos en vivo (`hello`, push tras cada `/ingest/draft-event`,
  reconexión) leen `sessionStore.archetypeIntent(sessionId)` y lo pasan. `handleSuggestionsPreview`
  lo toma de `body.archetypeIntent`. `computeV5Fallback` (ruta `pro-drafter.ts`) **no cambia**.
- **El handler de `set_intent`**: sobre una sesión suscrita → `setArchetypeIntent(...)`; **si el
  valor cambió**, recalcula y publica **sólo `suggestions`** (no `snapshot`, no `draft_state` — el
  tablero no cambió). Si el valor es igual al almacenado, **no-op** (guarda de idempotencia). Esto
  es una excepción explícita al orden de push `draft_state` → `suggestions`, igual que
  `draft_paths` ya lo es.
- **4.3 no toca `SCORING_WEIGHTS_V6` ni ningún archivo de `signals/`.** Si el QA de calibración
  (§11.14.8) pide otro `w`, es un follow-up que acuña `SCORING_WEIGHTS_V7` con la misma estructura
  `V5 × (1 − w)` y su candado de regresión cero re-corrido.

