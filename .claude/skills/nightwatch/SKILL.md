---
name: nightwatch
description: Detecta si una tarea es candidata para dejarla corriendo desatendida durante la noche en el VPS de Hermes (GPT). Usar solo cuando el usuario menciona explícitamente dejar algo corriendo toda la noche, trabajo largo sin supervisión, o mandarle algo a Hermes. Nunca se activa por defecto.
---

# /nightwatch — Detector de Trabajo Nocturno (Hermes VPS)

## SEGURIDAD OPERACIONAL DEL VPS (obligatoria, no opcional, cuando SÍ se usa)
Esta es la única pieza del ecosistema que corre desatendida, de noche, sin nadie mirando en tiempo real — el blast radius de un descuido aquí es mayor que en cualquier otra skill. Antes de mandar cualquier cosa a Hermes, confirma (o pide al usuario que confirme) que el entorno del VPS cumple TODO esto:
- **Usuario Linux exclusivo para Hermes, sin `sudo`.** Nunca corre como root ni con el usuario principal del VPS.
- **Repositorio o worktree aislado** — nunca el mismo checkout que usas tú en vivo.
- **Límites duros de CPU, RAM, disco y duración máxima** de la sesión — no "hasta que termine", un tope real.
- **Cero acceso a secretos de producción.** Ninguna credencial real, ninguna variable de entorno de producción — si la tarea necesita probar algo, usa credenciales de sandbox/desarrollo.
- **Comandos y directorios permitidos, explícitos** — no acceso libre al sistema de archivos del VPS.
- **La salida es un commit o patch revisable, nunca un push directo ni un deploy.** Hermes propone, no aplica. Tú decides si se integra, y pasa por `@redteam`/Sentinel igual que cualquier otro código.
- **Prohibido ejecutar deploy de cualquier forma**, aunque la tarea "parezca" terminada — eso es exclusivo de `/castoff`, con confirmación humana.
- **Kill switch accesible** — una forma de detener el proceso de inmediato si algo se ve mal, sin tener que esperar a la mañana.
- **Registro completo de comandos y archivos modificados** — no un resumen, el log real de lo que Hermes hizo, para que `@root-cause` pueda usarlo si algo sale mal (ver regla de contexto real para fallos de herramientas externas, igual que con Codex).

Si no puedes confirmar todo esto, no califica para `/nightwatch` — dilo explícito en vez de mandarlo de todas formas.

## PROPÓSITO
No es un motor de ejecución remota — es un filtro conservador, a propósito la opción menos usada del ecosistema. La mayoría de las tareas NO deberían ir aquí: consumen tokens de un sistema aparte (Hermes, con GPT, en tu VPS de Hostinger) sin los gates de supervisión (`@redteam`, Sentinel) que sí tenemos en el flujo normal. Existe solo para el puñado de casos donde de verdad conviene: trabajo largo, bien especificado, que puede esperar a la mañana.

## REGLAS
1. **Actívate solo si el usuario lo pide explícito** ("déjalo corriendo toda la noche", "esto puede esperar a mañana", "mándaselo a Hermes"). Nunca lo sugieras de oficio — quemar tokens en un sistema aparte sin que te lo pidan es exactamente lo que queremos evitar.
2. Antes de aceptar, verifica que la tarea cumple TODO esto — si falla cualquiera, dilo y no la mandes:
   - Ya tiene un ticket con criterios de aceptación claros (si no, primero `/grill-me` o precísalo — no está listo para desatendido).
   - No toca nada que necesite un gate de seguridad en vivo (auth, pagos, producción) — eso necesita a Sentinel presente, no desatendido.
   - Es lo bastante grande/lenta para justificar dejarla sin supervisión — no mandes algo de 20 líneas, es desperdiciar la ventaja de la noche.
3. Si califica: cambia `assigned_tool: hermes-vps` en el frontmatter del ticket, y escribe un brief 100% autocontenido — igual que para `codex`, Hermes no lee `journal.md` ni conoce nuestras skills, así que el ticket tiene que bastar solo.
4. Anota en `journal.md`: `- [timestamp] tool:nightwatch ticket:<id> result:info — enviado a Hermes VPS, retomar por la mañana` (formato en `CLAUDE.md`).
5. **Al retomar**: pide el resultado a Hermes y pásalo por `@redteam`/`@shipcheck` exactamente igual que cualquier otro código. Que haya corrido de noche y sin ti no significa que se salte revisión — al contrario, mayor razón para revisarlo con más cuidado, no menos.

## LÍMITES
- No se conecta al VPS por sí sola — no hay MCP para eso todavía, ni falta que hace. Tú decides cómo se lo entregas a Hermes.
- No decide por su cuenta mandar nada — siempre a petición explícita del usuario.
- Nunca salta `@redteam`/Sentinel al volver el trabajo de Hermes.
