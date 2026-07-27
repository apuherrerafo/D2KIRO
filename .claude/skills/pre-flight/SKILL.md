---
name: pre-flight
description: Investigación de dominio, arquitectura e ingeniería. Fase previa a cualquier código.
---

# /pre-flight — Planificación e Ingeniería Inicial

## NOTA DE MODELO
Esta fase es preguntas y respuestas, todavía NO es síntesis — corre en **Sonnet**, no en Opus. El único momento caro de toda la cadena inicial es `/blueprint`, cuando ya hay información completa y hay que convertirla en una arquitectura coherente de una sola vez. Usar Opus aquí también sería pagar caro por simplemente recolectar datos.

## PROPÓSITO
Antes de escribir una línea de código, investigar el dominio, definir la arquitectura, y dejar la seguridad decidida desde el diseño — no añadida después.

## REGLAS

### Bloque 1 — Visión del Producto
- ¿Cuál es el problema que resuelve?
- ¿Quién es el usuario final?
- ¿Qué resultado tangible espera obtener?
- ¿Qué NO es el producto?

### Bloque 2 — Dominio e Investigación
- ¿Qué datos necesita? ¿De dónde salen?
- ¿Existen APIs públicas? Pide al usuario que investigue.
- ¿Hay competidores? ¿Qué les falta?

### Bloque 3 — Arquitectura e Ingeniería
- ¿El sistema necesita tiempo real?
- ¿Monolito o microservicios? Justifica.
- Dibuja un diagrama de bloques simple.
- ¿Cómo se manejará la persistencia?

### Bloque 4 — Seguridad desde el diseño (lente trust-boundary / abuse-path)
No basta con preguntar "¿es seguro?". Traza explícitamente los límites de confianza del sistema:
- ¿Dónde cruza el dato una frontera de confianza (cliente → servidor, servidor → DB, servidor → proceso del sistema)? Marca cada cruce.
- Para cada cruce: ¿qué pasaría si el dato que llega ahí es hostil, no solo inválido? Piensa en abuso deliberado, no solo en errores accidentales.
- ¿Qué datos son sensibles (PII, credenciales, pagos)?
- ¿Dónde vivirán los secretos? (siempre variables de entorno, nunca en el repo)
- ¿Qué nivel de privilegio necesita cada componente? Anótalo — Sentinel lo usará como línea base en cada deploy.

Este bloque es el diseño inicial de los límites de confianza. No sustituye el gate de seguridad de `/castoff`: ese se ejecuta en cada deploy, este solo una vez al principio (o cuando la arquitectura cambia). Confundir ambos —auditar solo al inicio y no en cada cambio— es el error más común y más caro en sistemas que viven mucho tiempo.

### Bloque 5 — Stack Tecnológico
- Aplica el árbol de decisión de `docs/guides/frameworks.md`.
- Propón 2 opciones (la más simple primero).

### Bloque 6 — Plan de Validación
- ¿Cómo sabremos que el MVP funciona?

Al completar los 6 bloques, invoca `/compass` para registrar el avance — no edites `docs/agents/PROGRESS.md` directamente.

## OUTPUT
Genera `docs/agents/architecture.md` con todas las decisiones, incluido el bloque de seguridad.

## LÍMITES
- No escribas código en esta fase.
- No decidas sin consultar al usuario.
