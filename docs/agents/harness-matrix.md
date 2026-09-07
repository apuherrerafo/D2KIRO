# Harness Responsibility Matrix + Taxonomía sin solapamiento

> **Spec:** `.kiro/specs/r0-engineering-baseline-recovery/` — R0.4 Harness Truth, **Task 23**.
> **Requisitos:** 4.2 (taxonomía sin solape), 4.3 (matriz de veredictos), 4.3 c1.
> **Fuente de diseño:** `design.md` §4.4 (Taxonomía del harness, Reconciliation Procedure, Harness
> Learning / Curation, Harness Responsibility Matrix, Agent Guardrail Architecture).
> **Naturaleza:** artefacto de **racionalización**. NO ejecuta ningún KEEP/MERGE/MOVE/DELETE/REFACTOR.
> Produce el mapeo canónico que consumen las Tasks 24–29 y desbloquea la Task 3.
> **Estado del working tree al escribir:** modificados `apps/engine/src/pipeline/run-pipeline.test.ts`,
> `apps/engine/src/server/app.test.ts`, `scripts/eval/benchmark-pro-agreement.test.ts`,
> `scripts/hooks/_hook_lib.py`, `scripts/hooks/data-boundary-guard.py` (Tasks 2/4/17, aceptadas);
> untracked `.kiro/specs/r0-engineering-baseline-recovery/`, `docs/agents/r0-discovery/`,
> `scripts/hooks/hook-path-normalization.test.ts`. Esta Task NO los toca.

---

## 0. Principio rector

**Una responsabilidad → un mecanismo canónico.** La misma regla no debe vivir a la vez en
`CLAUDE.md` + `Rule` + `Agent` + `Skill` + `Hook` + `CI` cuando uno de esos mecanismos puede ser el
**dueño real** de la responsabilidad.

**Las restricciones determinísticas viven en `Permission | Hook | Test | CI | schema/invariant`,
no en instrucciones repetidas a LLMs** (P2 del diseño; regla de dos ramas del Agent Guardrail
Architecture). Un `AGENT` nunca es dueño de un chequeo determinista que puede vivir en código.

**Autoridad para resolver contradicciones doc↔código:** jerarquía ADR-001 L0–L6 (gana el número
menor). L0 = contratos duros (`verify-simplicity.sh`, hooks de `.claude/settings.json`), L1 = ADR,
L2 = `architecture.md`, L3 = `SPEC.md`, L4 = código, L5 = investigación, L6 = memoria de agente.
`invariantes.md` se trata como autoridad alta (L0/L2: invariantes que un gate bloquea).
`journal.md` es append-only y **ortogonal** a la jerarquía.

---

## 1. Inventario real del harness (verificado en el working tree, no asumido del audit)

### 1.1 Contexto / verdad siempre cargada

| Mecanismo | Estado real verificado | Nota |
|---|---|---|
| `CLAUDE.md` | 198 líneas. Título "Fase 4 en curso" pero cuerpo dice "Fase 6 en curso" (drift menor). Índice + L0 + política de modelos + tabla de agentes (7 agentes). | Referencia `verify-claude-md-split.sh` en la línea 90. |
| `.claude/rules/invariantes.md` | 80 líneas. Imperativo, path-agnóstico, dice `SCORING_WEIGHTS_V6` activa, `bun run test` canónico, `raw:null` sagrado. **El mejor artefacto.** | Modelo de convergencia. |
| `.claude/rules/engine.md` | 560 líneas. ~80% narrativa de fases cerradas (1b, 2, 3, 4, 4.2, 4.3, 5, 6, 8, 9, 9.1). | Sigue en `.claude/rules/`, NO archivado. |
| `.claude/rules/security.md` | 266 líneas. Restricciones de seguridad + narrativa por fase. | Cargada siempre. |
| `.claude/rules/testing-seams.md` | 283 líneas. Costuras S1–S19. | Cargada siempre. |
| `.claude/rules/web.md` | 242 líneas. Reglas de `apps/web` (incluye la regla de `STEAM_WEB_API_KEY` en `.env.example`). | Cargada siempre. |
| `.claude/rules/fase-9.md` / `fase-9.1.md` | 50 + 50 líneas. Narrativa + reglas de fase; Fase 9.1 parcialmente activa según `CLAUDE.md`. | Siguen en `.claude/rules/`. |
| `.claude/rules/context7.md` | 34 líneas. Alcance de Context7 MCP por agente; dice explícitamente que Warden/Chronicle/Tracer/Sentinel **NO** lo tienen. | Cargada siempre. |
| `docs/rules-archive/` | **YA EXISTE** con `fase-1, 1b, 3, 4, 4.2, 4.3, 5, 6, 8`. Falta mover `engine.md` y `fase-9*.md`. | Destino de la Task 24. |

### 1.2 Espejos manuales de verdad

| Mecanismo | Estado real verificado | Divergencia |
|---|---|---|
| `AGENTS.md` | 151 líneas. Espejo manual de `CLAUDE.md` para Codex. | Dice `SCORING_WEIGHTS_V5` activo (código = V6); tabla de agentes lista **5** (falta `data-stat-engineer`, `evaluation-engineer`); comandos `bun run dev` / `bun test` / `bun run lint` (canónico real = `bun run test`; `dev`/`lint` de raíz no existen). |
| `.kiro/steering/tech.md` | Dice `SCORING_WEIGHTS_V5 es la constante activa` (auditoría 2026-08-22, TSK-065). | Diverge de `invariantes.md` (V6). |
| `.kiro/steering/product.md` | Menciona `SCORING_WEIGHTS_V5`. | Diverge de V6. |
| `.kiro/steering/structure.md` | Menciona `SCORING_WEIGHTS_V5`. | Diverge de V6. |
| `.kiro/hooks/verify-simplicity.md` | Definición de hook lado-Kiro; nota que el script devuelve exit 1, no 2. | Informativa; no es fuente de verdad. |

### 1.3 SPEC / ADR / memoria

| Mecanismo | Estado real |
|---|---|
| `.kiro/specs/` | `engine-performance-optimizations/`, `random-draft-simulator/`, `r0-engineering-baseline-recovery/`. |
| `docs/adr/` | ADR-001 (jerarquía L0–L6), ADR-002 (pro pick ≠ ground truth), ADR-003 (frontera curated/generated), ADR-004 (percentiles diferidos), ADR-005 (etiquetado Golden Dataset). + `README.md`. |
| `docs/agents/architecture.md` | 138 KB — arquitectura viva (L2). |
| `docs/specs/SPEC.md` | 344 KB — contrato por fase (L3). |
| `docs/agents/journal.md` | 702 KB, append-only, protegido por `verify-simplicity.sh`. |
| `docs/agents/ledger.md` | 33 KB, append-only. **Destino canónico único** del Reconciliation Procedure. |
| `docs/agents/CONTEXT.md` | Hechos de dominio Dota dispersos (candidato a "Dota Domain Pack", solo declarado). |
| `docs/agents/PROGRESS.md` | Estado de fase (dice Fase 10). |

### 1.4 Skills y command wrappers

| Mecanismo | Estado real |
|---|---|
| `.claude/skills/` | **25 directorios** (`SKILL.md` cada uno): blueprint, brainstorm, build, castoff, compass, depcheck, design-forge, dispatch, evolve, foundation-check, gear-up, grill-me, helm, kickoff, launchpad, loop, nightwatch, onboarding, pre-flight, prototype, redteam, root-cause, rulebook, scout, shipcheck. |
| `.claude/commands/` | **30 wrappers de una línea.** 25 espejan 1:1 una skill; 5 son alias (`plan`→kickoff/pre-flight/blueprint, `fix`→root-cause, `review`→redteam, `ship`→shipcheck+castoff, `start`→onboarding/launchpad). |

### 1.5 Agentes (`.claude/agents/`, 7 archivos)

| Agente | `tools:` declaradas | Defecto verificado |
|---|---|---|
| `warden.md` | Read, Glob, Grep, **Bash** | Instruye al LLM a correr `bun test` + `bun run lint` + contar archivos (`git diff --name-only`). Chequeo determinista corrido por un LLM → **viola P2**. `bun run lint` de raíz no existe. |
| `artisan.md` | Read, Write, Edit, Glob, Grep, **mcp__context7** | Exige `docs/agents/DESIGN_SYSTEM.md` — **no existe** (`docs/agents/` no lo tiene), pero sí tiene consumidores vigentes: `dispatch` enruta UI a Artisan y `web.md` lo exige para el acabado de pantallas. |
| `tracer.md` | Read, Grep, Bash | Cuerpo dice "Consulta Context7 MCP" pero `tools:` **no** incluye `mcp__context7`; `context7.md` dice explícitamente que Tracer NO debe tenerlo. Instrucción insatisfacible / contradictoria. |
| `chronicle.md` | Read, Write, Edit, Glob, Grep | Contradicción interna: declara `journal.md` append-only y "nunca comprimas o elimines", pero también ordena archivarlo y empezar un `journal.md` vacío al superar ~500 entradas. Vaciarlo viola la protección append-only. |
| `sentinel.md` | Read, Grep, Bash | Su juicio semántico sobre trust boundaries y abuse paths es legítimo; también repite como autoridad verificaciones deterministas (secretos, bindings, imports/red, dependencias) que deben venir de Permission/Hook/Test/CI. |
| `data-stat-engineer.md` | Read, Glob, Grep, Bash, Write, Edit | Fase 9, bien acotado, sin `mcp__context7`. Preservar intacto (regla (a)). |
| `evaluation-engineer.md` | Read, Glob, Grep, Bash, Write, Edit | Fase 9, bien acotado, sin `mcp__context7`. Preservar intacto (regla (a)). |

**Conteo de agentes: 7 antes de Task 23 — 7 después de Task 23** (esta Task no crea ni retira
agentes; R0.4 / requisito 4.4 c3 PROHÍBE crear agentes nuevos).

### 1.6 Hooks / guards / gates deterministas

| Mecanismo | Estado real verificado |
|---|---|
| `.claude/settings.json` → PreToolUse `Bash` | `scripts/hooks/pretooluse-guard.sh`: si el comando es `git commit\|push`, corre `VERIFY_COMMIT_GATE=1 bash scripts/verify-simplicity.sh` (tsc + suites + backtest). Solo dentro de sesión Claude Code. |
| `.claude/settings.json` → PreToolUse `Edit\|Write\|MultiEdit` | `scripts/hooks/pretooluse-edit-guard.sh` → encadena `data-boundary-guard.py` + `write-scope-guard.py`. |
| `.claude/settings.json` → PostToolUse `Edit\|Write` + SubagentStop | `bash scripts/verify-simplicity.sh` (escaneo + **efecto colateral**: llama `scripts/sync-context.ts` como informativo `\|\| true`). |
| `scripts/verify-simplicity.sh` | Gate L0. Secciones: sync-context (informativo), base de diff adaptativa local/CI, dependencias de producción (**sección 1**), secretos, WIP, append-only, invariantes y `VERIFY_COMMIT_GATE=1` → tsc+suites+backtest. La sección 1 inspecciona el **diff staged** de `dependencies` y exige `// ALLOWED`; no demuestra que `/gear-up` o `@depcheck` se hayan ejecutado. |
| `scripts/sync-context.ts` | **EXISTE** (7.6 KB). Avisa si `AGENTS.md`/`.kiro/steering/` quedaron atrás del stack. Llamado como informativo desde `verify-simplicity.sh`. |
| `scripts/hooks/_hook_lib.py` | `to_repo_relative` / `matches_any` — normalización de ruta (endurecida en Task 4, OS-independiente, fail-closed). |
| `scripts/hooks/data-boundary-guard.py` | Protege `data/curated/**` (ADR-003). Fail-closed tras Task 4. |
| `scripts/hooks/write-scope-guard.py` | Encierra escrituras al `write_scope` del ticket en `doing`. Fail-open si no hay ticket/`write_scope` (retrocompatible). |
| `scripts/hooks/hook-guards.test.ts` / `hook-path-normalization.test.ts` | Tests de los guards. |
| `.github/workflows/ci.yml` | 2 jobs: `test` (matriz engine/web/root: `bun install` por árbol, `tsc --noEmit` engine+web, `bun run lint` **solo web**, `bun test`), y `verify-simplicity` (`bash scripts/verify-simplicity.sh`). Único gate real hoy. |
| `scripts/eval/gate.ts` | Gate de evaluación Fase 9. `--enforce` sin uso; `return 0` en informativo; dataset vacío / baseline ausente → PASS silencioso (lo repara R0.2A, Tasks 8–10). |

### 1.7 Discovery de R0 ya producida

| Artefacto | Contenido relevante |
|---|---|
| `docs/agents/r0-discovery/pre-push-gate.md` (Task 1, aceptada) | **CONFIRMED:** `core.hooksPath` vacío en todo scope; `.git/hooks` solo samples; Husky nunca instalado; sin `node_modules` en la raíz. CI (Ubuntu) es la **única** capa de gate real hoy. **No existe PRE-PUSH gate local.** Entorno de commits = Git Bash sobre Windows 10 (no WSL). Convergencia P3 real = **Windows Git Bash ↔ Ubuntu CI** (WSL no es entorno activo: `/home` vacío, sin `bun`, sin identidad git — INFERENCE fuerte). |
| `docs/agents/r0-discovery/pro-drafts-db.md` (Task 7) | **NO EXISTE aún** — Task 7 pendiente. Bloquea solo el sub-check Pro Agreement / Benchmark B. |
| `docs/agents/r0-discovery/railway-env-persistence.md` (Task 21) | **NO EXISTE aún** — Task 21 pendiente. Bloquea `STEAM_WEB_API_KEY` en `.env.example` + guardrail de secretos + acciones de persistencia. |

### 1.8 Evidencia de drift respecto al Design §4.4

| Design §4.4 afirma | Realidad del working tree | Consecuencia |
|---|---|---|
| `CHECKPOINT.json` existe (todo null) → DELETE | **NO existe** — ya fue borrado. | Verdict = N/A (ya hecho). Task 28 solo confirma ausencia. |
| `verify-claude-md-split.sh` sin llamadores (código muerto) → DELETE | No tiene caller automático en hook/CI/otro script. `CLAUDE.md:90` es referencia documental vigente y `TSK-196`/`TSK-218` conservan comandos de verificación históricos. Working tree `w/crlf`; ejecutado con Git Bash real falla con 336 líneas "PERDIDA O ALTERADA" por la comparación sensible a CRLF. | Verdict reclasificado: **REFACTOR / PENDING DECISION**. No DELETE automático y no KEEP intacto: Task 28 decide si restaura un caller verificable o retira primero el contrato documental y luego elimina. |
| `analisis-arquitectura.sh` sin llamadores (código muerto) → DELETE | **Caller ejecutable activo:** `.claude/skills/foundation-check/SKILL.md` lo autoriza y lo ejecuta en el paso 1. Working tree `w/crlf`; además, la ejecución real emite `integer expression expected` en la línea 20 cuando `grep -c` devuelve cero y el fallback agrega otro `0`. | Verdict reclasificado: **KEEP+REFACTOR**. Task 28 no lo borra; una tarea posterior debe restaurar su estado operativo y verificar `/foundation-check`. |
| `.agents/` vacío → DELETE | Directorio vacío **presente**. | Verdict = DELETE en pie (Task 28). |
| `.claude/commands/` = 30 wrappers sobre **24** skills | 30 wrappers sobre **25** skills (25 espejo 1:1 + 5 alias). | Conteo menor; no cambia el veredicto SIMPLIFY→MERGE (optional). |
| AGENTS.md tabla de agentes = espejo de CLAUDE.md | AGENTS.md lista **5** agentes; CLAUDE.md lista **7**. | Refuerza MERGE/DELETE de AGENTS.md (ya diverge dentro de sí mismo). |

---

## 2. Taxonomía canónica del harness (sin solapamiento)

Diez categorías. Cada una con su **regla de no-solape** — el criterio que impide que una
responsabilidad viva simultáneamente en dos categorías.

La clasificación usa **dos ejes distintos**:

1. **Primary responsibility / mechanism type:** exactamente una de las diez categorías de esta
   sección. Responde *qué responsabilidad implementa el artefacto* y evita doble ownership.
2. **Invocation / execution layer:** evento o capa que lo llama (`PreToolUse`, `PostToolUse`,
   `TASK COMPLETION`, `PRE-PUSH`, `PR/CI`, `INTELLIGENCE CI`, invocación manual). Responde *cuándo y
   desde dónde corre*. No convierte al artefacto invocado en otro tipo de mecanismo.

Ejemplo vinculante: `write-scope-guard.py` tiene **Primary = PERMISSION** (implementa el límite duro)
y **Invoked by = HOOK / PreToolUse**. No tiene ownership primario simultáneo `PERMISSION` y `HOOK`.
De igual forma, `verify-simplicity.sh` tiene **Primary = HOOK** (gate determinista) y puede ser
invocado en capas PostToolUse, commit-gate o CI sin adquirir tres categorías primarias.

| Categoría | Definición canónica | Regla de no-solapamiento | Dueño de referencia en este repo |
|---|---|---|---|
| **CLAUDE.md** | Contexto permanente, pequeño, que Claude casi siempre necesita (índice + L0 + política de modelos + tabla de roles). | **Cero narrativa de fase cerrada** (va a `docs/rules-archive/`). Cero procedimiento (eso es SKILL). Cero restricción path-specific (eso es RULE). | `CLAUDE.md` (198 líneas, a endurecer). |
| **RULE** | Verdad contextual / restricción persistente, preferiblemente path-scoped, **imperativa** (no relato). | No es procedimiento invocable. No es decisión con rationale (eso es ADR). Modelo: `invariantes.md`. | `.claude/rules/{invariantes,security,testing-seams,web,context7}.md`. |
| **SKILL** | Procedimiento reutilizable, invocado **bajo demanda**. | No se carga en cada turno. No impone una restricción (eso es RULE/PERMISSION). No corre como gate obligatorio. | `.claude/skills/*` (25). |
| **AGENT / SUBAGENT** | Especialista que se beneficia de **contexto aislado**; interpreta, sintetiza, redacta. | **Nunca es dueño de un chequeo determinista** que puede vivir en código (HOOK/CI/TEST, P2). Declara solo las `tools` que necesita (mínimo privilegio). | `.claude/agents/*` (7; `chronicle`, `sentinel`, `data-stat-engineer`, `evaluation-engineer` bien acotados). |
| **HOOK** | Automatización **determinista** atada a un evento (PreToolUse / PostToolUse / SubagentStop / git). | Un solo nivel de la arquitectura de verificación §3.2. **Sin efectos colaterales en el nivel barato** (AFTER EDIT). No es juicio de LLM. | `.claude/settings.json` hooks + `scripts/hooks/*` + `verify-simplicity.sh`. |
| **PERMISSION** | Límite duro de seguridad / acceso / write-scope. **Bloquea**, no es checklist. | No pondera; falla cerrado ante ambigüedad. No se implementa como prosa a un agente. | `write-scope-guard.py`, `data-boundary-guard.py`, `tools:` por agente, `.claude/settings.json`. |
| **SPEC** | Intención + diseño + tareas de **un** cambio concreto. | Una spec no es fuente de verdad permanente (eso es ADR/RULE tras cerrarse). | `.kiro/specs/*`. |
| **ADR** | Decisión arquitectónica **y su porqué**. Inmutable salvo ADR que la supersede. | No es contrato de fase (eso es SPEC). No es restricción operativa suelta (eso es RULE). | `docs/adr/ADR-00{1..5}`. |
| **TEST** | Evidencia determinista de **correctitud de software**. | **Separado de EVAL.** No mide calidad de inteligencia de drafting. | `**/*.test.ts`, `bun run test`, `bun test` por raíz en CI. |
| **EVAL** | Evidencia de **correctitud de inteligencia** (calidad de draft: NDCG@5, Bad Pick Rate, Pro Agreement). | **Separado de TEST.** No corre en pre-push; vive en INTELLIGENCE CI. El pick pro no es ground truth (ADR-002). | `scripts/eval/`, `eval/`, `scripts/stats/`, `gate.ts --enforce`. |

**Solapamientos mayores encontrados** (una responsabilidad, varios mecanismos):

1. **Ejecución de `bun test` / `bun run lint`** vive hoy en: agente **Warden** (prosa a LLM), hook
   **PreToolUse commit gate** (`verify-simplicity.sh` con `VERIFY_COMMIT_GATE=1`), y **CI**
   (`ci.yml` job `test`). → Canónico: **CI + PRE-PUSH gate local (Task 5) + TASK COMPLETION**.
   Warden deja de ejecutarlo (solo interpreta). Verdict Warden = REFACTOR (Task 25).
2. **Estado de pesos activos (V5 vs V6)** vive en: `invariantes.md` (V6 ✓), código (V6 ✓),
   `AGENTS.md` (V5 ✗), `.kiro/steering/{tech,product,structure}.md` (V5 ✗). → Canónico:
   `invariantes.md` + código (autoridad alta ADR-001). Espejos convergen a V6 vía Reconciliation
   Procedure (Task 24).
3. **Narrativa de fase** vive en: `.claude/rules/engine.md` (~80%), `fase-9*.md`, `CLAUDE.md`
   (título), y `docs/rules-archive/` (fases 1–8, correcto). → Canónico: `docs/rules-archive/` para
   narrativa; lo imperativo se destila a `invariantes.md` / RULE (Task 24).
4. **Regeneración de contexto (`sync-context.ts` / `hub.html`)** vive como **efecto colateral** de
   `verify-simplicity.sh` (nivel barato PostToolUse). → Canónico: **acción explícita**, fuera del
   escaneo barato (Task 27).
5. **Trabajo pesado (`tsc` + suites + backtest + eval)** vive en el **commit gate PreToolUse** (por
   commit, minutos). → Canónico: PRE-PUSH / PR / CI para software; **INTELLIGENCE CI** para el eval
   `--enforce` (Tasks 10, 27).
6. **Comando de test** documentado como `bun test` / `bun run dev` / `bun run lint` en `AGENTS.md`
   y `CLAUDE.md`, cuando el canónico es `bun run test` y `dev`/`lint` de raíz no existen. →
   Canónico: `package.json` + `invariantes.md` (Tasks 6, 24).
7. **Verificación de dependencias** referenciada en `/gear-up`, `@depcheck`, `verify-simplicity.sh`
   §3, Governance 2.0 (`CLAUDE.md` + `security.md`). No es solape nocivo: procedimiento (skills) +
   enforcement (script) + política (rules) son capas distintas de **un** dueño. Se consolida su
   enunciado (ver §5).
8. **Learning / curation de conocimiento durable**: hoy **sin dueño** — todo cae a `journal.md` /
   `engine.md` sin regla de enrutamiento (gap del audit). → Canónico: procedimiento que **propone**
   (Task 29), sin crear mecanismo nuevo sin aprobación.

---

## 3. Harness Responsibility Matrix

Formato por fila: **Current mechanism → Current responsibility → Evidence / observed problem →
Canonical responsibility → Canonical mechanism → Verdict → Target → Task ejecutora → Riesgo/notas.**

Los veredictos derivan de `design.md` §4.4 (tabla Harness Responsibility Matrix) **ajustados por la
evidencia del working tree** (§1.8). Ninguno se ejecuta en esta Task.

### 3.1 Contexto / reglas

| # | Current mechanism | Current responsibility | Evidence / observed problem | Canonical responsibility | Canonical mechanism | Verdict | Target | Task | Riesgo / notas |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `CLAUDE.md` | Contexto permanente pequeño + índice + política de modelos | Título "Fase 4" vs cuerpo "Fase 6"; referencia a `verify-claude-md-split.sh` | Índice + L0 + roles; sin narrativa de fase | `CLAUDE.md` | **KEEP+HARDEN** | — | 24 (drift de fase/comandos), 6 (comandos) | No mover invariantes fuera; ≤ ~200 líneas |
| 2 | `.claude/rules/invariantes.md` | Invariantes canónicos, imperativos, path-agnósticos | Correcto; dice V6 | Igual | `RULE` (modelo de referencia) | **KEEP (intacto)** | — | ninguna | Regla (a): no se toca |
| 3 | `.claude/rules/engine.md` | ~80% narrativa de fases cerradas + algo imperativo | 560 líneas inyectadas por turno | Narrativa → archivo; imperativo → RULE | `docs/rules-archive/` + destilar a `invariantes.md`/RULE | **MOVE** | `docs/rules-archive/engine.md` | 24 | Preservar cada línea imperativa; `docs/rules-archive/` ya existe |
| 4 | `.claude/rules/security.md` | Restricciones de seguridad (+ narrativa de fase) | Cargada siempre; parte es narrativa | Política de seguridad path-scoped | **Primary: `RULE`** | **KEEP** (podar narrativa de fase cerrada opcional) | — | 24 (poda opcional) | Enforcement separado: `PERMISSION`/`HOOK`/`TEST`/`CI`; la prosa no es el límite duro |
| 5 | `.claude/rules/testing-seams.md` | Costuras de prueba S1–S19 | Correcto | Igual | `RULE` | **KEEP** | — | ninguna | — |
| 6 | `.claude/rules/web.md` | Reglas `apps/web` (incl. `STEAM_WEB_API_KEY` en `.env.example`) | Regla escrita pero `.env.example` no la cumple | Igual | `RULE` | **KEEP+HARDEN** | `.env.example` | 24 (c1, tras §9.2 / Task 21) | Documentar solo el nombre del secreto |
| 7 | `.claude/rules/fase-9.md` / `fase-9.1.md` | Narrativa + reglas de fase (9.1 parcialmente activa) | Narrativa mezclada con lo vigente | Narrativa → archivo; vigente → RULE/ADR | `docs/rules-archive/` + RULE | **MOVE** (con cuidado: preservar lo activo de 9.1) | `docs/rules-archive/fase-9*.md` | 24 | Verificar qué de 9.1 sigue vinculante antes de mover |
| 8 | `.claude/rules/context7.md` | Alcance de Context7 MCP por agente | Correcto y coherente con least-privilege | Igual | `RULE` | **KEEP** | — | ninguna | Confirma que Tracer NO tiene `mcp__context7` |
| 9 | `docs/rules-archive/` | Archivo de narrativa de fase cerrada | Ya contiene fases 1–8 | Igual | destino de MOVE | **KEEP** | — | 24 (recibe engine.md/fase-9*) | — |

### 3.2 Espejos manuales de verdad

| # | Current mechanism | Current responsibility | Evidence / observed problem | Canonical responsibility | Canonical mechanism | Verdict | Target | Task | Riesgo / notas |
|---|---|---|---|---|---|---|---|---|---|
| 10 | `AGENTS.md` | Espejo de `CLAUDE.md` para Codex (reviewer independiente) | Dice V5; 5 agentes (faltan 2); comandos `bun run dev`/`bun test`/`bun run lint` inexistentes/no-canónicos | Punto de entrada para Codex **sin duplicar verdad divergible** | Generado desde la fuente, o pointer mínimo, o eliminado | **MERGE** (regenerar como pointer delgado; DELETE si Codex no lo requiere) | `AGENTS.md` reducido a "fuente canónica = `CLAUDE.md` + `.claude/rules/`" | 24 | Codex es rol confirmado → no borrar sin confirmar su flujo; quitar toda cifra/tabla divergible |
| 11 | `.kiro/steering/tech.md` | Steering de stack para Kiro (IDE principal) | Dice `SCORING_WEIGHTS_V5` activa | Steering específico de Kiro, no espejo de verdad | Reconciliar vía Reconciliation Procedure → V6; podar duplicación | **REFACTOR→KEEP** | `.kiro/steering/tech.md` | 24 | `.kiro/` NO se archiva (§9.5 resuelto); solo se quita la duplicación |
| 12 | `.kiro/steering/product.md` | Steering de producto para Kiro | Menciona V5 | Igual que 11 | Igual | **REFACTOR→KEEP** | `.kiro/steering/product.md` | 24 | Igual |
| 13 | `.kiro/steering/structure.md` | Steering de estructura para Kiro | Menciona V5 | Igual que 11 | Igual | **REFACTOR→KEEP** | `.kiro/steering/structure.md` | 24 | Igual |
| 14 | `.kiro/hooks/verify-simplicity.md` | Definición lado-Kiro del hook | Informativa; nota exit 1 vs 2 | Puntero al gate real | `HOOK` (real: `verify-simplicity.sh`) | **KEEP** | — | ninguna | Sin acción; no es fuente de verdad |

### 3.3 SPEC / ADR / memoria

| # | Current mechanism | Current responsibility | Evidence / observed problem | Canonical responsibility | Canonical mechanism | Verdict | Target | Task | Riesgo / notas |
|---|---|---|---|---|---|---|---|---|---|
| 15 | `.kiro/specs/*` | Specs de cambios concretos | Correcto | Igual | `SPEC` | **KEEP** | — | ninguna | — |
| 16 | `docs/adr/ADR-00{1..5}` | Decisiones arquitectónicas + rationale | Correcto | Igual | `ADR` | **KEEP (intactos)** | — | ninguna | Regla (a) |
| 17 | `docs/agents/architecture.md` (L2) | Arquitectura viva por fase | 138 KB | Igual | (fuera de taxonomía del harness; L2 ADR-001) | **KEEP** | — | ninguna | — |
| 18 | `docs/specs/SPEC.md` (L3) | Contrato de desarrollo por fase | 344 KB | Igual | (L3 ADR-001) | **KEEP** | — | ninguna | — |
| 19 | `docs/agents/journal.md` | Memoria histórica append-only | Protegido por `verify-simplicity.sh` | Igual | fuente append-only, ortogonal | **KEEP (intacto)** | — | ninguna | Regla (a); nunca se borran líneas |
| 20 | `docs/agents/ledger.md` | Registro append-only de tareas/decisiones | — | **Destino canónico único** de reconciliaciones materiales | append-only | **KEEP (intacto)** | — | 24 (solo append) | Solo reconciliaciones **materiales**; no sync triviales |
| 21 | `docs/agents/CONTEXT.md` | Hechos de dominio Dota dispersos | Sin regla de enrutamiento | Destino "Dota Domain Pack" (solo declarado) | `RULE` / Pack (no se diseña en R0) | **KEEP** (declarar como destino) | — | 29 (solo lo referencia) | No se diseña el Pack en R0 |

### 3.4 Skills y command wrappers

| # | Current mechanism | Current responsibility | Evidence / observed problem | Canonical responsibility | Canonical mechanism | Verdict | Target | Task | Riesgo / notas |
|---|---|---|---|---|---|---|---|---|---|
| 22 | `.claude/commands/` (30) | Wrappers de una línea sobre skills + 5 alias | 25 espejan 1:1 su skill; ruido de mantenimiento | Invocación / alias, no lógica | consolidar sobre las `SKILL` | **SIMPLIFY→MERGE** | `.claude/commands/` | 24 (o diferible) | **Clase: optional** (req. 4.3 c3). Bajo riesgo; conservar los 5 alias reales |
| 23 | `.claude/skills/` (25) | Procedimientos bajo demanda | Solapamientos entre algunas skills | Procedimiento reutilizable | `SKILL` | **KEEP** (racionalizar solapamientos) | — | 24 (opcional) | No multiplicar; no crear skills nuevas |

### 3.5 Agentes

| # | Current mechanism | Current responsibility | Evidence / observed problem | Canonical responsibility | Canonical mechanism | Verdict | Target | Task | Riesgo / notas |
|---|---|---|---|---|---|---|---|---|---|
| 24 | Agente **Warden** | "Ejecuta pruebas, verifica estilos" | Corre `bun test` + `bun run lint` + conteo de archivos vía LLM → **viola P2**; `bun run lint` de raíz no existe | El chequeo determinista lo corre **código**; el agente solo **interpreta** | **Primary check owner: `TEST`**; execution layers PRE-PUSH/CI; Warden conserva solo **Primary: `AGENT/SUBAGENT`** para interpretación | **REFACTOR** (mover el chequeo; agente consume, no ejecuta) | `.claude/agents/warden.md` | **25** (las capas de ejecución las provee la **27**) | Si sobrevive, queda como intérprete; si no aporta interpretación, retirar (menos, no más) |
| 25 | Agente **Artisan** | "Construye interfaces / design system" | Exige `docs/agents/DESIGN_SYSTEM.md` **inexistente**, pero tiene consumidores vigentes: `.claude/skills/dispatch/SKILL.md` enruta UI a Artisan y `.claude/rules/web.md` lo exige junto a `/design-forge` para pantallas | Especialista UI con dependencia documental reparada o consumidores explícitamente rediseñados | **Primary: `AGENT/SUBAGENT`** | **REFACTOR / KEEP-PENDING-CONSUMER-REVIEW** | `.claude/agents/artisan.md` y, solo si se propone retirarlo, sus consumidores | **25** | No DELETE mientras existan esos consumidores; cualquier retiro exige resolverlos primero; no crear sustituto |
| 26 | Agente **Tracer** | "Analiza fallos repetidos" (`attempts:3` → Tracer) | Cuerpo dice "Consulta Context7 MCP" pero `tools:` no lo incluye y `context7.md` lo prohíbe | Análisis de patrones repetidos, sin MCP | quitar la línea de Context7; mantener el rol de análisis | **REFACTOR** (alinear con `context7.md`; **no** añadir el MCP) | `.claude/agents/tracer.md` | **25** | `attempts→Tracer` sigue cableado en `/helm` + `CLAUDE.md`; solo se corrige la instrucción insatisfacible |
| 27 | Agente **Chronicle** | Documenta memoria/specs/ledger | Contradicción: manda preservar `journal.md` append-only y también vaciarlo tras archivarlo al superar ~500 entradas | Mantener memoria derivada/resúmenes sin truncar ni vaciar `journal*.md` o `ledger.md` | **Primary: `AGENT/SUBAGENT`** | **REFACTOR** | `.claude/agents/chronicle.md` | **25** | Puede generar artefactos derivados o una estrategia de partición compatible, pero jamás destruir historia protegida |
| 28 | Agente **Sentinel** | Gate semántico de seguridad pre-deploy | El análisis de trust boundaries, abuse paths, explotabilidad y riesgo residual requiere juicio; sus reglas 3/5/6/7 duplican comprobaciones deterministas o afirman verificar ejecución de una skill sin evidencia mecánica | Interpretar el diff y los resultados deterministas; emitir PASS/FAIL semántico con evidencia y riesgo residual | **Primary: `AGENT/SUBAGENT`**; invoked with evidence from `PERMISSION`/`HOOK`/`TEST`/`CI` | **KEEP+REFACTOR** | `.claude/agents/sentinel.md` | **25** (instrucción del agente) + **26** (arquitectura de guardrails) | Sentinel consume resultados deterministas; no los duplica ni los reemplaza como autoridad |
| 29 | Agentes **data-stat-engineer** / **evaluation-engineer** | Estadística / evaluación Fase 9 | Bien acotados, sin `mcp__context7`, veto de escritura sobre el motor | Igual | `AGENT` acotado | **KEEP (intactos)** | — | ninguna | Regla (a): explícitamente preservados |

### 3.6 Hooks / guards / gates

| # | Current mechanism | Current responsibility | Evidence / observed problem | Canonical responsibility | Canonical mechanism | Verdict | Target | Task | Riesgo / notas |
|---|---|---|---|---|---|---|---|---|---|
| 30 | Hook PostToolUse `verify-simplicity.sh` | Escaneo estático + **efecto colateral** (`sync-context.ts` → `hub.html`) | Nivel barato con efectos secundarios; 6 barridos `git ls-files\|grep` | Escaneo barato **sin efectos**; regeneración = acción explícita | `HOOK` (AFTER EDIT, sin efectos) + acción explícita separada | **REFACTOR** | `.claude/settings.json`, `verify-simplicity.sh` | **27** | No dejar un nivel obligatorio sin cobertura al mover |
| 31 | Hook PreToolUse Bash commit gate | `tsc` + suites + backtest por `git commit/push` | Minutos por commit; solo en sesión Claude Code (no git real) | Trabajo pesado en PRE-PUSH/PR/CI; eval `--enforce` en INTELLIGENCE CI | `HOOK` PRE-PUSH local (Task 5) + `CI` + INTELLIGENCE CI (Task 10) | **MOVE** | `.husky/pre-push` (o equiv. local) + `ci.yml` | **27** (consume 5 y 10) | No duplicar lo ya cableado en 5/10 |
| 32 | `scripts/hooks/write-scope-guard.py` | Encierra escritura al `write_scope` del ticket en `doing` | Fail-open sin ticket (retrocompatible, aceptable) | Límite duro de write-scope | **Primary: `PERMISSION`** | **KEEP+HARDEN** | — | 26 (lo **referencia**, no duplica) | **Invoked by:** HOOK / PreToolUse mediante `pretooluse-edit-guard.sh`; Guardrail 3 se apoya aquí |
| 33 | `scripts/hooks/data-boundary-guard.py` | Protege `data/curated/**` | Endurecido en Task 4 (fail-closed, OS-independiente); ADR-003 documenta el rationale, no implementa el bloqueo | Frontera curated/generated | **Primary: `PERMISSION`** | **KEEP+HARDEN** | — | 26 (referencia) | **Invoked by:** HOOK / PreToolUse; ADR-003 = `ADR`, `_hook_lib.py` = implementación auxiliar, sin co-ownership |
| 34 | `scripts/hooks/_hook_lib.py` | Normalización de ruta compartida para guards | Endurecido en Task 4 (CP6) | Implementación auxiliar única de los límites de permiso | **Primary: `PERMISSION`** (helper, no gate autónomo) | **KEEP (Task 4)** | — | ninguna | Lo invocan los guards; no es simultáneamente HOOK ni TEST |
| 35 | `scripts/verify-simplicity.sh` | Gate de límites/seguridad/deps/append-only (L0) | Mezcla escaneo barato + trabajo pesado + efecto colateral | Gate determinista L0 | **Primary: `HOOK`** | **KEEP+HARDEN** (quitarle el efecto colateral, mover lo pesado) | `verify-simplicity.sh` | **27** | **Invoked by:** PostToolUse/SubagentStop, commit gate y CI; esas capas no cambian su tipo primario |
| 36 | `scripts/sync-context.ts` | Regenera contexto / `hub.html`; avisa de drift `AGENTS.md`/steering | Corre como colateral informativo del gate barato | Acción **explícita**, no colateral | acción explícita (script invocado a mano / nivel propio) | **MOVE** | `scripts/sync-context.ts` (invocación explícita) | **27** | Útil como detector de drift; solo cambia **cuándo** corre |
| 37 | `.github/workflows/ci.yml` | Único gate real hoy (test + verify-simplicity) | `lint` solo en web (correcto); no ejecuta eval `--enforce` | PR/CI = software completo; INTELLIGENCE CI = eval pesado | `CI` | **KEEP+HARDEN** | `ci.yml` | 10 (cablear `--enforce` a INTELLIGENCE CI), 27 | No añadir eval pesado a pre-push |
| 38 | `scripts/eval/gate.ts` | Gate de evaluación Fase 9 | `--enforce` sin uso; PASS silencioso con dataset/baseline ausente | Gate que **falla fuerte** (P1); `GateStatus` 4 estados; clase por sub-check | `EVAL` (envoltura de política; `evaluateGate()` intacto) | **REFACTOR** | `scripts/eval/gate.ts` | **8, 9, 10** (R0.2A) | Fuera del scope de la Task 23; listado para completitud |

### 3.7 Código muerto / drift (ajustado por §1.8)

| # | Current mechanism | Design §4.4 dice | Evidence / observed problem | Verdict ajustado | Task | Riesgo / notas |
|---|---|---|---|---|---|---|
| 39 | `scripts/verify-claude-md-split.sh` | DELETE (sin llamadores) | Solo referencias documentales/históricas (`CLAUDE.md`, TSK-196/218); sin caller automático. `w/crlf`; falla hoy en Git Bash (336 líneas reportadas como perdidas/alteradas) | **REFACTOR / PENDING DECISION** — no DELETE automático y no KEEP intacto; decidir entre restaurar un caller útil y portable o retirar primero su contrato documental y después eliminar | **28** (su stop condition prevalece) | No reparar CRLF en Task 23 |
| 40 | `scripts/analisis-arquitectura.sh` | DELETE (sin llamadores) | Caller activo `.claude/skills/foundation-check/SKILL.md`; `w/crlf`; ejecución actual rota (`integer expression expected` en línea 20 para archivos con cero imports) | **KEEP+REFACTOR** — conservar por su consumidor y corregir estado operativo posteriormente | **28** (NO DELETE; su stop condition prevalece) | No reparar script/CRLF en Task 23; si se depreca `/foundation-check`, esa sería otra decisión |
| 41 | `.agents/` (directorio vacío) | DELETE | Presente y vacío | **DELETE** | **28** | Sin riesgo |
| 42 | `CHECKPOINT.json` | DELETE (todo null) | **Ya no existe** en el working tree | **N/A (ya hecho)** | **28** (solo confirma ausencia) | Drift vs audit; sin acción |
| 43 | `docs/agents/tasks/TSK-174.md` `state:` | Corregir `state:in_progress` (valor inválido) | No verificado en esta Task (fuera del inventario del harness); el design lo afirma | **REFACTOR** (corregir a estado válido del esquema) | **28** | Verificar el valor real en Task 28 |

---

## 4. Dueños canónicos por responsabilidad transversal

| Responsabilidad | Dueño canónico (mecanismo) | NO es dueño | Enganche existente | Task |
|---|---|---|---|---|
| **write-scope** | **Primary: `PERMISSION`** — `scripts/hooks/write-scope-guard.py` (fail-open sin ticket, por diseño retrocompatible) | ningún agente, ninguna prosa | **Invoked by:** `pretooluse-edit-guard.sh`, HOOK / PreToolUse en `.claude/settings.json` | 26 lo referencia |
| **data-boundary** (curated/generated) | **Primary: `PERMISSION`** — `scripts/hooks/data-boundary-guard.py` (fail-closed tras Task 4) | ningún agente; ADR-003 explica pero no bloquea | **Invoked by:** `pretooluse-edit-guard.sh`; `_hook_lib.py` normaliza | 26 lo referencia |
| **verification** (software) | **Primary: `TEST`** — `bun run test` y gates deterministas | ningún agente (P2); Warden solo interpreta | **Execution layers:** TASK COMPLETION · PRE-PUSH local (Task 5) · PR/CI (`ci.yml`) | 5, 25, 27 |
| **verification** (inteligencia) | **Primary: `EVAL`** — `scripts/eval/gate.ts --enforce` | pre-push; ningún agente; el pick pro (ADR-002) | **Execution layer:** INTELLIGENCE CI; `evaluateGate()` intacto; Tasks 8–10 | 10 |
| **dependency management** | Tres responsabilidades, sin co-ownership: **Policy = `RULE`** (Governance 2.0 en `CLAUDE.md` + `security.md`); **Procedure = `SKILL`** (`@depcheck` directo, o `/gear-up`→`@depcheck` al elegir stack); **Enforcement = `HOOK`** (`verify-simplicity.sh` §1) | ningún agente; `invariantes.md` no contiene Governance 2.0; el script no prueba que se ejecutó una skill | ver §5 | 3 (consume), 24 (política en docs) |
| **harness learning / curation** | **Sin dueño hoy** (gap). Canónico objetivo: procedimiento que **detecta + clasifica + PROPONE** hacia destino único, reutilizando el mecanismo canónico de esta matriz; si no existe y crear uno ampliaría la arquitectura → emite PROPUESTA para revisión humana | autoedición de `CLAUDE.md` / gobernanza (req. 4.7 c3, REGLA DURA); crear hook/skill nuevo sin aprobación | disparadores del design §4.4; destinos `CLAUDE.md\|Rule\|Skill\|ADR\|Hook/Test/Permission\|Dota Domain Pack\|nowhere` | 29 |
| **agent guardrails** (8 tipos) | Regla de dos ramas: determinista ⇒ `Permission\|Hook\|Test\|CI\|schema/invariant`; no determinista ⇒ `Policy/Rule` + independent verification + residual risk explícito | prosa vinculante sin verificación | write-scope-guard, data-boundary-guard/ADR-003, required-skip≠PASS (Task 8), path-normalization (Task 4), `attempts→Tracer`, `journal.md`/`ledger.md`, `promoteCandidate` approval | 26 (documenta; no implementa código nuevo) |
| **PRE-PUSH gate local** | `HOOK` local: `.husky/pre-push` cableado vía `core.hooksPath`, o `pre-push` nativo de git, o wrapper local equivalente verificable. **NO existe hoy** (Task 1 CONFIRMED). CI/PR es capa posterior, no sustituto | CI/PR por sí solo; documentar la ausencia de Husky | Task 1 discovery; niveles §5 | 5 |
| **reconciliación doc↔código** | `Reconciliation_Procedure` de 5 pasos (detectar → clasificar por ADR-001 L0–L6 → determinar canónico → resolver → registrar **materiales** en `ledger.md`) | "el código siempre gana" (ciego) | ADR-001; `ledger.md` append-only | 24 |
| **auditabilidad** | **Primary: `RULE`** — contrato de formato y append-only | agentes/skills como autoridad final | **Enforcement layer:** `verify-simplicity.sh`; `journal.md`/`ledger.md` son la evidencia | 26 (referencia) |

---

## 5. CANONICAL DEPENDENCY-MANAGEMENT PROCEDURE

**(Desbloquea la Task 3. Determinado por artefactos existentes que la matriz marca KEEP; ningún
MERGE/DELETE cambia este procedimiento.)**

### 5.1 Policy

La fuente es **Governance 2.0 en `CLAUDE.md` y `.claude/rules/security.md`**, no
`invariantes.md`:

- una **`dependency` de producción nueva** debe entrar por el procedimiento autorizado y quedar
  marcada `// ALLOWED`;
- una **`devDependency` de tooling rutinario** tiene bypass del vetting y de la marca;
- restaurar la instalación de paquetes **ya declarados y locked** no es añadir dependencias.

### 5.2 Procedure

Hay un solo flujo con dos puntos de entrada:

1. Si el paquete ya está seleccionado, se ejecuta **`@depcheck`** antes de añadirlo.
2. Si primero hay que elegir o cambiar stack, se entra por **`/gear-up`**; su propio contrato exige
   pasar después por **`@depcheck`** antes de instalar. Por eso `/gear-up` y `@depcheck` no son dos
   aprobaciones alternativas ni dos dueños paralelos: `/gear-up` decide stack y `@depcheck` autoriza
   el paquete concreto.
3. La instalación se hace con Bun en el árbol que usa el paquete (`apps/engine`, `apps/web` o raíz),
   nunca con un `bun add` global en la raíz para una app.
4. Una reconciliación de `node_modules` desde un manifest y `bun.lock` ya válidos no vuelve a ejecutar
   vetting ni reautoriza el paquete.

### 5.3 Enforcement

`scripts/verify-simplicity.sh` **sección 1** inspecciona solamente adiciones staged bajo la clave
`dependencies` de cada `package.json` y bloquea si el mismo diff no contiene `// ALLOWED`.
`devDependencies` quedan fuera. El script **no registra ni demuestra** que `/gear-up` o
`@depcheck` se hayan ejecutado, y tampoco comprueba si `node_modules` materializa el lockfile.

### 5.4 Estado real de `apps/web` y aplicación a Task 3

| Paquete | `apps/web/package.json` | `apps/web/bun.lock` | `apps/web/package-lock.json` | instalación local |
|---|---|---|---|---|
| `@testing-library/react` | Ya declarado en `devDependencies` | Presente | Presente | Ausente; `require.resolve` devuelve `MODULE_NOT_FOUND` |
| `iron-session` | Ya declarado en `dependencies` y cubierto por `// ALLOWED` | Presente | Presente | Ausente; `require.resolve` devuelve `MODULE_NOT_FOUND` |

Además, `iron-session` está declarado en el `package.json` raíz como `devDependency`. Ese dato no
materializa el árbol aislado de `apps/web`. `package-lock.json` confirma historia npm, pero el
procedimiento canónico de este árbol usa `bun.lock`.

Por tanto, **Task 3 no agrega, restaura ni vuelve a aprobar paquetes en el manifest**. Restaura el
árbol local de instalación desde `apps/web/package.json` + `apps/web/bun.lock` con la instalación
canónica de Bun ejecutada en `apps/web`; verifica resolución y la suite web; y revisa cualquier cambio
inesperado de lockfile antes de aceptarlo. `package.json` solo podría cambiar si la ejecución descubre
una inconsistencia nueva y demostrada.

---

## 6. Contrato de finalización (Task 23)

| # | Requisito de cierre | Estado |
|---|---|---|
| 1 | Existe un inventario real del harness | ✅ §1 (verificado en el working tree, con drift vs audit en §1.8) |
| 2 | Cada mecanismo relevante tiene responsabilidad | ✅ §3 (43 filas) |
| 3 | Cada responsabilidad tiene mecanismo canónico | ✅ §3 + §4 |
| 4 | Existe verdict KEEP/MERGE/MOVE/DELETE/REFACTOR por mecanismo | ✅ §3 |
| 5 | Definido el canonical dependency-management procedure | ✅ §5 |
| 6 | Indicada la Task posterior que ejecuta cada cambio | ✅ columna "Task" en §3 + §4 |
| 7 | No se implementó ningún veredicto | ✅ solo se escribió este documento |
| 8 | No se crearon agentes nuevos | ✅ 7 antes → 7 después |

**Taxonomía sin solape:** ✅ §2 (10 categorías, cada una con su regla de no-solapamiento; 8
solapamientos mayores identificados con su mecanismo canónico y Task).

---

## 7. Notas de riesgo / seguimiento para las Tasks 24–29

- **Task 24** debe aplicar el **Reconciliation Procedure** (no "el código gana"): para V5→V6, el
  canónico es `invariantes.md` (autoridad alta ADR-001), que ya dice V6; los espejos convergen a V6.
  Registrar solo reconciliaciones **materiales** en `ledger.md` (append-only).
- **Task 24** al mover `fase-9.md` / `fase-9.1.md`: **Fase 9.1 está parcialmente activa** según
  `CLAUDE.md` — separar lo vigente (queda como RULE/ADR) de la narrativa (va a archivo). No mover en
  bloque sin esa separación.
- **Task 25** depende de **Task 27** (la 27 provee el HOOK/CI destino del chequeo de Warden). La 25
  **solo** toca `.claude/agents/*`; no crea ni mueve hooks/CI.
- **Task 25**: Artisan tiene consumidores activos en `dispatch` y `web.md`, así que no se elimina
  mientras existan; reparar primero o resolver explícitamente esos consumidores. Chronicle se
  reclasifica a REFACTOR por su contradicción append-only. Sentinel conserva el juicio semántico y
  pasa a consumir evidencia determinista. Tracer solo quita la línea "Consulta Context7 MCP"
  (alinear con `context7.md`), **no** añade el MCP.
- **Task 28**: su stop condition prevalece. `verify-claude-md-split.sh` queda
  **REFACTOR/PENDING DECISION** (solo referencias documentales/históricas, sin caller automático,
  falla hoy con CRLF); `analisis-arquitectura.sh` queda **KEEP+REFACTOR** (caller activo
  `foundation-check` y estado operativo roto). Ninguno se elimina automáticamente.
  `CHECKPOINT.json` ya no existe (fila 42). Solo `.agents/` es DELETE limpio.
- **Task 29**: NO crear hook/script/skill nuevo sin aprobación humana; por defecto solo emite
  PROPUESTA de clasificación. El "Dota Domain Pack" solo se declara como destino.
- **Task 3** queda **candidata a desbloqueo** cuando esta revisión de la matriz sea aceptada: §5
  define el procedimiento y el contrato de Task 3 ya refleja el estado de instalación real.
- **Spec contradiction:** existe drift factual en el Design/Requirement 4.6 sobre los scripts, pero
  no exige replan: la stop condition de Task 28 ya ordena no eliminar al descubrir un caller y esta
  matriz aporta la reclasificación. `verify-claude-md-split.sh` no tiene caller ejecutable, pero su
  contrato documental vigente y su fallo operativo impiden tanto DELETE automático como KEEP
  intacto. Design y Requirements permanecen sin cambios.
