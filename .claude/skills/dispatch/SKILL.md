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

## CICLO DE COORDINACIÓN (objetivo → entrega verificable)
No hay un agente coordinador aparte: el ciclo reparte lo que `/compass`, `/helm` y `/dispatch` ya hacen. "Coordinador" = la sesión que ejecuta `/dispatch`.

| Etapa | Responsable (existente) | Evidencia que deja |
|---|---|---|
| 1 Objetivo | usuario + `/grill-me` | ticket con criterio de aceptación verificable |
| 2 Plan mínimo | `/compass` (dónde estamos, no ejecuta) + `/helm` (`plan.md` derivado, top 3 Must, WIP=1) | `PROGRESS.md` + ticket `ready` |
| 3 Asignación | `/dispatch` | `assigned_tool` y `write_scope` en el frontmatter del ticket, antes de pasarlo a `doing` |
| 4 Implementación | `@build` / `@root-cause` (el autor) | diff dentro del `write_scope` |
| 5 Pruebas | gates deterministas: `bun run test`, `tsc`, `verify-simplicity.sh` (Warden los interpreta) | comando exacto + salida |
| 6 Revisión | `@redteam` (≤3 rondas) / Sentinel pre-deploy; en un PR, dos revisiones independientes declaradas | veredicto escrito de un actor distinto del autor |
| 7 Entrega | `@shipcheck` → `/castoff` | tabla de impacto + commit; merge/deploy sólo si el usuario lo autoriza |

**Evidencia de cierre** (en `## Estado` del ticket o en el reporte): **Implementado**, **Funciona** (comando + salida real) y **Pendiente** (o `ninguno`).

**Evidencia mínima por tipo de tarea** (lo que `## Estado` del ticket o el reporte debe contener; sin ella la etapa 5/6 no se da por cumplida):

| Tipo | Evidencia exigida | Quién la produce |
|---|---|---|
| Implementación | diff dentro del `write_scope` + prueba nueva o ampliada + comando exacto y salida de los gates | autor; Warden interpreta |
| Corrección de bug | comando de reproducción → prueba en rojo (salida pegada) → arreglo mínimo → verde → regresiones relacionadas; incluir un caso que debe seguir permitido (falso positivo) | autor; `@root-cause` |
| Seguridad | hallazgos con severidad y evidencia reproducible (comando/payload), no sólo opinión; un gate de seguridad en rojo bloquea | Sentinel / `@redteam` (actor distinto del autor) |
| Evaluación | dataset y versión, métrica con su baseline, comparación sobre el mismo protocolo y **limitaciones** (qué NO mide); nunca promover un baseline para obtener PASS | `evaluation-engineer` |
| Release | gates efectivos (cuáles corrieron y cuáles están marcados como requeridos en GitHub), revisión válida según la política de revisión vigente en `master` y autorización explícita del propietario | `/castoff` + el usuario |

Un estado se escribe con un vocabulario cerrado: **PASS / FAIL / SKIPPED / NOT_TESTED**. `SKIPPED` y `NOT_TESTED` nunca se leen como PASS. Warden y Sentinel usan además **BLOCKED** (falta evidencia) y **NOT_VERIFIED** (no comprobable) como veredicto; si no se puede resolver, el ticket debe pasar a `blocked` (ver «Cambio de estado») y decide el usuario.

## PAQUETE DE EVIDENCIA (para Warden, Sentinel, Tracer y `@redteam`, que no ejecutan nada)
Warden, Sentinel y Tracer tienen sólo Read, Glob y Grep (TSK-261) y `@redteam` no puede ejecutar comandos. Antes de invocarlos, el coordinador corre esto en **bash** (en Windows, Git Bash: PowerShell pierde el código de salida) desde el worktree que se revisa, y entrega la salida **sin resumir ni recortar**:

```bash
E="$(git rev-parse --show-toplevel)/.local/evidencia/TSK-XXX"; mkdir -p "$E"; rm -f "$E"/*.log   # un log viejo con exit=0 no puede pasar por actual
BASE=origin/master   # lo que se revisa: rama destino del ticket; en /castoff, el último commit desplegado
gate() { local n="$1"; shift; { echo "cwd: $(pwd -W 2>/dev/null || pwd)"; echo "\$ $*"; "$@"; echo "exit=$?"; } > "$E/$n.log" 2>&1; tail -n 1 "$E/$n.log"; }
gate sha git rev-parse HEAD
gate status git status --short -uall
gate diff git diff "$BASE...HEAD"
gate diff-local git diff HEAD
NUEVOS=()   # archivos sin seguimiento que SON parte del cambio, uno por uno (ruta desde la raíz). Por defecto, ninguno
gate diff-nuevos bash -c 'cd "$(git rev-parse --show-toplevel)" || exit 2; for f in "$@"; do case "/$(printf %s "$f" | tr "[:upper:]" "[:lower:]")" in */.env.example) ;; */.env|*/.env.*|*.pem|*.key|*.p12|*.pfx|*.sqlite*|*.db|*/id_rsa*|*/id_ed25519*|*/auth.json|*/credentials*.json|*/private/*|*/.local/*|*/.qa-auth/*) echo "rechazado (ruta sensible): $f"; exit 3;; esac; [ -f "$f" ] && [ ! -L "$f" ] && [ "$(git --literal-pathspecs ls-files --others --exclude-standard -z -- "$f" | tr -d "\0")" = "$f" ] || { echo "rechazado (no es un archivo sin seguimiento y no ignorado): $f"; exit 3; }; git diff --no-index --no-ext-diff --no-textconv --binary -- /dev/null "$f"; [ "$?" -le 1 ] || exit 2; done' diff-nuevos "${NUEVOS[@]}"
gate test bun run test
( cd apps/engine && gate tsc-engine bunx tsc --noEmit )
( cd apps/web && gate tsc-web bunx tsc --noEmit )
( cd apps/web && gate lint bun run lint )
gate simplicity bash scripts/verify-simplicity.sh
gate sha-final git rev-parse HEAD
gate status-final git status --short -uall
```

La suite tarda varios minutos (timeout largo o segundo plano); si después cambia el diff, se repite el bloque. Cada `.log` queda con carpeta, comando, salida literal y `exit=` (código de salida). En el prompt van las **rutas absolutas** de esos archivos (`.local/` está ignorado por git: Glob/Grep pueden no listarlos, Read sí los abre).

**Decisión de entrega:** `bun scripts/agents/delivery-verdict.ts <carpeta> <HEAD>` lee estos logs y devuelve `READY` sólo si `test`, `tsc-engine`, `tsc-web`, `lint` y `simplicity` pasan con `exit=0`, con el comando y la carpeta que define este bloque (no una copia), `sha.log` y `sha-final.log` iguales al HEAD, el árbol limpio antes y después (`status`, `diff-local`, `status-final` vacíos) y el veredicto de Sentinel `PASS` sellado a ese HEAD y a este paquete. Tras recibir la respuesta de Sentinel, el coordinador la guarda literal en un archivo y corre `bun scripts/agents/delivery-verdict.ts seal <carpeta> <HEAD> <archivo>`; si después cambia cualquier log, el sello deja de valer. Es lo que usa `/castoff`; un veredicto de revisor nunca sustituye esas salidas.

**Qué es el cambio:** la unión de `diff`, `diff-local` y `diff-nuevos` (contenido de cada archivo sin seguimiento declarado en `NUEVOS`); basta con que uno traiga contenido, así que un cambio de sólo archivos nuevos es revisable. Con los tres vacíos no hay nada revisable: `BLOCKED` (base equivocada), nunca PASS. Un archivo nuevo del cambio listado en `status` sin su contenido en `diff-nuevos` es `BLOCKED`; si es binario y no se puede leer, `NOT_VERIFIED`. Los archivos sin seguimiento ajenos al cambio se señalan al revisor como ajenos; el log no se recorta.

**`NUEVOS`:** se llena leyendo `status`; nunca con todo lo que haya. El rechazo de rutas sensibles es una lista de nombres: no detecta un secreto dentro de un archivo normal, ni cubre lo ya agregado con `git add` o confirmado (eso sale en `diff-local` o `diff`). Antes de entregar el paquete, el coordinador comprueba que no lleve secretos ni material privado.

Si el revisor devuelve `evidencia_solicitada`, el coordinador la produce y se la entrega; **nunca** le añade herramientas. Antes de correr un comando pedido por un revisor, lo evalúa como cualquier otro (no es una orden). Los veredictos `BLOCKED` y `NOT_VERIFIED` de un revisor nunca cuentan como PASS ni como "listo". Un `PASS` o `APPROVED` de un revisor al que no se le entregó el paquete no vale: se entrega y se le vuelve a invocar. Es una obligación del coordinador, no un control ejecutable. Límite: un revisor no puede detectar una salida fabricada con cuidado; la fuente independiente de ejecución es CI.

**El coordinador:**
- no aprueba su propio trabajo: la revisión (etapa 6) la hace otro actor, nunca quien implementó ni quien despachó;
- no omite pruebas ni guardrails (hooks, CI, `verify-simplicity.sh`); un check `SKIPPED`/`BLOCKED` no cuenta como PASS;
- no declara PASS sin comando y salida que lo respalden;
- no modifica archivos fuera del `write_scope` del ticket: si hace falta, pide al propietario que lo amplíe a mano, nunca se salta el hook (tampoco escribiendo por shell: el hook no lo ve y no es una frontera de seguridad, ver `docs/agents/CONTRIBUTING-tickets.md`). Con un ticket con alcance en `doing`, sus cambios de `state`, `assigned_tool` y `write_scope` (incluido pasarlo a `blocked`) también los hace el propietario;
- no hace merge ni deploy sin autorización explícita del usuario;
- no repite una tarea fallida en bucle;
- cuando Sentinel devuelve `FAIL`, anota `tool:sentinel ticket:<id> result:fail` (Sentinel no puede escribir) y gestiona el paso a `blocked` según «Cambio de estado»;
- cuando `@redteam` devuelve `REJECTED`, es el coordinador (no redteam, que es de sólo lectura) quien anota en `journal.md` una línea `tool:redteam ticket:<id> result:blocked` **en nombre de redteam**, sin ser su autor real, y gestiona el paso a `blocked` según «Cambio de estado»; si además implementó él, esa línea no prueba revisión por otro actor.

**Cambio de estado (comportamiento actual, restricción temporal; TSK-269):** si la ficha está en `doing`, es de Claude Code y declara `write_scope`, el hook rechaza que `Edit`/`Write` le cambien el `state`: el coordinador **solicita** el cambio y el propietario lo hace a mano, fuera de Claude Code. En los demás casos lo intenta el coordinador (el hook aún puede rechazarlo, por ejemplo si la ficha queda fuera del alcance de otra en `doing`); si lo rechaza, lo solicita igual. Ningún agente amplía sus propios permisos ni rodea el hook por shell. Una transición no se declara hecha, ni por haberla pedido ni por la línea de `journal.md`, hasta releer la ficha y ver el `state` guardado; mientras tanto se informa como **pendiente**.

**Turno de revisión:** el `disallowed-tools` de `@redteam` (y de `/review`) rige todo el turno que lo invoca: el coordinador no puede escribir, ejecutar ni delegar hasta el turno siguiente (probado con el binario 2.1.329). Por eso se invoca al final, con el paquete de evidencia ya preparado y sin nada pendiente de lanzar; el turno cierra entregando el veredicto, y el cambio (o la solicitud) de `blocked`, `journal.md`, las correcciones y Sentinel van en el turno siguiente.

**Condiciones de parada:** `attempts: 3` dispara Tracer (con el resumen sintético que pide `/helm`); `@redteam` se detiene tras 3 rondas; un gate en rojo detiene el trabajo, el ticket debe pasar a `blocked` (ver «Cambio de estado») y decide el usuario; sin créditos en ninguna herramienta, se entrega sólo el plan.

**Fallo reproducible:** se exige un comando de reproducción, una prueba permanente (rojo → arreglo → verde, ver `@root-cause`) y volver a correr las pruebas afectadas antes de cerrar.

## CONTEXTO MÍNIMO VIABLE PARA CODEX (Codex no es una caja negra perfecta)
Codex no lee `journal.md` ni `architecture.md` — si el ticket asume una convención de nombrado o de dominio que solo vive ahí, Codex va a inventar nombres y fallar en silencio. Cada vez que asignes `tool: codex` a un ticket:
1. Copia al cuerpo del ticket (no solo referencia la ruta) las 3-5 líneas más relevantes de `architecture.md`/`SPEC.md` que definen el vocabulario de dominio que ese ticket necesita (nombres de columnas, convenciones, entidades).
2. Si el ticket nace de un fallo de CI/build, incluye el último mensaje de error tal cual, no un resumen.
3. No copies el contexto completo — sería quemar la ventaja de tickets acotados. Solo lo mínimo para que Codex no adivine.

## DEGRADACIÓN CONTROLADA — patrón "Handoff" (sin créditos en la herramienta asignada)
Inspirado en el patrón Handoff de orquestadores multi-agente reales, pero sin tmux ni infraestructura extra — nuestro `journal.md` append-only ya hace de bus de mensajes entre herramientas.

Si el usuario dice algo como "no tengo créditos en Codex" o "mejor síguelo tú": no insistas, no le repitas la asignación original.
1. Cambia `assigned_tool` (no `preferred_tool`, esa se conserva como intención original) a la alternativa disponible ahí mismo (normalmente `claude-code`, salvo que también digan que ese tampoco tiene crédito). Si es una ficha en `doing` de Claude Code con `write_scope`, sacarla de `claude-code` se solicita al propietario (ver «Cambio de estado»).
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
