# Ecosistema Caveman — Documento de Arquitectura Completo

**Propósito de este documento**: explicar la arquitectura completa a un revisor externo (humano o modelo de IA) que no tiene contexto previo, para obtener crítica independiente. Incluye no solo qué se construyó, sino qué se descartó y por qué — para que la revisión no repita sugerencias ya evaluadas y rechazadas con razón.

**Perfil del usuario**: diseñador de producto (no ingeniero de formación) que construye software con IA ("vibe coding"), usando Kiro IDE como editor principal, con Claude Code (extensión/CLI) y Codex CLI disponibles según créditos, y acceso opcional a un sistema propio ("Hermes", basado en GPT) en un VPS de Hostinger para trabajo desatendido de larga duración.

---

## 1. Filosofía de diseño

- **Minimalismo extremo**: cero dependencias innecesarias, una responsabilidad por skill/agente.
- **Reglas verificables por script, no solo por prosa**: los límites duros (archivos, líneas, WIP, secretos) viven en `scripts/verify-simplicity.sh`, no solo en instrucciones de texto que un LLM podría no seguir.
- **Adopción graduada, no anticipada**: herramientas más pesadas (design system propio, grafo de código externo) se activan solo cuando el proyecto demuestra necesitarlas, no por adelantado.
- **Costo de modelo proporcional al riesgo/frecuencia**: el modelo más caro se usa una sola vez, en el momento de mayor apalancamiento; todo lo de alta frecuencia usa el modelo estándar.
- **Portabilidad sin sobre-prometer**: se documenta explícitamente qué funciona igual entre Kiro/Claude Code/Codex y qué no, en vez de asumir compatibilidad universal.

---

## 2. Entorno de ejecución (multi-herramienta)

| Herramienta | Rol | Lee `.claude/skills/` y agentes | Notas |
|---|---|---|---|
| **Kiro IDE** | Editor principal | No — tiene su propio motor (specs, steering, hooks) | Su flujo nativo `requirements.md → design.md → tasks.md` se integra, no se reemplaza (ver §9) |
| **Claude Code** (extensión/CLI dentro de Kiro) | Motor que ejecuta este ecosistema completo | Sí — es el único que lo hace | Aquí viven los 5 agentes y las 25 skills core |
| **Codex CLI** | Mano de obra para tareas acotadas y autocontenidas | No | Recibe tickets ya formateados, sin contexto del ecosistema |
| **Hermes (VPS Hostinger, GPT)** | Trabajo largo y desatendido, opcional | No | Solo se usa si el usuario lo pide explícito vía `/nightwatch`; nunca por defecto |

**AGENTS.md**: se genera como espejo de `CLAUDE.md`, con soporte real desigual — Kiro lo lee nativo, Claude Code tiene retrocompatibilidad parcial (su formato nativo es `.claude/`), Codex necesita configuración explícita. No se trata como solución universal, se documenta la limitación.

---

## 3. Agentes (5) — sub-agentes de Claude Code, contexto aislado

| Agente | Modelo | Rol | Tools | Por qué existe como agente separado (no como skill) |
|---|---|---|---|---|
| **Warden** | `claude-sonnet-5` | Revisa: pruebas, linters, límites | Read, Glob, Grep, Bash | Necesita ejecutar comandos de verificación de forma aislada del hilo de ejecución |
| **Artisan** | `claude-sonnet-5` | Ejecuta: interfaces y sistema de diseño | Read, Write, Edit, Glob, Grep | Especialización de dominio (UI) que se beneficia de contexto propio |
| **Chronicle** | `claude-haiku-4-5-20251001` | Documenta: memoria, specs, ledger | Read, Write, Edit, Glob, Grep | Tarea de alto volumen y bajo riesgo — modelo barato adrede |
| **Tracer** | `claude-sonnet-5` | Analiza: fallos repetidos, alternativas | Read, Grep, Bash | Se activa solo tras 3 fallos — necesita una mirada sin el sesgo de quien escribió el código que falló |
| **Sentinel** | `claude-sonnet-5` | Gate de seguridad, bloqueante, pre-deploy | Read, Grep, Bash | **Decisión de diseño explícita**: separado de quien genera el código, siguiendo el patrón de "guardrail en modelo distinto al que responde" — un mismo hilo autovigilándose rinde peor que una segunda pasada independiente |

**Por qué solo 5 y no más** (rechazado explícitamente: un agente por "rol de oficina"): cada sub-agente cuesta aislamiento de contexto real — pierde la conversación en curso, hay que re-explicarle, y hay riesgo de enrutamiento incorrecto. Se añade un agente solo cuando el aislamiento aporta algo que el hilo principal no puede dar (una segunda mirada sin sesgo, un modelo de costo distinto). El resto de "roles de oficina" (PM, arquitecto, investigador) son **skills** que corren en el hilo principal, no agentes.

**Ningún agente corre en Opus.** Ver §5.

---

## 4. Skills — 25 core + 4 opcionales

### Cadena de planificación inicial (única con Opus, ver §5)
`/kickoff` → `/pre-flight` → `/blueprint` → `/rulebook`

- **`/kickoff`**: brainstorming inicial, sin proyecto todavía. Adaptación de `/grill-me` para el momento "antes de que exista un proyecto" — su salida es texto plano portable (pegable en Kiro/Cursor/Codex), no tickets.
- **`/pre-flight`**: investigación de dominio, arquitectura, y **Bloque de seguridad con lente trust-boundary/abuse-path** (traza cada punto donde un dato cruza de una zona menos confiable a una más confiable, antes de escribir código).
- **`/blueprint`**: **el único momento caro de todo el ecosistema** — sintetiza brief + respuestas de `/pre-flight` en `architecture.md` + `SPEC.md` de una sola vez. Incluye el concepto de "seams" (costuras de prueba: dónde se va a probar cada componente, antes de documentar su comportamiento).
- **`/rulebook`**: traduce spec a reglas ejecutables (`.claude/rules/`, `.kiro/steering/`, `.cursor/rules/`). **Importa `tasks.md` de Kiro directamente** si el usuario planificó ahí en vez de usar nuestras skills — no duplica el trabajo.

### Producto
- **`/brainstorm`**: divergente, sin filtrar.
- **`/grill-me`**: convergente, MoSCoW, genera tickets YAML con campo `tool` asignado (ver §7).
- **`/helm`**: PM — genera `plan.md`/`ledger.md` como **vistas derivadas** (nunca editadas a mano), checkpoints.

### Ejecución técnica
- **`/dispatch`**: enrutador único (fusiona lo que antes eran `@router` y `/orquestar`) — modo automático (detecta intención) y manual. Incluye el **patrón "Handoff"** (§8) y la heurística de asignación de herramienta.
- **`/prototype`**: desechable, 1 archivo, datos falsos.
- **`@build`**: implementación mínima. **Disciplina TDD** (test que falla antes que el código) — separada explícitamente de `@loop` (que es optimización de código ya correcto, no corrección).
- **`@root-cause`**: exige comando de reproducción determinista antes de tocar código — sin eso, "no hay diagnóstico, hay una teoría".
- **`@redteam`**: revisión adversarial en **dos pasadas explícitas y separadas** (Standards: simplicidad/nomenclatura/errores; Spec: ¿hace lo que el ticket pedía, ni más ni menos?) precedidas por un **gate de seguridad bloqueante** (no ponderado con las demás dimensiones — si falla, rechaza de inmediato).
- **`@shipcheck`**: verificación de cierre — script, **tabla de impacto de documentación obligatoria** (qué código tocó qué concepto de negocio y qué documento se actualizó), regenera el HUB.
- **`@depcheck`**: recortada a lo que exige ejecución real (vigencia de API vía Context7) — lo estático se delega al campo oficial `compatibility` del frontmatter de cada skill.
- **`@loop`**: optimización iterativa de una métrica, sobre código ya correcto.

### Deploy, evolución y arquitectura continua
- **`/castoff`**: gate de pre-deploy. Invoca a Sentinel de forma obligatoria y bloqueante. **Chequeo post-deploy vía Railway MCP local** si está disponible (nunca afirma haber revisado logs que no revisó).
- **`/evolve`**: revisa el ecosistema de skills, sugiere fusiones/mejoras (nunca aplica sin confirmación). También gestiona el **patrón de handoff de contexto** cuando una sesión se acerca al límite de ventana (anexa estado a `journal.md`, el usuario hace `/clear`, se retoma leyendo la última entrada).
- **`/foundation-check`**: hot spots vía `git log` (script de <40 líneas, cero dependencias) + "prueba de eliminación" para detectar módulos superficiales. Incluye la **escalada condicional documentada** a un grafo de código externo (Graphify + code-review-graph) solo si el crecimiento del repo lo justifica — nunca por defecto (ver §10).
- **`/onboarding`**: integración a repos que YA EXISTEN — no impone el stack por defecto si ya hay uno funcionando.
- **`/design-forge`**: dos fases. Fase 1 (prototipo): **daisyUI** si el stack es HTMX (default), shadcn/ui solo si el proyecto corre React de verdad. Fase 2 (cuando el proyecto lo amerite): handoff a design system propio, migrando componente por componente. Incluye "Diseñar Dos Veces" en texto plano (sin servidor de preview).
- **`/gear-up`**: elige stack mínimo, verificado con Context7.

### Guía y observabilidad
- **`/compass`**: conductor con estado — lee/escribe `docs/agents/PROGRESS.md`, dice el siguiente paso exacto (skill + herramienta + modelo), conversa con el usuario sobre en qué fase está. No ejecuta nada, solo orienta.
- **`/scout`**: captura páginas de referencia (UI/UX/negocio) a Markdown, con nota explícita de qué se debe imitar. Patrón CLI+archivo (nunca vuelca scraping crudo al contexto).
- **`/nightwatch`**: detector conservador de trabajo apto para `tool: hermes-vps`. Nunca se activa de oficio.

### Opcionales (`skills-extra/`, no se cargan por defecto)
`/teach-me`, `/transcript-grab`, `@clean-sweep`, `/skillmap`.

### Eliminado / fusionado
- `/mission-control` — eliminado: duplicaba `hub.ts` y prometía costos de tokens que no puede conocer con precisión.
- `@router` — fusionado dentro de `/dispatch`.

---

## 5. Política de modelos

| Nivel | Cuándo | Modelo | Razón |
|---|---|---|---|
| Razonamiento (caro, **una sola vez por proyecto**) | Exclusivamente `/blueprint` | `claude-opus-4-8` | Recolectar información no necesita razonamiento caro; sintetizarla en una arquitectura coherente sí. Antes se cometió el error de poner Opus en `/kickoff`, `/pre-flight` y `/blueprint` (tres veces) — corregido a una sola llamada. |
| Estándar (todo lo demás) | `/kickoff`, `/pre-flight`, `/rulebook` en adelante, los 5 agentes | `claude-sonnet-5` | Suficiente para preguntas/respuestas y para todo lo posterior a tener arquitectura sólida |
| Volumen/barato | Memoria, archivado | `claude-haiku-4-5-20251001` | Alto volumen, bajo riesgo |

**Excepciones documentadas — gatillo de riesgo verificable, no un dogma absoluto**: se permite una activación puntual de Opus fuera de `/blueprint` si aplica al menos uno de: cambio de trust boundary, migración irreversible, cambio de auth/permisos, cambio de motor de DB, `@root-cause` falla 2 veces consecutivas apuntando a la capa de dominio (no bugs de lógica), más del 40% de tickets activos requieren reescribir `architecture.md` (pivote de dominio real), o discrepancia seria confirmada entre `SPEC.md` y el código real. Fuera de esta lista, la regla original se mantiene: "parece que hace falta Opus" sin un gatillo de la lista es señal de planificación floja, no una razón válida. Siempre vuelve a Sonnet de inmediato al resolver, y se anota en `journal.md` cuál gatillo aplicó.

**Se evita `claude-fable-5`** salvo que no haya otra opción — es el modelo más caro disponible, sin ganancia sobre Opus para este uso.

**Regla simétrica para Codex/GPT**: dentro de `tool: codex`, sub-distinción por tipo de tarea (completado rápido = modelo ligero; bug de lógica oculta = modelo de razonamiento; lote/alto volumen = modelo barato) — mismo principio que el lado Claude, no un modelo único para todo.

---

## 6. Gestión de tareas (Kanban derivado)

- **Fuente única de verdad**: frontmatter YAML de cada `docs/agents/tasks/TSK-XXX.md` — campos `id`, `title`, `state`, `moscow`, `attempts`, `preferred_tool`, `assigned_tool`.
- **Vistas derivadas** (nunca editadas a mano): `plan.md`, `ledger.md`, `docs/agents/hub.html`.
- **Estados**: `backlog → ready → doing → review/blocked → done`. **WIP=1 por `assigned_tool`** (no global) — Claude Code, Codex, Kiro nativo y Hermes pueden tener cada uno una tarea activa en paralelo; el límite es por ejecutor, no por proyecto. Verificado por script.
- **`attempts` en 3** → dispara automáticamente a Tracer, con un payload sintético preparado por `/helm` (ticket + extracto de intentos + último error) — no el historial completo, para no romper la eficiencia de correr en Sonnet.

## 7. Campo de herramienta — intención vs. decisión real

Dos campos, no uno, por ticket:
- **`preferred_tool`**: la intención al crear el ticket, asignada por `/grill-me`.
- **`assigned_tool`**: la decisión real, fijada por `/dispatch` justo antes de ejecutar — considera alcance actual, sensibilidad (auth/pagos empujan a `claude-code` aunque la intención fuera otra), necesidad de memoria, créditos disponibles, y reversibilidad. Puede diferir de `preferred_tool` si las condiciones cambiaron.

Cuatro valores posibles para ambos campos:
- `claude-code`: toca skills, memoria, o necesita gates de seguridad.
- `codex`: tarea acotada, spec clara, sin necesidad de memoria del proyecto — debe ser 100% autocontenida, con "contexto mínimo viable" inyectado por `/dispatch` (vocabulario de dominio + último error de CI, no el contexto completo).
- `kiro-nativo`: planificación/navegación/edición rápida que Kiro resuelve solo.
- `hermes-vps`: trabajo largo desatendido — **nunca por defecto**, solo vía `/nightwatch`, sujeto a un checklist obligatorio de seguridad operacional (usuario Linux sin sudo, worktree aislado, límites de recursos, cero secretos de producción, salida solo como patch revisable, kill switch, prohibido auto-deploy).

## 7b. Los 6 alias — la superficie real que el usuario necesita recordar

Con 25 skills core, pedirle a un diseñador de producto que memorice cada nombre técnico es la carga cognitiva equivocada. `/dispatch` reconoce 6 alias simples y decide internamente cuál skill específica corresponde según la fase en `PROGRESS.md`:

`/start` (→ `/onboarding` o `/launchpad`) · `/plan` (→ `/kickoff`, `/pre-flight` o `/blueprint` según la fase) · `/build` (→ `@build`) · `/fix` (→ `@root-cause`) · `/review` (→ `@redteam`) · `/ship` (→ `@shipcheck` → `/castoff`)

Los nombres específicos siguen existiendo y funcionando — los alias no los reemplazan, evitan que haya que aprenderlos todos antes de poder trabajar.

## 8. Patrón "Handoff" — degradación controlada por falta de créditos

Cuando el usuario dice "no tengo créditos en X", `/dispatch` reasigna el campo `tool` del ticket de inmediato (sin volver a preguntar), y anexa una línea a `journal.md` con qué herramienta se quedó sin crédito y en qué punto exacto — así `journal.md` hace de "bus de mensajes" entre herramientas sin necesitar infraestructura adicional (se evaluó y se rechazó adoptar un orquestador multi-agente tipo CAO/tmux por ser demasiado pesado para el caso de uso).

## 9. Integración con Kiro Specs (no reemplazo)

Kiro tiene su propio flujo nativo (`requirements.md → design.md → tasks.md`, con paralelización por "olas" de tareas independientes). La decisión fue **no competir con eso**: `/rulebook` detecta si existe `tasks.md` y lo importa directo a nuestro formato de ticket (con `tool` asignado), en vez de pedir que se repita `/grill-me` desde cero.

## 10. Memoria y observabilidad

- **`docs/agents/journal.md`**: fuente de verdad, **append-only** (verificado por script — cualquier diff que borre líneas de aquí falla la verificación). Formato de línea estructurado para permitir conteo automático:
  ```
  - [YYYY-MM-DDTHH:MM] tool:<nombre> ticket:<TSK-XXX|-> result:<ok|blocked|fail|info> — nota
  ```
- **`docs/agents/MEMORY.md`**: vista comprimida y regenerable de `journal.md` (nunca se comprime el original — la compresión con pérdida solo afecta a la vista).
- **`docs/agents/PROGRESS.md`**: fase actual + siguiente paso exacto (herramienta + modelo) — el archivo que hace posible que `/compass` funcione incluso si el avance ocurrió en Kiro nativo o Codex, no solo en Claude Code.
- **`docs/agents/CHECKPOINT.json`**: estado efímero (cwd, comando de test, PID de servidor, hash de commit) — separado de `journal.md` a propósito. `journal.md` cuenta la historia; esto es lo que un script necesita para rehidratar el entorno sin que el LLM tenga que inferirlo de prosa. Se sobreescribe en cada handoff, no es append-only.
- **`docs/agents/models.yaml`**: checklist central de qué archivos tocar cuando un modelo cambia de nombre. No es indirección real — Claude Code no soporta variables en el campo `model:` de un sub-agente — es documentación de los puntos de contacto, no una solución automática.
- **Partición de `journal.md`**: al superar ~500 entradas, se archiva como `journal-YYYY-MM.md` y se empieza uno nuevo. `hub.ts` lee todos los `journal*.md` juntos para las estadísticas, así que no se pierde historial. Cada línea incluye `event:` (ID único) y `schema:v1` (versión de formato), retrocompatible si el formato cambia después.
- **`docs/agents/hub.html`** (generado por `bun scripts/hub.ts`): vista unificada con:
  1. Mapa de arquitectura **estático** (SVG hecho a mano, sin librerías de grafos) — cómo se conectan skills y agentes.
  2. Kanban de tareas, con bandera "🟡 necesita tu decisión" en `review`/`blocked`.
  3. **Estadísticas de uso real** — parseadas de las líneas estructuradas de `journal.md`: qué skill/agente se usa más, tasa de éxito, cuántas veces bloqueó/falló.
  4. Feed de actividad estilo cards (no lista plana).
  5. Sugerencias de `/evolve` (lee `docs/agents/evolve-report.md`).

**Human-in-the-loop real**: cuando `@redteam` rechaza o Sentinel bloquea un deploy, el ticket pasa a `state: blocked` automáticamente — **no reintenta solo**. Aparece marcado en el HUB. Ese es el punto de intervención: el humano decide reintentar, cambiar de enfoque, o descartar.

---

## 11. MCPs — decisiones y razones

| MCP | Decisión | Razón |
|---|---|---|
| Context7 | ✅ Adoptado | Vigencia de dependencias en tiempo real (`@depcheck`) |
| Firecrawl | ✅ Adoptado (confirmado independientemente) | Scraping a Markdown, patrón CLI+archivo (`/scout`) |
| crw-mcp | ✅ Confirmado (vía npm registry: v0.28.0, AGPL-3.0, 37 versiones, activo) | Alternativa local a Firecrawl, instalar vía `npx crw-mcp`. Nota: `crw-cli` vía cargo NO existe, ese comando de la investigación original era incorrecto |
| Railway MCP (local) | ✅ Adoptado | Chequeo post-deploy en `/castoff`, hereda credenciales de la CLI, sin infraestructura nueva |
| Filesystem MCP | ❌ Rechazado | Redundante con las tools nativas de Claude Code (Read/Write/Bash) |
| Git MCP | ❌ Rechazado | Redundante con `Bash` nativo |
| Sequential Thinking / memoria como grafo | ❌ Rechazado | Compite con y es más pesado que `journal.md` + Chronicle + HUB, que ya resuelven el mismo problema |
| Linear MCP / GitHub MCP (sync de tasks.md) | ❌ Rechazado por ahora | No hay necesidad planteada; `/rulebook` ya importa `tasks.md` a nuestro propio formato |
| Sentry / Datadog | ❌ Opcional futuro | Railway MCP cubre lo básico para un desarrollador independiente |
| Graphify + code-review-graph | ⚠️ Condicional | El propio ecosistema de esa herramienta admite que en repos pequeños (nuestro caso por diseño) es redundante. Gatillo: solo si `/foundation-check` muestra crecimiento sostenido. Si se adopta: acotar a 5-8 tools (no las ~25 por defecto), revisar qué hooks escribe en la config antes de aceptarlos |

---

## 12. Seguridad — resumen de mecanismos

- **Trust-boundary/abuse-path lens** en `/pre-flight` (diseño) y Sentinel (ejecución, cada deploy) — no una checklist genérica, sino trazar cada cruce de confianza y pensar en abuso deliberado, no solo error accidental.
- **Gate bloqueante, no ponderado**: en `@redteam`, la seguridad se evalúa antes que cualquier otra dimensión y rechaza de inmediato si falla — no se promedia con "simplicidad" o "nomenclatura".
- **Mínimo privilegio en dos capas**: por agente (`tools:` en el frontmatter) y por skill (`allowed-tools:`, mecanismo del estándar oficial de Agent Skills que no se estaba usando al principio).
- **Secretos**: solo variables de entorno; cualquier literal sospechoso en el diff es FAIL automático, verificado tanto por script (`verify-simplicity.sh`) como por Sentinel.
- **Sentinel corre en Sonnet siempre** (no Opus) — se decidió explícitamente no escalar el modelo de seguridad porque el volumen (cada deploy) no lo justifica, y porque si el diseño inicial fue sólido, esto es verificar contra lo ya decidido, no re-razonar desde cero.
- **Independencia real, no solo "segunda pasada"**: Sentinel recibe el diff, no la conversación completa (evita heredar el marco mental de quien generó el código), y opera con presunción de inseguro — el veredicto por defecto es FAIL salvo que se aporte evidencia concreta de que no es explotable.
- **Gates específicos del stack (Bun+HTMX+SQLite+Drizzle)**, añadidos tras revisión externa: migraciones destructivas de Drizzle sin `rollback.sql` en el mismo commit, SQL crudo vía `db.execute(sql\`...\`)` con interpolación, XSS vía fragmentos HTML de HTMX sin sanear, CORS con wildcard en producción. Y en `@redteam` (Standards, no bloqueante): N+1 queries de Drizzle dentro de loops, valores de UI hardcodeados fuera de `tokens.css`.
- **Seguridad operacional de Hermes/VPS** (`/nightwatch`): usuario Linux exclusivo sin sudo, worktree aislado, límites duros de recursos y duración, cero acceso a secretos de producción, comandos/directorios explícitamente permitidos, salida solo como commit/patch revisable (nunca push directo ni deploy), kill switch, log completo de comandos y archivos modificados. Es la única pieza que corre desatendida — el hueco más serio que señaló la revisión externa.

---

## 13. Decisiones explícitamente rechazadas (con razón, para no repetirlas)

| Propuesta | Rechazada porque |
|---|---|
| Un agente por "rol de oficina" (PM, arquitecto, investigador, etc.) | El aislamiento de contexto de un sub-agente cuesta real; solo se justifica cuando aporta algo que el hilo principal no puede (ver §3) |
| Eliminar el agente de seguridad (Sentinel) y fusionarlo en `/pre-flight` | Un guardrail en modelo/pasada separada rinde mejor que auto-vigilancia del mismo flujo; además `/pre-flight` corre una vez, Sentinel corre en cada deploy — fusionar los dejaría sin protección continua |
| Fusionar `@loop` con disciplina TDD | Son problemas distintos: TDD es corrección, `@loop` es optimización de algo ya correcto. Fusionar rompe la regla de una responsabilidad por skill |
| Eliminar `@depcheck` a favor de solo frontmatter estático | La vigencia de una API en tiempo real (vía Context7) no se puede resolver con un campo YAML estático |
| Visual regression testing con servidor local (patrón "visual companion") | Añade Node.js, gestión de puertos, falla en Windows/WSL2 — se sustituyó por "Diseñar Dos Veces" en texto plano |
| Orquestador multi-agente tipo CAO con tmux | Demasiada infraestructura para el caso de uso; el patrón conceptual (Handoff) se adoptó, la herramienta no |
| Dashboard `/mission-control` con costos de tokens estimados | No puede conocer los costos reales con precisión; duplicaba lo que ahora hace `hub.ts` con datos reales |
| Adoptar Graphify/CRG por defecto | El propio ecosistema de la herramienta admite que es redundante en repos pequeños — se dejó como escalada condicional, no default |
| shadcn/ui como base por defecto | Es un sistema de React; el stack por defecto es HTMX sin React — se corrigió a daisyUI |

---

## 14. Abierto / pendiente de decisión del usuario

- ~~Wikilinks `[[...]]` estilo Obsidian~~ — **Decidido: NO.** Es puramente cosmético (solo afecta cómo se ve la carpeta si se abre en la app Obsidian, cero efecto en Claude Code/skills/HUB). El usuario no usa Obsidian, así que sería complejidad añadida sin ningún beneficio real. Rutas en texto plano se quedan como están.
- ~~Verificación de "CRW/fastCRW"~~ — **Resuelto: confirmado real** vía consulta directa al registro de npm (`crw-mcp` existe, v0.28.0, AGPL-3.0, activo). El comando `cargo install crw-cli` de la investigación original era incorrecto — el correcto es `npx crw-mcp`.
- **Confirmación de nombres de modelo de OpenAI** (`GPT-5.6 Sol/Terra/Luna` y sus strings de API) — mencionados de forma consistente en tres investigaciones independientes, pero el formato de string citado (`openai.gpt-5.6-sol`) no coincide con convenciones típicas de nombrado de OpenAI; tratado con escepticismo.

---

## 15. Preguntas abiertas para el revisor externo

1. ¿La separación entre "agentes" (contexto aislado, 5) y "skills" (hilo principal, 25) es la línea correcta, o hay algún caso de uso de este perfil de usuario (diseñador de producto, vibe coding) donde un sexto agente sí se justificaría?
2. ¿La política de "Opus una sola vez, en `/blueprint`" tiene algún punto ciego — algún momento posterior donde el costo de un error de razonamiento sea tan alto que justifique romper la regla?
3. ¿El mecanismo de `journal.md` con formato de línea estructurado es suficiente para observabilidad real, o en la práctica se necesitaría algo más robusto una vez el proyecto crezca (y en qué umbral)?
4. ¿Falta algún gate de seguridad específico para un stack Bun+HTMX+SQLite+Drizzle que no esté cubierto por Sentinel/`@redteam`?
5. ¿La estrategia de "adopción graduada" (design system, grafo de código) es la correcta, o hay algo en este stack donde adoptar temprano sí paga, al revés de lo que asumimos?

---

## Apéndice A — `scripts/verify-simplicity.sh` (código real, no aspiracional)

```bash
#!/bin/bash
set -euo pipefail

ERRORS=0

echo "🦴 Verificando simplicidad..."

# No hay límites ni avisos por número de archivos o líneas: el alcance técnico se define por la
# tarea, no por presupuestos artificiales.

# --- 1. Dependencias nuevas ---
# El check anterior solo detectaba la CLAVE "dependencies" siendo añadida.
# Este detecta cualquier línea nueva DENTRO de dependencies/devDependencies,
# que es el caso real: un paquete más en un bloque que ya existía.
if git diff HEAD -- package.json 2>/dev/null | \
   awk '
     /^\+\+\+/ {next}
     /"(dependencies|devDependencies)"[[:space:]]*:/ {in_block=1; next}
     in_block && /^\+/ && /"[^"]+"[[:space:]]*:[[:space:]]*"[^"]+"/ {found=1}
     in_block && /^[^+-]*}/ {in_block=0}
     END {exit !found}
   '; then
  if ! git diff HEAD -- package.json 2>/dev/null | grep -q '// ALLOWED'; then
    echo "❌ ERROR: Nueva(s) dependencia(s) detectada(s) en package.json sin marcar // ALLOWED."
    echo "   Pasa por /gear-up o @depcheck antes de continuar."
    ERRORS=$((ERRORS + 1))
  fi
fi

# --- 4. Secretos hardcodeados ---
if git diff HEAD 2>/dev/null | grep -E '^\+' | \
   grep -Ei '(api[_-]?key|password|secret|token)\s*[:=]\s*["'"'"'][A-Za-z0-9_\-]{8,}' > /dev/null; then
  echo "❌ ERROR: Posibles secretos hardcodeados en el diff."
  ERRORS=$((ERRORS + 1))
fi

# --- 5. WIP = 1: solo una tarea puede estar en estado "doing" ---
DOING_COUNT=$(grep -rl '^state: doing' docs/agents/tasks/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$DOING_COUNT" -gt 1 ]; then
  echo "❌ ERROR: $DOING_COUNT tareas en estado 'doing'. Máximo permitido: 1 (regla WIP=1)."
  grep -rl '^state: doing' docs/agents/tasks/ 2>/dev/null | sed 's/^/   - /'
  ERRORS=$((ERRORS + 1))
fi

# --- 6. journal*.md (incluidas particiones mensuales archivadas) y ledger.md deben ser append-only ---
for f in docs/agents/journal*.md docs/agents/ledger.md; do
  if [ -f "$f" ] && git diff HEAD -- "$f" 2>/dev/null | grep -qE '^-[^-]'; then
    echo "❌ ERROR: $f tiene líneas eliminadas. Es append-only — nunca se reescribe."
    ERRORS=$((ERRORS + 1))
  fi
done

# --- Resultado ---
if [ "$ERRORS" -eq 0 ]; then
  echo "✅ Verificación de simplicidad superada."
  exit 0
else
  echo "🔥 $ERRORS violación(es). Corrige antes de continuar."
  exit 1
fi
```
