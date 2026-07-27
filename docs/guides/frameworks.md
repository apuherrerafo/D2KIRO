# Árbol de decisión de stack — frameworks.md

Guía usada por `/pre-flight` (Bloque 5) y `/gear-up` para proponer opciones de stack.
No es una lista de preferencias — es un árbol de preguntas: el tipo de proyecto decide
qué categorías de herramientas tienen sentido, antes de nombrar productos concretos.

## Pregunta 1 — ¿Dónde vive la interfaz principal del usuario?

- **Sitio/app web tradicional** (el usuario abre una URL en el navegador, interacción
  request/respuesta): un frontend server-rendered con actualizaciones parciales (ej.
  HTMX) es una opción sólida y minimalista — evita el peso de un framework SPA completo.
- **Overlay dentro de un juego** (la interfaz vive encima del juego mientras se juega,
  reacciona a eventos del juego en tiempo real, no a clics de navegación de páginas):
  esto normalmente corre sobre una plataforma de overlay para juegos (ej. Overwolf),
  que expone su propio SDK de eventos vía JavaScript del lado del cliente. Ese modelo
  encaja mejor con un frontend reactivo basado en componentes (React, Svelte, Vue) que
  con HTMX, porque la UI se actualiza por eventos empujados del juego/backend, no por
  swaps de HTML disparados por navegación o polling.
- **CLI / solo lógica sin interfaz**: no aplica ninguno de los anteriores, se prioriza
  únicamente el runtime del backend.

## Pregunta 2 — ¿La app necesita empujar actualizaciones en tiempo real (segundos) al
usuario, o alcanza con petición-respuesta bajo demanda?

- **Tiempo real (WebSockets/SSE)**: el runtime del backend debe soportar conexiones
  persistentes de forma nativa o con librería madura y ligera — evitar stacks donde
  esto requiera infraestructura adicional pesada (colas de mensajes, brokers externos)
  si el volumen de usuarios es bajo (ej. un solo usuario en el MVP).
- **Petición-respuesta**: cualquier runtime/framework estándar alcanza sin necesidad de
  WebSockets.

## Pregunta 3 — ¿Cuál es la escala real esperada en el MVP?

- **Un solo usuario / bajo volumen**: prioriza simplicidad operativa sobre
  escalabilidad — SQLite en archivo local es preferible a un servidor de base de datos
  separado; un monolito es preferible a microservicios.
- **Multiusuario desde el día uno**: recién ahí se justifica evaluar un motor de base
  de datos con concurrencia real y separación de servicios.

## Pregunta 4 — ¿Ya existe un default de proyecto declarado (ej. en `CLAUDE.md`)?

- El default declarado (`Bun + HTMX + SQLite + Drizzle`) es el punto de partida por
  defecto de este ecosistema, pero **no es obligatorio si el tipo de proyecto
  (Pregunta 1) no encaja con él** — un overlay de juego con eventos en tiempo real es
  precisamente un caso donde HTMX no es la pieza correcta, aunque el runtime (Bun) y la
  persistencia (SQLite/Drizzle) sí puedan seguir aplicando sin cambios.

## Formato de salida esperado

Proponer siempre **2 opciones máximo**, la más simple primero:
- **Opción A**: la más cercana al default del proyecto, con la limitación específica
  señalada si no encaja del todo.
- **Opción B**: alternativa justificada solo por las respuestas concretas al árbol de
  arriba — nunca "porque es más moderno" o preferencia sin razón ligada al proyecto.

La verificación de que cada pieza elegida siga vigente (no deprecada) es trabajo de
`/gear-up` vía Context7 — este árbol solo decide la *categoría* de herramienta, no su
vigencia actual.
