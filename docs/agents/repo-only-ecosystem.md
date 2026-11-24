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

## Compatibilidad por proveedor

| Proveedor | Estado | Detalle |
|---|---|---|
| **Claude Code (CLI)** | Aislable | Lanzar con `scripts/agents/claude-repo-only.sh`. Efecto esperable, **no medido**: al excluir la fuente `user`, tampoco rigen los hooks/permisos/modelo de `~/.claude/settings.json` |
| **Claude Code (extensión de VS Code)** | **No aislado** | La sesión de la extensión no pasa por el lanzador: sigue ganando la copia personal (esta misma sesión cargó el `dispatch` viejo). No verifiqué una opción de la extensión para pasar flags |
| **Codex** | Sin colisión de nombres; aislamiento parcial | No carga `.claude/skills`; el repo no tiene `.agents/skills`, así que Codex no usa skills de D2Kiro (rol reviewer, ver `AGENTS.md`). Sin `AGENTS.md` global: sólo rige el del repo (comprobado con `codex debug prompt-input`, offline). Sí ve skills globales ajenos a D2Kiro (en `~/.codex/skills` y `~/.agents/skills`, p. ej. `concorde-*`, `mi-garaje-*`). `CODEX_HOME` vacío quita `~/.codex/skills` pero **no** `~/.agents/skills`, y un home vacío pierde el login |
| **Gemini CLI** | NOT_TESTED | No instalado. Documentado: `.gemini/settings.json` con `context.fileName: ["AGENTS.md"]` es válido; `GEMINI_CLI_HOME` aísla `~/.gemini`; la doc de Gemini dice que fue reemplazado por Antigravity el 2026-06-18 y existe `~/.gemini/antigravity-cli` — hay que confirmar la versión instalada antes de fiarse |

## Limitaciones y alternativa segura

1. **Extensión de VS Code**: sin garantía. Alternativa segura que sólo puede aplicar el propietario (no se hizo):
   retirar de `~/.claude/skills/` las 25 copias de D2Kiro (el repo es la fuente), o trabajar desde la CLI con el lanzador.
2. **`--setting-sources` excluyendo skills no es contrato de la doc**: puede cambiar en una versión futura.
   Re-verificar con `bash scripts/agents/claude-repo-only.sh -p "Invoca el skill dispatch con la herramienta Skill y dime su Base directory"`.
3. **Codex**: no hay aislamiento completo sin perder la sesión; la mitigación real es que no hay skills de D2Kiro
   que sombrear y que `AGENTS.md` del repo es la única instrucción de proyecto.
