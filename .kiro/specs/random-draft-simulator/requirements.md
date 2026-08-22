# Requirements Document

## Introduction

El `random-draft-simulator` es una extensión del simulador existente de dota2coach que genera
drafts de **Ranked All Pick** aleatorios y realistas para QA iterativo del motor de sugerencias.
En lugar de repetir los mismos 2 guiones hardcodeados, el sistema permite al usuario jugar como
drafter de su equipo (Radiant o Dire) mientras un bot enemigo elige con heurísticas basadas en el
meta. Los bans se resuelven automáticamente al inicio con la lista personal del usuario más relleno
aleatorio hasta 16 bans totales. Los picks se hacen en 3 rondas a ciegas con timers reales. El
copiloto (motor de sugerencias existente) asiste al usuario durante su fase de picks.

El simulador existente con guiones hardcodeados (`captainsMode`, `allPick` en `scripts.json`) se
mantiene intacto. Esta feature agrega un tercer modo de ejecución, sin tocar el contrato de
eventos `draft-event/v1`, el reductor `applyDraftEvent`, ni el motor `buildSuggestions`.

**Formato de draft de referencia (Ranked All Pick, 7.35d–7.37, sin cambios estructurales):**
- 16 bans automáticos al inicio (50% prob. por ban personal, relleno por tasa de ban del bracket)
- 3 rondas de picks a ciegas: 2-2-1 por equipo
- Timers: 25s (rondas 1 y 2), 20s (ronda 3)
- Sin last pick secuencial — ambos equipos eligen simultáneamente en cada ronda

---

## Glossary

- **Random_Draft_Simulator**: el nuevo modo de simulación de All Pick aleatorio descrito en este
  documento. Distinto del simulador de guiones fijos existente.
- **Draft_Engine**: el módulo `apps/engine/src/simulator/player.ts` y su función `runSimulator`.
- **Draft_Reducer**: la función pura `applyDraftEvent` en `apps/engine/src/draft/reducer.ts`.
- **Suggestion_Engine**: la función `buildSuggestions` en `apps/engine/src/signals/mix.ts`.
- **Ban_Phase**: la fase automática de 16 bans que ocurre antes de la pantalla de selección.
- **Personal_Ban_List**: la lista de hasta 4 héroes que el usuario configura para bans automáticos.
- **Meta_Ban_Pool**: el conjunto de héroes con alta tasa de ban en el bracket activo, usado para
  rellenar la Ban_Phase hasta llegar a 16 bans.
- **Pick_Phase**: la fase de 3 rondas de picks a ciegas que sigue a la Ban_Phase.
- **Blind_Round**: cada una de las 3 rondas de la Pick_Phase donde ambos equipos eligen
  simultáneamente sin ver los picks del oponente hasta que termina la ronda.
- **Bot_Drafter**: el agente automatizado que controla al equipo enemigo durante la Pick_Phase.
- **User_Drafter**: el usuario humano que controla su equipo durante la Pick_Phase.
- **Copilot**: el Suggestion_Engine tal como lo percibe el usuario — muestra sugerencias en
  tiempo real mientras el User_Drafter elige.
- **Draft_Session**: una instancia completa de un draft desde Ban_Phase hasta el último pick.
- **Conflict_Ban**: el ban automático que ocurre cuando User_Drafter y Bot_Drafter intentan
  pickear el mismo héroe en la misma Blind_Round.
- **Meta_Freshness**: el estado de frescura de la meta en SQLite, expuesto por `getMetaFreshness`.
- **Stale_Warning**: el aviso visible al usuario cuando la meta está desactualizada (>24 horas).
- **draftSeed**: identificador de 8 caracteres alfanuméricos (A-Z, 0-9) que determina la secuencia
  aleatoria de una Draft_Session — mismo seed + misma Personal_Ban_List = mismo draft del bot.

---

## Requirements

### Requirement 1: Configuración del lado del jugador y Personal Ban List

**User Story:** Como jugador que va a simular un draft, quiero elegir mi lado (Radiant o Dire) y
configurar mis bans personales antes de empezar, para que el simulador refleje mis preferencias
reales de ban.

#### Acceptance Criteria

1. THE Random_Draft_Simulator SHALL permitir al User_Drafter seleccionar entre Radiant y Dire
   como su lado antes de iniciar una Draft_Session.
2. THE Random_Draft_Simulator SHALL permitir al User_Drafter configurar una Personal_Ban_List de
   entre 0 y 4 héroes antes de iniciar una Draft_Session.
3. WHEN el User_Drafter selecciona un héroe para la Personal_Ban_List, THE Random_Draft_Simulator
   SHALL verificar que ese héroe no esté ya presente en la Personal_Ban_List antes de añadirlo;
   si ya está presente, SHALL rechazar la acción y mantener la lista sin cambios.
4. IF el User_Drafter intenta agregar un quinto héroe a la Personal_Ban_List, THEN THE
   Random_Draft_Simulator SHALL rechazar la acción, mostrar un mensaje indicando que el máximo
   es 4 héroes, y mantener la lista sin cambios.
5. THE Random_Draft_Simulator SHALL persistir la Personal_Ban_List y el lado seleccionado en
   `localStorage` del navegador, de modo que al recargar la página el usuario encuentre la misma
   configuración que dejó.
6. WHEN el User_Drafter elimina un héroe de la Personal_Ban_List, THE Random_Draft_Simulator
   SHALL actualizar la lista inmediatamente y persistir el cambio en `localStorage`.

---

### Requirement 2: Fase de Bans automática (Ban_Phase)

**User Story:** Como jugador, quiero que los bans se resuelvan automáticamente al inicio de cada
draft usando mi lista personal como base, para poder concentrarme en la fase de picks.

#### Acceptance Criteria

1. WHEN se inicia una Draft_Session, THE Random_Draft_Simulator SHALL resolver la Ban_Phase
   completa y emitir todos los eventos `hero_banned` al Draft_Reducer antes de mostrar la
   pantalla de selección de héroes.
2. WHEN se resuelve la Ban_Phase y la Personal_Ban_List contiene héroes, THE
   Random_Draft_Simulator SHALL evaluar cada héroe de la lista con una probabilidad independiente
   del 50% usando el draftSeed como fuente de aleatoriedad; IF la Personal_Ban_List está vacía o
   no existe, THEN cero héroes de la lista se aplican y se procede directamente al relleno.
3. IF la cantidad de bans aplicados de la Personal_Ban_List es menor a 16, THEN THE
   Random_Draft_Simulator SHALL completar hasta alcanzar exactamente 16 bans seleccionando
   héroes del Meta_Ban_Pool ordenados por tasa de ban descendente en el bracket activo, sin
   repetir héroes ya baneados; IF la Personal_Ban_List produce 16 o más bans exitosos, THEN
   THE Random_Draft_Simulator SHALL tomar exactamente los primeros 16 en orden de evaluación.
4. THE Random_Draft_Simulator SHALL emitir exactamente 16 eventos `hero_banned` al Draft_Reducer
   durante la Ban_Phase, con el primer evento asignado al lado Radiant y alternando Radiant/Dire
   en cada evento subsiguiente.
5. IF la Ban_Phase produce menos de 16 héroes únicos disponibles para banear, THEN THE
   Random_Draft_Simulator SHALL banear todos los héroes disponibles, registrar en consola
   `[Ban_Phase] bans emitidos: N de 16 esperados`, y continuar hacia la Pick_Phase.

---

### Requirement 3: Fase de Picks a ciegas — estructura de 3 rondas (Pick_Phase)

**User Story:** Como jugador, quiero que los picks sigan la estructura real de Ranked All Pick con
3 rondas a ciegas, para practicar el mismo estilo de toma de decisiones que en una partida real.

#### Acceptance Criteria

1. THE Random_Draft_Simulator SHALL estructurar la Pick_Phase en exactamente 3 Blind_Rounds con
   la siguiente distribución: Ronda 1 — 2 picks por equipo; Ronda 2 — 2 picks por equipo;
   Ronda 3 — 1 pick por equipo.
2. WHILE una Blind_Round está activa, THE Random_Draft_Simulator SHALL mantener los picks del
   Bot_Drafter para esa ronda en un estado oculto no accesible al User_Drafter; el Bot_Drafter
   SHALL haber calculado y registrado internamente sus picks antes de que comience el timer del
   User_Drafter.
3. WHEN el User_Drafter confirma todos sus picks para una Blind_Round, THE Random_Draft_Simulator
   SHALL revelar simultáneamente todos los picks del Bot_Drafter y del User_Drafter para esa
   ronda, emitiendo los eventos `hero_picked` de ambos lados al Draft_Reducer antes de comenzar
   la siguiente ronda.
4. WHEN comienza la Ronda 1 o la Ronda 2, THE Random_Draft_Simulator SHALL iniciar un temporizador
   visible de 25 segundos para que el User_Drafter complete sus picks.
5. WHEN comienza la Ronda 3, THE Random_Draft_Simulator SHALL iniciar un temporizador visible de
   20 segundos para que el User_Drafter complete su pick.
6. WHEN el temporizador de una Blind_Round expira sin que el User_Drafter haya confirmado todos
   sus picks, THE Random_Draft_Simulator SHALL seleccionar automáticamente héroes aleatorios del
   conjunto de héroes no baneados y no pickeados para completar los picks pendientes del
   User_Drafter, y proceder a la revelación simultánea.
7. WHEN el User_Drafter confirma sus picks antes de que expire el timer, THE Random_Draft_Simulator
   SHALL detener el timer y proceder inmediatamente a la revelación simultánea sin esperar el
   tiempo restante.
8. WHEN termina la Ronda 3, THE Random_Draft_Simulator SHALL emitir un evento `session_ended`
   con `reason: "completed"` al Draft_Reducer.

---

### Requirement 4: Bot_Drafter — selección inteligente de héroes

**User Story:** Como jugador haciendo QA del motor de sugerencias, quiero que el Bot_Drafter
elija héroes de forma competente usando datos del meta, para que las sugerencias reflejen
situaciones de draft reales.

#### Acceptance Criteria

1. WHEN el Bot_Drafter debe elegir un héroe en una Blind_Round, THE Bot_Drafter SHALL calcular
   los scores del Suggestion_Engine sobre el estado actual del draft con el lado del Bot_Drafter
   como lado local, y seleccionar el héroe con el score más alto; en caso de empate, SHALL
   seleccionar el primero en orden de la lista de sugerencias.
2. IF el Suggestion_Engine no produce sugerencias para el Bot_Drafter (pool de candidatos vacío),
   THEN THE Bot_Drafter SHALL elegir un héroe aleatorio usando el draftSeed del conjunto de
   héroes no baneados y no pickeados disponibles.
3. IF el conjunto de héroes disponibles para el Bot_Drafter está vacío (sin candidatos ni
   fallback), THEN THE Random_Draft_Simulator SHALL registrar en consola el error y omitir el
   pick del Bot_Drafter para esa ronda sin detener la Draft_Session.
4. WHEN comienza una Blind_Round, THE Bot_Drafter SHALL calcular y registrar internamente todos
   sus picks para esa ronda antes de activar el temporizador del User_Drafter, de modo que el
   estado de picks del Bot_Drafter esté listo para revelación simultánea.
5. WHILE la Ban_Phase está activa, THE Bot_Drafter SHALL seleccionar y registrar la mitad de los
   bans asignados al lado enemigo según la distribución alternada del formato, usando el
   draftSeed como fuente de aleatoriedad.

---

### Requirement 5: Conflict_Ban — resolución de colisiones de pick

**User Story:** Como jugador, quiero que si elijo el mismo héroe que el bot en la misma ronda,
ese héroe se banee automáticamente como en el juego real.

#### Acceptance Criteria

1. WHEN el User_Drafter y el Bot_Drafter han seleccionado el mismo héroe en la misma Blind_Round,
   THE Random_Draft_Simulator SHALL banear ese héroe automáticamente emitiendo un evento
   `hero_banned` al Draft_Reducer, sin emitir ningún evento `hero_picked` para ese héroe.
2. WHEN ocurre un Conflict_Ban, THE Random_Draft_Simulator SHALL mostrar una notificación visible
   indicando el nombre del héroe baneado por conflicto; la notificación SHALL permanecer visible
   hasta que el User_Drafter seleccione un héroe alternativo o hasta que expire el nuevo timer.
3. WHEN ocurre un Conflict_Ban, THE Random_Draft_Simulator SHALL reiniciar el temporizador de la
   Blind_Round con el tiempo completo original de esa ronda (25s para rondas 1-2, 20s para
   ronda 3), y el Bot_Drafter SHALL recalcular su pick alternativo usando el Suggestion_Engine
   antes de activar el nuevo timer.
4. THE Random_Draft_Simulator SHALL permitir hasta 2 Conflict_Bans por Blind_Round; después del
   segundo Conflict_Ban, el User_Drafter SHALL ser el primer confirmado en obtener el héroe en
   conflicto si ocurre una tercera colisión, y el Bot_Drafter SHALL recalcular con el siguiente
   mejor candidato.

---

### Requirement 6: Copilot — sugerencias en tiempo real durante la Pick_Phase

**User Story:** Como jugador, quiero recibir sugerencias del copiloto mientras elijo mis picks,
para practicar cómo usar el motor de sugerencias en condiciones de draft real.

#### Acceptance Criteria

1. WHEN comienza una Blind_Round y el User_Drafter tiene el turno de pick activo, THE Copilot
   SHALL mostrar las sugerencias del Suggestion_Engine calculadas sobre el estado del draft
   conocido por el User_Drafter en ese momento, dentro de los primeros 500ms desde el inicio
   de la ronda.
2. WHEN el estado del draft cambia por un ban o un pick revelado al inicio de una ronda, THE
   Copilot SHALL recalcular y mostrar sugerencias actualizadas en menos de 500ms (p95); si el
   cálculo supera 500ms, SHALL mostrar las últimas sugerencias válidas con un indicador visual
   de "actualizando".
3. WHILE el Bot_Drafter no ha revelado sus picks de la ronda en curso, THE Copilot SHALL calcular
   sugerencias usando únicamente el estado del draft visible para el User_Drafter, excluyendo
   los picks ocultos del Bot_Drafter.
4. WHEN el User_Drafter selecciona un héroe como pick pendiente, THE Random_Draft_Simulator SHALL
   registrar la selección en el estado local del User_Drafter sin emitir eventos al Draft_Reducer;
   IF el User_Drafter deselecciona ese héroe antes de confirmar la ronda, THE Random_Draft_Simulator
   SHALL eliminar la selección del estado local sin efecto sobre el Draft_Reducer.
5. IF el Suggestion_Engine lanza una excepción o supera el hard cutoff de 500ms durante el
   cálculo para el Copilot, THEN THE Copilot SHALL mostrar el mensaje "Sin sugerencias disponibles"
   y registrar el error en consola, sin bloquear la interacción del User_Drafter.

---

### Requirement 7: Stale_Warning — aviso de meta desactualizada

**User Story:** Como jugador, quiero saber antes de simular un draft si los datos del meta están
desactualizados, para decidir si sincronizar primero o continuar de todos modos.

#### Acceptance Criteria

1. WHEN el User_Drafter accede a la pantalla del Random_Draft_Simulator y la última sincronización
   exitosa tiene más de 24 horas de antigüedad (o nunca se realizó), THE Random_Draft_Simulator
   SHALL mostrar el Stale_Warning integrado en esa misma pantalla, sin navegar a otra pantalla.
2. WHEN el Stale_Warning está visible, THE Random_Draft_Simulator SHALL mostrar la fecha y hora
   de la última sincronización exitosa en formato `DD/MM/YYYY HH:MM` en la zona horaria local
   del navegador; si nunca hubo una sincronización exitosa, SHALL mostrar "Sin sincronización
   previa".
3. WHEN el Stale_Warning está visible y el User_Drafter activa el botón de sincronizar, THE
   Random_Draft_Simulator SHALL invocar `POST /api/meta/sync` y deshabilitar el botón durante
   la sincronización en curso.
4. WHEN la sincronización iniciada desde el Stale_Warning finaliza con éxito, THE
   Random_Draft_Simulator SHALL ocultar el Stale_Warning y re-habilitar el botón de sincronizar.
5. WHEN la sincronización iniciada desde el Stale_Warning falla, THE Random_Draft_Simulator SHALL
   mantener el Stale_Warning visible, re-habilitar el botón de sincronizar, y mostrar un mensaje
   de error indicando que la sincronización falló con opción de reintentar.
6. IF la Meta_Freshness indica que la última sincronización exitosa tiene 24 horas o menos al
   cargar la pantalla, THEN THE Random_Draft_Simulator SHALL no mostrar el Stale_Warning.
7. WHEN el User_Drafter inicia una Draft_Session con el Stale_Warning visible (sin sincronizar),
   THE Copilot SHALL incluir el flag `stale_meta` en el `degraded` array de cada `SuggestionSet`
   calculado durante esa Draft_Session.

---

### Requirement 8: Variedad y reproducibilidad del draft generado

**User Story:** Como desarrollador haciendo QA, quiero que cada draft sea diferente y poder
reproducir uno específico, para probar el motor con combinaciones diversas y reportar bugs con
contexto exacto.

#### Acceptance Criteria

1. WHEN se inicia una Draft_Session sin un draftSeed proporcionado, THE Random_Draft_Simulator
   SHALL generar un draftSeed de 8 caracteres alfanuméricos (A-Z, 0-9) único para esa sesión.
2. WHEN una Draft_Session finaliza, THE Random_Draft_Simulator SHALL mostrar el draftSeed de
   esa sesión en la pantalla de resumen final; el draftSeed SHALL permanecer visible hasta que
   el User_Drafter inicie una nueva Draft_Session.
3. IF el User_Drafter proporciona un draftSeed válido de 8 caracteres alfanuméricos al iniciar
   una Draft_Session, THEN THE Random_Draft_Simulator SHALL usar ese draftSeed para determinar
   la secuencia aleatoria del Bot_Drafter y los bans automáticos de esa sesión.
4. IF el User_Drafter proporciona un valor que no es un string de exactamente 8 caracteres
   alfanuméricos (A-Z, 0-9) como draftSeed, THEN THE Random_Draft_Simulator SHALL rechazar el
   inicio de la Draft_Session, mostrar un mensaje indicando el formato requerido, y no modificar
   ningún estado de sesión en curso.
5. THE Random_Draft_Simulator SHALL producir exactamente la misma Ban_Phase y la misma secuencia
   de picks del Bot_Drafter para todo par (draftSeed, Personal_Ban_List) idéntico, independiente-
   mente de cuándo o cuántas veces se ejecute.

---

### Requirement 9: Compatibilidad con el simulador existente

**User Story:** Como desarrollador, quiero que el simulador de guiones fijos existente siga
funcionando sin cambios, para no romper las pruebas de regresión actuales.

#### Acceptance Criteria

1. THE Random_Draft_Simulator SHALL coexistir con los guiones `captainsMode` y `allPick` de
   `apps/engine/src/simulator/scripts.json` sin modificar el contenido de ese archivo.
2. THE Random_Draft_Simulator SHALL no añadir nuevos tipos al union `DraftEvent` del
   Draft_Reducer ni modificar los tipos existentes en ese union.
3. THE Random_Draft_Simulator SHALL comunicarse con `apps/engine` usando únicamente los endpoints
   HTTP existentes: `POST /api/simulator/sessions` y `GET /api/simulator/sessions/:id/state`;
   no SHALL crear endpoints nuevos en `apps/engine`.
4. WHEN el Random_Draft_Simulator emite eventos al Draft_Reducer, THE Draft_Reducer SHALL
   procesarlos con `applyDraftEvent` sin ninguna modificación a esa función.
5. THE Random_Draft_Simulator SHALL no modificar `buildSuggestions`, ningún scorer, ni los
   valores de `SCORING_WEIGHTS_V1`, `SCORING_WEIGHTS_V2`, ni `SCORING_WEIGHTS_V3` en
   `apps/engine/src/signals/weights.ts`.
6. WHEN el Random_Draft_Simulator crea una Draft_Session, THE Random_Draft_Simulator SHALL usar
   un `sessionId` diferente al de cualquier sesión del simulador de guiones fijos activa en el
   mismo proceso, de modo que los estados de ambos tipos de sesión nunca interfieran.

---

### Requirement 10: Serialización del estado de Draft_Session

**User Story:** Como desarrollador, quiero que el estado completo de una Draft_Session pueda
serializarse y deserializarse sin pérdida de información, para guardar, reproducir y depurar
sesiones específicas.

#### Acceptance Criteria

1. WHEN se solicita la serialización de una Draft_Session, THE Random_Draft_Simulator SHALL
   producir un objeto JSON que contenga exactamente los siguientes campos tipados: `draftSeed`
   (string 8 chars), `userSide` ("radiant" | "dire"), `personalBanList` (array de hasta 4
   HeroId enteros positivos), `resolvedBans` (array de hasta 20 HeroId), `picksByRound` (array
   de 3 objetos, cada uno con `userPicks: HeroId[]` y `botPicks: HeroId[]`), y `hiddenBotPicks`
   (array de hasta 10 HeroId pendientes de revelar).
2. WHEN el Random_Draft_Simulator deserializa un objeto JSON de estado de Draft_Session, THE
   Random_Draft_Simulator SHALL producir un estado donde cada campo listado en el criterio 1
   tiene el mismo valor que en el objeto JSON original (comparación campo por campo).
3. THE Random_Draft_Simulator SHALL producir un estado equivalente campo por campo (según el
   criterio 2) para todo estado de Draft_Session válido que sea serializado y luego
   deserializado en la misma versión del sistema.
4. IF el Random_Draft_Simulator recibe un objeto JSON con algún campo faltante, con tipo
   incorrecto, o con valor fuera del rango permitido (según los tipos del criterio 1), THEN THE
   Random_Draft_Simulator SHALL rechazar el objeto con un error que identifique el campo
   específico que falló la validación, sin modificar ningún campo del estado de sesión en curso.
5. IF el Random_Draft_Simulator recibe una solicitud de deserialización cuando ya existe una
   Draft_Session activa, THEN THE Random_Draft_Simulator SHALL rechazar la solicitud con un
   error indicando que ya existe una sesión activa, sin modificar el estado de la sesión en
   curso.
