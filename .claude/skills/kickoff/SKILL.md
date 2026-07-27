---
name: kickoff
description: Convierte una idea desordenada en un primer prompt estructurado, portable a cualquier editor (Kiro, Cursor, Antigravity) o a /pre-flight si te quedas en Claude Code. Usar al inicio de un proyecto nuevo cuando tienes ideas sueltas y quieres organizarlas antes de plantear nada a un IDE con IA.
---

# /kickoff — Brief Portable de Arranque

## NOTA DE MODELO
Esta fase es preguntas y respuestas, todavía NO es síntesis — corre en **Sonnet**, no en Opus. El único momento caro de toda la cadena inicial es `/blueprint`, cuando ya hay información completa y hay que convertirla en una arquitectura coherente de una sola vez. Usar Opus aquí también sería pagar caro por simplemente recolectar datos.

## PROPÓSITO
Es la versión de `/grill-me` para ANTES de que exista un proyecto. No genera tickets ni escribe en `docs/agents/tasks/` — genera un bloque de texto plano que puedas copiar y pegar en cualquier lado: el spec de Kiro, el plan mode de Cursor, o el primer mensaje de `/pre-flight` si te quedas trabajando aquí mismo.

## REGLAS
1. Deja que el usuario hable primero, sin interrumpir con preguntas — es brainstorming, no interrogatorio. Solo cuando termine de soltar ideas, entra en modo convergente.
2. Aplica el mismo filtro que `/grill-me`, pero con menos formalismo y sin MoSCoW todavía — es demasiado pronto para priorizar algo que no está ni definido:
   - "¿Cuál es el resultado concreto que esperas?"
   - "¿Quién lo va a usar, tú u otra persona?"
   - "¿Qué explícitamente NO debe hacer esto?"
   - "¿Hay alguna restricción que ya sepas? (presupuesto, plazo, plataforma, alguna tecnología obligatoria)"
3. **No rellenes huecos con suposiciones.** Si falta algo importante (por ejemplo, no dijo quién es el usuario final), dilo explícitamente: "Me parece buena la idea, pero antes de convertirla en un brief te falta decirme X." No sigas hasta tener lo mínimo indispensable.
4. Cuando tengas lo mínimo, genera el bloque final en texto plano, sin YAML, sin frontmatter — tiene que poder pegarse en cualquier chat sin que se vea raro.
5. Pregunta: "¿Te quedas en Claude Code (sigo con `/pre-flight`) o te llevas esto a otro editor?"
6. Al terminar, invoca `/compass` para que registre el avance en `docs/agents/PROGRESS.md` y confirme el siguiente paso — no lo escribas tú mismo, así queda en un solo lugar. Si el usuario se queda, pasa el control a `/pre-flight` directamente sin que tenga que repetir nada.

## FORMATO DE SALIDA (plano, portable)
```
PROYECTO: [nombre tentativo]

PROBLEMA: [qué resuelve, en una frase]

USUARIO: [quién lo usa]

RESULTADO ESPERADO: [qué tiene que poder hacer al terminar]

FUERA DE ALCANCE: [qué explícitamente no es]

RESTRICCIONES CONOCIDAS: [presupuesto / plazo / plataforma / tecnología obligatoria, si aplica]

NOTAS ADICIONALES: [cualquier detalle suelto que el usuario mencionó y vale la pena no perder]
```

## LÍMITES
- No escribe código, no crea tickets, no toca `docs/agents/`.
- No decide MoSCoW — eso es trabajo de `/grill-me`, más adelante, cuando ya hay un proyecto real.
- No asume información que el usuario no dio.
