---
name: dispatch
description: Enrutador único del ecosistema — automático (analiza intención) o manual (el usuario elige el flujo). Sustituye y fusiona lo que antes eran @router y /dispatch.
---

# /dispatch — Enrutador de Construcción (auto + manual)

## PROPÓSITO
Recibir una petición del usuario y enrutarla al flujo correcto, ya sea porque el usuario invoca `/dispatch` explícitamente (modo manual, con confirmación) o porque el propio agente detecta la necesidad de enrutar automáticamente en medio de una tarea (modo automático, antes conocido como `@router`).

## ALIAS SIMPLES (los únicos 6 nombres que el usuario necesita recordar)
No le pidas a un diseñador de producto que memorice 25 nombres de skill. Reconoce estos 6 alias como entrada válida, siempre, y decide tú internamente cuál skill específica corresponde según `docs/agents/PROGRESS.md`:

| Alias | Resuelve a (según fase actual) |
|---|---|
| `/start` | `/onboarding` si el repo ya existe, `/launchpad` si es nuevo |
| `/plan` | `/kickoff` si no hay brief todavía, `/pre-flight` si hay brief sin arquitectura, `/blueprint` si ya hay respuestas completas de `/pre-flight` |
| `/build` | `@build` (ejecución normal) |
| `/fix` | `@root-cause` |
| `/review` | `@redteam` |
| `/ship` | `@shipcheck` → `/castoff` en secuencia |

El usuario puede seguir usando los nombres específicos si los conoce — los alias no los reemplazan, solo evitan que tenga que aprenderlos todos antes de poder trabajar. `/compass`, cuando explica el "loop de todos los días", usa estos 6 nombres, no los 25.

## MODO AUTOMÁTICO (sin invocación explícita)
Clasifica la intención del mensaje del usuario:
- "crear", "iniciar", "nuevo" → `/launchpad` o `/pre-flight`. Si trae ideas sueltas sin organizar todavía, `/kickoff` primero.
- "arreglar", "bug", "error" → `@root-cause`.
- "mejorar", "optimizar" → `@loop`.
- "diseñar", "interfaz", "UI" → `/design-forge` o Artisan.
- "probar", "verificar" → Warden o `@shipcheck`.
- "documentar", "especificar" → Chronicle o `/blueprint`.
- "desplegar", "deploy", "producción" → `/castoff`.
- "esto ya existe", "proyecto existente", "integrar en mi repo" → `/onboarding`.
- "arquitectura", "deuda técnica", "por qué está tan enredado esto" → `/foundation-check`.
- "no me acuerdo qué skill usar", "estoy perdido", "qué existe en este ecosistema" → `/compass` (guía interactiva, no ejecuta nada por ti).
- "déjalo corriendo toda la noche", "mándaselo a Hermes", "esto puede esperar a mañana" → `/nightwatch` (nunca de oficio, solo si lo piden).
- Si no está seguro, pregunta: "¿Qué quieres hacer exactamente?" — nunca adivina en tareas con impacto en producción o seguridad.

## MODO MANUAL (invocación explícita `/dispatch`)
- Verifica `docs/agents/plan.md`.
- Si la tarea no es prioritaria (no está en el top 3 Must-have), pregunta antes de continuar.
- Clasifica la petición con la misma tabla del modo automático.
- Si la tarea requiere revisión crítica (según `plan.md` o si toca datos sensibles/endpoints): `@build` → `@redteam` (máx. 3 rondas) → si involucra deploy, `/castoff`.
- Si falla 3 veces → Tracer.
- Al terminar, invoca `@shipcheck`.
- Respeta WIP=1 y los límites estrictos de archivos y dependencias.

## CONTEXTO MÍNIMO VIABLE PARA CODEX (Codex no es una caja negra perfecta)
Codex no lee `journal.md` ni `architecture.md` — si el ticket asume una convención de nombrado o de dominio que solo vive ahí, Codex va a inventar nombres y fallar en silencio. Cada vez que asignes `tool: codex` a un ticket:
1. Copia al cuerpo del ticket (no solo referencia la ruta) las 3-5 líneas más relevantes de `architecture.md`/`SPEC.md` que definen el vocabulario de dominio que ese ticket necesita (nombres de columnas, convenciones, entidades).
2. Si el ticket nace de un fallo de CI/build, incluye el último mensaje de error tal cual, no un resumen.
3. No copies el contexto completo — sería quemar la ventaja de tickets acotados. Solo lo mínimo para que Codex no adivine.

## DEGRADACIÓN CONTROLADA — patrón "Handoff" (sin créditos en la herramienta asignada)
Inspirado en el patrón Handoff de orquestadores multi-agente reales, pero sin tmux ni infraestructura extra — nuestro `journal.md` append-only ya hace de bus de mensajes entre herramientas.

Si el usuario dice algo como "no tengo créditos en Codex" o "mejor síguelo tú": no insistas, no le repitas la asignación original.
1. Cambia `assigned_tool` (no `preferred_tool`, esa se conserva como intención original) a la alternativa disponible ahí mismo (normalmente `claude-code`, salvo que también digan que ese tampoco tiene crédito).
2. Anexa una línea al `journal.md`: qué herramienta se quedó sin crédito, en qué punto exacto de la tarea, y qué recibe la herramienta de reemplazo. Así, si más tarde vuelve la herramienta original, no repite trabajo ni pierde el hilo.
3. Continúa la tarea de inmediato con lo que sí está disponible — el usuario ya te dijo qué prefiere, no le preguntes otra vez.
4. Si ninguna herramienta tiene crédito, dilo directo y ofrece hacer solo el análisis/plan en texto para que lo ejecuten después.

## DECISIÓN DE assigned_tool (no uses preferred_tool a ciegas)
`preferred_tool` es la intención de `/grill-me` al crear el ticket — no la decisión final. Antes de ejecutar cualquier ticket, revisa si `assigned_tool` ya está fijado (si sí, respétalo salvo que algo cambió). Si está en `null`, decide `assigned_tool` evaluando:
- **Alcance actual**: ¿el ticket creció más de lo que parecía al crearlo?
- **Sensibilidad**: ¿toca auth, pagos, datos de producción? Eso empuja hacia `claude-code` aunque `preferred_tool` dijera `codex`.
- **Necesidad de memoria**: ¿necesita `journal.md`/`architecture.md` para tener sentido? Si sí, `codex`/`kiro-nativo`/`hermes-vps` quedan descartados.
- **Créditos disponibles**: ver patrón Handoff, abajo.
- **Duración estimada y reversibilidad**: tareas largas y reversibles son mejores candidatas para `hermes-vps`/`codex`; tareas cortas e irreversibles, para `claude-code` con supervisión.
Escribe el resultado en `assigned_tool` del frontmatter — así el ticket conserva ambos: la intención original y la decisión real, sin perder trazabilidad.

## HEURÍSTICA DE ASIGNACIÓN (qué herramienta encaja mejor, sin superlativos no verificados)
- **`kiro-nativo`**: planificación estructurada (requirements/design/tasks), tareas que se benefician de paralelización nativa por dependencias, o cualquier cosa que un hook de guardado ya resuelve sin pasar por un agente.
- **`claude-code`**: refactors que tocan múltiples archivos y sitios de llamada, cualquier tarea que necesite las skills/agentes/gates de este ecosistema, o seguimiento estricto de reglas largas (`CLAUDE.md`).
- **`codex`**: tareas acotadas y bien especificadas en terminal, migraciones puntuales, iteración rápida de test-fix — y la alternativa natural sin costo marginal cuando se agotan créditos de las otras dos. Dentro de `codex` mismo, no todo pesa igual: ver "Política de Modelos" en `CLAUDE.md` para la sub-distinción entre completado rápido, bug de lógica oculta, y tareas de lote.

## LÍMITES
- Prohibido refactorizar archivos no relacionados.
- Prohibido añadir dependencias sin permiso.
- No ejecutes código directamente: enruta, no implementes.
