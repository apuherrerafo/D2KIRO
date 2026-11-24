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
| **Claude Code (extensión de VS Code)** | **No aislable desde el repo** | `claudeCode.claudeProcessWrapper` y `claudeCode.environmentVariables` son de ámbito `machine` (manifiesto de la extensión 2.1.329): VS Code no los acepta en `.vscode/settings.json` del repo, sólo en ajustes de usuario. La extensión invoca `wrapper <claude.exe> <args>` (leído en su código) y los skills personales ganan por precedencia documentada. No se probó la extensión en ejecución → **NOT_TESTED** |
| **Codex 0.159.0** | Carga nativa del repo verificada | `codex debug prompt-input` (offline) en un repo temporal: ve `AGENTS.md` y los skills de `<repo>/.agents/skills`; **no** ve `.claude/skills`. Sin `AGENTS.md` global. Skills de D2Kiro para Codex: ninguno (rol reviewer, `AGENTS.md`); no se crearon. Sigue viendo skills globales ajenos (`~/.codex/skills`, `~/.agents/skills`); `CODEX_HOME` vacío quita los primeros, no los segundos, y pierde el login |
| **Gemini CLI** | NOT_TESTED | No instalado. Documentado: `context.fileName: ["AGENTS.md"]` válido; `GEMINI_CLI_HOME` aísla `~/.gemini` |
| **Antigravity (`agy` 1.5.14)** | NOT_TESTED | Instalado; `agy agents` no devuelve nada. No se leyó su documentación oficial ni se hizo una llamada al modelo; no se afirma cómo carga instrucciones del repo |

## Acción del propietario (única forma de aislar la extensión de VS Code)

Elegir **una**; yo no toco `~/.claude`:

1. **Retirar de `~/.claude/skills/` las 25 copias de D2Kiro** (mover a una carpeta de respaldo, no borrar). La lista
   exacta la imprime `bun scripts/agents/shadowing.ts`; tras moverlas el mismo comando debe decir `OK`. Efecto: los
   demás proyectos que dependieran de esas copias personales dejan de verlas. Con esto la precedencia documentada
   (`personal > project`) ya no tiene nada que sombrear; no lo probé en ejecución (requeriría tocar `~/.claude`).
2. **Alternativa no verificada**: apuntar `claudeCode.claudeProcessWrapper` (ajuste de usuario) a un wrapper que añada
   `--setting-sources project,local` **al final** de los argumentos. Se sabe que el último flag gana y cómo llama la
   extensión al wrapper, pero no se probó en VS Code ni qué ejecutables acepta en Windows, por eso no se entregó uno.

## Limitaciones

1. **`--setting-sources` excluyendo skills no es contrato de la doc**: puede cambiar en una versión futura.
   Re-verificar con `bash scripts/agents/claude-repo-only.sh -p "Invoca el skill dispatch con la herramienta Skill y dime su Base directory"`.
2. **`shadowing.ts` no corre en CI**: depende de la máquina (lee `~/.claude`).
3. **Codex**: no hay aislamiento completo sin perder la sesión; la mitigación es que no hay skills de D2Kiro que sombrear.
