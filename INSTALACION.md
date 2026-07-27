# Instalación — Ecosistema Caveman

## 5 pasos, y ya
1. Sube esta carpeta a un repo de tu GitHub (una sola vez, para siempre).
2. Abre Kiro (o Cursor), en la carpeta de tu proyecto nuevo, corre:
   ```bash
   git clone https://github.com/tu-usuario/setup.git temp && cp -r temp/{CLAUDE.md,AGENTS.md,.claude,docs,scripts} . && rm -rf temp && bash scripts/install.sh
   ```
3. Abre el chat de **Claude Code** dentro de Kiro (no el chat nativo de Kiro) y escribe `/start`.
4. Sigue lo que te vaya diciendo — no necesitas memorizar nada más.
5. Si en algún momento no sabes qué hacer, escribe `/compass`.

## El loop de todos los días (esto es TODO lo que necesitas recordar)
El ecosistema completo tiene 25 skills y 5 agentes — pero tú, en el día a día, solo necesitas conversar en lenguaje normal y usar 6 palabras:

**`/start` · `/plan` · `/build` · `/fix` · `/review` · `/ship`** — y `/compass` cuando no sepas cuál de las seis toca.

No necesitas saber que "por debajo" `/plan` puede resolver a `/kickoff`, `/pre-flight` o `/blueprint` según en qué momento estés — `/dispatch` lo decide por ti. Todo lo demás (gates de seguridad, arquitectura continua, deploy, MCPs, importación de specs de Kiro) existe y funciona, pero se activa solo o te lo va a nombrar `/compass` en el momento exacto en que haga falta. Piensa en el resto del ecosistema como el motor de un auto: no necesitas saber cómo funciona para manejarlo, solo frenar, acelerar, y a quién llamar si algo suena raro (`/compass`).

## Paso 2 (detalle) — dentro de Kiro, conecta lo que vayas a usar
1. Conecta tu cuenta de GitHub en Kiro (Settings → Source Control) si todavía no lo hiciste.
2. Activa la extensión o el CLI de **Claude Code** dentro de Kiro — sin esto, `.claude/skills/` y `.claude/agents/` no hacen nada.
3. Si vas a usar **Codex CLI**, verifica que esté instalado y logueado por separado — Kiro no lo integra de forma nativa todavía.

