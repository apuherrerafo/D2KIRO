# PROYECTO: dota2coach (Draft Coach) — Fase 4 en curso

## STACK ACTUAL
Definido por `/pre-flight` (`docs/agents/architecture.md`, Bloque 5) y cerrado por `/blueprint`
(`docs/specs/SPEC.md`, §0-D3). No modificar manualmente — si cambia, se regenera desde ahí.

Dos procesos locales, no uno:
- **`apps/engine`** (Bun): motor de sugerencias, WebSocket, SQLite. Escucha únicamente en
  `127.0.0.1`. Nunca llama a la red en el camino caliente del draft.
- **`apps/web`** (Next.js, App Router, TypeScript estricto): sitio + vista de draft en vivo.
  RTK Query para páginas normales; WebSocket + Zustand como única excepción para el draft en vivo.
  Tailwind + shadcn/ui.
- DB: SQLite + Drizzle ORM (solo en `apps/engine`).
- Testing: Bun Test.
- Despliegue: Railway.
- Captura de draft (fase 1): `simulator` y `manual` son capturadores de primera clase.
  `overwolf` y `ocr` quedan especificados como contrato, se construyen después (SPEC §0-D1).

**Nota de estado (2026-08-26)**: fases 1, 1b, 2 y 3 completas y en producción (Railway,
https://d2kiro-production.up.railway.app, auto-deploy sobre `master`), sin cambios de fondo desde
la nota anterior. **Fase 4 sigue en pausa, sub-ticket 4.1 completo** — señal `archetype_fit`
aislada (`TSK-089`), sin integrar al motor (4.2, sin fecha). **Fase 5 completa** ("MVP de
Producción: Auth & Personal Hero Pool multi-usuario"): los 13 tickets originales (`TSK-094` a
`TSK-106`) más el trabajo posterior de producto/infraestructura hasta `TSK-125` están `done` e
integrados en `master` — login real con Steam, esquema multi-cuenta, CI/CD (GitHub Actions +
Husky), y el motor Pro-Drafter (KNN + simulador de línea + decodificador de intención bayesiano,
`apps/engine/src/{pipeline,knn,lane,intent}/`) construido y probado, dark detrás de
`ENABLE_PRO_DRAFTER`. **Fase 6 en curso** ("Formalizar Pro-Drafter: apertura de equipo consciente
de bans", `docs/specs/SPEC.md` §13): origen — el top-5 de apertura del Copilot se sentía
repetitivo entre bans distintos porque el bono actual (`MAX_COUNTER_RELIEF=0.12` en
`team-opener.ts`) es chico frente al peso dominante de `position_fit`. `/pre-flight` y `/blueprint`
completos, `/rulebook` recién cerrado con 10 tickets (`TSK-126` a `TSK-135`, orden estricto de
dependencia) — le da al motor Pro-Drafter, ya construido pero nunca conectado a la apertura de
equipo, un camino real que reacciona al solapamiento posicional y la entropía de rol de los héroes
baneados, reutilizando `intent/denial-score.ts` sin editarlo. `ENABLE_PRO_DRAFTER` sigue apagado
por defecto durante toda la fase — nada de esto cambia el comportamiento observable de producción
hasta un segundo `/blueprint`, condicionado a un paquete de evidencia numérico (`TSK-135`). Cero
código de esta fase escrito todavía. Ver `docs/agents/PROGRESS.md` para el estado exacto y el
siguiente paso.

## COMANDOS ESENCIALES
- `bun run dev` → Iniciar servidor de desarrollo.
- `bun test` → Ejecutar pruebas unitarias.
- `bun run lint` → Formatear código.
- `bash scripts/verify-simplicity.sh` → Verificar seguridad, invariantes y calidad antes de un commit.
- `bun scripts/hub.ts` → Regenerar el tablero desde los tickets.

## REGLAS INVIOLABLES
Los gates técnicos de seguridad, invariantes, tipos y pruebas se codifican en `scripts/verify-simplicity.sh`.

- **Política de dependencias por categoría (Governance 2.0, 2026-08-24):** una `dependency` de
  producción nueva (`package.json` → `dependencies`) sigue exigiendo pasar por `/gear-up` o
  `@depcheck` y marcarse `// ALLOWED` — es lo que termina en el bundle/runtime real. Una
  `devDependency` nueva (tooling de infraestructura rutinaria del stack Bun — p. ej.
  `better-sqlite3`, `typescript`, linters, generadores de tipos) tiene **bypass total**: no exige
  ticket de excepción, comando previo ni marca `// ALLOWED`. Verificado mecánicamente en
  `scripts/verify-simplicity.sh` (sección 3), que distingue la clave exacta del `package.json`.
- Está permitido modificar todos los archivos y líneas técnicamente necesarios para completar una
  tarea o refactorización limpia e integral. No se requiere una excepción ni confirmación por el
  tamaño de un cambio.
- **WIP = 1**: solo una tarea puede estar en estado `doing` a la vez.
- Prohibido refactorizar archivos no relacionados con la tarea.
- Cada cambio debe traducirse a lenguaje producto: "Esto significa que ahora...".

## SEGURIDAD DESDE EL DISEÑO
No es un checklist al final. Es un gate que bloquea.

- Todo input externo se valida antes de tocar la lógica de negocio (formularios, query params, body de API).
- Toda query a la base de datos es parametrizada vía Drizzle. Nunca strings concatenados.
- Todo HTML insertado dinámicamente (HTMX) se escapa. Cero `innerHTML` con datos sin sanear.
- Los secretos viven únicamente en variables de entorno (`process.env`). Un literal sospechoso en el diff es FAIL automático en `verify-simplicity.sh` y en Sentinel.
- Cada agente y skill declara solo las `tools` que necesita (mínimo privilegio). Ver tabla de agentes abajo.
- `/castoff` es obligatorio antes de cualquier deploy y no se puede saltar dentro del flujo automatizado.
- La dimensión de seguridad en `@redteam` es un gate binario (bloquea si falla), no un ítem ponderado entre cinco.

## REGLAS POR FASE
El detalle inviolable de cada fase vive en `.claude/rules/fase-N.md` (movido de aquí
por TSK-196 para mantener `CLAUDE.md` < 200 líneas; contenido verbatim, verificado por
`scripts/verify-claude-md-split.sh`). El detalle condicional por tipo de archivo sigue en
`.claude/rules/{engine,web,security,testing-seams}.md`.

- **Fase 1** — dota2coach: `.claude/rules/fase-1.md`
- **Fase 1b** — hero pool: `.claude/rules/fase-1b.md`
- **Fase 3** — posiciones reales: `.claude/rules/fase-3.md`
- **Fase 4** — sub-ticket 4.1 — señal `archetype_fit`: `.claude/rules/fase-4.md`
- **Fase 4.2** — integrar `archetype_fit` al motor: `.claude/rules/fase-4.2.md`
- **Fase 4.3** — `archetype_fit` usable: selector + transporte: `.claude/rules/fase-4.3.md`
- **Fase 5** — Auth & Personal Hero Pool multi-usuario: `.claude/rules/fase-5.md`
- **Fase 6** — Formalizar Pro-Drafter: apertura consciente de bans: `.claude/rules/fase-6.md`
- **Fase 8** — rehabilitar `counter` + higiene de superficie: `.claude/rules/fase-8.md`
- **Fase 9** — V6-medido → V6-contextual: evaluación offline, calibración empírica, inteligencia contextual: `.claude/rules/fase-9.md`
- **Fase 9.1** — comparabilidad + calibración empírica: `.claude/rules/fase-9.1.md`

## MEMORIA
- `docs/agents/journal.md` → **fuente de verdad**, append-only, nunca se comprime ni se borra. `verify-simplicity.sh` bloquea cualquier diff que elimine líneas de aquí.
- `docs/agents/MEMORY.md` → vista comprimida y regenerable de `journal.md`.
- `docs/agents/USER.md` → perfil del diseñador de producto.
- `docs/agents/ledger.md` → registro append-only de tareas completadas (misma protección que journal.md).

Leer `MEMORY.md` y `USER.md` al inicio de cada sesión.

## GESTIÓN DE TAREAS (Kanban derivado)
- Fuente única de verdad: el frontmatter YAML de cada `docs/agents/tasks/TSK-XXX.md`.
- `plan.md`, `ledger.md` y `docs/agents/hub.html` son **vistas derivadas**. Nunca se editan a mano.
- Campo `attempts` en 3 → dispara automáticamente Tracer. No se pregunta, se ejecuta.
- WIP=1 por herramienta (`assigned_tool`), verificado por script — ver detalle abajo.

## FORMATO DE LOG EN journal.md (para que el HUB pueda contar, no solo leer)
Toda skill/agente que anote algo en `journal.md` usa esta primera línea fija, seguida de texto libre si hace falta:
```
- [YYYY-MM-DDTHH:MM] event:evt-<id> schema:v1 tool:<nombre-skill-o-agente> ticket:<TSK-XXX|-> result:<ok|blocked|fail|info> — nota breve
```
`event:` es un identificador único (ej. `evt-20260725-001`) y `schema:v1` versiona el formato — si el formato cambia en el futuro, un parser puede distinguir líneas viejas de nuevas sin romperse. Ejemplos reales:
```
- [2026-07-25T14:02] event:evt-20260725-001 schema:v1 tool:build ticket:TSK-014 result:ok — login con magic link implementado
- [2026-07-25T14:10] event:evt-20260725-002 schema:v1 tool:redteam ticket:TSK-014 result:blocked — gate de seguridad: secreto hardcodeado en auth.ts
- [2026-07-25T14:15] event:evt-20260725-003 schema:v1 tool:sentinel ticket:TSK-014 result:fail — falta validación de input en endpoint /login
```
Esto no reemplaza el texto libre de siempre — es solo la primera línea, para que `bun scripts/hub.ts` pueda contar sin tener que interpretar prosa.

## HUMAN-IN-THE-LOOP: dónde intervienes tú
`bun scripts/hub.ts` genera un solo HTML con tres cosas: en qué fase del proyecto estás (leído de `PROGRESS.md`), el Kanban de tareas, y la actividad reciente de los agentes (leída de `journal.md`). Cuando un gate falla (`@redteam` → REJECTED, Sentinel → FAIL), el ticket pasa a `state: blocked` automáticamente y aparece con la bandera "🟡 necesita tu decisión" — ningún agente reintenta solo desde ahí. Ese es el punto exacto donde entras: revisas el motivo en `journal.md`, y decides si se reintenta, se cambia de enfoque, o se descarta.

## HERRAMIENTA POR TAREA (Kiro + Claude Code + Codex + Hermes)
Cada ticket declara **dos campos**, no uno — la intención y la decisión real son cosas distintas:
- **`preferred_tool`**: la intención al crear el ticket, asignada por `/grill-me`.
- **`assigned_tool`**: la decisión real, fijada por `/dispatch` justo antes de ejecutar — considera alcance actual, sensibilidad, necesidad de memoria, créditos disponibles y reversibilidad. Puede diferir de `preferred_tool` si las condiciones cambiaron desde que se creó el ticket.

Valores posibles para ambos campos:
- **`claude-code`**: la tarea toca skills, memoria (`journal.md`), tablero, o necesita `@redteam`/gates de seguridad. Es lo único que entiende este ecosistema.
- **`codex`**: feature acotada con spec ya clara, pocos archivos, sin necesidad de leer memoria del proyecto. El ticket debe ser 100% autocontenido — Codex no lee `journal.md` ni conoce las skills de aquí.
- **`kiro-nativo`**: planificación, navegación o edición rápida que Kiro ya resuelve bien sin pasar por ningún agente.
- **`hermes-vps`**: trabajo largo y autocontenido que se deja corriendo desatendido de noche en el VPS de Hermes (GPT). Nunca por defecto — solo si el usuario lo pide explícito vía `/nightwatch`, con el checklist de seguridad operacional que esa skill exige. Siempre pasa por `@redteam`/Sentinel al volver, igual que cualquier otro código.

Si no estás seguro de cuál usar, por defecto es `claude-code` — es la única opción que no pierde trazabilidad en `journal.md`.

## WIP=1 POR HERRAMIENTA, NO GLOBAL
La regla original ("solo una tarea en `doing`, punto") desperdiciaba el sistema multi-herramienta que construimos. La regla real: **máximo 1 tarea en `doing` por cada valor de `assigned_tool`** — Claude Code puede estar implementando mientras Codex resuelve algo acotado y Hermes investiga de noche, siempre que cada uno tenga como máximo una tarea activa a la vez. Verificado por script, no por confianza.

## POLÍTICA DE MODELOS (Opus solo al principio, y ahí se acaba)
Tres niveles, no nombres fijos — así solo actualizas esta tabla cuando salga un modelo nuevo, no 20 archivos.

| Nivel | Cuándo | Modelo hoy | Por qué |
|---|---|---|---|
| **Razonamiento** (caro, UNA sola vez en todo el proyecto) | Exclusivamente `/blueprint` — el momento donde ya hay brief + respuestas de `/pre-flight` completas y hay que sintetizarlas en una arquitectura coherente. | `claude-opus-4-8` | Recolectar información (`/kickoff`, `/pre-flight`) no necesita razonamiento caro — sintetizarla en una decisión coherente sí. Separar ambos evita pagar Opus tres veces por lo que en realidad es un solo trabajo de síntesis. |
| **Estándar** (todo lo demás, sin excepción) | `/kickoff`, `/pre-flight`, `/rulebook` en adelante: ejecutar, revisar, diagnosticar, gate de seguridad, diseño de UI, arquitectura continua, revisión adversarial | `claude-sonnet-5` | Suficiente para preguntas/respuestas y para todo lo que viene después de tener ya una arquitectura sólida |
| **Volumen/barato** | Memoria, archivado, tareas repetitivas de bajo riesgo | `claude-haiku-4-5-20251001` | Se ejecuta muy seguido; no tiene sentido pagar de más por resumir texto |

**Evita `claude-fable-5` salvo que no tengas otra opción disponible** — es el más caro de todos, y no gana nada frente a Opus para lo que hacemos aquí.

**Regla simétrica para Codex/GPT**: mismo principio que con Claude — el modelo insignia/caro solo en los casos que de verdad lo exigen (razonamiento profundo, bug oculto, `/blueprint` si no hay Opus). Para todo lo demás dentro de `tool: codex`, usa el equivalente a "Sonnet" del lado de OpenAI — el modelo de trabajo estándar de tu plan, no el flagship por defecto.

**Para tareas con `tool: codex`**: no todas son iguales — distingue por tipo de tarea, no uses un solo modelo para todo (info no verificada de forma independiente, tómala como guía operativa y confírmala tú de tanto en tanto en la doc oficial de OpenAI):
- Completado rápido, edición acotada, 1-2 archivos: el modelo de código más rápido/barato disponible en tu plan (ligero, latencia baja).
- Bug de lógica oculta o concurrencia que ya resistió un intento normal: el modelo de razonamiento profundo disponible (piensa antes de responder, no el de respuesta instantánea) — es el mismo espíritu que justifica Opus en `/blueprint`, aplicado del lado de Codex.
- Tarea de lote/alto volumen (limpiar miles de filas, clasificar datos): el modelo más barato disponible, optimizado para eso — no gastes el modelo de razonamiento en volumen.

**Fallback sin créditos de Opus**: si te quedas sin créditos de Opus justo en `/blueprint`, el modelo insignia disponible en tu plan de Codex/ChatGPT (el de gama más alta, pensado para tareas críticas y complejas) es un sustituto razonable — mismo nivel "razonamiento caro, solo al inicio", solo que del otro proveedor. No es una equivalencia confirmada, es la mejor alternativa disponible cuando no hay opción.

**Excepciones documentadas — gatillo de riesgo verificable, no un dogma**: "si algo pide Opus fuera de `/blueprint`, la planificación falló" es cierto la mayoría de las veces, pero no siempre — un cambio legítimo de alcance no es lo mismo que una planificación floja. Se permite una activación puntual de Opus (vía `/compass`, nunca en silencio) si se cumple **al menos uno** de estos gatillos objetivos:
- Cambio de trust boundary respecto a lo que definió `/pre-flight`.
- Migración de datos irreversible.
- Modificación de autenticación o permisos.
- Cambio de motor de base de datos.
- `@root-cause` falla 2 veces consecutivas apuntando a la capa de dominio/entidades (Opus-Emergency).
- Más del 40% de los tickets activos requieren reescribir `architecture.md` (Blueprint v2 — pivote de dominio real).
- Discrepancia seria confirmada entre `SPEC.md` y la arquitectura real del código.

Fuera de esta lista, la regla original se mantiene: si "hace falta" Opus y no hay un gatillo de la lista, es señal de planificación floja — se replanifica con Sonnet, no se sube de modelo por comodidad. Después de resolver cualquiera de estos casos, vuelve a Sonnet de inmediato — ninguna excepción se queda "por si acaso". Anota en `journal.md` cuál gatillo aplicó, siempre.

| Agente | Modelo | Rol | Tools |
|---|---|---|---|
| Warden | `claude-sonnet-5` | Revisa: pruebas, linters, límites | Read, Glob, Grep, Bash |
| Artisan | `claude-sonnet-5` | Ejecuta: interfaces y sistema de diseño | Read, Write, Edit, Glob, Grep |
| Chronicle | `claude-haiku-4-5-20251001` | Documenta: memoria, specs, ledger | Read, Write, Edit, Glob, Grep |
| Tracer | `claude-sonnet-5` | Analiza: fallos repetidos, alternativas | Read, Grep, Bash |
| Sentinel | `claude-sonnet-5` | Revisa: gate de seguridad obligatorio pre-deploy | Read, Grep, Bash |
| data-stat-engineer | `claude-sonnet-5` | Fase 9: capa estadística offline (percentiles, Empirical Bayes, perfil de señales, procedencia). No toca el motor. Sin MCP. | Read, Glob, Grep, Bash, Write, Edit |
| evaluation-engineer | `claude-sonnet-5` | Fase 9: harness de evaluación (replay, métricas, 2 benchmarks, Golden Dataset, `gate.ts`). No toca el motor. Sin MCP. | Read, Glob, Grep, Bash, Write, Edit |

Ningún agente corre en Opus — Opus vive únicamente en `/blueprint`, una sola vez por proyecto, antes de que exista ningún agente que invocar. Ver "Política de modelos" arriba.

Decisión de diseño: no se creó un agente "Orquestador" ni "Arquitecto" separado. Orquestar es una skill (`/dispatch`), no un sub-agente — no necesita su propio contexto aislado, y separar el enrutamiento en un sub-agente añadiría latencia sin beneficio. Lo mismo aplica a arquitectura: vive en `/pre-flight` como skill, no como rol permanente, porque solo se ejecuta al inicio del proyecto o ante cambios grandes.

## CONTEXT7 (documentación de librería al día)
MCP declarado en `.mcp.json` (project-scoped, versionado). Se consulta **sólo** en `/rulebook` e
implementación, para confirmar la API vigente de una librería del stack (sobre todo Next.js y Bun).
**Nunca en el camino caliente** — es tooling de desarrollo, no entra en ningún `import` de `apps/`.
Detalle, alcance por agente y CLI equivalente (`npx ctx7 …`) en `.claude/rules/context7.md`.
Token: `CONTEXT7_API_KEY` exportado en el shell (ver `.env.example`); sin él corre en modo anónimo.

## SKILLS
- **Core** (`.claude/skills/`): se cargan siempre, forman el flujo real del proyecto.
- **Extra** (`skills-extra/`): utilidades opcionales de investigación/aprendizaje personal. No se cargan por defecto — se invocan copiando el archivo a `.claude/skills/` o referenciándolo explícitamente.

Ver `docs/SETUP.md` para el listado completo y `CHANGELOG.md` para el historial de decisiones.
