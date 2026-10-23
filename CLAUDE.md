# dota2coach / D2KIRO (Draft Coach)

Producto: coach de draft de Dota 2 (simulador + copiloto + draft en vivo) para jugadores con login de
Steam. Producción en Railway (https://d2kiro-production.up.railway.app, auto-deploy sobre `master`).
Estado real y siguiente paso: `docs/agents/PROGRESS.md` (**fuente de verdad del estado — no se copia aquí**).

## Qué carga cada sesión (no mezclar áreas)
- Siempre: este archivo + `.claude/rules/invariantes.md` (verdades de toda fase) + `security.md` (gate).
- Por ruta (se cargan solos al tocar esos archivos, vía `paths:`): `engine.md` → `apps/engine/**`,
  `web.md` → `apps/web/**`, `testing-seams.md` → `*.test.ts(x)`, `context7.md` → `apps/**`.
- Historia de fases cerradas (1–9.1): `docs/rules-archive/` — se lee a pedido, nunca se inyecta.
- Landing / Companion / Hero Knowledge V7: cada una trae **su propio** `.claude/rules/<área>.md` con
  `paths:` en el PR que la mergea. No se agregan reglas de un área a archivos de otra.
- Proceso del ecosistema (journal, tickets, herramienta por tarea, modelos): `docs/agents/process.md`.

## Stack
Dos procesos locales, independientes (`apps/web` nunca importa de `apps/engine`):
- **`apps/engine`** (Bun): motor de sugerencias, HTTP+WebSocket, SQLite + Drizzle. Sólo `127.0.0.1`.
  Nunca red en el camino caliente del draft. Scoring activo: `SCORING_WEIGHTS_V6`.
- **`apps/web`** (Next.js App Router, TS estricto, Tailwind + shadcn/ui). RTK Query para páginas;
  WebSocket + Zustand sólo para el draft en vivo. Login Steam OpenID + `iron-session`.
- Tests: Bun Test. CI: GitHub Actions + Husky. Despliegue: Railway.
- Captura de draft: `simulator` y `manual` de primera clase; `overwolf`/`ocr` como contrato.
- Pro-Drafter (KNN + línea + intención) detrás de `ENABLE_PRO_DRAFTER` (apagado por defecto).

## Comandos
- Local (dos procesos, sin `dev` en la raíz): `cd apps/engine && bun run dev` y `cd apps/web && bun run dev`.
- `bun run test` — **el único comando de pruebas** (corre las tres raíces por separado). `bun test`
  a secas en la raíz da ~55 fallos falsos (`happy-dom` parchea `fetch` global).
- `bun run e2e` — Playwright, lento (~1,2 min), de a uno; va en `/castoff`, no en cada commit.
- `cd apps/web && bun run lint` (único lint configurado; es el de CI).
- `bun run verify:r1` — certificación R1. `bun run eval` — harness offline del motor.
- `bash scripts/verify-simplicity.sh` — seguridad/invariantes/calidad antes de un commit.
- `bun scripts/hub.ts` — regenera el tablero derivado.

## Reglas inviolables
- Detalle técnico en `.claude/rules/`; si una regla de área choca con `invariantes.md`, gana `invariantes.md`.
- **Dependencias**: una `dependency` de producción nueva exige `/gear-up` o `@depcheck` y `// ALLOWED`.
  Una `devDependency` de tooling rutinario tiene bypass total (`verify-simplicity.sh` §3).
- Se puede tocar todo archivo técnicamente necesario para la tarea; **no** refactorizar lo no relacionado.
- **WIP = 1 por `assigned_tool`**, verificado por script.
- Cada cambio se explica en lenguaje producto: "Esto significa que ahora…".
- **Seguridad desde el diseño** (gate, no checklist): input externo validado en el borde; queries sólo
  vía Drizzle; sin `innerHTML` con datos; secretos sólo en `process.env` (literal sospechoso = FAIL);
  mínimo privilegio por agente; `@redteam` con seguridad como gate binario; `/castoff` obligatorio
  antes de cualquier deploy.
- **Worktrees**: los hooks (`scripts/hooks/`) bloquean escribir/commitear/pushear en un worktree
  distinto al de la sesión. Cada tarea va en su propio worktree desde `origin/master`.

## Memoria y tareas
- `docs/agents/journal.md` — fuente de verdad, append-only (nunca se borran líneas; lo verifica
  `verify-simplicity.sh`). `ledger.md` igual. `MEMORY.md` es vista regenerable de `journal.md`.
- Leer `docs/agents/MEMORY.md` y `USER.md` al inicio de sesión.
- Tickets: frontmatter YAML de `docs/agents/tasks/TSK-XXX.md` es la fuente; `plan.md`, `ledger.md` y
  `hub.html` son vistas derivadas, no se editan a mano. `attempts: 3` dispara Tracer.
- Entradas de journal: primera línea fija `- [YYYY-MM-DDTHH:MM] event:evt-<id> schema:v1 tool:<x>
  ticket:<TSK-XXX|-> result:<ok|blocked|fail|info> — nota` (detalle en `process.md`).
- Gate falla (`@redteam` REJECTED / Sentinel FAIL) → ticket `blocked` → decide el usuario; ningún agente reintenta solo.

## Herramientas y modelos
`preferred_tool` (intención) vs `assigned_tool` (decisión de `/dispatch`): `claude-code` (default, único
con trazabilidad en journal), `codex` (acotado y autocontenido), `kiro-nativo`, `hermes-vps` (sólo vía `/nightwatch`).
Modelos: Opus sólo en `/blueprint` (más excepciones documentadas vía `/compass`), Sonnet para todo lo
demás, Haiku para memoria/volumen; evitar `claude-fable-5`. Tabla de agentes, excepciones y regla
Codex: `docs/agents/process.md`.

## Skills
Core en `.claude/skills/` (flujo real del proyecto); extras opcionales en `skills-extra/`. Listado: `docs/SETUP.md`.
