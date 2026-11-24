# Ecosistema de agentes sólo-repo (TSK-253)

Decisión del propietario: D2Kiro usa **sus** agentes, skills, workflows, reglas y evals; las versiones
globales no deben sustituirlos. Fecha: 2026-11-23. Probado con Claude Code 2.1.329 y Codex CLI 0.159.0
reales; Gemini CLI **no está instalado** en esta máquina.

## Causa raíz

Claude Code resuelve un skill con el mismo nombre así: **enterprise > personal > project**
(code.claude.com/docs/en/skills). Los 25 skills del repo existen también en `~/.claude/skills/` (copias
viejas), así que gana la personal. Medido con el binario real, sesión limpia:

| Prueba | Resultado |
|---|---|
| `dispatch` sin flags | `Base directory: C:\Users\APU\.claude\skills\dispatch`; sin «CICLO DE COORDINACIÓN» |
| `dispatch` con `--setting-sources project,local` | `Base directory: <repo>\.claude\skills\dispatch`; con «CICLO DE COORDINACIÓN» |
| `dispatch`, `helm`, `compass` con `scripts/agents/claude-repo-only.sh` | los tres desde `<repo>\.claude\skills\` |

Alcance del problema (`bun scripts/agents/shadowing.ts`): 25 skills sombreados; sólo `dispatch` y
`root-cause` difieren en contenido (y el agente `chronicle`). Son justo los archivos que el repo cambió
después de la copia personal. Subagentes: el **proyecto gana** al personal (documentado), no hay sombra.

## Qué funciona y qué no (Claude Code)

| Mecanismo | Documentado | Resultado real |
|---|---|---|
| `--setting-sources project,local` | Sólo como fuentes de *settings* | **Funciona**: excluye `~/.claude/skills` (desaparecen `adhd-mode`, `modo-dota`, `siempre-lo-ultimo`…; quedan los 25 del repo). Que excluya skills es comportamiento observado, **no promesa de la doc** → candado: ver abajo |
| `skillOverrides: {"dispatch":"off"}` | Sí | **No sirve**: apaga el nombre entero, también el del repo |
| `permissions.deny: ["Skill(dispatch)"]` | Sí (la doc no dice qué copia bloquea) | **No sirve**: bloquea las dos |
| `--bare`, `--disable-slash-commands` | Sí | Descartados: quitan también el skill del repo / hooks |
| `CLAUDE_CONFIG_DIR` | Sólo settings, historial, plugins | No probado ni necesario |
| Renombrar o borrar `~/.claude/skills/*` | — | **Prohibido aquí** (no se tocan configuraciones globales) |

## Cambios

- `scripts/agents/claude-repo-only.sh`: lanzador de una línea (`claude --setting-sources project,local "$@"`;
  `CLAUDE_BIN` para sustituir el binario). Prueba sin red con un binario falso; verificado en rojo quitando el flag.
- `scripts/agents/shadowing.ts` (+ prueba): detector de solo lectura de skills del repo sombreados por la copia
  personal. Se corre a mano; **no** es parte del CI (depende de la máquina).
- No se duplicó ningún skill, no se tocó `~/.claude`, `~/.codex` ni `~/.gemini`, ni CI ni guardrails.

## Protecciones con `--setting-sources project,local` (TSK-254, medido)

- **A nivel usuario** (`~/.claude/settings.json`) sólo hay un hook `SessionStart` (el aviso «lo último», una
  comodidad personal), sin `permissions` ni `env`. Con el flag deja de correr; no es una protección de D2Kiro.
- **A nivel proyecto** (`.claude/settings.json`, versionado) viven las dos protecciones reales:
  `pretooluse-guard` (gate de `git commit/push`) y `pretooluse-edit-guard` (data-boundary + `write_scope`).
- Prueba real: un `Write` fuera del worktree se bloquea con el mismo mensaje `fail-closed` **con y sin** el flag
  y el archivo no se crea. No probé el guard de Bash bajo el flag (mismo archivo de settings): inferido, no medido.
- Si el flag se repite, **gana el último** (medido: `user,project,local` seguido de `project,local` → repo;
  al revés → copia personal). La extensión de VS Code pasa su propio `--setting-sources`.

## Compatibilidad por proveedor

| Proveedor | Estado | Detalle |
|---|---|---|
| **Claude Code (CLI)** | Aislado y verificado | `scripts/agents/claude-repo-only.sh`; protecciones del proyecto intactas (sección anterior) |
| **Claude Code (extensión de VS Code)** | **Resuelto retirando las copias personales** (ver abajo); desde el repo solo no es aislable | `claudeCode.claudeProcessWrapper` y `claudeCode.environmentVariables` son de ámbito `machine` (manifiesto de la extensión 2.1.329): VS Code no los acepta en `.vscode/settings.json` del repo, sólo en ajustes de usuario. La extensión invoca `wrapper <claude.exe> <args>` (leído en su código) y los skills personales ganan por precedencia documentada. Verificado en ejecución tras retirar las copias personales (TSK-255): la sesión de la extensión pasó a cargar `compass` desde el repo |
| **Codex 0.159.0** | Carga nativa del repo verificada | `codex debug prompt-input` (offline) en un repo temporal: ve `AGENTS.md` y los skills de `<repo>/.agents/skills`; **no** ve `.claude/skills`. Sin `AGENTS.md` global. Skills de D2Kiro para Codex: ninguno (rol reviewer, `AGENTS.md`); no se crearon. Sigue viendo skills globales ajenos (`~/.codex/skills`, `~/.agents/skills`); `CODEX_HOME` vacío quita los primeros, no los segundos, y pierde el login |
| **Gemini CLI** | NOT_TESTED | No instalado. Documentado: `context.fileName: ["AGENTS.md"]` válido; `GEMINI_CLI_HOME` aísla `~/.gemini` |
| **Antigravity (`agy` 1.5.14)** | NOT_TESTED | Instalado; `agy agents` no devuelve nada. No se leyó su documentación oficial ni se hizo una llamada al modelo; no se afirma cómo carga instrucciones del repo |

## Estado: copias personales respaldadas (2026-11-24, TSK-255)

Por decisión del propietario se movieron (sin borrar) las 25 copias de D2Kiro de `%USERPROFILE%\.claude\skills` a
`%USERPROFILE%\Documents\D2KIRO\_backup-claude-personal-skills-2026-11-24\skills`, con `MANIFEST.sha256` (hashes
tomados **antes** de mover) y `RESTORE.ps1`. Medido: `sha256sum -c` 25/25 OK; `bun scripts/agents/shadowing.ts` → `OK`;
las demás skills globales (`adhd-mode`, `modo-dota`, `siempre-lo-ultimo`…) intactas.

- **CLI sin flags** y **sesión de la extensión de VS Code**: `dispatch`/`helm`/`compass` cargan desde `.claude/skills/` del
  repo (la sesión de la extensión cargaba antes `compass` desde `~/.claude`). Ojo: cada checkout carga **su** versión;
  el checkout principal en `r1/product-certification` no tiene aún el ciclo de coordinación en `dispatch`.
- **Restaurar:** `powershell -File "%USERPROFILE%\Documents\D2KIRO\_backup-claude-personal-skills-2026-11-24\RESTORE.ps1"`.
  Mueve las carpetas de vuelta, no sobrescribe una existente (la omite y la reporta) y verifica los hashes. Probado sobre
  una copia con HOME temporal: 25 de 25.
- **Límite de la comprobación de dependencias:** sólo el historial local de Claude Code (173 transcripciones, 32 proyectos):
  los 25 skills sólo se invocaron en proyectos D2Kiro; los comandos globales usan rutas relativas; los 14 proyectos de VMC
  tienen skills propios sin nombres en común. No puede ver otras máquinas ni otras herramientas.
- **Si vuelve a aparecer una copia personal**, `bun scripts/agents/shadowing.ts` la detecta (sale 1).

## Limitaciones

1. **`--setting-sources` excluyendo skills no es contrato de la doc**: puede cambiar en una versión futura.
   Re-verificar con `bash scripts/agents/claude-repo-only.sh -p "Invoca el skill dispatch con la herramienta Skill y dime su Base directory"`.
2. **`shadowing.ts` no corre en CI**: depende de la máquina (lee `~/.claude`).
3. **Codex**: no hay aislamiento completo sin perder la sesión; la mitigación es que no hay skills de D2Kiro que sombrear.
