# AP Solo Mid recovery audit

**Fecha:** 2026-09-17  
**Alcance congelado:** Ranked All Pick · Solo · Radiant · Position 2/Mid · Intent NONE.  
**Veredicto:** **WRONG_PRODUCT_MODEL**. El flujo actual no modela a un humano que controla un solo pick Mid: el navegador controla los cinco picks Radiant, `playerPosition` desaparece antes de crear la sesión y V6 recibe una consulta de `teamOpening` sin posición.

Este documento es un audit; no se modificó código productivo. `docs/diagnostics/dota-expert-playtest.md` y `dota-expert-cases.json` se usan sólo como evidencia secundaria.

## Reproducción y estado del repositorio

Al inicio del audit:

```text
git status --short
?? docs/diagnostics/
?? scripts/hooks/__pycache__/

git branch --show-current
r1/product-certification

git rev-parse HEAD
d5d233c7d75cfd971cd5ca99139e573acc6c1799
```

Se preservaron esos cambios locales. La observación runtime se hizo in-process contra los módulos productivos y la SQLite real, sin imprimir account IDs ni secretos. La sesión reproducida fue AP, Solo, Radiant, bans por defecto, Position 2 seleccionada en UI, Intent NONE.

## 1. Qué controla realmente Solo

**Respuesta:** representa a un humano controlando **todos los picks de su lado**. `partySize=1` sí crea un `PartyContext` con un único `controlledSlot`, pero hoy ese dato sólo limita el número de acciones de `RecommendationDecision`; no restringe la autorización ni conduce a los otros cuatro aliados.

Trazabilidad:

1. `ConfigPanel` conserva `playerPosition` y `partySize` y los pasa a `onStart` (`apps/web/features/random-draft-simulator/components/ConfigPanel.tsx:276-290`, `:318-335`).
2. `useRandomDraftSession.startDraft` conserva la posición en el estado frontend, pero llama a `initDraft` sin posición y a `createSimulatorProtocolSession` sólo con patch, side y party size (`apps/web/features/random-draft-simulator/use-random-draft-session.ts:286-316`).
3. El cliente crea `controlledSlots=[{slotIndex: 0}]` para Solo; este índice es un **roster slot 0-based**, no Position 2 (`apps/web/features/random-draft-simulator/protocol-client.ts:102-148`; `apps/engine/src/draft-protocol/types.ts:40-45`).
4. El kernel publica las dos ranuras abiertas de cada ronda por lado (`apps/engine/src/draft-protocol/ranked-all-pick.ts:104-117`).
5. `ProtocolSession.authorizedLegalActions` filtra sólo por `side`, no por `controlledSlots` (`apps/engine/src/draft-protocol/protocol-session.ts:180-215`). Por eso ambas ranuras Radiant de una ronda son autorizadas incluso en Solo.
6. `deriveLegalDecision` sí recorta esa lista según el **conteo** de `controlledSlots`; para Solo escoge el menor índice de ranura de ronda (`apps/engine/src/recommendation/decision.ts:39-80`). Esto no mapea el roster slot a una posición ni impide enviar la otra acción.
7. `BlindRoundPanel` exige 2, 2 y 1 selecciones Radiant, y `confirmRound` envía todas (`apps/web/features/random-draft-simulator/components/BlindRoundPanel.tsx:84-120`; `apps/web/features/random-draft-simulator/use-random-draft-session.ts:264-284`).

Observación runtime después de bans:

```text
partySize=1
controlledSlots=[{slotIndex:0}]
authorizedLegalActions=[Radiant slotIndex:0, Radiant slotIndex:1]
RecommendationDecision.controlledSlots=[Radiant slotIndex:0]
```

Se enviaron Puck a la ranura 0 y Storm Spirit a la ranura 1: **ambos comandos fueron autorizados y aceptados**. El mismo patrón 2+2+1 se repite hasta que el owner completa los cinco picks Radiant.

- Slots realmente controlados por el navegador: **los cinco del equipo**, en tres rondas.
- Slot declarado como controlado: roster slot `0`; no equivale a Mid.
- Correspondencia con Position 2: **ninguna**.
- Generador de los otros cuatro aliados: **no implementado**.
- Conducta actual: el navegador espera que el owner elija esos cuatro héroes.

**Severidad: P0 — wrong product model.** Además contradice la invariante documentada en `participants.ts`: en Solo los otros cuatro aliados son participantes externos que la sesión no debería seleccionar (`apps/engine/src/draft-protocol/participants.ts:3-14`).

## 2. Trazabilidad de Position 2 end-to-end

| Salto | Estado de `playerPosition` | Evidencia |
|---|---|---|
| UI Position 2 → `ConfigPanel` | **PRESENT** | El selector escribe `playerPosition=2`. |
| `ConfigPanel` → config de `startDraft` | **PRESENT** | Se incluye en `onStart`. |
| `startDraft` → estado frontend | **PRESENT**, pero sólo local | `nextConfig` conserva el valor. |
| `startDraft` → `initDraft` | **LOST** | No se incluye en sus argumentos. |
| `startDraft` → `createSimulatorProtocolSession` | **LOST** | El body sólo contiene ruleset, patch, side, adapter y party context. |
| Body → session metadata | **LOST** | Metadata no tiene posición (`protocol-session.ts:38-44`). |
| Metadata → participante controlado | **IGNORED** | Sólo existe roster slot `0`; no hay rol/posición. |
| Metadata → `PerspectiveDraftView` | **LOST** | La perspectiva proyecta información visible, no posición. |
| Perspectiva → `RecommendationDecision` | **IGNORED** | Decide por acciones abiertas y cantidad controlada. |
| Decision → `RecommendationSet/v2` | **LOST** | El contrato no contiene target position. |
| V2 → `computeSuggestions`/V6 | **DEFAULTED/ABSENT** | `targetPosition` llega `undefined`; se fuerza `teamOpening=true`. |
| V6 → Top6 | **IGNORED** | Se evalúa el universo general de héroes. |
| V2 → Copilot | **LOST** | Copilot recibe hasta cinco recomendaciones generales. |

Punto exacto de desaparición: **en `startDraft`, al cruzar del config frontend al body de creación de sesión** (`use-random-draft-session.ts:299-301`). No existe después un default a Position 2.

## 3. Qué cree V6 que está recomendando

La llamada productiva real observada para la decisión humana fue equivalente a:

```ts
computeSuggestions(legacyState, null, {
  teamOpening: true,
  // targetPosition: undefined
  // diversitySeed: undefined
  // archetypeIntent: undefined
});
```

La ruta arma siempre la recomendación humana con `accountId=null` y `teamOpening=true` (`apps/engine/src/recommendation/build.ts:144-158`). Ni el endpoint de sesión ni `RecommendationSet/v2` transportan posición, seed o intent (`apps/engine/src/server/routes/protocol-sessions.ts:284-325`).

Por tanto V6 cree que el actor es un **capitán escogiendo el opener/general composition del equipo**, no Julio escogiendo Mid. Las llamadas adicionales observadas para one-ply modelaron al rival también con `teamOpening=true`; tampoco recibieron posición o seed.

## 4. Autopsia numérica de Crystal Maiden

Estado reproducido: tablero vacío, bans por defecto, datos reales locales, patch `7.41e`. V6 produjo:

```text
1. Crystal Maiden  114.32258
2. Clockwerk       108.32258
3. Pugna            99.09677
4. Dazzle           99.09677
5. Tusk             99.09677
6. Oracle           99.09677
```

`RecommendationSet/v2` recorta a cinco aunque V6 calcula seis (`apps/engine/src/recommendation/build.ts:62`, `:240-280`).

### Pesos realmente efectivos

Los pesos nominales V6 son: position `.342`, counter `.216`, patch `.117`, synergy `.117`, pool `.108`, archetype `.100` (`apps/engine/src/signals/weights.ts:114-120`). En esta apertura sólo votan position y counter, de modo que se renormalizan a:

```text
position_fit = 0.6129032258
counter      = 0.3870967742
```

`patch_meta`, aunque está cargado, se marca `dataReady=false`; synergy no aplica sin aliados; pool se omite expresamente en `teamOpening`; archetype es null/irrelevante para Intent NONE. El promedio imputado del estado fue position `66.8885547`, counter `63.9937107`.

### CM y cinco mids razonables

| Héroe | Final | position_fit raw / normalizado / N | counter raw / normalizado / N | Base V6 | Extra team-opener | patch raw / N (peso) | synergy · pool · archetype |
|---|---:|---|---|---:|---:|---|---|
| Crystal Maiden | **114.32258** | `1.000 / 100 / 3027` | `.060 / 75 / 0` | `90.32258` | **+24** | `.521684 / 277664 (0)` | `null · omitted · null` |
| Zeus | 83.48190 | `.895757 / 89.5757 / 3559` | `.020 / 58.333 / 0` | `77.48190` | +6 | `.502472 / 258337 (0)` | `null · omitted · null` |
| Puck | 55.41692 | `.500 / 50 / 3116` | `null → mean 63.9937 / 0` | `55.41692` | 0 | `.451343 / 50928 (0)` | `null · omitted · null` |
| Queen of Pain | 55.41692 | `.500 / 50 / 2471` | `null → mean 63.9937 / 0` | `55.41692` | 0 | `.474191 / 163858 (0)` | `null · omitted · null` |
| Storm Spirit | 55.41692 | `.500 / 50 / 2842` | `null → mean 63.9937 / 0` | `55.41692` | 0 | `.462780 / 102634 (0)` | `null · omitted · null` |
| Ember Spirit | 55.41692 | `.500 / 50 / 6703` | `null → mean 63.9937 / 0` | `55.41692` | 0 | `.483418 / 112710 (0)` | `null · omitted · null` |

No hubo degradations; confidence fue `high`. Los aportes base de CM fueron `61.2903` por position y `29.0323` por counter. Luego `team-opener` sumó 24 puntos por counters baneados: Juggernaut hard `.12`, Rubick medium `.06` y Pudge medium `.06`. Esa señal de alivio por bans ya influyó en `counter` y se vuelve a sumar como bonus de opener (`signals/counter.ts:186-235`; `signals/team-opener.ts:57-150`). El score final puede superar 100 porque el bonus se agrega después de normalizar.

La fórmula de position en board vacío mezcla capacidad de llenar roles y seguridad (`signals/position-fit.ts:16-18`, `:154`); por eso un support flexible obtiene `1.0`, mientras varios mids puros obtienen `.5`. No es una medición target-aware de Position 2.

Como contraprueba se ejecutó la ruta existente con `targetPosition=2` y sin `teamOpening`. CM salió del Top6, pero éste quedó en Skywrath Mage, Zeus, Phoenix, Snapfire, Keeper of the Light y Marci. El filtro sólo exige **alguna** presencia histórica en Position 2 y la fórmula sigue premiando flexibilidad/safety; por ejemplo Skywrath tenía sólo 8.03% de share Mid. Por eso propagar `targetPosition=2` es necesario pero no suficiente.

**Causa real:** sí, CM gana principalmente porque el motor cree que busca un opener de equipo. Además, esa política premia flexibilidad de support y duplica el alivio de counters baneados; no existe restricción target-aware de Mid.

## 5. Datos que llegan a este pick

| Fuente | EXISTS | LOADED | USED_IN_THIS_PICK | Freshness | Efecto observado |
|---|---|---|---|---|---|
| Patch identity | Sí (`7.41e`) | Sí | Sí | Fresh | Selecciona snapshots y forma parte del estado/sesión. |
| Hero catalog | Sí, 127 héroes | Sí | Sí | Updated `2026-09-17T05:11:18.625Z` | Universo, IDs y nombres. |
| `heroPositions` | Sí, 126 héroes/238 entradas | Sí | **Sí** | Source `7.41e`; Chen ausente | Es la señal dominante, pero no target-aware. |
| Patch stats | Sí, 127 héroes/1016 filas | Sí | Raw calculado, **peso 0** | Sync OK `2026-09-17T05:11:18.915Z` | Aparece en evidencia, pero `patch_meta` queda `dataReady=false`; no mueve score. |
| Matchups estadísticos | Tabla existe, 0 filas | Sí | No | Vacío | Ningún efecto. |
| Counters curados | Sí, 127 víctimas/528 edges | Sí | **Sí** | Sin patch/version embebido; frescura no demostrable | Señal activa y bonus de opener; influencia fuerte y duplicada para ciertos bans. |
| Capabilities | Sí, 124 héroes | Sí | Parcial | Sin patch/version embebido; frescura no demostrable | Estrategia/resumen/diversificación del opener; no determina por sí sola el primer score. |
| Steam account | Sí, 1 row local | No para V2 | No | N/A | La llamada usa `accountId=null`; el ID no fue expuesto. |
| Personal hero pool | Tabla existe, 0 filas | No efectivo | No | Vacío | Además el scorer se omite en `teamOpening`. |

La fuente real es `apps/engine/data/dota2coach.sqlite` más datasets curados del engine. La sincronización meta más reciente terminó OK con 1143 filas. Pro data queda fuera: no participa directamente en esta decisión.

## 6. Intent

**Recomendación: A — REMOVE/HIDE FROM SIMULATOR MVP.**

El selector existe y el estado de sesión lo conserva sólo en frontend; el propio hook documenta que no llega a RecommendationSet/v2 (`use-random-draft-session.ts:103-106`, `:150-152`). Para Intent NONE no tiene efecto; Push/Teamfight/Pickoff/Scaling tampoco afectan esta ruta. Mantenerlo visible promete control inexistente y agrega ruido al objetivo congelado.

## 7. Los otros nueve jugadores

| Participante | Clasificación actual | Conducta real |
|---|---|---|
| Julio | **HUMAN_CONTROLLED**, pero mal delimitado | El navegador envía su pick y los otros cuatro aliados; no hay mapeo Mid. |
| Aliados externos ×4 | **NOT_IMPLEMENTED** | Son “external” sólo estructuralmente. No existe driver: el owner los elige manualmente. |
| Enemigos ×5 | **SIMULATED_TEST_POLICY** | El servidor llama V6 sin posición, cuenta, intent ni seed, toma el primer candidato disponible y rellena la menor ranura abierta (`protocol-sessions.ts:195-274`). |

El bot enemigo no usa exactamente las mismas options que la recomendación humana: la humana fuerza `teamOpening=true`; el bot llama V6 con `{}`. Sin embargo, en el estado vacío ambas políticas dieron el mismo Top1, Crystal Maiden. El bot es determinista y Top1-first; esto explica la colisión 10/10 de la evidencia secundaria sin afirmar falsamente que ambas llamadas son idénticas.

Mínimo comportamiento plausible: nueve participantes explícitos, roles asignados, picks automáticos con posición válida, exclusión de héroes ya tomados y selección seedada dentro de un Top-K/quality band. No hace falta un bot perfecto, pero sí políticas distintas y reproducibles que eviten copiar siempre el Top1 humano.

## 8. Mapa funcional de R1/S1-S7 en Solo Mid

| Componente | Estado | Qué ocurre en este flujo |
|---|---|---|
| ProtocolKernel AP | **USED** | Mantiene fase, bans, rondas y legalidad base. |
| PerspectiveDraftView | **USED** | Proyecta correctamente la información visible por actor. |
| ProtocolSession | **USED_BUT_CONTEXT_MISSING** | Sesión real, pero autorización sólo por side y metadata sin posición/seed. |
| RecommendationSet/v2 | **USED_BUT_CONTEXT_MISSING** | Entrega decisión y recomendaciones; no transporta posición y recorta Top6 a 5. |
| V6 | **USED_BUT_CONTEXT_MISSING** | Motor real, consultado como team opener/general, no como Mid. |
| Role belief / joint assignment | **USED_BUT_CONTEXT_MISSING** | Produce role impact post-ranking; ningún caller aporta preferencia/posición confirmada de Julio, así que no restringe candidatos. |
| One-ply | **USED** | Se calcula para la recomendación Top1. |
| Steal | **USED** | Se calcula/deferencia dentro del análisis Top1, aunque su materialización visible depende del resultado. |
| Position/counter signals | **USED** | Son las únicas señales votantes en la apertura reproducida. |
| Patch signal | **USED_BUT_CONTEXT_MISSING** | Se carga y muestra raw, pero no vota por `dataReady=false`. |
| Synergy | **USED_BUT_CONTEXT_MISSING** | Inactiva en board vacío; puede activarse después de picks aliados. |
| Pool/archetype | **NOT_USED_BY_SIMULATOR** | Pool excluido en team opener; intent desconectado. |
| Party model | **USED_BUT_CONTEXT_MISSING** | Limita decision count, pero no autorización, UI ni conducción de aliados externos. Confunde roster slot con round slot. |
| CM work | **NOT_USED_BY_SIMULATOR** | Fuera de esta ruta AP. |
| E2E AP party sizes | **TEST_ONLY** | Los tests hacen 2+2+1 clicks aun en Solo y certifican completitud, no semántica Solo (`e2e/ap-party-sizes.spec.ts:9-57`). |
| E2E simulator/copilot | **TEST_ONLY** | Verifican finalización/contenido, no role validity, sensibilidad a Position 2 o repetición. |
| Bot-drafter web anterior | **LEGACY** | El runtime actual usa la ruta server de protocol sessions. |

R1 sí está presente técnicamente; lo perdido es el **contexto de producto y participante** que conecta esos componentes.

## 9. Arquitectura real actual

```text
[UI: AP / Solo / Radiant / Position 2 / NONE]
             |
             | playerPosition PRESENT en config
             v
[useRandomDraftSession]
             |
             X playerPosition LOST
             | body: patch + side + partySize=1
             v
[Protocol Session metadata]
  controlled roster slot=[0]  (NO es Pos2)
             |
             +--> [ProtocolKernel round slots 2+2+1]
             |           |
             |           +--> side-only authorization
             |                     |
             |                     v
             |            [Browser elige 5 Radiant]
             |                 WRONG MODEL
             |
             +--> [PerspectiveDraftView]  CONNECTED
                         |
                         v
                [RecommendationDecision]
                  1 round slot by count
                         |
                         v
                [RecommendationSet/v2]
                  no position, max 5
                         |
                         v
                [V6 teamOpening=true]
                  targetPosition=undefined
                         |
                         +--> positions + curated counters  USED
                         +--> patch stats                   LOADED / NONVOTING
                         +--> pool + intent                 DISCONNECTED
                         v
                 [Copilot: general Top5]

[4 allied external players] ----X----> NOT IMPLEMENTED
             (sus picks los hace el browser/owner)

[5 enemy players]
             |
             v
[Server AP bot: V6 {}, deterministic Top1, lowest slot]
                 TEST POLICY; no role/seed

[Legacy web bot drafter] --------X----> LEGACY / no participa
```

## 10. Minimum recovery

No hace falta reescribir V6 ni el kernel AP. El cambio mínimo creíble tiene tres piezas:

1. **Contrato y turno humano.** Llevar `targetPosition=2`, seed y una identidad/slot de participante explícita desde UI hasta session metadata y RecommendationSet. Definir un schedule que mapee roster participants a round slots y autorizar al navegador sólo cuando corresponda Julio. Para el MVP reducido puede fijarse Solo/Radiant/Mid y ubicar el pick humano tarde en el orden Radiant, de forma que existan picks visibles que den contexto; esto debe ser una política de producto explícita, no confundir Position 2 con `slotIndex=1`.
2. **Conducir a los nueve externos.** Extender la orquestación AP para completar tanto aliados como enemigos con roles válidos. Cada bot consulta V6 para su posición, excluye héroes tomados y elige de forma determinista por seed dentro de un Top-K/quality band; la política humana y la de bots no deben compartir siempre Top1. No se necesita modelado conductual avanzado.
3. **Hacer que la decisión sea realmente Mid y certificarla.** En la recomendación humana usar `targetPosition=2`, no `teamOpening`; endurecer admisión/score position-aware para que una presencia marginal en Mid no venza a mids reales; transportar los seis resultados; ocultar Intent. Reemplazar los E2E 2+2+1 del owner por tests de un solo pick humano, nueve picks automáticos, sensibilidad contextual y replay/variación por seed.

### Áreas mínimas que probablemente cambien

- Frontend simulator: `ConfigPanel`, `use-random-draft-session`, `protocol-client`, `BlindRoundPanel` y tipos/store asociados.
- Contratos/session AP: `draft-protocol/types`, `party-context`, `participants`, `protocol-session` y una costura de schedule/participant driver.
- Server/recommendation: `server/routes/protocol-sessions`, `recommendation/build`, contrato de RecommendationSet/v2.
- Targeting de posición: `signals/mix`/candidate admission y `position-fit`, acotado a Position 2.
- Tests: protocol session, recommendation, server route y E2E Solo Mid.

No se requiere cambiar schema de datos, Captain's Mode, coordinación Party, otras posiciones o todo V6.

## Batería futura de aceptación (20 escenarios)

Todos los escenarios son AP · Solo · Radiant · Position 2 · Intent NONE. En cada uno se captura estado/seed, Top6, evidencia de posición de cada candidato, señales, role validity y comparación contra el estado padre.

| # | Escenario |
|---:|---|
| 1 | Opening baseline |
| 2 | Mismo opening y misma seed (replay exacto) |
| 3 | Opening con ban irrelevante |
| 4 | Opening con bans de counters del Top1 Mid |
| 5 | Enemy lane Puck revelado |
| 6 | Enemy lane Huskar revelado |
| 7 | Enemy lane Viper revelado |
| 8 | Rival con alta movilidad (Storm + Puck) |
| 9 | Rival con illusion carry (Phantom Lancer) |
| 10 | Rival greedy (Anti-Mage + Doom) |
| 11 | Rival heavy physical |
| 12 | Rival heavy magic |
| 13 | Rival dive/catch |
| 14 | Rival sustain |
| 15 | Aliados necesitan catch |
| 16 | Aliados necesitan waveclear |
| 17 | Aliados magic-heavy necesitan daño físico |
| 18 | Aliados greedy necesitan tempo |
| 19 | Late pick: cuatro aliados + cuatro enemigos visibles |
| 20 | Batch del mismo fixture con 10 seeds |

Gates propuestos:

- **Legalidad:** cero héroes baneados/tomados; el humano sólo puede enviar una selección.
- **Role validity:** Top1 aceptable como Mid; cada Top6 debe tener Position 2 dominante o una cuota histórica material (umbral inicial sugerido: ≥25%, revisable por experto). CM y supports sin caso Mid real no pasan.
- **Context sensitivity:** en perturbaciones decisivas cambia Top1 o cambian al menos dos miembros/orden del Top6 con explicación de señales; un ban irrelevante conserva Jaccard@6 ≥ .67.
- **Determinismo:** mismo estado+seed produce Top6 y draft idénticos.
- **Variación:** en 10 seeds hay al menos tres contextos/Top1 distintos; un Top1 no ocupa >50% y el orden Top6 completo no se repite >30%.
- **Colisión:** pick humano y primer pick automático no colisionan; la tasa de intento de colisión natural debe quedar <20% en el batch.
- **Juicio experto:** un Dota expert revisa Top6, rol y reacción a contexto; estas métricas no sustituyen ese gate.

## Prioridad

### P0

1. Solo autoriza/obliga al owner a completar los cinco picks Radiant; los cuatro aliados externos no existen.
2. Position 2 se pierde al crear la sesión y V6 recibe `teamOpening=true` sin target position.
3. Aun conectando Position 2, la admisión/posición actual permite supports con uso Mid marginal por encima de mids reales.
4. El bot rival es seedless, roleless y deterministic Top1; reproduce la misma apertura y produce colisiones/repetición.

### P1

1. RecommendationSet/v2 trunca Top6 a cinco.
2. Intent visible está desconectado.
3. E2E certifica el modelo incorrecto 2+2+1 y no mide role validity/sensibilidad/repetición.
4. Patch stats frescos no votan; matchups está vacío; counters/capabilities curados no llevan versión de patch verificable.
5. Seed no llega a recomendación ni a la política bot.

## Reporte final solicitado

```text
AP SOLO MID AUDIT:
WRONG_PRODUCT_MODEL

CURRENT SOLO ACTUALLY CONTROLS:
ALL TEAM

POSITION 2 REACHES ENGINE:
NO

V6 TARGET POSITION:
undefined; la llamada humana usa teamOpening=true.

WHY CRYSTAL MAIDEN WINS:
El motor evalúa un team opener general: position_fit premia flexibilidad/safety de support,
counter aporta y el bonus de banned-counter relief se suma otra vez (+24). No existe targeting Mid.

CURRENT ALLIED 4 POLICY:
NOT_IMPLEMENTED; el browser/owner hace manualmente sus cuatro picks.

CURRENT ENEMY 5 POLICY:
SIMULATED_TEST_POLICY; V6 sin posición/seed, Top1 disponible, menor slot abierto.

CURRENT SIMULATOR MODEL MATCHES REAL SOLO AP:
NO

CURRENT R1 COMPONENTS ACTUALLY USED:
ProtocolKernel, PerspectiveDraftView, ProtocolSession, RecommendationSet/v2, V6,
role-impact parcial, one-ply, steal, position/counter signals.

R1 COMPONENTS NOT VISIBLE IN THIS FLOW:
CM work; personal pool; archetype intent; patch como señal votante; party/external-participant
semantics efectivas. E2E sólo certifica el modelo equivocado.

DATA ACTUALLY USED BY MID PICK:
patch identity, hero catalog, heroPositions y curated counters; capabilities parcialmente.
Patch stats sólo como raw/no voto; matchups/pool/account no afectan el score.

INTENT RECOMMENDATION:
REMOVE

TOP P0:
Modelo Solo incorrecto; Position 2 perdida/teamOpening forzado; targeting Mid insuficiente;
bots externos inexistentes o deterministic Top1.

TOP P1:
Top6 truncado a 5; intent muerto visible; E2E certifica 2+2+1; seed ausente;
frescura/participación de señales de datos incompleta.

MINIMUM FILES/AREAS LIKELY TO CHANGE:
Frontend simulator; contratos/metadata/authorization de ProtocolSession; participant schedule/driver;
server protocol routes; RecommendationSet/build; position admission/fit; tests unit/integration/E2E.

MINIMUM RECOVERY PLAN:
1. Transportar Position 2/seed/identidad y autorizar un solo turno humano.
2. Simular 4 aliados + 5 enemigos con roles y selección Top-K seedada.
3. Recomendar Mid con targeting estricto, Top6 completo, intent oculto y batería Solo-Mid.

EXPECTED RECOVERY SIZE:
>1 DAY

CAN WE GET A CREDIBLE SOLO-MID MVP WITHOUT REWRITING V6:
YES
```
