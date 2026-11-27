# Ecosistema de agentes sólo-repo (TSK-253)

> **Alcance en `release/mvp-beta` (unidad C):** mediciones del 2026-11-23/24 sobre la rama `agent-ecosystem/phase1`.
> TSK-254 (control de herramientas de skills) y la matriz de integración **no están** en esta rama. El «CICLO DE
> COORDINACIÓN» de `dispatch` llegó después con las unidades A+B (PR #172, fusionado en `32cd2502`).

Decisión del propietario: D2Kiro usa **sus** agentes, skills, workflows, reglas y evals; las versiones
globales no deben sustituirlos. Fecha: 2026-11-23. Probado con Claude Code 2.1.329 y Codex CLI 0.159.0
reales; Gemini CLI: **NOT_TESTED**.

## Causa raíz

Claude Code resuelve un skill con el mismo nombre así: **enterprise > personal > project**
(code.claude.com/docs/en/skills). Si en `~/.claude/skills/` existe una copia con el nombre de un skill del repo,
gana la personal. Medido con el binario real, sesión limpia:

| Prueba | Resultado |
|---|---|
| `dispatch` sin flags, con una copia personal del mismo nombre | Carga la copia personal |
| `dispatch` con `--setting-sources project,local` | Carga la del repo |
| `dispatch`, `helm`, `compass` con `scripts/agents/claude-repo-only.sh` | Los tres desde `<repo>\.claude\skills\` |

`bun scripts/agents/shadowing.ts` detecta qué skills del repo quedan sombreados. Subagentes: el **proyecto gana** al
personal (documentado), no hay sombra.

## Qué funciona y qué no (Claude Code)

| Mecanismo | Documentado | Resultado real |
|---|---|---|
| `--setting-sources project,local` | Sólo como fuentes de *settings* | **Funciona**: excluye `~/.claude/skills` y quedan los del repo. Que excluya skills es comportamiento observado, **no promesa de la doc** → candado: ver abajo |
| `skillOverrides: {"dispatch":"off"}` | Sí | **No sirve**: apaga el nombre entero, también el del repo |
| `permissions.deny: ["Skill(dispatch)"]` | Sí (la doc no dice qué copia bloquea) | **No sirve**: bloquea las dos |
| `--bare`, `--disable-slash-commands` | Sí | Descartados: quitan también el skill del repo / hooks |
| `CLAUDE_CONFIG_DIR` | Sólo settings, historial, plugins | No probado ni necesario |
| Renombrar o borrar `~/.claude/skills/*` | — | Fuera del alcance de TSK-253; ver TSK-255 abajo |

## Cambios

- `scripts/agents/claude-repo-only.sh`: lanzador (`claude --setting-sources project,local "$@"`;
  `CLAUDE_BIN` para sustituir el binario). Desde 2026-11-27 falla si excluir lo personal desactivaría protecciones.
  Prueba sin red con un binario falso.
- `scripts/agents/shadowing.ts` (+ prueba): detector de solo lectura de skills del repo sombreados por la copia
  personal. Se corre a mano; **no** es parte del CI (depende de la máquina).
- En TSK-253 no se duplicó ningún skill ni se tocó `~/.claude`, `~/.codex` ni `~/.gemini`, ni CI ni guardrails.

## Protecciones al usar el lanzador

`--setting-sources project,local` excluye la configuración personal completa, no sólo los skills. Para no desactivar
protecciones propias, el lanzador **falla (exit 3) sin arrancar Claude** si en el directorio personal hay reglas,
`CLAUDE.md`, `settings.local.json`, ajustes ilegibles o cualquier clave de `settings.json` fuera de la lista cerrada de
claves inocuas (incluidos permisos y hooks): `personalProtections` en `scripts/agents/shadowing.ts`. No modifica nada.
En ese caso, el aislamiento de skills se consigue retirando las copias personales (sección «Copias personales»). La configuración
administrada por la organización no se comprobó.

La comprobación ignora los `.env` y `bunfig.toml` del directorio desde el que se lanza. El lanzador **no** filtra las
opciones que le pases a Claude: las que relajan permisos o hooks siguen siendo responsabilidad tuya.

Los hooks versionados en `.claude/settings.json` pertenecen a la fuente `project`. Medido con el binario real sólo para
la protección de edición; el resto NOT_TESTED con el flag.

## Compatibilidad por proveedor

| Proveedor | Estado | Detalle |
|---|---|---|
| **Claude Code (CLI)** | Aislamiento de skills verificado el 2026-11-23 | `scripts/agents/claude-repo-only.sh`; sólo arranca si no hay protecciones personales que perder |
| **Claude Code (extensión de VS Code)** | **No aislable sólo desde el repo** | `claudeCode.claudeProcessWrapper` y `claudeCode.environmentVariables` son de ámbito `machine` (manifiesto de la extensión 2.1.329): VS Code no los acepta en `.vscode/settings.json` del repo, sólo en ajustes de usuario. Si hay copias personales con el mismo nombre, ganan por precedencia documentada; retirarlas es decisión de cada usuario (TSK-255) |
| **Codex 0.159.0** | Carga nativa del repo verificada | `codex debug prompt-input` (offline) en un repo temporal: ve `AGENTS.md` y los skills de `<repo>/.agents/skills`; **no** ve `.claude/skills`. Skills de D2Kiro para Codex: ninguno (rol reviewer, `AGENTS.md`). El repo no aísla los skills globales de cada usuario |
| **Gemini CLI** | NOT_TESTED | Documentado: `context.fileName: ["AGENTS.md"]` válido; `GEMINI_CLI_HOME` aísla `~/.gemini` |
| **Antigravity** | NOT_TESTED | No se afirma cómo carga instrucciones del repo |

## Copias personales (TSK-255)

Quien tenga copias personales con el nombre de un skill del repo puede retirarlas (respaldándolas antes) para que cada
checkout cargue **su** versión. Esa acción ocurre fuera del repositorio y su detalle no se versiona.
`bun scripts/agents/shadowing.ts` detecta si hay o reaparece una copia (sale 1).

## Limitaciones

1. **`--setting-sources` excluyendo skills no es contrato de la doc**: puede cambiar en una versión futura.
   Re-verificar con `bash scripts/agents/claude-repo-only.sh -p "Invoca el skill dispatch con la herramienta Skill y dime su Base directory"`.
2. **`shadowing.ts` no corre en CI**: depende de la máquina (lee `~/.claude`).
3. **Codex**: el repo no aísla la configuración global de cada usuario.
