---
name: evolve
description: Revisar y mejorar el ecosistema de skills automáticamente. Inspirado en Skill Claw.
---

# /evolve — Evolución del Ecosistema

## PROPÓSITO
Mantener las skills actualizadas, sin duplicaciones y optimizadas. También gestiona el handoff de contexto cuando una sesión se acerca al límite de la ventana de contexto.

## HANDOFF DE CONTEXTO (sesiones largas)
Cuando el usuario note degradación o pida cerrar sesión por límite de contexto:
- No crees archivos temporales fuera del control de versiones. Anexa al `journal.md` (append-only, nunca se reescribe) una entrada con un bloque `estado_handoff:` que resuma: qué se hizo, qué falta, y qué skill debería invocarse al retomar.
- **Además, sobreescribe `docs/agents/CHECKPOINT.json`** (este sí se sobreescribe, no es append-only — es estado efímero, no historial) con: `last_bash_cwd`, `last_test_command`, `pid_of_dev_server`, `last_git_commit_hash`, `updated_at`. `journal.md` cuenta la historia; `CHECKPOINT.json` es lo que un script necesita para rehidratar el entorno sin que el LLM tenga que inferirlo de prosa.
- El usuario ejecuta `/clear` (o equivalente) para vaciar la ventana de contexto.
- Al retomar con `/launchpad`, el agente lee la última entrada `estado_handoff` de `journal.md` Y `CHECKPOINT.json`, y continúa desde ahí — sin releer todo el historial.

## HANDOFF PROACTIVO (no esperar a que el usuario lo pida)
En "vibe coding" real, el humano no siempre nota la degradación a tiempo — sigue escribiendo "sigue"/"continúa" mientras el modelo ya empezó a perder el hilo. Si detectas que llevas más de 2 intercambios seguidos sin progreso concreto (el usuario repite variantes de "sigue" sin que nada nuevo se resuelva), no esperes: dilo explícito ("Creo que estamos dando vueltas sin avanzar — voy a guardar el estado ahora antes de que se pierda algo") y ejecuta el handoff tú mismo. Nota honesta: esto depende de que tú mismo notes el patrón en la conversación — no hay un mecanismo automático de conteo de tokens que lo dispare solo.

## REGLAS (evolución de skills)
- Revisa todas las skills en `.claude/skills/` (core) y `skills-extra/` (opcionales).
- Detecta solapamientos y sugiere fusiones.
- Identifica skills débiles y propone mejoras.
- Detecta patrones repetitivos en el historial de tareas (`journal.md`, `ledger.md`).
- Sugiere nuevas skills si detecta necesidades no cubiertas.
- NUNCA modifiques sin aprobación del usuario.

## OUTPUT
Informe con recomendaciones, escrito en `docs/agents/evolve-report.md` (se sobreescribe cada vez — es el reporte "actual", no un historial). `bun scripts/hub.ts` lo muestra automáticamente en el panel de sugerencias.

## LÍMITES
- Solo sugerencias. Nada se aplica sin confirmación.
