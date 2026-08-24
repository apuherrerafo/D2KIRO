# plan.md — vista derivada, generada por /helm

**No se edita a mano.** Fuente de verdad: frontmatter YAML de cada `docs/agents/tasks/TSK-XXX.md`.
Regenerar con `/helm` cada vez que cambie el estado de un ticket.

Los tickets TSK-001 a TSK-088 están `done`. **Backlog en cero** — se cerró el rediseño completo de
UX de `/draft` (7 tickets originales del `/grill-me`), el RCA de arquitectura que salió de
verificar TSK-075/076 en vivo (TSK-078/079/080), la especificación formal + su ejecución completa
vía Spec-Driven Development (`specs/draft-native-experience.md`, TSK-081/077/071→074), el bot
real de `/random-draft` (TSK-082/083), la paridad visual de `/random-draft` con `/draft`
(TSK-084/085/086 — grid nativa, picks persistentes, timer al centro), el flujo sin fricción de
ronda (TSK-087 — auto-avance, sin botón manual), y un ajuste rápido de navegación/picker visual
(TSK-088 — link en NavBar + modal de Personal_Ban_List) previo a arrancar la reingeniería del
motor de recomendaciones. `should`/`could`: ninguno.

## Top Must-have (backlog)

Ninguno — backlog en cero.

## Done en esta ronda (2026-08-23)

| Ticket | Tema |
|---|---|
| TSK-075 | `HeroGrid` nativo por atributo, componente aislado |
| TSK-076 | Wiring de `HeroGrid` en `ActiveDraftState` (`DraftView.tsx`), pantalla principal |
| TSK-078 | RCA fase 1: guardrail `MAX_PICKS_PER_SIDE`/`roster_full` en el reductor |
| TSK-079 | RCA fase 2: `DraftInputMode` + `useSubmitDraftEvent`, tubería única de entrada |
| TSK-080 | RCA fase 3: `DraftLayout` (tablero compacto + grilla contenida + rail de sugerencias) |
| TSK-081 | `InputModeSelector` visible sobre `HeroGrid` (spec §1.2) — confirmado en vivo por el usuario |
| TSK-077 | Jerarquía visual táctica en `SuggestionCard`/`SignalBreakdown` (spec §1.3) — confirmado en vivo por el usuario |
| TSK-071 | Tabla curada de turnos/tiempos, Captain's Mode + All Pick (spec §2.1) — investigación real aportada por el usuario |
| TSK-072 | Máquina de turnos en el reductor + `wrong_turn` + reserva (spec §2.2) |
| TSK-073 | Turno en el protocolo WebSocket + espejo en `apps/web` (spec §2.3) |
| TSK-074 | `TurnStatusBar`/`DraftTimer` real conectado al turno del motor (spec §2.4) |
| TSK-082 | `POST /api/suggestions/preview` — sugerencias reales sin sesión, para el bot de `/random-draft` |
| TSK-083 | El bot de `/random-draft` usa el motor real (`buildSuggestions`) en vez del scoring simplificado |
| TSK-084 | `HeroGrid` portado a `/random-draft` (`BlindRoundPanel`/`ConfigPanel`), reemplaza `HeroPicker` |
| TSK-085 | `CompactBoard` persistente en `/random-draft` — picks de rondas anteriores ya no desaparecen |
| TSK-086 | Timer de ronda al centro de `CompactBoard` en `/random-draft` — paridad visual con All Pick real |
| TSK-087 | Auto-avance de ronda en `/random-draft` — sin botón manual "Confirmar ronda" |
| TSK-088 | Link a `/random-draft` en el NavBar + `HeroPickerModal` para la Personal_Ban_List |

## Should-have (no bloquea, se atiende después)

Ninguno en backlog actualmente.

## WIP actual (por assigned_tool)

Ninguna tarea en `doing`, ninguna en `backlog` — libre para abrir cualquier trabajo nuevo vía
`/dispatch`.

## Hallazgo de esta ronda: `/random-draft` ya era el simulador con bot que el usuario pidió

El usuario pidió transformar `/draft` en un simulador interactivo de All Pick contra un bot
(rondas ocultas 2/2/1, timer visible, fase de 16 bans, revelación simultánea). Investigación antes
de escribir código: **todo eso ya existía, construido y commiteado desde TSK-063**, en
`/random-draft` (`apps/web/features/random-draft-simulator/`) — `BLIND_ROUND_SPECS` ya tenía
exactamente 2/25s, 2/25s, 1/20s; `ban-phase.ts` ya resolvía 16 bans; `BlindRoundPanel.tsx` ya tenía
timer real + revelación simultánea + banner de conflicto; `CopilotPanel.tsx` ya mostraba
sugerencias reales del motor para el lado del usuario. La única brecha real era que el bot rival
(`bot-drafter.ts`) usaba un scoring propio simplificado, no el motor completo — corregido en
TSK-082/083. **Corrección de un ítem de "caminos identificados" de una ronda anterior de esta
misma sesión**: se había anotado como pendiente "el sistema de rondas ocultas de All Pick
necesitaría una feature aparte" — eso era incorrecto, ya existía. Queda como lección: antes de
planificar una feature grande, buscar primero si ya existe en otra parte del árbol.

## Verificación visual pendiente

**Confirmados en vivo por el usuario**: TSK-081 (`InputModeSelector`), TSK-077 (jerarquía visual
de `SuggestionCard`/`SignalBreakdown`), y TSK-084/085 (grid nativa + picks persistentes en
`/random-draft`, tras el reporte con capturas del usuario). **Pendiente de confirmación en vivo**:
TSK-074 (`TurnStatusBar`, requiere una sesión `captains_mode` real por un paso manual
documentado), TSK-082/083 (bot real de `/random-draft`, verificado por `curl` contra el motor real
y por `bun test`, pero no jugado en el navegador todavía), y TSK-086 (timer al centro de
`CompactBoard`, recién cerrado). El resto de los tickets de UI de esta ronda
(TSK-075/076/079/080, motor de TSK-071/072/073) pasaron `tsc --noEmit`/`bun test`/`curl` con los
dos servidores reales corriendo, pero eso no es lo mismo que "se ve y se usa bien".

## Caminos identificados, sin fecha ni ticket (decisión de producto pendiente, no bloquean nada)

- El spike de Overwolf (único capturador de fase 1 nunca validado contra una partida real).
- El adaptador OCR (contrato ya especificado en `architecture.md`, nunca construido).
- Predicción de rol/posición del rival (dependencia condicional de STRATZ, documentada desde
  fase 1b, nunca priorizada).
- El sistema combinatorial completo de caminos de draft (eje de timing, forma de recursos, win
  conditions primaria+secundaria) — la v1 (TSK-036) solo cubrió el eje de plan macro, a propósito.
- Elegir formato (`all_pick`/`captains_mode`) desde la UI antes de arrancar un draft manual en
  `/draft` — hoy `bootstrap-session.ts` hardcodea `all_pick`, así que `TurnStatusBar`/la máquina de
  turnos de Captain's Mode no tienen forma nativa de activarse todavía sin un paso manual por API.
- El algoritmo interno exacto de Valve para los 16 bans automáticos de Ranked All Pick (spec §2.1)
  quedó documentado como no confirmado a propósito — si se necesita simular ese comportamiento con
  precisión en el futuro, hace falta evidencia directa del cliente de Dota 2, no se debe inventar.
- El bot de `/random-draft` ahora depende del motor real -- `initDraft` ya no es puro/determinístico
  desde el `draftSeed` cuando el motor está disponible (trade-off aceptado a propósito). Si en el
  futuro se necesita volver a la reproducibilidad total, existe la opción `remoteBotPick` para
  forzar el fallback simplificado siempre.

Cualquiera de ellos arranca con `/kickoff` cuando el usuario lo decida — ver
`docs/agents/PROGRESS.md` para el detalle completo de cada uno.
