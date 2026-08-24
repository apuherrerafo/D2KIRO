# Spec — Experiencia nativa de `/draft`

> Spec formal de cierre para el módulo `/draft`. Fuente de verdad para TSK-071 a TSK-074,
> TSK-077 y TSK-081. Convención de numeración `§N` igual que `docs/specs/SPEC.md`. Aprobada
> 2026-08-23, vía Plan Mode.

## §0 — Estado de partida (qué ya existe, qué falta)

| Pieza | Estado | Ticket |
|---|---|---|
| `DraftLayout` (header compacto Radiant/Bans/Dire, región central `min-h-0` + scroll propio) | **Hecho**, sin verificación visual | TSK-080 |
| `HeroGrid` (grid nativa por atributo, highlight dorado, guardrails `isHeroTaken`/`isRosterFull`) | **Hecho**, sin verificación visual | TSK-075/076/079 |
| `DraftInputMode` compartido (`useDraftStore`) + `useSubmitDraftEvent` (tubería única) | **Hecho** | TSK-079 |
| `MAX_PICKS_PER_SIDE`/`roster_full` en el reductor | **Hecho**, 23/23 tests | TSK-078 |
| Selector visible de modo (Pick Radiant / Ban / Pick Dire) sobre `HeroGrid` | **Falta** — hoy el modo solo se cambia desde dentro de `ManualEntryPanel` (modal) | TSK-081 |
| Jerarquía visual de `SuggestionCard`/`SignalBreakdown` | **Falta** | TSK-077 |
| Tabla de turnos real (datos) | **Falta** | TSK-071 |
| Máquina de turnos en el reductor + `wrong_turn` | **Falta** | TSK-072 |
| Turno en el protocolo WebSocket | **Falta** | TSK-073 |
| Timer real conectado a `DraftTimer.tsx` | **Falta** | TSK-074 |

## §1 — Requerimientos de UI/Layout

### §1.1 — Header espejo nativo (`DraftLayout` / `CompactBoard`)

**Ya implementado (TSK-080)** — esta sección documenta el contrato ya construido, no propone uno
nuevo.

- `apps/web/components/draft-layout/DraftLayout.tsx`: raíz `h-screen overflow-hidden flex
  flex-col`. `CompactBoard` interno: `grid-cols-[1fr_auto_1fr]` — Radiant (5 casillas fijas,
  llenas o vacías) a la izquierda, bans centrados, Dire (5 casillas fijas) a la derecha.
- **La corrección técnica real contra el desbordamiento**: la región central lleva
  `flex-1 min-h-0` — sin `min-h-0`, un hijo flex nunca se encoge por debajo de la altura de su
  contenido y `overflow-y-auto` no hace nada; el scroll termina siempre en la página completa. Es
  la causa raíz confirmada del "scroll excesivo" reportado, no una suposición.
- Simetría garantizada porque ambas columnas (`CompactSideRow`) usan el mismo componente con
  `align="start"|"end"` — no hay dos implementaciones separadas que puedan divergir.
- **Pendiente de este pilar**: verificación visual en navegador real (ningún ticket de UI de esta
  sesión la tiene todavía) en al menos 2 resoluciones (ver Gherkin §3.4).

### §1.2 — Selector de modo en grilla (`InputModeSelector`) — nuevo, TSK-081

Hoy `DraftInputMode` (`{ action: "pick" | "ban"; side: TeamSide | "unknown" }`) ya vive en
`useDraftStore` (TSK-079) y ya gobierna tanto `HeroGrid` como `ManualEntryPanel` — pero el único
control visible para cambiarlo está enterrado dentro del modal de `ManualEntryPanel`. Este pedido
es agregar un control visible **en la pantalla principal**, junto a `HeroGrid`, sin abrir el modal.

- Componente nuevo `apps/web/components/input-mode-selector/InputModeSelector.tsx`: 3 botones —
  "Pick Radiant" / "Ban" / "Pick Dire" — que llaman `setInputMode({...})` (misma acción del store
  que ya usa `ManualEntryPanel`, sin tubería nueva).
  - "Pick Radiant" → `{ action: "pick", side: "radiant" }`; "Pick Dire" → `{ action: "pick", side:
    "dire" }`; "Ban" → `{ action: "ban" }` (el lado de un ban sigue siendo `"unknown"` desde este
    control, mismo comportamiento que ya decidió TSK-079 para `ManualEntryPanel`).
  - Estado activo resaltado (mismo patrón `actionButtonClassName`/`sideButtonClassName` ya
    existente en `ManualEntryPanel.tsx` — se puede extraer a un helper compartido si la
    duplicación molesta, no antes).
- Se monta en `DraftLayout` (prop nueva `modeSelector?: ReactNode`, mismo patrón que
  `topBar`/`grid`/`suggestionsRail` — puramente de presentación) o directo arriba de `HeroGrid` en
  `DraftView.tsx` — decisión de implementación, no de producto.
- **Fuente de verdad única, explícita**: cambiar el modo acá afecta inmediatamente qué hace un
  clic en `HeroGrid` — es el mismo comportamiento ya construido en TSK-079, solo gana un control
  visible fuera del modal. Ningún componente nuevo de estado, ninguna tubería nueva.

### §1.3 — Jerarquía táctica en `SuggestionCard` (TSK-077)

Sin cambios de diseño respecto al ticket ya aprobado (`docs/agents/tasks/TSK-077.md`) — se
incorpora acá para que la spec quede completa en un solo lugar:

- `suggestion.reason` (ya prioriza `team_synergy`/`counter`/`position_fit` por peso real vía
  `buildReason()` en `mix.ts` — el motor no cambia) pasa a tener jerarquía tipográfica real
  (`text-heading`, no `text-body` compartido con la confianza).
- `SignalBreakdown` reordena visualmente: `team_synergy`/`counter`/`position_fit` primero,
  `patch_meta`/`hero_pool_fit` al final — constante de prioridad nueva en
  `apps/web/features/draft/constants.tsx`, sin tocar el orden de wire.
- El número crudo (`raw.toFixed(2)`) baja de énfasis visual; la `explanation` narrativa es lo
  primero que se lee en cada fila.

## §2 — Sistema de turnos y temporizador (TSK-071 → TSK-074)

### §2.1 — Contrato de datos (TSK-071)

**Hallazgo central de la investigación, cambia el diseño respecto al pedido original**: Captain's
Mode y All Pick NO comparten la misma forma de dato. Captain's Mode es genuinamente por turnos
alternados; el sistema de bans de All Pick **no lo es** — es dos mecanismos no interactivos:

1. **16 bans automáticos**, resueltos al instante (mezcla de las preferencias de ban de cada
   jugador + los héroes más baneados en ese rango de MMR) — cero interacción de turno. Esto
   confirma y ancla en reglas reales lo que `docs/specs/SPEC.md` (Fase 1b) ya anotaba de pasada
   como "guion de bans de allPick ampliado a 16" — no era arbitrario, es el número real.
2. **Una fase de votación simultánea de 15s** (los 10 jugadores votan en paralelo, no por turno) —
   resuelve ~5 bans adicionales (la mitad de los votos, redondeo aleatorio).

Solo la **fase de picks** de All Pick es por turnos alternados entre los dos equipos.

**Consecuencia de diseño para TSK-072**: `DraftFormatTurnTable` no puede ser una única secuencia
homogénea para los dos formatos. Para All Pick, la fase de bans **no participa** de la máquina de
turnos/`wrong_turn` — llega como un evento (o lote de eventos) sin validación de orden, igual que
hoy. Captain's Mode sí modela bans y picks como turnos reales, de punta a punta.

**Captain's Mode — secuencia real** (fuente: KJC eSports, cruzada con el orden documentado en
7.34): 24 turnos totales, en 6 fases alternadas: Ban(4) → Pick(4) → Ban(6) → Pick(4) → Ban(4) →
Pick(2) = 14 bans + 10 picks. El orden exacto de qué equipo actúa en cada uno de los 24 turnos
necesita confirmarse contra el patch actual (`7.41e`) antes de curar el archivo final — el orden
arriba es la estructura de fases, no la asignación turno-por-turno de lado.

**Tiempos — Captain's Mode** (fuente: cruzada entre 2 artículos, consistente): 30s de tiempo
estándar por selección (no acumulable, se resetea cada turno) + 130s de reserva por equipo (banco
compartido entre todos los turnos de ese equipo, se consume automáticamente cuando el estándar de
un turno se agota, nunca se recarga). Turno sin acción al agotarse ambos tiempos: ban vacío en fase
de ban, héroe aleatorio en fase de pick.

**Tiempos — All Pick (fase de picks)**: **sin confirmar** — las fuentes públicas no convergen (25s
/ 30s / "2 héroes por 30s"/75s totales aparecen en distintos artículos, probablemente reflejando
variantes de matchmaking distintas o cambios entre parches). TSK-071 debe cerrar este número
observando un draft real o una fuente única autoritativa del parche `7.41e` antes de curar el
archivo — **no se cura con el valor más frecuente de la búsqueda, se verifica**.

- `apps/engine/src/draft/draft-format-turns.json` (nuevo, mismo patrón que
  `hero-positions.json`/`capabilities.json`): por formato, la secuencia de turnos reales (solo
  aplica completa a `captains_mode`; para `all_pick` solo cubre la fase de picks) + tiempo estándar
  + reserva por equipo.
- Loader (`draft-format-turns.ts`) valida al cargar — secuencia vacía/turno malformado degrada a
  "sin datos de turno", nunca tira el motor (mismo criterio que `loadHeroPositions`).
- `format: "unknown"` sigue sin tabla — sigue siendo un estado legítimo (`engine.md`).

### §2.2 — Máquina de estados de turno (TSK-072)

- `turn-clock.ts` (puro): dado `DraftState` + la tabla curada, deriva el turno actual (lado,
  acción esperada, tiempo base/reserva restante) a partir de
  `banned.length + picks.radiant.length + picks.dire.length` — nunca un índice guardado aparte
  que pueda desincronizarse.
- Nuevo `RejectionReason: "wrong_turn"` — rechaza un `hero_picked`/`hero_banned` fuera del turno
  esperado **solo cuando la tabla de turnos aplica** (Captain's Mode completo; All Pick, solo en
  la fase de picks — la fase de bans de All Pick nunca puede rechazar por `wrong_turn`, no tiene
  turnos que validar).
- `pick_reverted` exento, mismo criterio que ya tiene con `stale_seq`.
- Al agotarse tiempo base + reserva de un turno: el reductor **no elige un héroe aleatorio por su
  cuenta** — eso sería lógica de juego inventada, fuera del contrato ya establecido de
  `applyDraftEvent` (pura, sin reloj propio). En su lugar, expone `turn.expired: boolean`; quién
  resuelve la expiración (¿el capturador manda un evento sintético? ¿la UI ofrece un botón?) es una
  decisión de producto que **no está en el pedido original** — pendiente explícita (ver Gherkin
  §3.3, escenario acotado a "se agota el tiempo", sin resolver qué pasa después).

### §2.3 — Sincronización WebSocket (TSK-073)

- `DraftState.turn: DraftTurn | null` — `{ side, action, baseRemainingMs, reserveRemainingMs:
  { radiant, dire } }`, viaja dentro de `draft_state`/`snapshot` (nunca un mensaje nuevo — mismo
  criterio que ya se documentó para "caminos de draft": un tercer push automático solo se abre con
  decisión explícita, y el turno es parte directa del estado, no un cálculo exploratorio).
- Orden de push sin cambios: `draft_state` (con `turn` ya adentro) antes que `suggestions`.
- Espejo a mano en `apps/web/features/draft/types.ts`, mismo patrón que `SignalId`.

### §2.4 — Componente timer nativo (TSK-074)

- `DraftTimer.tsx` (ya existe, hoy solo alimentado por el guion del simulador) se extiende para
  aceptar un deadline derivado de `draftState.turn.baseRemainingMs` en vez de `waitMs` fijo — el
  simulador sigue funcionando sin cambios.
- `TurnIndicator` nuevo: lado activo + acción esperada + badge "Tú" (mismo patrón
  `LOCAL_SIDE_BADGE` ya usado en `DraftLayout`/`DraftBoard`).
- Reserva: indicador secundario compacto por equipo, no un segundo `DraftTimer` completo — el
  tiempo base es lo que de verdad apura, la reserva es contexto.
- `draftState.turn === null` → nada de esto se renderiza, la vista cae al layout de hoy sin
  turno — nunca un timer roto o en blanco.

## §3 — Criterios de aceptación (Gherkin)

```gherkin
Feature: InputModeSelector sobre HeroGrid

  Scenario: Alternar entre Pick Radiant, Ban y Pick Dire
    Given un draft activo con localSide identificado como "radiant"
    And el modo de entrada actual es "Pick Radiant"
    When el usuario hace clic en "Ban" en InputModeSelector
    Then useDraftStore().inputMode pasa a { action: "ban", side: "unknown" }
    And un clic en cualquier héroe de HeroGrid dispara hero_banned, no hero_picked
    When el usuario hace clic en "Pick Dire"
    Then useDraftStore().inputMode pasa a { action: "pick", side: "dire" }
    And un clic en un héroe disponible dispara hero_picked con side: "dire"

Feature: Rechazo por turno incorrecto (Captain's Mode)

  Scenario: Un pick llega fuera de turno
    Given un draft activo en formato "captains_mode" con la tabla de turnos de TSK-071 cargada
    And el turno actual (draftState.turn) es { side: "radiant", action: "ban" }
    When se envía hero_picked con side: "dire" para el héroe 14
    Then el motor rechaza el evento con rejected: "wrong_turn"
    And draftState no cambia (mismo estado que antes del evento)
    And draftState.turn sigue siendo { side: "radiant", action: "ban" }

  Scenario: pick_reverted nunca se rechaza por turno
    Given un draft activo en formato "captains_mode"
    And el héroe 14 fue pickeado por radiant en un turno ya pasado
    When se envía pick_reverted para el héroe 14, side: "radiant", en cualquier turno actual
    Then el evento se acepta -- wrong_turn nunca aplica a pick_reverted

  Scenario: La fase de bans de All Pick nunca rechaza por turno
    Given un draft activo en formato "all_pick", en fase de bans
    When se envía hero_banned para cualquier héroe, cualquier side
    Then el evento se acepta -- la tabla de turnos de TSK-071 no cubre bans de All Pick

Feature: Reloj de turno (tiempo base + reserva)

  Scenario: Se agota el tiempo base de un turno, con reserva disponible
    Given un turno con baseRemainingMs en 0 y reserveRemainingMs.radiant en 45000
    When el reloj avanza 1000ms más
    Then reserveRemainingMs.radiant baja a 44000
    And turn.expired sigue en false mientras haya reserva

  Scenario: Se agota el tiempo base y la reserva del equipo
    Given un turno con baseRemainingMs en 0 y reserveRemainingMs.radiant en 0
    When el reloj avanza
    Then turn.expired pasa a true
    # Qué evento resuelve la expiración queda fuera de este escenario -- ver §2.2, pendiente
    # explícito de decisión de producto.

Feature: Header nativo responsivo

  Scenario Outline: El header no recorta contenido en resoluciones estándar
    Given un draft activo con 5 picks por lado y 8 bans
    When la ventana mide <width>x<height>
    Then CompactBoard muestra las 5 casillas de Radiant, los bans y las 5 de Dire sin overflow horizontal
    And ningún ícono se corta ni se superpone con otro

    Examples:
      | width | height |
      | 1366  | 768    |
      | 1920  | 1080   |
      | 1280  | 800    |
```

## Fuentes (investigación real, no inventada)

- [A new approach to Captains Mode draft order in patch 7.34](https://esports.gg/news/dota-2/dota-2-patch-7-34-captains-mode-draft-order/)
- [How Does Captain's Mode Work in Dota 2? — KJC eSports](https://www.kjcesports.com/guide/how-does-captains-mode-work-in-dota-2/)
- [Banning in All Pick: A Higher Standard Of Ranked Play — DOTABUFF](https://www.dotabuff.com/blog/2016-05-02-banning-in-all-pick-a-higher-standard-of-ranked-play)
- [How Does Ranked All Pick Drafting Work In Dota 2? — Hotspawn](https://www.hotspawn.com/dota2/guide/how-does-ranked-all-pick-drafting-work-in-dota-2)
- [Game modes — Dota 2 Wiki (Fandom)](https://dota2.fandom.com/wiki/Game_modes)
