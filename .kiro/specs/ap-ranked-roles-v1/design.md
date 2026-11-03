# Design Document

## Overview

Ver **§1 Executive Summary** y **§6 Ranked All Pick State Machine** para el resumen del producto y la arquitectura de alto nivel.

D2KIRO AP Ranked Roles V1 extiende la infraestructura R1 existente (Protocol Kernel, V6 scoring engine, RecommendationSetV2) para soportar el modo Ranked Roles All Pick como producto completo. El diseño sigue el principio REUSE BEFORE REWRITE: el kernel, la perspectiva por lado y el scoring V6 no se tocan; las extensiones son aditivas. El cambio más crítico es reemplazar SOLO_MID_SIMULATOR_POLICY (hardcode Radiant/Mid/last-pick) con un modelo generalizado que soporta cualquier side, cualquier posición personal del Player, y los 5 slots aliados controlados manualmente.

## Architecture

El sistema se organiza en cuatro capas de estado con límites estrictos de visibilidad (detalle en **§5 Draft State / State Boundaries**):

- **Simulator Truth** (DraftProtocolState): estado autoritativo del kernel, incluye picks ocultos del Enemy Bot.
- **Player-Visible State** (PerspectiveDraftView): producida por project(state, side) — única función autorizada. Picks enemigos sellados aparecen como {visibility:"HIDDEN"} sin heroId.
- **Coach State** (CoachObservableState): derivado solo desde PerspectiveDraftView + inferencia legal. Nunca toca el estado autoritativo directamente.
- **Hidden Round State**: exclusivamente dentro del kernel; nunca expuesto antes del reveal.

La máquina de estados completa se describe en **§6**. Las decisiones de reutilización vs. reemplazo de componentes están en **§21 Existing Components Reuse Plan**.

## Components and Interfaces

Los componentes principales y sus interfaces se detallan a lo largo del diseño. Resumen:

| Componente | Sección | Disposición |
|---|---|---|
| Protocol Kernel (kernel.ts) | §9 Collision, §6 State Machine | REUSE AS-IS |
| perspective.ts / project() | §7 Hidden Information Architecture | REUSE AS-IS |
| BanResolutionPolicy | §8 Ban Resolution Policy | NUEVO |
| GeneralizedSimulatorPolicy / SimulatorSessionConfig | §11 Own Team Control | REPLACE (SOLO_MID_SIMULATOR_POLICY) |
| Enemy Bot | §12 Enemy Bot Architecture | REUSE + EXTEND |
| computeRoleBelief / RoleBelief | §13 Enemy Role Inference, §14 Flex | REUSE + EXTEND |
| uildRecommendationSetV2 | §16 Recommendation Architecture | REUSE + EXTEND |
| deriveRevealStrategy() | §16 Recommendation Architecture | NUEVO |
| RecommendationOutputV3 | §17 Recommendation Output Contract | NUEVO |
| Hero Pool scoping | §18 Hero Pool Integration | REUSE + EXTEND |
| detectSafeCoreWindow() | §19 Safe Core V1 | NUEVO |

Interfaces de dominio completas en **§4 Proposed Domain Model**.

## Data Models

Los modelos de datos clave se definen en **§4 Proposed Domain Model**. Los más importantes:

- **SimulatorSessionConfig**: configuración pre-draft del Player (side, playerPersonalPosition, seed, banPreferences, patch).
- **AllPickSimulatorState**: envuelve DraftProtocolState + config + timer state + gold penalty state + EnemyBotInternalState.
- **CoachObservableState**: estado observable del Coach derivado de PerspectiveDraftView + role beliefs + player assignments.
- **RevealStrategy**: role-neutral discriminated union del output del Coach (REVEAL_POSITION | REVEAL_HERO | DEFER_POSITION | REVEAL_FLEX | OPPORTUNITY). Support-first es una policy que produce REVEAL_POSITION, no una categoría propia. El Coach no finge certeza de héroe cuando la evidencia solo justifica rol.
- **RecommendationOutputV3**: contrato UX completo con primaryAction, shortlist: HeroCard[], opportunity?, personalHeroView?, meta.
- **HeroCard**: entrada de shortlist con heroId, position, confidence, adges: HeroBadge[], 
ationale.

Los tipos de protocolo (DraftProtocolState, RankedApState, PerspectiveDraftView, etc.) son contratos congelados de R1 documentados en pps/engine/src/draft-protocol/types.ts.

## 1. Executive Summary

D2KIRO AP Ranked Roles V1 es un diseño brownfield sobre la base R1 existente del proyecto. El objetivo es extender la infraestructura ya construida — el Protocol Kernel, el pipeline de recomendación V6, el sistema de sesiones — para soportar el modo **Ranked Roles All Pick** como producto completo con Simulator, Coach continuo y UX orientada a la decisión táctica del draft.

### Qué ya existe y funciona (REUSE AS-IS)

El núcleo del protocolo de draft (`draft-protocol/kernel.ts`) implementa correctamente la mecánica de Ranked All Pick: 2+2/2+2/1+1, picks sellados simultáneos, resolución por ronda con colisiones progresivas, proyección por perspectiva con barrera estructural de información oculta. Los timers de 25/25/20 segundos ya están correctos. El contador de colisiones es per-ronda (no per-hero). El engine de scoring V6 con sus 6 señales ponderadas (`SCORING_WEIGHTS_V6`) está operativo y no se toca. `RecommendationSetV2` con su pipeline de build ya es reutilizable. `RoleBelief` / `computeRoleBelief` soporta el modelo probabilístico de posición incluyendo Flex. Los datos curados (`hero-positions.json`, `hero-counters.json`, `patchStats`) están disponibles.

**Nota**: `resolveSimulatorCollisionAuthority` en `adapters/simulator-authority.ts` necesita un patch — actualmente usa un PRNG aleatorio para elegir al ganador de colisión #3, lo que contradice la regla de producto (first-registration-wins). Es **REUSE + PATCH**, no REUSE AS-IS. Ver §9 y §21.

### Qué necesita extensión

- **Ban Phase**: el kernel acepta `RECORD_RESOLVED_BANS + BAN_RESOLUTION_COMPLETE` pero falta la `BanResolutionPolicy` simulada y la UI de configuración de preferencias del Player.
- **Enemy Bot**: `chooseExternalSuggestion` y `deriveExternalDecisionSeed` existen pero están acoplados a `SOLO_MID_SIMULATOR_POLICY`. Necesitan desacoplarse del hardcode de posición/side.
- **Role Inference para Coach**: `computeRoleBelief` existe pero no está conectado al pipeline de Coach para héroes enemigos revelados.
- **Recommendation Level 1**: `RecommendationSetV2` genera ranking de candidatos pero no produce una "Primary Action" de nivel estratégico (`RevealStrategy`). Necesita una capa de orquestación.
- **Hero Pool scoping**: el `hero_pool` en DB existe, pero no está asociado a la posición personal declarada del Player. Necesita scoping por posición.
- **`decision-context.ts`**: usa `DraftState` del legacy reducer en lugar de `PerspectiveDraftView`. Necesita un puente.

### Qué debe reemplazarse

- **`SOLO_MID_SIMULATOR_POLICY`** (en `simulator/solo-mid-policy.ts`): hardcodea `humanSide: "radiant"`, `humanPosition: 2`, `humanRosterSlot: 4`. Viola PD-001, PD-019, PD-020 y Requirements 3, 19, 21. Debe reemplazarse con un `GeneralizedSimulatorPolicy` que soporte cualquier side, cualquier posición personal, y los 5 slots aliados controlados por el Player.
- **`isSoloMidSimulatorMetadata()`**: guard específico del recovery build, debe reemplazarse con `isApSimulatorMetadata()` más flexible.
- **`SOLO_MID_RECOMMENDATION_OUTPUT_LIMIT`** (en `recommendation/build.ts`): residuo del recovery build, reemplazar con constante general.

### Las partes más críticas

1. **Reemplazar `SOLO_MID_SIMULATOR_POLICY`**: tiene múltiples call sites (`protocol-sessions.ts`, `protocol-session.ts`, `decision.ts`). Es el cambio con mayor riesgo de regresión y la raíz de todas las violaciones de product decisions relacionadas con side/posición.
2. **Player Personal Position**: declarar la posición personal del Player antes del draft y conectarla al Hero Pool, a la vista "YOUR [POSITION] NOW", y al scoping del Coach.
3. **Actualizar `verifiedThroughPatch` a "7.41f"**: cambio de metadata puro pero impacta tests que verifican ese campo exacto.

---

## 2. Current State Audit

Para cada capacidad se indica su estado en el repositorio actual.

| # | Capacidad | Estado | Referencia en el código |
|---|-----------|--------|------------------------|
| 1 | Ranked All Pick 2+2/2+2/1+1 | **EXISTS AND REUSABLE** | `kernel.ts`: `ROUND_CAPACITY = {1:2, 2:2, 3:1}` |
| 2 | Hidden state / perspective | **EXISTS AND REUSABLE** | `perspective.ts`: `project(state, side)`, `PerspectiveHeroSlot` union discriminada |
| 3 | Picks simultáneos (sealed) | **EXISTS AND REUSABLE** | `RankedApRoundState.sealed[]`, `SUBMIT_SEALED_SELECTION` |
| 4 | Reveal al cierre de ronda | **EXISTS AND REUSABLE** | `resolveRound()` → `confirmedPicks` |
| 5 | Collision counter per-ronda | **EXISTS AND REUSABLE** | `RankedApRoundState.collisionsResolved`, resetea en `createRoundState()` |
| 6 | Timers 25/25/20s | **EXISTS AND REUSABLE** | `ROUND_TIMER_MS = {1:25000, 2:25000, 3:20000}` en `ranked-all-pick.ts` |
| 7 | Bans (pre-match preference system) | **EXISTS BUT NEEDS EXTENSION** | Kernel acepta `RECORD_RESOLVED_BANS + BAN_RESOLUTION_COMPLETE`. Falta `BanResolutionPolicy` simulada y UI de preferencias |
| 8 | Radiant/Dire | **EXISTS AND REUSABLE (kernel) / CONFLICTS WITH PRODUCT (solo-mid-policy)** | `TeamSide` en kernel correcto. `SOLO_MID_SIMULATOR_POLICY.humanSide: "radiant"` hardcodeado — viola PD-019 |
| 9 | Player personal position | **MISSING** | `humanPosition` existe en `ProtocolSessionMetadata` pero sin lógica de declaración pre-draft ni uso en Coach/Hero Pool para el modelo generalizado |
| 10 | Five allied manual selections | **EXISTS BUT CONFLICTS WITH PRODUCT** | `SOLO_MID_SIMULATOR_POLICY.humanRosterSlot: 4` convierte Mid en último pick del equipo — viola PD-001, PD-002, PD-020 |
| 11 | Enemy Bot | **EXISTS BUT NEEDS EXTENSION** | `chooseExternalSuggestion` existe, acoplado a `SOLO_MID_SIMULATOR_POLICY` |
| 12 | Deterministic seed | **EXISTS AND REUSABLE** | `deriveExternalDecisionSeed()`, `simulatorSeed` en `ProtocolSessionMetadata` |
| 13 | Enemy hidden role truth (interno) | **EXISTS AND REUSABLE** | State autoritativo en kernel nunca expuesto por `project()` |
| 14 | Coach enemy role inference | **EXISTS BUT NEEDS EXTENSION** | `computeRoleBelief()` en `role-belief.ts` existe; no conectado al pipeline de Coach para revelados |
| 15 | Own Flex | **EXISTS BUT NEEDS EXTENSION** | `computeRoleBelief()` modela Flex; falta UI + API para display "FLEX 3/4" y asignación del Player |
| 16 | Enemy Flex | **EXISTS BUT NEEDS EXTENSION** | Mismo mecanismo que enemy role inference; falta conectar al pipeline de Coach |
| 17 | Hero Pool | **EXISTS AND REUSABLE (DB) / NEEDS EXTENSION (scoping)** | `hero_pool` en DB desde Fase 1b. Falta asociación explícita a posición personal declarada del Player |
| 18 | YOUR POSITION NOW panel | **MISSING** | No existe vista separada de "TU MID AHORA" / "TU CARRY AHORA" |
| 19 | Recommendation recomputation | **EXISTS AND REUSABLE** | `buildRecommendationSetV2`, `ProtocolSessionStore.apply()` |
| 20 | Reveal-decision recommendation | **EXISTS BUT NEEDS EXTENSION** | `RecommendationSetV2` genera candidatos pero no un output de nivel estratégico `RevealStrategy` |
| 21 | Support-first prior | **EXISTS BUT NEEDS EXTENSION** | `decision-context.ts`: `team_opening` existe; el prior support-first no está implementado como lógica de recomendación |
| 22 | Safe Core | **MISSING** | No existe señal/detector de safe core window |
| 23 | Meta (patch stats) | **EXISTS AND REUSABLE** | `MetaSnapshot`, `patch_meta` signal de V6 |
| 24 | Counters | **EXISTS AND REUSABLE** | `hero-counters.json` + `createCounterScorer` post-Fase 8 |
| 25 | Synergy | **EXISTS AND REUSABLE** | `team_synergy` signal de V6 |
| 26 | Side context | **EXISTS AND REUSABLE (kernel) / NEEDS EXPLICIT TIEBREAKER** | `TeamSide` en state, `localSide` en metadata. Falta ser tiebreaker explícito en Coach cuando hay evidencia suficiente |
| 27 | Patch identity | **EXISTS AND REUSABLE / NEEDS METADATA UPDATE** | `basedOn.patch` en `RecommendationBasedOn`. `verifiedThroughPatch: "7.41e"` debe actualizar a "7.41f" |
| 28 | Availability rules (hidden-correct) | **EXISTS AND REUSABLE** | `isSealedSelectionLegal`: no excluye sealed del lado opuesto — correcto por diseño de hidden picks |
| 29 | UX recommendation contract | **EXISTS BUT NEEDS EXTENSION** | `RecommendationSetV2` tiene candidatos pero falta `primaryAction` como top-level output |
| 30 | Tests / certificación existente | **EXISTS AND REUSABLE** | `kernel.test.ts`, `protocol-session.test.ts`, recommendation tests. Falta E2E de navegador real del flujo completo |

---

## 3. Product-to-System Mapping

| Requirement | Componente existente | Estado | Gap |
|---|---|---|---|
| Req 1 — Draft 2+2/2+2/1+1 | `kernel.ts`: `ROUND_CAPACITY`, `createRoundState()` | ✅ Completo | Ninguno |
| Req 1 — Picks simultáneos/sealed | `SUBMIT_SEALED_SELECTION`, `RankedApRoundState.sealed[]` | ✅ Completo | Ninguno |
| Req 1 — Reveal al cierre | `resolveRound()` → `confirmedPicks` | ✅ Completo | Ninguno |
| Req 1 — Colisiones progresivas (3 eventos) | `resolveRound()`, `collisionsResolved`, `WAITING_FOR_COLLISION_AUTHORITY` | ✅ Completo | Ninguno |
| Req 2 — Ban preferences Player (hasta 4) | `RECORD_RESOLVED_BANS` en kernel | ⚠️ Parcial | Falta `BanResolutionPolicy` simulada, UI de configuración de prefs, generación determinística de prefs para los 9 simulados |
| Req 3 — Selección de side antes del draft | `localSide` en `ProtocolSessionMetadata`, `CreateProtocolSessionInput.localSide` | ⚠️ Parcial | `SOLO_MID_SIMULATOR_POLICY` hardcodea "radiant" — debe removerse. Falta UI de selección de side |
| Req 4 — Own Team roles conocidos / enemy hidden | `PartyContext.controlledSlots`, `RoleBelief` | ⚠️ Parcial | `computeRoleBelief` no conectado al pipeline de Coach. Roles propios no declarados explícitamente para los 5 slots |
| Req 5 — Player controla 5 selections | Kernel acepta `SUBMIT_SEALED_SELECTION` sin restricción de slot | ⚠️ Parcial | `SOLO_MID_SIMULATOR_POLICY.humanRosterSlot:4` restringe a 1 slot de control manual. Necesita `partySize:5, controlledSlots:[0..4]` generalizado |
| Req 6 — Enemy Bot coherente | `chooseExternalSuggestion()`, `deriveExternalDecisionSeed()` | ⚠️ Parcial | Acoplado a `SOLO_MID_SIMULATOR_POLICY`. Necesita `EnemyBotConfig` generalizado con validación de composición (no 5 cores) |
| Req 7 — Timers 25/25/20s con gold penalty | `ROUND_TIMER_MS = {1:25000, 2:25000, 3:20000}` en kernel identity | ⚠️ Parcial | Timers son metadata del kernel pero la lógica de countdown/penalización de oro es responsabilidad del Simulator (no del kernel). Necesita `TimerState + GoldPenaltyState` en `AllPickSimulatorState` |
| Req 8 — Coach recalcula continuamente | `buildRecommendationSetV2`, `ProtocolSessionStore.apply()` | ⚠️ Parcial | Falta orquestación que dispare recompute después de cada `confirmedPick` y `roundReveal` |
| Req 9 — "Reveal decision" como output primario | `RecommendationSetV2` con candidatos | ❌ Falta | No existe `RevealStrategy` ni `primaryAction` como output de nivel estratégico. Necesita nueva capa `deriveRevealStrategy()` |
| Req 10 — Support-first prior | `decision-context.ts`: `team_opening` contexto | ⚠️ Parcial | El prior no está implementado en lógica de recomendación. Solo existe el contexto. Necesita integración en `deriveRevealStrategy()` |
| Req 11 — Hero Pool personal | `hero_pool` en DB, `hero_pool_fit` signal V6 | ⚠️ Parcial | Pool no está scoped a `playerPersonalPosition`. Falta sección "Best outside your pool". Falta "YOUR [POSITION] NOW" panel |
| Req 12 — Hidden enemy isolation | `perspective.ts`: `project()`, `PerspectiveHeroSlot` discriminated union | ✅ Completo | Barrera estructural en tipos. Solo verificar que pipeline de Coach recibe `PerspectiveDraftView`, no `DraftProtocolState` |
| Req 13 — Flex handling | `computeRoleBelief()` con `entropy`, `probabilities` | ⚠️ Parcial | No conectado al pipeline de Coach. Falta display "FLEX 3/4". Falta UI para asignación por Player |
| Req 14 — Win condition inference (advisory) | `team_synergy`, `position_fit` signals en V6 | ⚠️ Parcial | Señales existen. No existe una función de "directional inference" explícita. Deferred: deep win condition modeling |
| Req 15 — UX: primary action + shortlist + badges | `RecommendationSetV2` con `evidence`, `signals` | ⚠️ Parcial | Falta `RecommendationOutputV3` con `primaryAction`, `shortlist` con badges, `opportunity` block, `personalHeroView` |
| Req 16 — Safe Core | `counter` signal, `hero-counters.json`, `patch_meta` | ⚠️ Parcial | Señales existen. No existe `SafeCoreDetector`. Necesita función que combine señales y emita flag `safeCoreWindow` |
| Req 17 — Meta/Counters/Synergy como inputs | V6 signals: `patch_meta`, `counter`, `team_synergy` | ✅ Completo | SCORING_WEIGHTS_V6 activo. No tocar. |
| Req 18 — Draft state visibility | `PerspectiveDraftView`, `project()` | ⚠️ Parcial | Vista existe. Falta UI que muestre Flex como "FLEX 3/4", hidden slots como vacíos, gold penalty |
| Req 19 — Position ≠ pick timing | Kernel no restringe slot-picking por posición | ✅ Completo | `SOLO_MID_SIMULATOR_POLICY.rosterPositions` asigna posiciones en orden fijo — remover ese constraint |
| Req 20 — Hero availability enforcement | `isSealedSelectionLegal()`, `heroAlreadyTaken()` | ✅ Completo | Semántica correcta: hidden enemy no bloquea disponibilidad del Player |
| Req 21 — Player personal position declaration | `humanPosition` en `ProtocolSessionMetadata` | ⚠️ Parcial | Campo existe pero sin lógica de declaración pre-draft generalizada ni uso en Coach/Hero Pool |

---

## 4. Proposed Domain Model

Esta sección describe los contratos clave del dominio en TypeScript conceptual (no código de producción final).

### SimulatorSessionConfig

Contiene toda la configuración declarada por el Player antes de que comience el draft.

```typescript
interface SimulatorSessionConfig {
  // Lado del Player: seleccionado explícitamente antes del draft (PD-006)
  side: TeamSide;                          // "radiant" | "dire"
  
  // Posición personal del Player (Req 21, PD-012, PD-020)
  // Required for AP Ranked Roles V1 — session cannot start without it.
  // ProtocolSessionMetadata.humanPosition retains | null for legacy compatibility.
  playerPersonalPosition: 1 | 2 | 3 | 4 | 5;
  
  // Own Team known role assignments in Ranked Roles (Req 4, PD-012)
  // Exactly one of each: Pos1, Pos2, Pos3, Pos4, Pos5 — known from matchmaking.
  // This is role identity, NOT pick chronology. A Pos2 (Mid) may pick in Round 1.
  // The Player's personal slot is identified by playerPersonalPosition.
  // The other four positions are controlled by the human party or by the Ally Bot (PD-026).
  ownTeamRoleAssignments: Record<1 | 2 | 3 | 4 | 5, "assigned">;
  // Note (PD-026, supersedes the former "all 5 controlled by the Player"): control is by POSITION,
  // see partySize / controlledPositions below. Party 5 = all five positions human-controlled.
  // Role assignments are known truth (Ranked Roles gives them); pick slots are NOT.

  // Party size: 1 | 2 | 3 | 5. Party 4 is unsupported (PD-026).
  partySize: 1 | 2 | 3 | 5;

  // AP CONTROL SOURCE OF TRUTH (PD-026). Distinct positions controlled by humans; length ===
  // partySize; includes playerPersonalPosition. Fixed at session creation and immutable.
  // The Ally Bot controls the complement. This is NOT derived from chronology or from
  // PartyContext.controlledSlots (which is structural and inert for AP, see §5 and §11).
  controlledPositions: (1 | 2 | 3 | 4 | 5)[];
  
  // Seed para reproducibilidad determinística del Enemy Bot y bans simulados (Req 6.4)
  simulatorSeed: string;
  
  // Preferencias de ban del Player: hasta 4 heroIds (puede haber slots vacíos = null)
  // Índice 0 = preferencia más fuerte (PD-021)
  playerBanPreferences: (HeroId | null)[];  // length <= 4
  
  // Patch activo (PD-025)
  patch: string;                            // "7.41f" para V1
}
```

### AllPickSimulatorState

Estado completo del Simulator, con separación estricta de capas.

```typescript
interface AllPickSimulatorState {
  // Capa A: estado autoritativo del protocolo (TODA la info, incluyendo picks enemigos sellados)
  protocolState: DraftProtocolState;
  
  // Configuración declarada en pre-draft
  config: SimulatorSessionConfig;
  
  // Estado de timers por ronda (separado del kernel — el kernel no gestiona tiempo)
  timerState: RoundTimerState | null;
  
  // Penalización de oro por jugador (solo Own Team, índices 0-4 correspondientes a los 5 slots)
  goldPenaltyBySlot: number[];             // length = 5, valor en unidades de oro
  
  // Estado interno del Enemy Bot (NUNCA expuesto al pipeline del Coach)
  enemyBotState: EnemyBotInternalState;
  
  // Resultado de ban resolution (seteado al completar BAN_CONFIGURATION → BAN_RESOLUTION)
  resolvedBans: HeroId[];
}

interface RoundTimerState {
  round: 1 | 2 | 3;
  startedAt: number;          // timestamp ms
  durationMs: number;         // 25000 | 25000 | 20000
  penaltyStartedAt: number | null;
}
```

### CoachObservableState

El estado que el Coach puede ver. Derivado SOLO desde `PerspectiveDraftView` + inferencia legal. Nunca contiene picks enemigos ocultos ni la role queue real del enemy team.

```typescript
interface CoachObservableState {
  // Proyección del estado desde la perspectiva del Player (Req 12)
  // Producida por: project(protocolState, config.side)
  view: PerspectiveDraftView;
  
  // Beliefs de posición para cada héroe revelado del equipo enemigo
  // Derivados SOLO desde heroId + heroPositions + draft evidence (Req 4, Req 13)
  enemyRoleBeliefs: Map<HeroId, RoleBelief>;
  
  // Beliefs de posición para héroes propios confirmados
  ownRoleBeliefs: Map<HeroId, RoleBelief>;
  
  // Asignaciones explícitas del Player (Override sobre RoleBelief inference)
  playerPositionAssignments: Map<HeroId, 1 | 2 | 3 | 4 | 5>;
  
  // Posición personal del Player y su Hero Pool (si fue declarada)
  personalContext: PlayerPersonalContext | null;
  
  // Banes confirmados (visible para ambos lados — no hidden)
  confirmedBans: HeroId[];
}

interface PlayerPersonalContext {
  position: 1 | 2 | 3 | 4 | 5;
  heroPool: HeroId[];           // Héroes del pool para esa posición
}
```

### RevealStrategy

Output de nivel estratégico del Coach — responde "¿qué es lo mejor revelar ahora?".

```typescript
type RevealStrategy =
  // Recommend revealing a specific position (any of Pos1–5)
  // Support-first prior produces REVEAL_POSITION(position=5) or (position=4), not a special category
  | { kind: "REVEAL_POSITION"; position: 1 | 2 | 3 | 4 | 5; rationale: string }
  // Recommend a specific hero — only when evidence justifies hero-level specificity
  | { kind: "REVEAL_HERO"; heroId: HeroId; position: 1 | 2 | 3 | 4 | 5; rationale: string }
  // Recommend deferring a specific position (keep it unrevealed for strategic ambiguity)
  | { kind: "DEFER_POSITION"; position: 1 | 2 | 3 | 4 | 5; rationale: string }
  // Flex pick — position not yet resolved, both options shown
  | { kind: "REVEAL_FLEX"; possiblePositions: (1 | 2 | 3 | 4 | 5)[]; rationale: string }
  // Exceptional opportunity (with optional subtype)
  | { kind: "OPPORTUNITY"; subtype: "SAFE_CORE" | "COUNTER" | "STEAL"; heroId?: HeroId; rationale: string };
// Note: support-first prior is a POLICY that produces REVEAL_POSITION(position=5).
// It is not a fundamental strategy category. "Convenient" fallback to hero-level
// is removed — if only role-level evidence exists, REVEAL_POSITION is the honest output.
```

### RecommendationOutputV3

Contrato UX nuevo. Construido encima de `RecommendationSetV2` — no lo reemplaza.

```typescript
interface RecommendationOutputV3 {
  // Acción primaria recomendada (Req 9, Req 15, PD-015, PD-016)
  primaryAction: {
    strategy: RevealStrategy;
    label: string;             // "Abre con Pos5" / "Asegura este carry ahora"
  };
  
  // Shortlist de héroes con contexto táctico (3–5 héroes — exacto a determinar en QA)
  shortlist: HeroCard[];
  
  // Bloque de oportunidad contextual (Req 15, Req 16, PD-017)
  // Solo presente cuando hay evidencia real
  opportunity?: {
    label: string;             // "Ventana de carry — contadores clave baneados"
    heroId?: HeroId;
  };
  
  // Vista personal del Player ("TU MID AHORA") (Req 11.7, Req 21)
  // Solo presente cuando playerPersonalPosition está declarada
  personalHeroView?: {
    positionLabel: string;     // "TU MID AHORA" / "TU CARRY AHORA"
    heroes: { heroId: HeroId; rank: number }[];
  };
  
  // Metadatos para stale-detection y display contextual
  meta: {
    round: 1 | 2 | 3 | null;
    phase: RankedApPhase;
    confidence: "alta" | "media" | "baja";
    basedOn: RecommendationBasedOn;  // Trazabilidad completa (ya existe en RecommendationSetV2)
  };
}
```

### HeroCard

Cada entrada de la shortlist.

```typescript
type HeroBadge =
  | "SAFE"            // Pick seguro en el estado actual del draft
  | "FLEX"            // Puede jugar múltiples posiciones
  | "CATCH"           // Héroe de initiation/catch
  | "TEAMFIGHT"       // Fortaleza en teamfight
  | "COUNTERS_BANNED" // Contadores clave ya baneados
  | "GOOD_WITH_X"     // Sinergia con héroe X ya picked
  | "STRONG_META"     // Alto win rate en el patch
  | "YOUR_POOL"       // Está en el Hero Pool personal del Player
  | "OUTSIDE_YOUR_POOL" // Fuera del pool pero contextualmente relevante
  | "LANE_STRONG"     // Domina su lane en el patch actual
  | "GOOD_ON_SIDE";   // Ventaja conocida en Radiant/Dire (solo cuando hay evidencia)

interface HeroCard {
  heroId: HeroId;
  position: 1 | 2 | 3 | 4 | 5;   // Posición primaria inferida
  confidence: "alta" | "media" | "baja";
  badges: HeroBadge[];
  rationale: string;               // Frase breve derivada de evidencia real
  score: number;                   // Score V6 (para ranking interno, puede no mostrarse)
  isFromPool: boolean;
}
```

---

## 5. Draft State / State Boundaries

El diseño define cuatro capas de estado con límites estrictos de visibilidad. Las violaciones de estos límites son bugs de correctness, no de rendimiento.

### Capa A — SIMULATOR TRUTH (DraftProtocolState)

**Quién la posee**: el kernel (`kernel.ts`). Contiene toda la información del draft incluyendo los picks sellados del Enemy Bot que aún no han sido revelados.

**Acceso**: solo el Simulator y el kernel. Nunca el pipeline del Coach directamente.

**Contenido relevante**:
- `rankedAp.round.sealed[]` — picks de ambos lados en la ronda actual (incluyendo los enemigos ocultos)
- `rankedAp.confirmedPicks[]` — picks ya revelados de rondas pasadas
- `rankedAp.bannedHeroes[]` — héroes baneados

**El kernel de protocolo es agnóstico a posiciones (PD-027).** Conoce lado, ronda, `roundSlot`
(`slotIndex` de `OpenSlot` / `SealedSelection` / `ConfirmedPick`, con su significado round-scoped:
0 o 1 en rondas 1–2, 0 en ronda 3), héroe, colisiones y reveals — y nada de posiciones ni
controladores. `PartyContext` es "foundation only, no protocol-rule effect" (`draft-protocol/types.ts`,
`party-context.ts`): el kernel lo valida y lo guarda pero no lo usa para legalidad. Para una sesión AP
Simulator se crea como `{ partySize, side, controlledSlots: [] }`: estructuralmente válido y
semánticamente inerte. **`ControlledSlot.slotIndex` nunca se lee ni se escribe como verdad de posición
o de control en código AP.** Captains Mode y las sesiones manuales (Live) conservan su `partyContext`
actual sin cambios.

### Capa B — PLAYER-VISIBLE STATE (PerspectiveDraftView)

**Quién la produce**: `project(protocolState, config.side)` en `perspective.ts`. Es la única función autorizada para convertir Capa A en Capa B.

**Invariante crítico**: los picks sellados del lado enemigo aparecen como `{ visibility: "HIDDEN" }` — la union discriminada de `PerspectiveHeroSlot` garantiza estructuralmente que no hay campo `heroId` en ese caso.

**Qué incluye**:
- `ownPicks`: `{ visibility: "KNOWN", heroId }` para picks propios confirmados o sellados en la ronda actual
- `enemyPicks`: `{ visibility: "REVEALED", heroId }` para picks enemigos de rondas pasadas; `{ visibility: "HIDDEN" }` para picks enemigos sellados en la ronda actual
- `bannedHeroes[]` — siempre visibles para ambos lados
- `status`, `phase`, `round` — info de progreso del draft

### Capa C — COACH STATE (CoachObservableState)

**Quién la posee**: el pipeline de recomendación. Derivado SOLO desde `PerspectiveDraftView` + evidencia legal (heroPositions, patchStats, heroPool).

**Invariante crítico**: el Coach nunca toca `DraftProtocolState` directamente. El pipeline de `buildRecommendationSetV2` recibe `PerspectiveDraftView`, no el state autoritativo.

**Contenido derivado**:
- `enemyRoleBeliefs`: para cada `REVEALED` pick enemigo, se calcula `computeRoleBelief({heroId, heroPositions, occupiedPositions: enemyConfirmedPositions})` — sin consultar el state autoritativo
- `ownRoleBeliefs`: para cada pick propio conocido
- `playerPositionAssignments`: overrides explícitos del Player
- `confirmedBans`: idéntico a `PerspectiveDraftView.bannedHeroes`

### Capa D — HIDDEN ROUND STATE

**Quién la posee**: exclusivamente el kernel, dentro de `RankedApRoundState.sealed[]`, filtrado a entradas del lado enemigo por `project()`.

**Invariante**: nunca sale de Capa A como información legible. El tipo `{ visibility: "HIDDEN" }` en Capa B no tiene `heroId`. El pipeline de Coach en Capa C nunca puede leer un heroId de un slot "HIDDEN".

### Disponibilidad de héroes: perspectiva vs. interna

- **Desde el Player**: un héroe está disponible si no está en `confirmedBans` y no está en `confirmedPicks` de rondas anteriores. Un pick enemigo sellado en la ronda actual (oculto) NO hace que ese héroe sea indisponible para el Player. La función `isSealedSelectionLegal` ya implementa esta semántica correctamente.
- **Desde el Enemy Bot**: simétricamente, los picks sellados propios no hacen indisponible un héroe para el Enemy Bot hasta la resolución de la ronda.

### Timer State (separado del kernel)

```typescript
interface RoundTimerState {
  round: 1 | 2 | 3;
  startedAt: number;         // ms desde epoch
  durationMs: number;        // 25000 | 25000 | 20000
  penaltyStartedAt: number | null;  // null = penalización no activa
}
```

El kernel no gestiona tiempo. El Simulator es responsable del countdown, del inicio de la penalización y de la lógica de "si expira el timer sin confirmar, el sistema continúa con penalización activa" (Req 7.2). El kernel solo recibe el comando de selección cuando el Player confirma — nunca por timeout.

### Gold Penalty State (por slot)

```typescript
interface GoldPenaltyState {
  bySlot: number[];        // length = 5, índice = pickOrdinal propio (cronología 0..4); nunca una posición ni un controlador (PD-027)
  penaltyRatePerSecond: number;  // 2 oro/s (Req 7.2)
}
```

Separado del kernel. Actualizado por el Simulator cuando `penaltyStartedAt` no es null. Solo aplica a slots de Own Team con selección pendiente.

### Own Pick Position Binding (capa de sesión del Simulator)

```typescript
// Vive en la entrada del ProtocolSessionStore, fuera del kernel (mismo precedente que Timer y Gold Penalty).
interface OwnPickPositionBinding {
  round: 1 | 2 | 3;
  slotIndex: number;          // = roundSlot: el slotIndex round-scoped del kernel, sin cambio de significado
  assignedPosition: 1 | 2 | 3 | 4 | 5;
}
// ownPickPositions: OwnPickPositionBinding[]   (sólo lado local)
```

- Se registra cuando el Simulator acepta una selección sellada propia: el kernel aplica
  `SUBMIT_SEALED_SELECTION(side, slotIndex, heroId)` (sin cambios) y la sesión registra a qué
  `assignedPosition` corresponde.
- Es verdad conocida del Own Team para el Player y el Coach (PD-027 punto 3); nunca se re-infiere.
- **Se elimina** cuando una colisión reabre ese `(round, roundSlot)`.
- El snapshot puede exponerlo después como `ownAssignedPositions`, **sólo al lado propio**.
- `assignedPosition` viaja fuera del comando del kernel (ver §11 "Pick de cualquier slot").

### EnemyBotInternalState

```typescript
interface EnemyBotInternalState {
  // Asignación interna de posiciones (pos 1-5) a los 5 roster slots del Enemy Team
  positionsByRosterSlot: Record<number, 1 | 2 | 3 | 4 | 5>;
  
  // Picks ya decididos internamente pero aún no revelados (picks sellados en ronda actual)
  pendingSelections: { rosterSlot: number; heroId: HeroId }[];
  
  // Historial de decisiones (para trazabilidad determinística)
  decisionHistory: ExternalPickRecord[];
}
```

Este objeto nunca pasa al pipeline del Coach. El único canal entre `EnemyBotInternalState` y el Coach es `project(protocolState, playerSide)` — que oculta estructuralmente lo que no está revelado.

---

## 6. Ranked All Pick State Machine

La máquina de estados completa del Simulator extiende la que ya implementa el kernel con dos nuevas fases pre-draft.

```
PRE_DRAFT
  ↓ (Player selecciona side + posición personal)
BAN_CONFIGURATION
  ↓ (Player configura ban preferences; BanResolutionPolicy genera bans simulados)
BAN_RESOLUTION [kernel: BAN_RESOLUTION phase]
  → RECORD_RESOLVED_BANS (varios) → BAN_RESOLUTION_COMPLETE
  ↓
PICK_ROUND_1 [kernel: PICK_ROUND_1 phase]
  → SUBMIT_SEALED_SELECTION × (2 Radiant + 2 Dire)
  → resolveRound → [collision? → WAITING_FOR_COLLISION_AUTHORITY → back] → confirmedPicks
  ↓
PICK_ROUND_2 [kernel: PICK_ROUND_2 phase]
  → mismo flujo
  ↓
PICK_ROUND_3 [kernel: PICK_ROUND_3 phase]
  → SUBMIT_SEALED_SELECTION × (1 Radiant + 1 Dire)
  → resolveRound
  ↓
COMPLETE [kernel: COMPLETE]
```

### PRE_DRAFT

- **Inputs aceptados**: selección de side (Radiant/Dire), declaración de `playerPersonalPosition` (opcional), carga de simulatorSeed
- **Transición**: cuando el Player confirma side → avanza a `BAN_CONFIGURATION`
- **Invariante**: no se puede avanzar sin side seleccionado (Req 3.5)
- **Output al Coach**: ninguno aún — el draft no ha comenzado

### BAN_CONFIGURATION

- **Inputs aceptados**: Player configura hasta 4 ban preferences (slots pueden estar vacíos)
- **Proceso interno**: `BanResolutionPolicy.resolve(preferences, seed)` genera los banned heroes
  - Preferencias de los 9 jugadores simulados: generadas determinísticamente desde `simulatorSeed`
  - Resultado: variable-length `HeroId[]` con garantías observables (unique bans priorizados; 4 prefs llenas = ≥1 ban)
- **Transición**: cuando el Player confirma → el Simulator envía `RECORD_RESOLVED_BANS(resolvedBans) + BAN_RESOLUTION_COMPLETE` al kernel
- **Output al Coach**: el set final de banes (Req 2.5)

### BAN_RESOLUTION (kernel phase)

- El kernel acepta `RECORD_RESOLVED_BANS` con la lista de heroIds baneados
- Luego `BAN_RESOLUTION_COMPLETE` avanza a `PICK_ROUND_1`
- El kernel valida: no duplicados, IDs válidos

### PICK_ROUND_1 / PICK_ROUND_2 / PICK_ROUND_3

Para cada ronda:

| Evento | Emisor | Qué hace el kernel | Output al Coach |
|---|---|---|---|
| Timer comienza | Simulator | — | — |
| `SUBMIT_SEALED_SELECTION` (Own Team slot) | Player | Sella el pick en `round.sealed` | `PerspectiveDraftView` actualizado: pick propio aparece como KNOWN |
| `SUBMIT_SEALED_SELECTION` (Enemy Bot slot) | EnemyBot | Sella el pick en `round.sealed` | Sin cambio visible (pick enemigo queda HIDDEN) |
| Todos los slots sellados | kernel | Ejecuta `resolveRound()` | `confirmedPicks` con todos los reveals simultáneos |
| Collision 1-2 detectada en resolveRound | kernel | Ban + reopen slots | Coach recibe updated state con héroes baneados + slots abiertos de nuevo |
| Collision 3 detectada | kernel | `WAITING_FOR_COLLISION_AUTHORITY` | Simulator actúa como authority: envía `APPLY_AUTHORITATIVE_COLLISION_RESOLUTION` |
| Round completada | kernel | Phase avanza (PICK_ROUND_2, etc.) | Coach recibe nuevo estado con todos los picks revelados |

### COMPLETE

- Todos los picks confirmados
- El kernel marca `status: "COMPLETE"`
- El Coach puede mostrar la composición final y análisis retrospectivo

### Timer expirado (sin selección confirmada)

- El Simulator inicia `goldPenaltyState[slot]` incrementando 2 oro/s
- El Player sigue pudiendo seleccionar y confirmar héroes
- El Simulator puede implementar "auto-confirm con héroe aleatorio" si decide implementar ese comportamiento (deferred — no es V1 MVP)

---

## 7. Hidden Information Architecture

La barrera de información oculta es un invariante de correctness del producto (PD-009, Req 12). Su garantía es estructural, no disciplinaria.

### La única función de proyección autorizada

```
project(state: DraftProtocolState, viewerSide: TeamSide | null): PerspectiveDraftView
```

Esta función, en `perspective.ts`, es el único punto donde `DraftProtocolState` se convierte en algo que el Coach puede ver. Toda otra ruta directa desde el state autoritativo hacia el pipeline de Coach es un bug.

### La barrera estructural en tipos

`PerspectiveHeroSlot` es una union discriminada:

```typescript
type PerspectiveHeroSlot =
  | { visibility: "KNOWN"; heroId: HeroId }      // Pick propio (conocido con certeza)
  | { visibility: "REVEALED"; heroId: HeroId }    // Pick enemigo revelado (ronda pasada)
  | { visibility: "HIDDEN" };                     // Pick enemigo sellado esta ronda — SIN heroId
```

El caso `HIDDEN` **no tiene campo `heroId`**. No hay forma en TypeScript de acceder a un heroId desde ese caso — es imposible por tipo, no solo por disciplina de código.

### Implementación en perspective.ts

Para Ranked All Pick:
- Picks propios sellados en la ronda actual → `{ visibility: "KNOWN", heroId }` (el Player sí conoce sus propios picks)
- Picks enemigos de rondas pasadas → `{ visibility: "REVEALED", heroId }`
- Picks enemigos sellados en la ronda actual → `hidden()` — función que crea un objeto fresco `{ visibility: "HIDDEN" }` (no un singleton compartido, para evitar mutación accidental)

### Pipeline de Coach recibe solo PerspectiveDraftView

El pipeline de `buildRecommendationSetV2` y cualquier función de Coach debe recibir `PerspectiveDraftView` como input, no `DraftProtocolState`. Esto se verifica mediante el test de arquitectura existente (`architecture-guard.test.ts`). El mismo patrón debe aplicarse a `deriveRevealStrategy()` y `translateToRecommendationOutputV3()`.

### EnemyBotInternalState nunca pasa al Coach pipeline

El Enemy Bot tiene acceso a `DraftProtocolState` para saber qué héroes están disponibles en su universo (bans + picks de rondas anteriores). Pero sus picks internos en la ronda actual nunca se serializan hacia ninguna función del Coach. La única comunicación es a través de `project()`.

### Test cases obligatorios para esta barrera

1. `project(state, "radiant")` con picks de Dire en `round.sealed` → `enemyPicks` contiene solo `{ visibility: "HIDDEN" }`, sin `heroId` accesible
2. `project(state, "dire")` con picks de Radiant en `round.sealed` → mismo resultado simétrico
3. `buildRecommendationSetV2` dado un `PerspectiveDraftView` con `enemyPicks` HIDDEN → ningún pick enemigo oculto aparece en las recomendaciones ni en las señales de counter
4. `project(state, null)` (sin viewer) → todos los picks sealed aparecen como `HIDDEN` (neutral viewer)
5. En `perspective.ts`, `hidden()` retorna un nuevo objeto en cada llamada (no singleton reutilizado)
6. La UI del roster nunca etiqueta un héroe enemigo desde la cronología ni desde la asignación privada del Enemy Bot (PD-027 punto 5)
7. Ninguna proyección, snapshot ni DOM contiene `internalPositionAssignments` ni `positionsByRosterSlot`

---

## 8. Ban Resolution Policy

La fase de ban no es interactiva durante el draft. Los banes se determinan antes de que empiece la selección de héroes (PD-021, Req 2).

### Interfaz canónica

```typescript
interface BanPreferenceSet {
  playerId: string;           // Identificador del jugador (real o simulado)
  preferences: (HeroId | null)[];  // Hasta 4 prefs; null = slot vacío
}

interface BanResolutionPolicy {
  resolve(preferences: BanPreferenceSet[], seed: string): HeroId[];
}
```

### Input

- `preferences[0]`: preferencias del Player (configuradas en UI)
- `preferences[1..9]`: preferencias de los 9 jugadores simulados, generadas determinísticamente desde `seed` usando un PRNG estable (el mismo patrón que `deriveExternalDecisionSeed`)
- Cada set puede tener 0-4 entradas; slots vacíos (`null`) se ignoran

### Garantías observables (no el algoritmo interno)

La policy encapsula el algoritmo interno. Lo observable desde fuera:
1. **Unique bans priorizados**: si un héroe es preferido por más de un jugador, solo se banea una vez (no una vez por jugador que lo prefirió)
2. **4 prefs llenas = ≥1 ban garantizado**: un jugador con los 4 slots llenos tiene al menos uno de sus héroes baneado
3. **Variable-length output**: el número de banes puede variar según los solapamientos entre preferencias

### Determinismo

```
BanResolutionPolicy.resolve(same_preferences, same_seed) === same_output
BanResolutionPolicy.resolve(same_preferences, different_seed) // meaningful variation
```

### Integración con el kernel

El Simulator llama a la policy, obtiene `HeroId[]`, y luego envía al kernel:
```
RECORD_RESOLVED_BANS(heroes: resolvedBans)
BAN_RESOLUTION_COMPLETE
```

El kernel valida la lista (IDs válidos, sin duplicados) y avanza a `PICK_ROUND_1`.

### Lo que el Coach recibe

Solo el set final de banes. El Coach nunca recibe preferencias individuales ni el proceso de resolución (Req 2.5). La barrera de información es: `project(state, side).bannedHeroes = resolvedBans`.

### Ban resolution failure behavior

If `BanResolutionPolicy.resolve()` throws or produces an invalid result:
- The session MUST NOT advance to PICK_ROUND_1
- The session remains in BAN_CONFIGURATION with an error state
- The Player is shown an error and offered a retry with the same inputs and seed
- An empty or silently reduced ban set is NOT an acceptable degradation — proceeding with no bans would violate the product's fidelity requirement (PD-013, PD-014)

---

## 9. Collision State Machine

El kernel ya implementa correctamente la mecánica de colisiones progresivas de Dota 2 (Req 1.5, PD-022). Esta sección describe el comportamiento para referencia y verificación.

### Datos clave en RankedApRoundState

```typescript
interface RankedApRoundState {
  round: 1 | 2 | 3;
  collisionsResolved: number;        // Counter per-ronda (no per-hero) — resetea en nueva ronda
  pendingCollision: PendingCollisionAuthority | null;  // Non-null = WAITING_FOR_COLLISION_AUTHORITY
  authorityResolutions: AuthoritativeCollisionResolution[];
  sealed: SealedSelection[];
  openSlots: OpenSlot[];
  // ...
}
```

### Flujo de resolución de ronda (resolveRound)

Cuando todos los slots de la ronda están sellados, `resolveRound()` ejecuta:

1. Detecta colisiones: héroes seleccionados por ambos lados en la misma ronda
2. Para cada colisión, incrementa `collisionsResolved`
3. Si `collisionsResolved <= 2` (colisiones 1 y 2):
   - El héroe disputado queda baneado permanentemente
   - Los slots de ambos lados se reabren (pueden elegir cualquier otro héroe)
   - La ronda continúa esperando nuevas selecciones para esos slots
4. Si `collisionsResolved >= 3` (colisión 3):
   - El kernel pausa: `status = "WAITING_FOR_COLLISION_AUTHORITY"`
   - Espera `APPLY_AUTHORITATIVE_COLLISION_RESOLUTION(round, heroId, winner)`
   - El Simulator actúa como authority: determina el winner usando **first-registration-wins** — el contendiente cuyo `SUBMIT_SEALED_SELECTION` fue registrado primero en el event log del kernel retiene el héroe
   - Después de la resolución: el ganador retiene el héroe; el perdedor reabre su slot

### Reset del counter

`collisionsResolved` se resetea a 0 en `createRoundState()` al iniciar cada nueva ronda. El counter es por ronda, no por heroId ni por draft.

### resolveSimulatorCollisionAuthority

`resolveSimulatorCollisionAuthority` existe en `adapters/simulator-authority.ts` pero actualmente usa un PRNG (`mulberry32`) to randomly select the winner — this **conflicts with the approved product rule**. The correct rule for collision event #3 is: **whoever registered the disputed selection first keeps the hero**. The adapter must be patched to use the canonical event log ordering (`state.rankedAp.round.sealed` insertion order, or the kernel's event log ordinal) to identify which contender submitted first, rather than a random draw. This is a **REUSE + PATCH** disposition, not REUSE AS-IS.

Add a mandatory test: **collision event #3: the contender whose `SUBMIT_SEALED_SELECTION` command appears earlier in the canonical event log retains the hero; the later registrant must re-pick.**

### Héroes baneados por colisión

Un héroe baneado como resultado de colisión (collisions 1-2) entra en `bannedHeroes[]` del state, igual que un ban pre-draft. Es permanentemente indisponible para el resto del draft.

### Tests obligatorios

1. Ronda 1, colisión evento #1: héroe disputado en `bannedHeroes`; ambos slots de vuelta en `openSlots`; `collisionsResolved = 1`
2. Misma ronda, colisión evento #2: segundo héroe disputado baneado; `collisionsResolved = 2`
3. Misma ronda, colisión evento #3: `status = "WAITING_FOR_COLLISION_AUTHORITY"`; `pendingCollision` no null
4. `APPLY_AUTHORITATIVE_COLLISION_RESOLUTION` resuelve la colisión 3; ganador confirma; perdedor reabre slot
5. Inicio de ronda siguiente: `collisionsResolved = 0`
6. Héroe baneado por colisión no aparece como disponible en rondas siguientes
7. **First-registration order**: en colisión evento #3, el contendiente cuyo `SUBMIT_SEALED_SELECTION` aparece antes en el event log del kernel retiene el héroe; el registrante posterior debe re-picar — nunca un sorteo aleatorio

---

## 10. Player Personal Position Model

La declaración de la posición personal del Player es un input pre-draft que desbloquea tres capacidades: Hero Pool scoping, vista "YOUR [POSITION] NOW", e identificación de "cuál de los 5 slots es el mío".

### Ciclo de vida

```
PRE_DRAFT
  Player selecciona (ambos REQUERIDOS para iniciar draft):
    - side: Radiant | Dire
    - playerPersonalPosition: 1 | 2 | 3 | 4 | 5
  ↓
SimulatorSessionConfig.playerPersonalPosition = 1|2|3|4|5  (required — no null)
ProtocolSessionMetadata.humanPosition = 1|2|3|4|5|null  (null only in legacy sessions)
  ↓
BAN_CONFIGURATION
  playerPersonalPosition ya confirmado:
    - Carga hero_pool para esa posición (puede estar vacío; no es error)
    - Activa "YOUR [POSITION] NOW" panel
  ↓
PICK_ROUND_1..3
  Coach usa playerPersonalPosition para:
    - Scopear hero_pool_fit signal al slot personal
    - Mostrar "TU MID AHORA" / "TU CARRY AHORA" (Req 21.3)
    - Identificar cuál slot del draft es el personal del Player
```

### Relación con pick timing (PD-001, PD-020)

La posición personal NO determina cuándo el Player debe picar su héroe personal. El Player puede llenar el slot personal en cualquier ronda. El Simulator acepta cualquier héroe disponible en cualquier slot en cualquier momento — no hay advertencias ni bloqueos por "pick temprano" (Req 19).

### Relación con ProtocolSessionMetadata.humanPosition

El campo `humanPosition: 1|2|3|4|5|null` ya existe en `ProtocolSessionMetadata`. En el recovery build solo se usaba para identificar al Mid (`humanPosition: 2`). En el modelo generalizado, este mismo campo representa la posición personal declarada por el Player para cualquier posición. La lógica de llenarlo ya no está hardcodeada en `SOLO_MID_SIMULATOR_POLICY` sino que viene de la declaración pre-draft del Player.

### AP Ranked Roles V1 requires playerPersonalPosition

A valid AP Ranked Roles V1 session cannot begin without `playerPersonalPosition`. The PRE_DRAFT phase gate checks both `side` AND `playerPersonalPosition` before advancing to BAN_CONFIGURATION (Req 21). If `playerPersonalPosition` is absent, the session remains in PRE_DRAFT and the Player is prompted to select their position.

Hero Pool may remain empty — that is not an error. Ban preferences may have empty slots — that is not an error. Only `side` and `playerPersonalPosition` are mandatory to start the draft.

The `humanPosition` field in `ProtocolSessionMetadata` retains `null` as a valid value for backward compatibility with legacy session paths that predate this requirement.

### Relación con Hero Pool

El `hero_pool` en DB está asociado al usuario globalmente. Para AP Ranked Roles V1, el pool relevante es el de la `playerPersonalPosition` declarada. Cuando el Coach evalúa héroes para el slot personal del Player, usa `hero_pool_fit` signal con ese pool. Para los otros 4 slots del equipo aliado, `hero_pool_fit` es `applicable: false` (Req 11.1, PD-010).

---

## 11. Own Team Control Model

> **Actualización 2026-09-27 (PD-026 / PD-027).** El modelo "el Player controla los 5 selections" que
> describe esta sección se conserva sólo como el caso **Party 5**. PD-026 lo generaliza a Solo / Party 2 /
> Party 3 / Party 5 con control por **posición**. Las subsecciones nuevas de abajo ("Party control model",
> "Canonical vocabulary", "Ally Bot scheduling", "Rejected designs register") mandan sobre cualquier
> ejemplo de `controlledSlots: [0..4]` de esta sección.

En AP Ranked Roles V1 el Player controla los 5 selections del Own Team. Este es el cambio de modelo más significativo respecto al recovery build.

### Modelo general: 5 slots controlados (legado — sólo Party 5; ver "Party control model (PD-026)")

```typescript
// Configuración de partido del Simulator
const ownTeamPartyContext: PartyContextInput = {
  partySize: 5,
  side: config.side,
  controlledSlots: [
    { side: config.side, slotIndex: 0, controllerId: "player" },
    { side: config.side, slotIndex: 1, controllerId: "player" },
    { side: config.side, slotIndex: 2, controllerId: "player" },
    { side: config.side, slotIndex: 3, controllerId: "player" },
    { side: config.side, slotIndex: 4, controllerId: "player" },
  ],
};
```

El kernel ya soporta `PartyContext` con `controlledSlots`. Solo hay que configurarlo correctamente para los 5 slots del lado del Player.

### Own Team role assignments are known truth

In Ranked Roles, the own team's five role assignments (Pos1 Carry, Pos2 Mid, Pos3 Offlane, Pos4 Soft Support, Pos5 Hard Support) are known before the draft begins — they come from matchmaking queue selection. These role assignments are a fact about the team, independent of when each hero is picked.

- **Role assignment** (Pos1..Pos5): which role each player queued for. Known. Stable. Does not constrain pick timing.
- **Pick round slot** (Round 1 slot 0, Round 1 slot 1, etc.): the chronological position of a selection. Independent of role assignment.

The design removes the fixed `slot-ordinal → position` mapping from `SOLO_MID_SIMULATOR_POLICY` because that mapping **erroneously imposed pick order onto roles**. It does NOT remove the knowledge that Own Team has exactly one Pos1, one Pos2, one Pos3, one Pos4, and one Pos5. That knowledge is real Ranked Roles truth and must remain explicit in `SimulatorSessionConfig`.

When a Player fills a pick slot, they are associating that pick with one of the five known role slots — but they choose freely which role slot to fill at which pick moment.

### Party control model (PD-026)

`SimulatorSessionConfig.partySize` + `controlledPositions` (ver §4) son la **fuente de verdad del
control en AP**:

| Party | `controlledPositions` | Ally Bot controla |
|---|---|---|
| Solo (1) | la posición personal | las otras 4 |
| Party 2 | 2 posiciones declaradas | las otras 3 |
| Party 3 | 3 posiciones declaradas | las otras 2 |
| Party 5 | `[1,2,3,4,5]` | ninguna |
| Party 4 | no soportado | — |

- `PartyContext` sigue siendo **estructural e inerte** para AP Simulator:
  `{ partySize, side, controlledSlots: [] }`. **No es el oráculo de posición ni de control.**
- El control pertenece a **posiciones / participantes**, nunca a asientos cronológicos.
- Los picks del Ally Bot son picks del Own Team: su héroe y su posición son verdad conocida para el
  Player y el Coach.

### Canonical vocabulary (PD-027)

| Concepto | Significado | Estable en el draft | Lo conoce el Coach | Lo conoce el Player | Capa |
|---|---|---|---|---|---|
| `assignedPosition` | Pos1..Pos5; identidad del participante del Own Team | Sí | Sí | Sí | Sesión Simulator / Coach |
| `controller` | Humano o Ally Bot que controla un `assignedPosition` | Sí | Sí | Sí | Sesión Simulator |
| `roundSlot` | `slotIndex` round-scoped del kernel (0/1 en R1–R2, 0 en R3) | No (por ronda) | Sí | Sí | Kernel de protocolo |
| `pickOrdinal` | Orden cronológico 0..4 derivado; ni posición ni controlador | Sí (tras el hecho) | Sí | Sí | Derivado |
| Enemy private position | Rol interno del Enemy Bot por pick | Sí | **No** | **No** | Simulator-private |

- **En código AP, `slotIndex` significa únicamente `roundSlot`.** No existen dos significados de `slotIndex`.
- Los términos `rosterSeat` / `rosterSlot` se retiran en favor de `pickOrdinal` donde se quiere decir
  cronología. Las apariciones históricas de `rosterSlot` en este documento significan `pickOrdinal`.

### Slot ordinal vs. posición declarada

En el recovery build, `SOLO_MID_SIMULATOR_POLICY.rosterPositions` asignaba posiciones según el orden fijo de picks: slot 0 = Pos5, slot 1 = Pos4, etc. Esto violaba PD-001 al hacer que la posición dependiera del orden de pick.

En el modelo generalizado:
- Los 5 slots (0..4) son simplemente los "asientos" del equipo en la ronda
- La posición (Pos1-5) asociada a cada héroe se determina por declaración explícita del Player o por inferencia (`RoleBelief`)
- No hay mapeo fijo slot-ordinal → posición

### Rejected designs register

Diseños rechazados explícitamente. Ninguno puede reaparecer en código de producción (candado:
`no-solo-mid-residue.test.ts`, a extender en el commit de implementación):

- `POSITION_FOR_ROSTER_SEAT`, `ROSTER_SEAT_FOR_POSITION`, `positionForRosterSeat`,
  `rosterSeatForPosition`, `positionForRoundSlot` (motor y web), `SEAT_ROLE_NAMES` — reintroducidos por
  `7af98c7` / `b8d4d20` / `5e39890`, en contradicción con este §11 y con PD-001 / PD-020.
- `PartyContext.controlledSlots` como verdad de control o de posición en AP — `7af98c7`.
- `ControlledSlot.slotIndex = position − 1` (reinterpretar el índice del kernel como posición) — rechazado
  2026-09-27: sobrecarga un segundo concepto de "slot" con significado de posición y contradice PD-027.

### Pick de cualquier slot en cualquier ronda

El Simulator acepta `SUBMIT_SEALED_SELECTION(side, slotIndex, heroId)` para cualquier combinación válida de (side, slotIndex) en la ronda actual. El kernel no tiene concepto de "este slotIndex debe tener tal posición". La validación es solo: slot está abierto + héroe disponible.

**`assignedPosition` viaja fuera del comando del kernel.** El comando sigue siendo
`SUBMIT_SEALED_SELECTION(side, slotIndex, heroId)` con `slotIndex = roundSlot`. Para una sesión AP
Simulator, la posición viaja como campo hermano en el sobre de envío (`{ command, viewerSide,
assignedPosition }`) y la valida la ruta, nunca el comando ni el validador del kernel. La sesión
comprueba que la posición es controlada por un humano y aún no está ligada, aplica el comando al
kernel y después registra el binding (§5 "Own Pick Position Binding"). Cualquier `roundSlot` propio
abierto puede llevar cualquier posición humana sin cubrir.

### Slot personal del Player

El slot personal se identifica por `playerPersonalPosition`, no por un índice fijo. Cuando el Player pica un héroe y lo asocia a su posición personal, ese slot queda marcado como "el slot del Player". Esta asociación es semántica (para el Coach), no un constraint del kernel.

### Ally Bot scheduling (PD-027 punto 4)

- Por ronda, el humano actúa primero. El Ally Bot llena la capacidad propia restante de la ronda
  sólo después de que los humanos actuaron, o cuando el humano cede explícitamente el resto de la ronda.
- El timer nunca elige automáticamente (§6 "Timer expirado"): ceder la ronda es una acción explícita del
  humano, no disponible cuando las posiciones sin cubrir del Ally Bot no alcanzan para la capacidad
  restante de la ronda.
- El orden en que el Ally Bot cubre sus posiciones es una permutación determinista de las posiciones que
  controla, derivada de `simulatorSeed` (namespace propio, mismo patrón que `deriveExternalDecisionSeed`).
- El Ally Bot nunca impide que una posición controlada por un humano se selle en la ronda en que el humano
  decide actuar; el único límite es la capacidad real de la ronda (2 / 2 / 1).

### Reemplazando SOLO_MID_SIMULATOR_POLICY

**`SOLO_MID_SIMULATOR_POLICY`** (en `simulator/solo-mid-policy.ts`) expone las siguientes propiedades relevantes que deben generalizarse:

| Propiedad antigua | Reemplazo |
|---|---|
| `humanSide: "radiant"` | `config.side` (del Player) |
| `humanPosition: 2` | `config.playerPersonalPosition` |
| `humanRosterSlot: 4` | Slot identificado dinámicamente por la declaración del Player |
| `partySize: 1` | `partySize: 5` (5 slots controlados) |
| `rosterPositions: { radiant: [...], dire: [...] }` | Eliminado — posición no depende de slot ordinal |
| `externalSelection.maxCandidates: 3` | Reutilizable como constante del Enemy Bot (ver §12) |
| `externalSelection.qualityBandPoints: 5` | Reutilizable como constante del Enemy Bot |

### isApSimulatorMetadata()

Reemplaza `isSoloMidSimulatorMetadata()`. La función nueva verifica que:
- `adapterKind === "simulator"`
- `simulatorSeed !== null`

Ya no verifica `humanSide === "radiant"` ni `humanPosition === 2` ni `humanRosterSlot === 4`.

---

## 12. Enemy Bot Architecture

El Enemy Bot controla los 5 picks del equipo enemigo. Su diseño sigue el mismo principio de información oculta: tiene acceso al estado completo del protocolo (para saber qué está disponible), pero sus decisiones no deben filtrarse al Coach.

### EnemyBotConfig

```typescript
interface EnemyBotConfig {
  // Lado del enemy team (opuesto al del Player)
  side: TeamSide;
  
  // Asignación interna de posiciones a los 5 slots (determinística por seed)
  // No expuesto al Coach
  internalPositionAssignments: Record<number, 1 | 2 | 3 | 4 | 5>;  // slotIndex → position
  
  // Seed del draft (para determinismo)
  seed: string;
}
```

### Pipeline de decisión del Enemy Bot

Para cada slot enemigo abierto en la ronda actual:

1. Obtiene `perspective.project(protocolState, enemySide)` — el Enemy Bot ve desde su propio lado
2. Obtiene la `internalAssignedPosition` para el roster slot actual desde `EnemyBotConfig.internalPositionAssignments`
3. Construye el universo de candidatos RESTRINGIDO a héroes válidos para esa posición, usando `hero-positions.json` data
4. Llama a `buildRecommendationSetV2` con `targetPosition = internalAssignedPosition` para filtrar y ponderar candidatos dentro de ese universo
5. Aplica quality band: top-3 candidatos dentro de 5 score points del mejor dentro del universo restringido
6. Selecciona determinísticamente usando `deriveExternalDecisionSeed(draftSeed, participant, decisionIndex)`
7. Envía `SUBMIT_SEALED_SELECTION(enemySide, slotIndex, chosenHeroId)` al kernel

La validación de composición (evitar 5 cores, Req 6.2) se logra usando `buildRecommendationSetV2` con la inferencia de roles del Enemy Bot — V6's `position_fit` signal ya penaliza composiciones incoherentes.

**Internal assigned position is a Simulator constraint, not Coach information.** `internalPositionAssignments` is stored in `EnemyBotInternalState`, which never reaches the Coach pipeline. The restriction that Enemy Bot slot 0 picks a valid Pos5 hero (for example) is enforced within Simulator Truth — the Coach sees only the revealed hero and must infer its position from observable evidence.

### Determinismo

```typescript
// Reutilizable desde solo-mid-policy.ts (desacoplado del hardcode)
function deriveExternalDecisionSeed(
  draftSeed: string,
  participant: { side: TeamSide; rosterSlot: number },
  decisionIndex: number,
): string {
  return `${draftSeed}:${participant.side}:${participant.rosterSlot}:${decisionIndex}`;
}
```

Misma lógica que el recovery build, generalizada para cualquier side y rosterSlot.

### Separación de información

`EnemyBotInternalState.pendingSelections` (picks sellados aún no revelados) nunca se serializa hacia el pipeline del Coach. La única comunicación entre el Enemy Bot y el Coach es a través de `project(protocolState, playerSide)`, que oculta estructuralmente los picks sellados del lado enemigo.

`internalPositionAssignments` es una permutación sembrada por sesión, indexada por el `pickOrdinal`
del propio Enemy Bot. Es **Enemy private position** (verdad privada del Simulator, PD-027 punto 5), no un
mapeo compartido ni fijo, y su único consumidor es el driver del Enemy Bot. Nunca llega al Player, al
Coach, a la evidencia de recomendación ni a la UI normal del roster.

### Variation policy

`chooseExternalSuggestion` implementa la quality band de forma reutilizable:
- Filtra candidatos a los que estén dentro de `qualityBandPoints = 5` puntos del mejor
- Considera máximo `maxCandidates = 3`
- Selecciona dentro del band usando `stableHash(seed) % band.length`

Estas constantes se mueven a `EnemyBotConfig` o a un archivo de constantes del Simulator, desacopladas de `SOLO_MID_SIMULATOR_POLICY`.

### Comportamiento correcto de disponibilidad de héroes

El Enemy Bot consulta disponibilidad a través de `isSealedSelectionLegal(protocolState, enemySide, slotIndex, heroId)`. Esta función verifica:
- `heroAlreadyTaken`: en `bannedHeroes` o `confirmedPicks` de rondas pasadas
- `slotIsOpen`: el slot está disponible en la ronda actual
- No verifica picks Own Team de la ronda actual (sealed enemy-visible) — correcto por diseño

Esto significa que el Enemy Bot puede intentar seleccionar el mismo héroe que el Player ya seleccionó internamente — si eso ocurre, la colisión se detecta en `resolveRound()`.

---

## 13. Enemy Role Inference Model

El Coach infiere posiciones probables para los héroes enemigos revelados usando evidencia legal observable. Nunca accede a la role queue interna del Enemy Team (PD-005, PD-012, Req 4).

### Fuente de evidencia legal

El Coach puede ver en `CoachObservableState.view.enemyPicks` solo las entradas con `visibility: "REVEALED"`. Para cada héroe revelado, la inferencia se basa en:

1. **Distribución histórica del héroe** (`deriveFlexDistribution(heroId, heroPositions)` desde `intent/position-prior.ts`)
2. **Confirmed positions from explicit Player assignments** (hard constraints, `status: CONFIRMED` only). Probable/likely inferences from other enemy heroes are soft evidence that can inform the hero/patch distribution tier but must not be passed as `occupiedPositions` structural constraints — that would create inference feedback loops.
3. **Override explícito del Player** si el Player asigna una posición a un héroe enemigo

### Cálculo

```typescript
// Para cada héroe revelado del enemigo:
const belief = computeRoleBelief({
  heroId: revealedHeroId,
  heroPositions: heroPositionsData,
  // IMPORTANT: only pass CONFIRMED positions as occupiedPositions.
  // A "Likely Pos3" belief is soft evidence — it must NOT eliminate Pos3 as a possibility
  // for other heroes as if it were a hard structural constraint. Doing so creates a
  // feedback loop where soft inferences chain into false certainties.
  occupiedPositions: enemyHardConfirmedPositions,  // only explicit Player assignments
  confirmedPosition: playerAssignment?.get(revealedHeroId) ?? null,
});
// enemyHardConfirmedPositions: Set<Position> containing only positions where
// the Player has explicitly assigned a position via manual override (status: CONFIRMED).
// LIKELY/UNRESOLVED beliefs do NOT contribute to this set.
```

`computeRoleBelief` ya soporta este input. El único trabajo nuevo es conectarlo al pipeline y construir `enemyHardConfirmedPositions` a partir de las asignaciones explícitas del Player (solo status CONFIRMED).

### Display de Flex enemy

El Coach muestra posiciones probables en lugar de forzar una sola asignación:

- Si `belief.entropy > umbral_flex` (threshold to validate in QA) y las top-2 posiciones juntas representan una fracción significativa de la masa (threshold to validate in QA): mostrar como "Likely Pos3 / Possible Pos2"
- Si `belief.entropy ≈ 0` (CONFIRMED o muy LIKELY): mostrar solo la posición dominante
- Si `belief.status === "UNRESOLVED"`: mostrar como "Pos?" o simplemente omitir la etiqueta de posición

### Player assignment override

Si el Player asigna explícitamente una posición a un héroe enemigo:
- `playerPositionAssignments.set(heroId, position)` en `CoachObservableState`
- La siguiente llamada a `computeRoleBelief` para ese héroe usará `confirmedPosition: position` → resultado `CONFIRMED` con entropy 0

El Player puede remover o cambiar la asignación (Req 13.4). El Coach recalcula `RoleBelief` en el siguiente update.

### Display del rol enemigo en el roster (PD-027 punto 5)

El roster muestra un rol enemigo únicamente desde `RoleBelief` (evidencia observable, distribución
probabilística, "Likely PosX / Possible PosY") o desde una asignación explícita del Player. Nunca desde la
cronología del pick, un asiento o la asignación privada del Enemy Bot. Sin evidencia suficiente el rol
se muestra probabilístico o no se muestra. Nota: `POST .../position-assignment` responde hoy 403
(`own_team_assignment_only`) para héroes enemigos; la asignación manual de un rol enemigo (§13
"Player assignment override") sigue siendo una brecha conocida, no un requisito de este commit.

### Lo que el Coach NO hace

- NO consulta `EnemyBotInternalState.positionsByRosterSlot` (role queue real)
- NO infiere roles enemigos desde posiciones propias aliadas (no hay correlación directa)
- NO fuerza resolución de Flex enemigo sin evidencia o asignación explícita (PD-018)

---

## 14. Flex Resolution Model

Un Flex Hero es aquel cuya posición primaria no puede inferirse con confianza desde el nombre del héroe o desde etiquetas temáticas. Su manejo requiere representar la ambigüedad honestamente.

### Detección de Flex (Own Team)

Un héroe propio se trata como Flex cuando `RoleBelief.entropy > umbral_flex_propio` (threshold to validate in QA) y las top-2 posiciones representan una fracción significativa de la masa total (threshold to validate in QA).

**Display**: el slot aparece como "FLEX 3/4" (Req 18.1) con las dos posiciones posibles. No se auto-asigna ninguna posición.

**Player assignment**: hay un control ligero en la UI de Draft State Visibility que permite al Player asignar la posición. La asignación llama a:
```typescript
coachObservableState.playerPositionAssignments.set(heroId, declaredPosition);
```
El Coach recalcula roles propios usando `computeRoleBelief({ confirmedPosition: declaredPosition })` → `CONFIRMED`.

**Sin asignación**: el Coach razona con ambas posiciones válidas para ese héroe hasta que el Player decide (Req 13.7). For own team Flex handling, only CONFIRMED explicit Player assignments are passed as `occupiedPositions`. Unresolved Flex slots are kept open — they do not contribute hard constraints to other slots' role beliefs.

### Detección de Flex (Enemy Team)

Mismo mecanismo que Enemy Role Inference (§13). El Coach muestra "Likely Pos3 / Possible Pos2" cuando la incertidumbre es alta.

**No forzar**: el Coach nunca auto-resuelve un Flex enemigo a una sola posición por default (PD-018). La confianza puede aumentar si el draft state acumula evidencia (otros héroes enemigos confirmados que ocupan posiciones alternativas), pero siempre es probabilístico, no categórico, sin evidencia suficiente.

### Interacción con V6 signals

El scoring V6 con `position_fit` signal ya trabaja con la posición asignada al héroe. Cuando un héroe es Flex y no tiene asignación confirmada, el pipeline puede:
1. Evaluar el héroe para su posición más probable (mayor `probability` en el belief)
2. O evaluar para cada posición posible y tomar el max — estrategia a definir en implementación (no hardcode en este diseño)

---

## 15. Hero Availability Model

La disponibilidad de héroes tiene una semántica diferente según la perspectiva del observador. Es crítico no confundir disponibilidad global con disponibilidad per-perspectiva.

### Disponibilidad desde la perspectiva del Player

Un héroe está **disponible para el Player** cuando no aparece en ninguno de estos sets del `CoachObservableState`:
- `confirmedBans` (banes resueltos pre-draft o por colisión)
- `view.ownPicks` (picks propios KNOWN de rondas pasadas)
- `view.enemyPicks` con `visibility: "REVEALED"` (picks enemigos ya revelados)

**Lo que NO excluye un héroe del pool del Player**: que el Enemy Bot lo haya seleccionado internamente en la ronda actual (pick sellado, oculto). Eso se detectará en `resolveRound()` como colisión, pero hasta ese momento el héroe es legalmente seleccionable por el Player.

### Disponibilidad desde la perspectiva del Enemy Bot

Simétrica: el Enemy Bot no puede seleccionar héroes en `bannedHeroes` o `confirmedPicks` de rondas pasadas. Pero los picks sellados del Player en la ronda actual no excluyen héroes del universo del Enemy Bot.

### Implementación autoritativa

`isSealedSelectionLegal(state, side, slotIndex, heroId)` en `ranked-all-pick.ts` es la función canónica. Verifica:
- `heroAlreadyTaken(rankedAp, heroId)`: en `bannedHeroes` O en `confirmedPicks.heroId`
- `slotIsOpen(round, side, slotIndex)`: el slot está disponible para ese lado
- `alreadySealedBySameSide(round, side, heroId)`: el mismo lado ya seleccionó ese héroe en la ronda actual

La función NO verifica si el lado opuesto tiene ese héroe en `sealed`. Esto es correcto por diseño.

### Availabilty para el Coach (recomendaciones)

El Coach recomienda héroes del pool visible al Player: `confirmedBans` y `revealed picks` excluidos. El Coach NO excluye héroes basado en picks enemigos no revelados (Req 20.6). Esto es garantizado estructuralmente porque el Coach solo ve `PerspectiveDraftView` — los picks sellados enemigos no tienen `heroId` visible.

### Tests obligatorios

1. `project(state, "radiant")` cuando Dire tiene Puck en `sealed`: Puck aparece como `HIDDEN` en `enemyPicks`, NO eliminado de `bannedHeroes`
2. `isSealedSelectionLegal(state, "radiant", 0, puck)` cuando Dire tiene Puck en `sealed`: retorna `true` (disponible para Radiant)
3. `isSealedSelectionLegal(state, "dire", 0, puck)` cuando Dire ya tiene Puck en `sealed` (mismo lado): retorna `false` (`alreadySealedBySameSide`)
4. Después de `resolveRound()` con Puck como colisión: `isSealedSelectionLegal(_, _, _, puck)` retorna `false` (Puck en `bannedHeroes`)
5. `buildRecommendationSetV2` con view que tiene Enemy Puck como HIDDEN: Puck puede aparecer en shortlist (es recomendable para el Player si V6 lo puntúa bien)

---

## 16. Recommendation Architecture

El sistema de recomendación tiene dos niveles de abstracción. El Nivel 2 ya existe. El Nivel 1 es nuevo.

### Nivel 2 — Hero Candidate Ranking (existente, reutilizable)

`buildRecommendationSetV2` en `recommendation/build.ts`. Pipeline completo de V6 scoring:

```
CoachObservableState.view (PerspectiveDraftView)
  + heroPositions + patchStats + heroCounters + heroPool
  → V6 signals (position_fit, counter, patch_meta, team_synergy, hero_pool_fit, archetype_fit)
  → SCORING_WEIGHTS_V6 mix
  → Ranked candidates: Recommendation[]
  → RecommendationSetV2
```

Este pipeline no se toca. Solo se le pasan los inputs correctos, con `hero_pool_fit` scoped a la posición personal del Player (ver §18).

### Nivel 1 — Reveal Strategy (nuevo)

`deriveRevealStrategy(coachState, context)` — nueva función que opera sobre el output de Nivel 2 y el estado del draft para producir la acción estratégica de nivel alto.

```typescript
function deriveRevealStrategy(
  view: PerspectiveDraftView,
  recommendations: RecommendationSetV2,
  playerPersonalPosition: 1 | 2 | 3 | 4 | 5 | null,
  heroPool: HeroId[],
  decisionContext: DraftDecisionContext,
): RevealStrategy
```

### Inputs de deriveRevealStrategy

- **`view.rankedAp.phase`**: determina en qué ronda estamos y cuántos picks quedan
- **`view.ownPicks`**: cuántos picks propios están confirmados
- **`view.enemyPicks` (REVEALED)**: héroes enemigos conocidos → influyen en counters
- **`decisionContext`**: `team_opening | blind_second_pick | response_pick | closing_pick` (de `decision-context.ts`, adaptado a `PerspectiveDraftView`)
- **`recommendations.recommendations[0]`**: el candidato top de Nivel 2 — su `confidence` y `roleImpact` informan el output
- **`heroPool`**: pool del Player para su posición personal
- **Support-first prior**: si `decisionContext === "team_opening"` o `"blind_second_pick"` y el top candidato es un core sin señal contextual fuerte → prior inclina hacia support

### Lógica de selección de RevealStrategy

| Condición | RevealStrategy |
|---|---|
| Ronda 1/2, prior support-first activo, sin oportunidad fuerte de core | `REVEAL_POSITION(position=5)` o `REVEAL_POSITION(position=4)` |
| Safe core window detectada (§19) | `OPPORTUNITY(subtype=SAFE_CORE, heroId=...)` |
| Counter-pick excepcional (counter signal dominante) | `OPPORTUNITY(subtype=COUNTER, heroId=...)` |
| Ronda 2/3, composición propia necesita un rol específico Y evidencia suficiente para héroe | `REVEAL_HERO(position, heroId)` |
| Ronda 2/3, composición necesita rol pero sin claridad de héroe | `REVEAL_POSITION(position)` |
| Pick propio es Flex sin asignación confirmada | `REVEAL_FLEX(possiblePositions)` |
| Evidencia solo soporta nivel de posición (default honesto) | `REVEAL_POSITION(position)` con la posición de mayor necesidad compositiva |

Las condiciones exactas (thresholds de score, umbrales de dominancia de señal) son design details que se calibran en QA, no se hardcodean en este documento.

### Orquestación: cuándo recomputar

```typescript
// Trigger 1: Own Team pick confirmado
onOwnPickConfirmed(heroId, slotIndex) → recalculate(CoachObservableState)

// Trigger 2: Round reveal (nuevos enemy picks visibles)
onRoundReveal(newEnemyPicks) → recalculate(CoachObservableState)

// Trigger 3: Player position assignment (flex resolution)
onPlayerPositionAssigned(heroId, position) → recalculate(CoachObservableState)
```

Req 8 exige recalculación después de cada uno de estos eventos. No hay "calculation lock".

### decision-context.ts — Adaptación al nuevo modelo

`deriveDecisionContext` actualmente usa `DraftState` del legacy reducer. En el nuevo modelo, debe adaptarse para recibir los datos de `PerspectiveDraftView`:

- `ownPicks.length` → desde `view.ownPicks.filter(p => p.visibility !== "HIDDEN").length`
- `revealedEnemyPicks.length` → desde `view.enemyPicks.filter(p => p.visibility === "REVEALED").length`
- `teamOpening` → derivado del `view.rankedAp.phase === "PICK_ROUND_1"` y sin picks propios confirmados

El resultado (`team_opening | blind_second_pick | response_pick | closing_pick`) sigue siendo el mismo — solo cambia la fuente de datos.

---

## 17. Recommendation Output Contract

`RecommendationOutputV3` es el contrato de UI. Se construye sobre `RecommendationSetV2`, no lo reemplaza. La traducción vive en `translateToRecommendationOutputV3()`.

### Estructura completa

```typescript
interface RecommendationOutputV3 {
  // Acción primaria: la respuesta central al Coach Question (Req 9, PD-015)
  primaryAction: {
    strategy: RevealStrategy;
    label: string;    // "Abre con Pos5 — sinergia con tu Mid" / "Asegura este Carry ahora"
  };
  
  // Shortlist de héroes concretos (3-5, exacto post-QA) (Req 15)
  shortlist: HeroCard[];
  
  // Bloque de oportunidad contextual (Req 15.2, Req 16, PD-017)
  // Solo presente cuando hay evidencia real que lo justifica
  opportunity?: {
    label: string;    // "Ventana de Carry — Slark y Anti-Mage ya baneados"
    heroId?: HeroId;
    evidence: string; // Breve: "3 counters duros baneados"
  };
  
  // Vista personal "TU MID AHORA" (Req 11.7, Req 21)
  personalHeroView?: {
    positionLabel: string;   // "TU MID AHORA" / "TU CARRY AHORA"
    heroes: {
      heroId: HeroId;
      rank: number;           // Posición en el ranking de pool del Player
      score: number;          // Score V6 de ese héroe
    }[];
  };
  
  // Sección de fuera del pool (Req 11.3, PD-010)
  outsidePoolRecommendation?: {
    heroId: HeroId;
    label: string;    // "Mejor fuera de tu pool"
    rationale: string;
  };
  
  // Metadatos para stale-detection y display contextual
  meta: {
    round: 1 | 2 | 3 | null;
    phase: RankedApPhase;
    ownPicksRemaining: number;
    confidence: "alta" | "media" | "baja";
    basedOn: RecommendationBasedOn;  // Trazabilidad completa
  };
}
```

### Invariantes del contrato

- `primaryAction.label` NUNCA es una obligación — el Player retiene plena autoridad (PD-003, Req 9.5)
- `opportunity` block SOLO aparece cuando hay evidencia real — no por defecto
- `personalHeroView` SOLO aparece cuando `playerPersonalPosition` está declarada
- `outsidePoolRecommendation` SOLO aparece cuando el pool está configurado Y ningún héroe del pool ofrece una respuesta satisfactoria
- `shortlist` NUNCA tiene un solo héroe como "la única opción" excepto cuando realmente solo hay uno disponible (Req 15.6)

### translateToRecommendationOutputV3()

```typescript
function translateToRecommendationOutputV3(
  recommendationSet: RecommendationSetV2,
  revealStrategy: RevealStrategy,
  coachState: CoachObservableState,
  config: SimulatorSessionConfig,
): RecommendationOutputV3
```

Responsabilidades:
1. Mapear `revealStrategy` → `primaryAction.label` con texto contextual
2. Convertir `recommendationSet.recommendations` → `HeroCard[]` con badges derivados de `evidence[]`
3. Detectar si `recommendations[0]` tiene safe core window → poblar `opportunity`
4. Filtrar pool del Player → `personalHeroView`
5. Detectar gap de pool → `outsidePoolRecommendation`
6. Propagar `basedOn` → `meta.basedOn`

### Stale-detection

Un `RecommendationOutputV3` se considera stale cuando `meta.basedOn` difiere del `basedOn` calculado para el estado actual del draft. La UI puede marcar la recomendación como "calculando..." mientras espera el nuevo resultado. La comparación usa `basedOn.stateIdentity` + `basedOn.evidenceVersion`.

---

## 18. Hero Pool Integration

El Hero Pool es un preference filter, nunca un hard gate (PD-010, Req 11.6).

### Scoping por posición personal

El pool relevante para `hero_pool_fit` signal es el pool de la `playerPersonalPosition` declarada por el Player. Para los otros 4 slots aliados, `hero_pool_fit` está marcado como `applicable: false` en el mix de V6.

```typescript
// Al construir el input para buildRecommendationSetV2:
const heroPool = coachState.personalContext?.heroPool ?? [];  // [] si no hay pool
// hero_pool_fit signal recibe este pool
// Para slots donde el Coach evalúa héroes de otras posiciones: pool = []
```

### "YOUR [POSITION] NOW" panel

Este panel es una vista secundaria compacta (Req 11.7) que no reemplaza el team-level recommendation:

```
TU MID AHORA: Puck › Ember Spirit › Storm Spirit
```

**PersonalHeroView requires a separate evaluation, not a filter of the team-level recommendation set.** The team-level RecommendationSetV2 may be evaluating Pos5 candidates when the primary action is "Open with Pos5". The Player's personal pool (e.g., their Mid heroes) must be ranked independently using the same V6 pipeline but scoped to:
- `targetPosition = playerPersonalPosition`
- `heroPool = personalContext.heroPool`
- Same draft state (confirmed bans, revealed enemies, own composition)

`personalRecommendationSet = buildRecommendationSetV2(view, actor, patch, computeSuggestions, { targetPosition: playerPersonalPosition, heroPool: personalPool })`

The panel then shows the top-N heroes from `personalRecommendationSet` that are in the pool, ordered by score. If the pool is empty or no pool heroes score above a minimum threshold (to validate in QA), the panel is not shown.

This evaluation runs in parallel with the team-level recommendation and must be recalculated after every draft event.

### "Best outside your pool"

Aparece como sección separada cuando:
- El Player tiene pool configurado (no vacío)
- The Player has a configured pool (not empty)
- The best personal-position candidate OUTSIDE the pool scores meaningfully higher than the best personal-position candidate INSIDE the pool (threshold to calibrate in QA)
- Comparison is within the personal position — NOT: global top hero of any position vs. pool

Cuando aparece:
```
MEJOR FUERA DE TU POOL: [HeroName] — [rationale]
```

Es explícitamente una sección secundaria, visualmente distinta del shortlist principal (PD-010).

### Sin hero pool configurado

Cuando el Player no tiene pool configurado: `hero_pool_fit` signal sigue con `applicable: false` para ese signal. Las recomendaciones se generan sin filtro de pool. No se muestran "YOUR [POSITION] NOW" ni "Best outside your pool" (Req 11.5).

---

## 19. Safe Core V1

La Safe Core es una señal contextual derivada de la combinación de evidencias ya disponibles en V6 y en los datos curados. No es una lista hardcodeada de héroes.

### Objetivo

Detectar cuándo un core hero puede revelarse temprano con seguridad estratégica (Req 16, PD-017). El Coach lo surface como señal informativa, no como recomendación obligatoria.

### Señales de input disponibles

Todas estas ya existen en el sistema actual:

| Señal | Fuente | Qué aporta |
|---|---|---|
| `counter` signal V6 | `hero-counters.json` + `createCounterScorer` | Score de matchup del héroe vs. picks enemigos actuales |
| Hard counters del héroe | `hero-counters.json` (curado Fase 8) | Lista de héroes que counteren duramente a este core |
| Baneados del set de hard counters | `bannedHeroes[]` vs. hard counters list | Fracción de hard counters ya fuera del draft |
| `patch_meta` signal V6 | `MetaSnapshot.patchStats` | Fuerza general del héroe en el patch actual |
| `position_fit` signal V6 | `hero-positions.json` | Si el héroe funciona bien en su posición de forma independiente |

### Lógica de detección V1

```typescript
interface SafeCoreSignal {
  isSafeWindow: boolean;
  evidence: string;   // "X de Y counters duros baneados" / "Top meta + counters escasos"
}

function detectSafeCoreWindow(
  heroId: HeroId,
  view: PerspectiveDraftView,
  v6Signals: SignalBreakdown,
  heroCounters: HeroCounterData,
): SafeCoreSignal
```

Un core puede calificarse como "safe window" cuando la combinación de señales apunta a baja amenaza contextual. La función combina:
- Fracción de hard counters ya baneados o picked por el propio equipo
- `counter` signal score del héroe en el estado actual
- `patch_meta` y `position_fit` como señales de fortaleza base

**No se hardcodean umbrales numéricos en este documento**. El threshold de "safe window" es un parámetro configurable que se calibra en QA (ver §25 Risks/Unknowns).

### Output en UX

El Safe Core window se surface como bloque `opportunity` en `RecommendationOutputV3`:
```
VENTANA EARLY CARRY — Slark y AM ya baneados; pocos counters disponibles
```

No reemplaza el shortlist. Es informacional. El Player puede ignorarlo (PD-003).

### Future Intelligence

Deep composition modeling, pick-rate analysis formal, blind-pickability scoring con modelos de distribución de composiciones enemigas: deferred.

---

## 20. Side + Patch Context

### Side context

Side es un input de primera clase disponible desde el inicio del draft (PD-006, Req 3):

- **`SimulatorSessionConfig.side`**: declarado por el Player en PRE_DRAFT
- **`ProtocolSessionMetadata.localSide`**: almacenado en la sesión del servidor
- **`PartyContext.side`**: llevado en el kernel state para Ranked AP

El side se usa en `project(state, config.side)` para generar el `PerspectiveDraftView` correcto.

**Side como tiebreaker en recomendaciones** (Req 3.6): si V6 tiene evidencia estadística confiable de diferencial Radiant/Dire para un héroe (datos actuales en `patchStats`), puede usarse como tiebreaker cuando dos candidatos tienen scores muy cercanos. No es un criterio dominante por defecto. "Suficiente evidencia" significa diferencial estadísticamente significativo en los datos del patch, no simplemente "Radiant tiene WR ligeramente mayor globalmente".

**Soporte simétrico Radiant/Dire** (PD-019, Req 3.4): ningún comportamiento es exclusivo de un side. Tests de QA deben incluir escenarios desde ambos lados.

### Patch context: two independent versioning axes

**Axis A — Ruleset Mechanics Version** (`RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch`): which patch version was used to verify the Ranked All Pick rules (round structure, timers, collision mechanic). This is metadata about the ruleset contract, not about scoring data.

**Axis B — Data Snapshot Version**: which patch/data window feeds the scoring pipeline:
- `patchStats` (win rates, pick rates) — sourced from `MetaSnapshot`
- `hero-positions.json` — curated position data
- `hero-counters.json` — curated counter data
- `hero-matchups` in SQLite — matchup statistics

**These two axes must be tracked independently.** Before declaring any data as "7.41f data":
- Audit the metadata of each dataset to confirm its actual source patch
- If the data is still 7.41e, do NOT silently rename it to 7.41f

**Temporary valid state for AP Ranked Roles V1 launch:**
- Ruleset mechanics: verified through 7.41f (update `verifiedThroughPatch`)
- Data snapshot: may still reflect 7.41e until a data refresh is performed
- When data is 7.41e and ruleset is 7.41f: the system MUST surface an explicit data-staleness indicator (e.g., `metaIsStale: true` in MetaSnapshot, already supported by V6) rather than claiming 7.41f data falsely

**`ProtocolSessionMetadata.patch`**: this is the data patch, not the ruleset patch. It should reflect the actual patch of the scoring data being used. Do not set it to "7.41f" until the data itself is verified as 7.41f.

---

## 21. Existing Components Reuse Plan

| Componente | Disposición | Qué cambia |
|---|---|---|
| `draft-protocol/kernel.ts` | **REUSE AS-IS** | Solo update `verifiedThroughPatch: "7.41f"` en `RANKED_ALL_PICK_IDENTITY` |
| `draft-protocol/types.ts` (`RankedApState`, `DraftProtocolState`) | **REUSE AS-IS** | Ninguno — tipos congelados son correctos |
| `draft-protocol/perspective.ts` / `project()` | **REUSE AS-IS** | Ninguno — barrera de información correcta |
| `RankedApRoundState` collision counter | **REUSE AS-IS** | Ninguno — semántica per-ronda correcta |
| `RANKED_ALL_PICK_IDENTITY` timers (25/25/20s) | **REUSE AS-IS** | Solo el update de `verifiedThroughPatch` |
| `draft-protocol/roles/role-belief.ts` / `computeRoleBelief` | **REUSE + EXTEND** | Conectar al pipeline de Coach para héroes enemigos revelados y propio Flex; construir `CoachObservableState.enemyRoleBeliefs` |
| `draft-protocol/rulesets/ranked-all-pick.ts` / `isSealedSelectionLegal` | **REUSE AS-IS** | Ninguno — disponibilidad simétrica correcta |
| `draft-protocol/adapters/simulator-authority.ts` / `resolveSimulatorCollisionAuthority` | **REUSE + PATCH** | Current implementation uses random PRNG (`mulberry32`) to pick winner — conflicts with product rule (first-registration-wins). Must be patched to use kernel event-log ordinal to determine which contender registered first. |
| `recommendation/build.ts` / `buildRecommendationSetV2` | **REUSE + EXTEND** | Generalizar `controlledRosterSlots` para 5 slots; separar `SOLO_MID_RECOMMENDATION_OUTPUT_LIMIT` en constante general; añadir capa `deriveRevealStrategy()` |
| V6 scoring engine (`signals/`, `SCORING_WEIGHTS_V6`) | **REUSE AS-IS** | Ninguno — no tocar weights ni señales |
| `hero-positions.json` | **REUSE AS-IS** | Ninguno |
| `hero-counters.json` | **REUSE AS-IS** | Ninguno |
| `intent/position-prior.ts` / `deriveFlexDistribution` | **REUSE AS-IS** | Ninguno — ya usado por `computeRoleBelief` |
| `simulator/solo-mid-policy.ts` / `deriveExternalDecisionSeed` | **REUSE + GENERALIZE** | Remover dependencia de `SOLO_MID_SIMULATOR_POLICY`; extraer como función pura con `(draftSeed, side, rosterSlot, decisionIndex)` |
| `simulator/solo-mid-policy.ts` / `chooseExternalSuggestion` | **REUSE + GENERALIZE** | Remover dependencia de `SOLO_MID_SIMULATOR_POLICY`; los parámetros `maxCandidates` y `qualityBandPoints` pasan a `EnemyBotConfig` |
| `server/protocol-session.ts` / `ProtocolSessionMetadata.humanPosition` | **REUSE + EXTEND** | Renombrar conceptualmente a `playerPersonalPosition`; eliminar guard `isSoloMidSimulatorMetadata` del flujo de autorización; generali  zar lógica de llenado |
| `draft-protocol/adapters/suggestion-bridge.ts` | **REUSE AS-IS** | Ninguno — puente hacia legacy DraftState para V6 sigue siendo el camino correcto |
| `recommendation/decision.ts` / `deriveLegalDecision` | **REUSE + PATCH** | Generalizar la dependencia en `rosterSlotForRoundSlot` para que no asuma la mapping fija de `SOLO_MID_SIMULATOR_POLICY.rosterPositions` |
| `simulator/solo-mid-policy.ts` / `SOLO_MID_SIMULATOR_POLICY` | **REPLACE** | Con `GeneralizedSimulatorPolicy` / `SimulatorSessionConfig` que soporta cualquier side, cualquier posición, y los 5 slots aliados |
| `recommendation/build.ts` / `SOLO_MID_RECOMMENDATION_OUTPUT_LIMIT` | **REPLACE** | Con `AP_RECOMMENDATION_OUTPUT_LIMIT` (constante general) |
| `simulator/solo-mid-policy.ts` / `isSoloMidSimulatorMetadata()` | **REPLACE** | Con `isApSimulatorMetadata()`: solo verifica `adapterKind === "simulator"` y `simulatorSeed !== null` |
| `simulator/solo-mid-policy.ts` / `rosterPositions` mapping | **REPLACE** | Con posición asignada por declaración del Player + inference; eliminar el mapeo fijo slot-ordinal → posición |
| `draft/reducer.ts` / `DraftState` / `applyDraftEvent` (legacy) | **FREEZE** | No nuevo trabajo aquí; continúa operando para tráfico legacy no migrado |
| `drafter/decision-context.ts` | **EXTEND** | Adaptar para recibir datos de `PerspectiveDraftView` (ownPicks count, revealedEnemyPicks count) en lugar de `DraftState` legacy |
| `web/features/random-draft-simulator/` | **FREEZE** | No es la fuente de verdad del nuevo Simulator; no modificar |

---

## 22. Migration / Compatibility Plan

### Call sites de SOLO_MID_SIMULATOR_POLICY

Los siguientes archivos referencian `SOLO_MID_SIMULATOR_POLICY` o `isSoloMidSimulatorMetadata` y deben actualizarse de forma coordinada:

1. **`simulator/solo-mid-policy.ts`**: fuente del policy — reemplazar la constante con el nuevo modelo. Mantener `rosterSlotForRoundSlot` (función pura útil), `participantForRoundSlot` (adaptar para no asumir `SOLO_MID_SIMULATOR_POLICY.rosterPositions`), `deriveExternalDecisionSeed` (generalizar), `chooseExternalSuggestion` (generalizar)
2. **`server/routes/protocol-sessions.ts`**: usa `isSoloMidSimulatorMetadata()` en la lógica de autorización de comandos y en la route de `APPLY_AUTHORITATIVE_COLLISION_RESOLUTION` → reemplazar con `isApSimulatorMetadata()`
3. **`server/protocol-session.ts`**: `ProtocolSessionStore.isCommandAuthorized()` y `authorizedLegalActions()` usan `isSoloMidSimulatorMetadata()` → reemplazar con `isApSimulatorMetadata()`
4. **`recommendation/decision.ts`**: `deriveLegalDecision()` importa `rosterSlotForRoundSlot` desde `solo-mid-policy.ts` → mantener la función, mover a un módulo más neutral o dejar en `solo-mid-policy.ts` como utilitario puro

### Compatibilidad con RecommendationSetV2

`RecommendationSetV2` sigue siendo el contrato interno del engine. `RecommendationOutputV3` es la capa de traducción para la UI — coexisten. No hay breaking change en el contrato del engine.

Si una feature existente consume `RecommendationSetV2` directamente (e.g., `web/features/draft/`), sigue funcionando sin cambios. `RecommendationOutputV3` es un nuevo endpoint de UI, no un reemplazo.

### Compatibilidad con legacy DraftState

El legacy `DraftState/applyDraftEvent/SessionStore` sigue operando para cualquier tráfico que aún no haya migrado. `protocol-session.ts` (nuevo path) es explícitamente distinto de `session.ts` (legacy). No hay trabajo nuevo en el legacy path.

### API endpoints

Los endpoints existentes de `/api/sessions/protocol` se extienden para el nuevo Simulator multi-slot. El `CreateProtocolSessionInput` ya acepta `partyContext` — se usa con `partySize: 5` y los 5 `controlledSlots`.

No se crea un namespace de API completamente nuevo salvo que la extensión requiera un nuevo recurso (ej: un endpoint dedicado para declarar `playerPersonalPosition` si no se puede pasar en la creación de sesión).

**Actualización PD-026 / PD-027 (2026-09-27).** Para una sesión AP Simulator: la creación envía
`controlledPositions` y un `partyContext` estructural `{ partySize, side, controlledSlots: [] }`
(Captains Mode y manual conservan su `partyContext` actual); el envío de un pick propio usa el sobre
`{ command, viewerSide, assignedPosition }` con `assignedPosition` como hermano del comando del kernel,
que no cambia; el auto-drive acepta un indicador para ceder la capacidad restante de la ronda al Ally Bot;
el snapshot puede exponer `ownAssignedPositions` sólo al lado propio. Sin ruta nueva ni cambio de la
allowlist del proxy.

### Update de verifiedThroughPatch

El cambio `"7.41e"` → `"7.41f"` en `RANKED_ALL_PICK_IDENTITY` impacta:
- Cualquier test que compare `ruleset.verifiedThroughPatch` contra un string literal
- El `rulesHash` de la identity (se recalcula automáticamente ya que usa `rulesHash({id, version, manifest})`)
- Tests de `basedOn.rulesHash` en recommendation tests (deben recalcular el hash esperado)

Este cambio debe hacerse en el mismo commit que actualice los tests afectados — no en dos commits separados.

### Orden recomendado de cambios (dentro de cada Wave)

Para minimizar regresiones en cada Wave:

1. Primero: escribir/actualizar tests para el nuevo comportamiento
2. Segundo: implementar el cambio que hace pasar los tests
3. Tercero: verificar que los tests existentes no regresaron

En particular, el reemplazo de `SOLO_MID_SIMULATOR_POLICY` debe ir acompañado de tests de simetría Radiant/Dire desde el primer día — el error histórico fue asumir Radiant sin tests que lo detectaran.

---

## 23. Testing Strategy

### Protocol / Kernel

| Test | Qué verifica |
|---|---|
| Round 1, collision evento #1 | Héroe disputado en `bannedHeroes`; ambos slots en `openSlots`; `collisionsResolved = 1` |
| Round 1, collision evento #2 (same round) | Segundo héroe baneado; `collisionsResolved = 2` |
| Round 1, collision evento #3 | `status = "WAITING_FOR_COLLISION_AUTHORITY"`; `pendingCollision` non-null |
| `APPLY_AUTHORITATIVE_COLLISION_RESOLUTION` | Ganador confirma pick; perdedor reabre slot; `status = "ACTIVE"` |
| `APPLY_AUTHORITATIVE_COLLISION_RESOLUTION` uses first-registration order | Contender with earlier kernel event-log ordinal retains the hero; later registrant re-picks — never a random draw |
| Start Round 2 after Round 1 collision | `collisionsResolved = 0` en la nueva `RankedApRoundState` |
| Hero baneado por colisión en Round 1 | No disponible en Round 2 (`isSealedSelectionLegal = false`) |
| Timer values en RANKED_ALL_PICK_IDENTITY | `ROUND_TIMER_MS = {1:25000, 2:25000, 3:20000}` |
| `verifiedThroughPatch` | Valor = "7.41f" post-update |

### Hidden Information Barrier

| Test | Qué verifica |
|---|---|
| `project(state, "radiant")` con Dire's Puck en `sealed` | `enemyPicks` contiene `{visibility:"HIDDEN"}`; sin campo `heroId` accesible |
| `project(state, "dire")` con Radiant's Lion en `sealed` | Simétrico al anterior |
| `hidden()` crea objetos distintos | Dos llamadas a `hidden()` retornan `!==` (no singleton) |
| `isSealedSelectionLegal(state, "radiant", 0, puck)` cuando Dire tiene Puck en `sealed` | Retorna `true` (Puck disponible para Radiant) |
| `isSealedSelectionLegal(state, "dire", 0, puck)` cuando Dire ya seleccionó Puck | Retorna `false` (`alreadySealedBySameSide`) |
| `buildRecommendationSetV2` con view con enemy HIDDEN picks | Ningún HIDDEN heroId aparece en `recommendations` ni en `evidence` |
| Pipeline de Coach no accede a `DraftProtocolState` directamente | `architecture-guard.test.ts` (ya existe, verificar sigue siendo válido) |
| Roster UI enemiga (PD-027 punto 5) | Un héroe enemigo nunca se etiqueta desde cronología ni desde `internalPositionAssignments`; el rol mostrado coincide con `RoleBelief` o no se muestra |
| Ninguna proyección / snapshot / DOM contiene `internalPositionAssignments` | Ausente en todas las superficies visibles al Player |

### Player Personal Position

| Test | Qué verifica |
|---|---|
| Position declarada ≠ pick timing — Pick Carry en Round 1 | `isSealedSelectionLegal` acepta el pick en Round 1 independientemente de `playerPersonalPosition` |
| Pick Mid (position=2) en Round 1 | Aceptado sin warnings ni bloqueos |
| `playerPersonalPosition = null` | Simulator crea sesión; `personalHeroView` ausente en RecommendationOutputV3 |
| `playerPersonalPosition = 3` + hero pool configurado para Pos3 | `personalHeroView.positionLabel = "TU OFFLANER AHORA"` y heroes filtrados por pool Pos3 |
| Party 5: Pos2 en Round 1 y Pos5 en Round 3 (PD-027) | Cada pick queda ligado a la posición elegida, no a la ronda; etiquetas Pos2 / Pos5 |
| Solo con Pos2: sellar en Round 1 (PD-026, PD-027) | Aceptado; el Ally Bot no sella antes de que el humano actúe o ceda la ronda |
| Misma seed, dos corridas (Ally Bot) | Mismo orden de posiciones del Ally Bot (determinismo) |
| Pick fuera de rol de un humano (PD-003, PD-027 punto 6) | Sin bloqueo ni advertencia; el Coach razona desde la posición elegida |
| Hero-for-PosN del Coach (PD-027 punto 7) | Todo héroe recomendado para una PosN cumple la credibilidad posicional canónica |

### Ban Resolution

| Test | Qué verifica |
|---|---|
| Same preferences + same seed | `BanResolutionPolicy.resolve()` retorna mismo array |
| Different seeds | Resultados significativamente distintos |
| Player con 4 prefs llenas | Al menos 1 de sus preferidos en `resolvedBans` |
| Héroe baneado duplicado en preferencias de distintos jugadores | Aparece una sola vez en `resolvedBans` |
| Banes recibidos por el Coach | Solo el array final de `resolvedBans`; no preferencias individuales |

### Enemy Bot

| Test | Qué verifica |
|---|---|
| Same seed → same decisions | `chooseExternalSuggestion` con mismo seed y mismo estado retorna mismo heroId |
| Different seeds → variation | Resultados distintos para al menos un pick |
| Enemy Bot selections respetar posición | No crea composiciones con 5 cores (position_fit penaliza) |
| Enemy Bot respects internalPositionAssignments | All five Enemy Bot picks are valid heroes for their internally assigned position per `hero-positions.json` evidence |
| Enemy Bot no conoce hidden Own Team picks | `isSealedSelectionLegal(state, enemySide, slot, sameHeroAsPlayer)` retorna true hasta resolución |

### Recommendation

| Test | Qué verifica |
|---|---|
| Recalculate after own pick confirmed | Nuevo `RecommendationOutputV3` con `basedOn.stateIdentity` diferente |
| Recalculate after round reveal | Nuevo recommendation incorpora nuevos enemy REVEALED heroes |
| Hero Pool solo afecta slot personal | `hero_pool_fit signal applicable = false` para slots de otras posiciones |
| "Best outside your pool" condicional | Solo aparece cuando pool configurado Y top global fuera del pool |
| Role-only recommendation válida | `primaryAction.strategy` puede ser `REVEAL_SUPPORT_EARLY` sin `heroId` forzado |

### Flex Handling

| Test | Qué verifica |
|---|---|
| Own Flex sin asignación | `RoleBelief.status = "LIKELY"` o `"UNRESOLVED"`; slot aparece como FLEX en view |
| Player asigna posición a Own Flex | `computeRoleBelief({confirmedPosition: X})` → `CONFIRMED`; slot ya no es FLEX |
| Enemy Flex sin asignación | `enemyRoleBeliefs` retiene múltiples posiciones; no auto-resuelve |
| Player asigna posición a enemy hero | `computeRoleBelief` con `confirmedPosition` → CONFIRMED; Coach recalcula |

### Side Symmetry

| Test | Qué verifica |
|---|---|
| Draft desde Dire side | `project(state, "dire")` retorna `ownPicks` correctos para Dire |
| `isApSimulatorMetadata()` para Dire | Retorna `true` (ya no verifica side = "radiant") |
| Recommendation con Dire side | No asume Radiant; `basedOn.perspectiveIdentity` incluye "dire" |
| Collision authority desde Dire | `resolveSimulatorCollisionAuthority` funciona desde cualquier side |

### Patch

| Test | Qué verifica |
|---|---|
| `RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch` | `"7.41f"` |
| `basedOn.patch` en RecommendationBasedOn | Valor del `metadata.patch` de la sesión, no hardcodeado |
| Sesión con `patch: "7.41f"` | `basedOn.patch = "7.41f"` en recommendation output |

---

## 24. E2E / Manual Acceptance Strategy

### Objetivo de aceptación humana

Un jugador humano debe poder completar un draft completo (Ronda 1 → Ronda 3) desde cualquier side y sentir que la experiencia se parece al Ranked Roles All Pick real de Dota 2.

### Escenarios clave de QA manual

1. **Carry en Ronda 1**: Player selecciona un Carry (Pos1) en Round 1. El Simulator acepta sin warnings. El Coach no penaliza la selección.
2. **Mid en Ronda 1**: Player selecciona Mid en Round 1. Aceptado. No hay indicador de "pick temprano".
3. **Dire side completo**: Player selecciona Dire. El draft funciona igual que con Radiant. Los enemigos son Radiant. Las recomendaciones son coherentes.
4. **Colisión Player + Enemy Bot**: Player y Enemy Bot seleccionan el mismo héroe en la misma ronda. El Simulator detecta la colisión, banea el héroe, y reabre los slots. Ambos deben re-seleccionar.
5. **Ban preferences influyen**: Player configura 4 bans. Al menos 1 aparece en el set de baneados. El Coach adapta sus recomendaciones al estado de banes.
6. **Hero Pool configurado**: Player declara Pos2 como posición personal y configura pool para Mid. El Coach prioriza héroes del pool en las recomendaciones del slot Mid. El panel "TU MID AHORA" aparece.
7. **Recomendación recalcula**: Player confirma un pick aliado. La recomendación cambia visiblemente (nuevo `basedOn.stateIdentity`).
8. **Enemy Puck disponible en ronda ciega**: Enemy Bot internamente selecciona Puck en Round 1. Puck sigue apareciendo como disponible para el Player hasta el reveal de la ronda.
9. **Flex enemy hero**: Enemy Bot pica un Flex Hero (ej: Rubick). El Coach muestra "Likely Pos4 / Possible Pos5" en lugar de forzar una posición.
10. **Player asigna posición enemy**: Player clickea en un héroe enemigo y asigna posición manualmente. El Coach recalcula usando esa asignación.

### Playwright E2E (post Wave 1)

- Happy path completo de un draft: desde PRE_DRAFT hasta COMPLETE, incluyendo ban phase, 3 rondas, reveal por ronda
- Desde Radiant y desde Dire (dos tests separados para simetría)
- Verificar que Puck sigue disponible para Own Team durante la ronda ciega del Enemy Bot
- Verificar que el recommendation se actualiza (DOM change) después de cada pick confirmado

**No certificar AP Ranked Roles V1 con solo unit tests**. La historia del recovery build muestra que las asunciones de side (Radiant hardcodeado) pasaron los unit tests existentes. Los tests de integración y el QA manual son capas de verificación adicionales críticas.

### Performance

Verificar `computedInMs` del engine de recomendación < 300ms p95 en el hardware objetivo (Req 8 + SPEC §4 performance budget). El criterio es medible: `RecommendationBasedOn.evidenceVersion` ya incluye un timestamp de cuando se computó.

---

## 25. Risks / Unknowns / Deferred Intelligence

### Riesgos técnicos

**R1 — Generalizar rosterSlotForRoundSlot sin romper RecommendationSetV2**

`decision.ts` usa `rosterSlotForRoundSlot` de `solo-mid-policy.ts` para determinar los controlled slots. La función en sí es pura y correcta. El riesgo está en que la lógica de `deriveLegalDecision` asume que el mapping slot-to-position es el del recovery build. Al generalizar para 5 slots controlados, hay que verificar que `RecommendationSetV2.decision.controlledSlots` se popula correctamente para todos los slots.

*Mitigación*: extender los tests de `decision.ts` antes de cambiar la implementación.

**R2 — SOLO_MID_SIMULATOR_POLICY tiene muchos call sites**

La constante está importada en múltiples archivos del server y del recommendation pipeline. Un cambio incompleto puede dejar algunos call sites apuntando al comportamiento viejo.

*Mitigación*: hacer un grep exhaustivo de los import sites antes de iniciar el reemplazo. Cambiar en un solo commit con todos los call sites actualizados.

**R3 — deriveDecisionContext usa DraftState legacy**

La función `deriveDecisionContext` en `decision-context.ts` lee `observedDraftFacts(state)` que depende de `DraftState.localSide` del legacy reducer. Adaptarla a `PerspectiveDraftView` requiere un puente o refactor del módulo.

*Mitigación*: crear una función paralela `deriveDecisionContextFromView(view: PerspectiveDraftView)` que replique la lógica usando los campos equivalentes de la view, sin tocar la función original (que sigue siendo usada por el legacy path).

**R4 — verifiedThroughPatch update rompe tests que verifican rulesHash**

El campo `rulesHash` de `RANKED_ALL_PICK_IDENTITY` se recalcula desde `{id, version, manifest}`. Si `verifiedThroughPatch` no forma parte del hash input, el hash no cambia. Pero hay que verificar exactamente qué campos van en `rulesHash()` para no introducir un mismatch silencioso.

*Mitigación*: leer `identity-hash.ts` y `rulesHash()` para confirmar qué campos incluye antes de actualizar el patch.

### Unknowns

- **Threshold de Flex display**: cuántos bits de entropy de `RoleBelief` constituyen "es un Flex" para el display (Req 13.1, Req 18.1). A determinar en QA con héroes de posición bien definida y héroes genuinamente flex.
- **Threshold de "Best outside your pool"**: qué diferencia de score V6 entre el top global y el mejor del pool justifica mostrar la sección. A determinar en QA.
- **Shortlist size exacta**: el rango es 3-5 héroes. El número exacto que se muestra en cada estado del draft se define en QA visual.
- **Safe Core threshold**: la combinación de señales para `isSafeWindow = true`. A calibrar con QA en escenarios reales.

### Deferred — Future Intelligence

Las siguientes capacidades están explícitamente fuera del alcance de AP Ranked Roles V1 MVP:

| Capacidad | Razón de deferral |
|---|---|
| Deep win condition inference (teamfight/push/scaling) | Requiere composition modeling y training data (Req 14 Future Intelligence) |
| Full composition needs modeling | Dependiente de ML/Bayesian post-MVP |
| Bracket-granular recommendations | Requiere player bracket data integration |
| ML/Bayesian inference más allá del scoring actual | Cambio de arquitectura, wave futura |
| Side-specific deep win-rate statistics (Radiant vs. Dire differential profundo) | Pipeline de datos más rico (Req 17 Future Intelligence) |
| Post-draft gameplan (itemización, timings) | Feature separada |
| GSI/OCR live integration | Capa de hardware/OS, no en scope |
| Player proficiency models (auto-learned) | Requiere datos longitudinales |
| Automatic personal learning / feedback loop | Feature de producto separada |
| Pick-rate analysis formal para Safe Core | Requiere distribución de composiciones enemigas (Req 16 Future Intelligence) |
| Playwright E2E full draft | Post Wave 1 MVP |

---

## 26. Proposed Implementation Waves

Alto nivel únicamente. Las tasks concretas se definen en `tasks.md`.

### Wave 1 — Simulator Fidelity Core

El objetivo de Wave 1 es tener un draft completo reproducible con fidelidad de mecánicas.

**Cambios principales**:
- Reemplazar `SOLO_MID_SIMULATOR_POLICY` con `SimulatorSessionConfig` generalizado (5 slots aliados, cualquier side, cualquier posición personal)
- Implementar Player Personal Position: declaración en PRE_DRAFT, almacenamiento en `ProtocolSessionMetadata.humanPosition`, conexión a Hero Pool
- Ban Phase: `BanResolutionPolicy` con garantías observables, UI de configuración de preferences, integración con kernel (`RECORD_RESOLVED_BANS + BAN_RESOLUTION_COMPLETE`)
- Enemy Bot generalizado: desacoplar `chooseExternalSuggestion` y `deriveExternalDecisionSeed` de `SOLO_MID_SIMULATOR_POLICY`, soporte para cualquier side
- Actualizar `verifiedThroughPatch: "7.41f"` + tests afectados
- Tests de disponibilidad simétrica: verificar que hidden enemy picks no bloquean Own Team availability y vice-versa
- `isApSimulatorMetadata()` reemplazando `isSoloMidSimulatorMetadata()`

**Criterio de aceptación de Wave 1**:
> 1. Un draft completo (ban phase → Round 1 → Round 2 → Round 3 → COMPLETE) es reproducible desde Radiant Y desde Dire con un draft real del Player.
> 2. El Player controla los 5 slots aliados; la posición personal es declarada antes de empezar.
> 3. Las mecánicas de colisión funcionan correctamente (unit tests verdes).
> 4. **Browser smoke check manual**: al menos un draft completo jugado en el navegador real desde Radiant y uno desde Dire, verificado por el Product Owner. Wave 1 no se cierra solo con unit/integration tests.

### Wave 2 — Coach Orchestration

El objetivo de Wave 2 es tener el Coach activo y recalculando recomendaciones en respuesta al draft.

**Cambios principales**:
- Orquestación de recompute: triggers en `onOwnPickConfirmed`, `onRoundReveal`, `onPlayerPositionAssigned`
- `deriveRevealStrategy()`: capa Level 1 sobre `buildRecommendationSetV2`
- `RecommendationOutputV3`: nuevo contrato + `translateToRecommendationOutputV3()`
- Support-first prior integrado en `deriveRevealStrategy` para `team_opening` y `blind_second_pick`
- "YOUR [POSITION] NOW" panel en la UI
- Hero Pool scoping a `playerPersonalPosition`
- Adaptar `deriveDecisionContext` para leer desde `PerspectiveDraftView`

**Criterio de aceptación de Wave 2**: el Coach produce una recomendación al inicio del draft, la recalcula después de cada pick aliado y reveal de ronda, y el panel personal del Player aparece cuando la posición fue declarada.

### Wave 3 — Role Uncertainty + Flex

El objetivo de Wave 3 es representar honestamente la ambigüedad de posición en el draft.

**Cambios principales**:
- Conectar `computeRoleBelief` al pipeline de Coach para héroes enemigos revelados: construir `CoachObservableState.enemyRoleBeliefs`
- Display "FLEX 3/4" para propios Flex heroes en UI
- Control de asignación de posición para el Player (propio y enemigo)
- Representación de enemy Flex: "Likely Pos3 / Possible Pos2" en la UI
- "Best outside your pool" sección con threshold calibrado en QA
- `occupiedPositions` inference para structural constraints en RoleBelief

**Criterio de aceptación de Wave 3**: un Flex Hero propio aparece como "FLEX 3/4" hasta que el Player lo asigna; un Flex Hero enemigo revelado muestra múltiples posiciones probables en lugar de una sola.

### Wave 4 — Contextual Intelligence

El objetivo de Wave 4 es añadir señales estratégicas de alto nivel.

**Cambios principales**:
- `detectSafeCoreWindow()`: función que combina `counter` signal, hard counters baneados, `patch_meta` y `position_fit`
- `opportunity` block en `RecommendationOutputV3` poblado desde Safe Core signal
- One-ply lookahead integration: `opponentResponse` y `steal` evaluation en `RecommendationSetV2.deferred` (ya implementado en el engine — solo wiring al nuevo output)
- Side context como tiebreaker explícito cuando hay evidencia estadística confiable en patchStats

**Criterio de aceptación de Wave 4**: cuando los hard counters de un Carry están mayormente baneados, el Coach muestra un bloque "Ventana Early Carry" en la UI. El output de one-ply lookahead es visible en la evidencia de la recomendación cuando está disponible.

### Wave 5 — Product Certification

El objetivo de Wave 5 es certificar el producto completo.

**Cambios principales**:
- Playwright E2E: happy path completo de un draft desde Radiant Y desde Dire
- QA manual: todos los 10 escenarios de §24
- Calibración de thresholds: Flex entropy cutoff, pool break threshold, shortlist size exacta, Safe Core threshold
- Performance verification: `computedInMs < 300ms` p95 bajo carga de draft real

> *Fuente del budget de 300ms p95: `SPEC.md §4` y `invariantes.md` del proyecto ("Motor de sugerencias: ≤ 300 ms, corte duro 500 ms"). Este threshold proviene de una fuente autoritativa del repo y se cita aquí por referencia — no es un valor inventado en este diseño.*
- Ajustes de UX post-QA: badges, labels, layout de shortlist

**Criterio de aceptación de Wave 5**: los 10 escenarios de QA manual pasan. Playwright E2E pasa desde ambos sides. Performance budget cumplido. Ningún hardcode de Radiant o posición Mid detectado en tests.

---

## Referencias Cruzadas

| Sección | Conecta con |
|---|---|
| §4 Domain Model | §5 Draft State Boundaries, §16 Recommendation Architecture, §17 Output Contract |
| §5 State Boundaries | §7 Hidden Information Architecture, §12 Enemy Bot Architecture, §15 Hero Availability |
| §6 State Machine | §8 Ban Resolution Policy, §9 Collision State Machine |
| §8 Ban Resolution | §6 State Machine (BAN_CONFIGURATION → BAN_RESOLUTION) |
| §9 Collision | §6 State Machine (WAITING_FOR_COLLISION_AUTHORITY) |
| §10 Player Personal Position | §11 Own Team Control, §18 Hero Pool Integration, §17 Output Contract (personalHeroView) |
| §11 Own Team Control | §21 Reuse Plan (SOLO_MID_SIMULATOR_POLICY → REPLACE) |
| §12 Enemy Bot | §7 Hidden Information, §15 Hero Availability |
| §13 Enemy Role Inference | §14 Flex Resolution, §16 Recommendation Architecture |
| §16 Recommendation Architecture | §17 Output Contract, §18 Hero Pool Integration, §19 Safe Core |
| §21 Reuse Plan | §22 Migration Plan, §26 Implementation Waves |
| §23 Testing Strategy | §24 E2E Acceptance, §25 Risks |

## Correctness Properties

Las propiedades de correctness centrales del sistema son verificables mediante tests y QA manual.

### Property 1: Hidden Information Isolation

**Validates: Requirements 12.1, 12.2, 12.4**

Ningún `heroId` de un pick enemigo sellado llega al pipeline del Coach antes del reveal de ronda. `project(state, side)` produce `{visibility:"HIDDEN"}` sin campo `heroId` para picks sellados del lado opuesto. Verificable: TypeScript impide acceso a `.heroId` en el caso HIDDEN por tipo; test runtime confirma que `enemyPicks` solo contiene HIDDEN antes del reveal de ronda.

### Property 2: Symmetric Availability

**Validates: Requirements 20.1, 20.2, 20.5**

Un héroe seleccionado internamente por el Enemy Bot en una ronda ciega NO desaparece del pool disponible del Player hasta el reveal. Y viceversa. Verificable: `isSealedSelectionLegal(state, playerSide, slot, heroId)` retorna `true` cuando ese heroId está en `sealed` del lado enemigo en la ronda actual.

### Property 3: Collision Counter Per-Round

**Validates: Requirements 1.5, 1.6**

El contador `collisionsResolved` en `RankedApRoundState` es por ronda, no por heroId. Resetea a 0 al iniciar cada nueva ronda via `createRoundState()`. Verificable: después de una colisión en Round 1 y al iniciar Round 2, `collisionsResolved === 0`.

### Property 4: Position Does Not Constrain Pick Order

**Validates: Requirements 19.1, 19.4**

El kernel acepta `SUBMIT_SEALED_SELECTION` para cualquier slot en cualquier ronda, sin relación con la posición personal declarada del Player. Verificable: pick de Carry (Pos1) en Round 1 es aceptado cuando `playerPersonalPosition = 1`.

### Property 5: Deterministic Simulator

**Validates: Requirements 6.4**

`BanResolutionPolicy.resolve(same_prefs, same_seed)` y `chooseExternalSuggestion(same_suggestions, same_seed)` producen el mismo resultado. Verificable: correr el mismo draft dos veces con el mismo seed produce resultado byte-idéntico.

### Property 6: Hero Pool Scoping

**Validates: Requirements 11.1, 11.6**

`hero_pool_fit` signal tiene `applicable: true` únicamente para el slot personal del Player. Para los otros 4 slots aliados es `applicable: false`. Verificable: signal breakdown de un slot no-personal muestra `applicable === false` para `hero_pool_fit`.

### Property 7: Ban Guarantee

**Validates: Requirements 2.3, 2.4**

Un Player con 4 preferencias completas tiene al menos 1 héroe baneado en el draft. Verificable: `BanResolutionPolicy.resolve` con 4 preferencias llenas incluye al menos 1 heroId de las preferencias del Player en el set de baneados.

## Error Handling

Los errores del sistema siguen el principio fail-closed: nunca silencioso, nunca corrompe estado.

- **Kernel rejection**: un comando rechazado por `applyProtocolCommand` retorna `{rejected: RejectionReasonV2}` con el estado anterior intacto. Nunca lanza excepción, nunca muta el estado.
- **Hidden picks leakage**: si `project()` produce `{visibility:"HIDDEN"}`, acceder a `.heroId` falla en tiempo de compilación TypeScript. Es imposible por tipo — no hay error de runtime que manejar.
- **Collision authority**: colisión 3+ pone el kernel en `WAITING_FOR_COLLISION_AUTHORITY`. Rechaza todo comando hasta recibir `APPLY_AUTHORITATIVE_COLLISION_RESOLUTION`. El Simulator actúa como authority determinística.
- **Ban resolution failure**: `BanResolutionPolicy` failure is fail-closed. The session does NOT advance to picks. The session returns to BAN_CONFIGURATION with an error message and offers retry. An empty ban set is only valid if the ban policy legitimately produces zero bans (all preference slots empty, all drawn slots empty). A policy crash or invalid output never silently advances the draft.
- **`computeRoleBelief` sin evidencia**: retorna `{status: "UNRESOLVED", probabilities: UNIFORM, entropy: log2(5)}`. Nunca lanza, nunca fabrica certeza falsa.
- **`hero_pool_fit` con pool vacío**: `applicable: false` en el signal contribution. La señal no vota en el scoring. No lanza.
- **Patch data no disponible**: `patch_meta` retorna `raw: null`. La señal queda fuera del scoring con redistribución proporcional de su peso — invariante del motor V6.

## Testing Strategy

La estrategia de testing completa está detallada en **§23 Testing Strategy** con aproximadamente 40 test cases específicos cubriendo: protocol/kernel, hidden information barrier, Player personal position, ban resolution determinism, Enemy Bot behavior, recommendation recomputation, Flex handling, side symmetry, y patch identity.

Principios guía:

- **No certificar AP Ranked Roles V1 solo con unit tests.** La historia del recovery build demuestra que asunciones de hardcode (Radiant, Mid, last-pick) pueden pasar todos los unit tests mientras el producto falla en QA manual.
- **Tests de simetría Radiant/Dire son obligatorios desde Wave 1.** El error histórico fue no tener tests que detectaran `humanSide: "radiant"` hardcodeado.
- **Tests de hidden availability symmetry** — que Puck siga disponible para Own Team cuando Enemy Bot lo tiene en `sealed` — deben existir antes de cualquier merge de Wave 1.
- **Playwright E2E** (happy path completo desde ambos sides) está programado para Wave 5 como criterio de aceptación final del producto.
