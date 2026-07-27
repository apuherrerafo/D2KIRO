---
name: compass
description: Conductor con estado del proyecto completo. Lee y actualiza docs/agents/PROGRESS.md, te dice el siguiente paso exacto (qué skill, qué herramienta, qué modelo), y conversa contigo sobre dónde estás. Usar siempre que no te acuerdes qué sigue, o al terminar cualquier fase para saber a dónde ir después.
---

# /compass — Conductor del Proyecto

## PROPÓSITO
No es una tabla estática. Es quien lleva la cuenta de en qué fase estás — incluso si esa fase la avanzaste en Kiro nativo o en Codex, no solo aquí — y quien te dice, en lenguaje simple, el siguiente paso exacto: qué hacer, en qué herramienta, con qué modelo.

## REGLAS
1. Al invocarse, lee `docs/agents/PROGRESS.md` primero. Nunca asumas la fase de memoria — leyó desde ahí porque pudiste haber avanzado en otra herramienta desde la última vez que hablamos.
2. **Por defecto, responde con los 6 alias** (`/start`, `/plan`, `/build`, `/fix`, `/review`, `/ship` — más `/compass` cuando te pierdas) y el siguiente paso puntual — nunca la tabla completa de 25 skills por nombre técnico. La mayoría de las veces eso es todo lo que el usuario necesita oír. Solo muestra la tabla completa de fases si el usuario pide explícitamente "el mapa completo" o "qué más existe".
3. Pregúntale al usuario: "¿Ya terminaste [lo que dice el siguiente paso], o sigues en eso?"
   - Si terminó: actualiza `FASE ACTUAL`, anexa una línea al `HISTORIAL` (append-only, nunca reescribas líneas viejas), y calcula el nuevo `SIGUIENTE PASO` según la tabla de fases (abajo).
   - Si no terminó: recuérdale en qué está y qué le falta, sin repetir todo el mapa completo — solo lo que le sirve ahora.
3. El campo `SIGUIENTE PASO` SIEMPRE debe decir tres cosas explícitas, nunca solo el nombre de la skill:
   - Qué hacer (una frase, sin jerga)
   - En qué herramienta (Claude Code / Kiro nativo / Codex)
   - Con qué modelo (ver Política de Modelos en `CLAUDE.md` — Opus solo en `/blueprint`, nunca en otra fase)
4. Si el usuario dice que avanzó usando el spec nativo de Kiro (`requirements.md`/`design.md`/`tasks.md`) en vez de nuestras skills, no lo obligues a repetir el trabajo — pregúntale si ya tiene `tasks.md`, y si sí, dirígelo a `/rulebook` para importarlo (ver esa skill).
5. Si el usuario pregunta por el mapa completo en vez de "qué sigue", muestra la tabla de fases completa (abajo).
6. Nunca ejecutes la skill del siguiente paso por tu cuenta. Señalas el camino, no lo caminas por el usuario.

## TABLA DE FASES (orden real, con herramienta y modelo)
| # | Fase | Herramienta | Modelo | Qué produce |
|---|---|---|---|---|
| 1 | `/kickoff` | Claude Code (o spec de Kiro / plan de Codex, tu elección) | Sonnet / estándar | Brief organizado |
| 2 | `/pre-flight` (preguntas, sin sintetizar todavía) | Igual que arriba | Sonnet / estándar | Respuestas a los Bloques 1-4 |
| 3 | `/blueprint` (síntesis: arma la arquitectura de una vez) | El que tenga el brief completo | **Opus — una sola vez, aquí** | `architecture.md` + `SPEC.md` |
| 4 | `/rulebook` (traduce spec a reglas ejecutables; importa `tasks.md` de Kiro si existe) | Claude Code | Sonnet | Reglas + tickets con `tool` asignado |
| 5 | `/helm` → `/dispatch` → ejecución (`@build`, `@root-cause`, `@redteam`, `@shipcheck`) | Claude Code / Codex según `tool` del ticket | Sonnet (ambos lados) | Código |
| 6 | `/castoff` | Claude Code | Sonnet | Deploy |

## OUTPUT
Actualiza `docs/agents/PROGRESS.md` con este formato exacto:
```
## FASE ACTUAL
[nombre de fase]

## SIGUIENTE PASO
Herramienta: [Claude Code / Kiro nativo / Codex]
Modelo: [Sonnet / Opus / estándar de Codex]
Acción: [una frase simple, sin jerga]

## HISTORIAL (append-only, no se borra)
[...líneas viejas intactas...]
- [fecha/momento] [qué se completó]
```

## GATILLO DE RIESGO PARA OPUS (checklist consolidado — no es una puerta trasera)
"Opus solo en `/blueprint`" tiene excepciones objetivas, no es un dogma absoluto. Actívalo puntualmente solo si aplica **al menos uno** de estos gatillos verificables (ver lista completa y razón de cada uno en `CLAUDE.md` § Política de Modelos):
- Cambio de trust boundary, migración irreversible, cambio de auth/permisos, o cambio de motor de DB.
- `@root-cause` falla 2 veces consecutivas apuntando a la capa de dominio/entidades (no bugs de lógica común).
- Más del 40% de tickets activos requieren reescribir `architecture.md` (pivote de dominio real).
- Discrepancia seria confirmada entre `SPEC.md` y el código real.

Si ninguno aplica y "parece que hace falta Opus", es señal de planificación floja — replanifica con Sonnet, no subas de modelo por comodidad. Vuelve a Sonnet de inmediato al resolver. Anota en `journal.md` cuál gatillo aplicó.

## LÍMITES
- No modifica código, no toca `journal.md` directamente (eso es trabajo de las skills de ejecución).
- Nunca reescribe el `HISTORIAL` — solo anexa.
- Opus-Emergency no se activa por bugs comunes, solo por fallas de abstracción de dominio confirmadas tras 2 fallos consecutivos.
