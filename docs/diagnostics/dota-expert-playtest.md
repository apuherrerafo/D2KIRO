# D2KIRO Dota Expert Playtest

Fecha de ejecución: 2026-09-17  
Rama: `r1/product-certification`  
Commit: `d5d233c7d75cfd971cd5ca99139e573acc6c1799`  
Veredicto: **NOT_USABLE**

## Resumen ejecutivo

D2KIRO contiene un motor que sí puede reaccionar a información de Dota: frente a Phantom Lancer,
Huskar y Medusa cambió a respuestas diferenciadas y razonables. Pero el producto que el jugador
usa no entrega al motor varios inputs que promete, y sus dos rivales simulados no draftean como
rivales de Dota.

Los bloqueantes reproducidos son:

1. `playerPosition` no llega a `RecommendationSet/v2`. Pos 1 (carry) a Pos 5 (hard support)
   producen exactamente el mismo ranking y Crystal Maiden Pos 5 lidera en todas.
2. `archetypeIntent` tampoco llega. `none`, `push`, `teamfight`, `pickoff` y `scaling` son
   funcionalmente idénticos en el producto.
3. El bot AP ejecuta esencialmente el mismo Top1 V6 que el Copilot. En estados simétricos produjo
   Crystal Maiden contra Crystal Maiden y `Conflict_Ban` en **10/10** pruebas.
4. El bot de Captain's Mode usa literalmente `lowestEligibleHeroIdStrategy`. Completó FIRST y
   SECOND siguiendo el ID elegible más bajo, no un draft.

La queja del owner quedó reproducida y cuantificada: Crystal Maiden fue Top1 en **50/50** aperturas
del matrix posición×seed y en **10/10** aperturas adicionales con bans variables. El problema no es
solo cosmético ni una opinión sobre el meta: son inputs desconectados y políticas rivales
deterministas demostradas por source y runtime.

## Método y límites

La batería usó el pipeline real:

`ban resolution del producto → HTTP ProtocolSession → ProtocolKernel → buildSuggestions V6 real → RecommendationSet/v2`

- No se mockeó `RecommendationSet`.
- El proceso que ya estaba activo era `apps/engine/src/index.e2e.ts`, sobre la SQLite real de
  desarrollo. Usa el mismo `createApp` y pipeline; su única diferencia relevante es habilitar la
  seam `forcedHeroId`.
- `forcedHeroId` se usó solamente para construir los cinco estados controlados de sensibilidad a
  enemy pick. No se usó en apertura, collisions, drafts AP completos ni bot CM.
- `RecommendationSet/v2` expone cinco recomendaciones (`RECOMMENDATION_OUTPUT_LIMIT=5`), aunque
  `buildSuggestions` calcule seis. Para preservar el pipeline de producto, las matrices V2
  registran Top5. Los controles directos de `/api/suggestions/preview` sí registran Top6.
- Las labels `EXCELLENT / ACCEPTABLE / BAD` son **AI DIAGNOSTIC ONLY**. No son Human Golden.
- Los casos estructurados, señales, estados, responses, steal y roleImpact están en
  `docs/diagnostics/dota-expert-cases.json`.

Total analizado: **168 decision points**: 144 outputs reales de recomendación y 24 acciones del
bot CM. Incluye 50 aperturas, 5 drafts AP Solo completos y 2 drafts CM completos.

## Verdad del runtime y de los datos

| Dimensión | Estado real |
|---|---|
| Patch efectivo | `7.41e`, tanto en sesión como en las 1,016 filas de `hero_patch_stats` |
| Frescura | Sync `ok` a `2026-09-17T05:11:18.915Z`; `isStale=false` |
| Héroes | 127 |
| Patch stats | 127/127 héroes, 8 brackets por héroe |
| Posiciones | 126/127 héroes, 238 entradas; falta Chen |
| Matchups estadísticos | **No disponibles**: 0 filas en `hero_matchups` |
| Counters curados | Disponibles: 127 víctimas, 528 aristas |
| Hero pool personal | **No disponible**: 0 cuentas/0 entradas; V2 usa `accountId=null` y `teamOpening=true` |
| Evidencia pro | Corpus de 502 filas disponible en disco, **no conectado** a RecommendationSet/v2 |
| Capacidades | 124 héroes disponibles para synergy/archetype/opening strategy |

### Señales que realmente votaron

En apertura Solo:

- `position_fit`: activa y dominante.
- `counter`: activa únicamente por counters curados que aparecen entre los bans; no había
  matchups estadísticos.
- `patch_meta`: trae `raw` real y muestra una explicación, pero `weighted=0` porque
  `dataReady("patch_meta")` devuelve `false` de forma incondicional.
- `team_synergy`: `raw:null` porque todavía no hay picks propios.
- `archetype_fit`: `raw:null`, `applicable:false`; la intención no llega.
- `hero_pool_fit`: excluida por `teamOpening=true`.

Después de revelar picks, `team_synergy` sí entra y `counter` responde a counters curados. Esto
explica por qué la sensibilidad a enemy picks puede funcionar aunque la apertura sea repetitiva.

## Matriz de apertura

Configuración primaria: Ranked AP Solo, personal ban list vacía, 10 seeds, Pos 1 (carry) a Pos 5
(hard support).

| Métrica | Resultado |
|---|---:|
| Estados | 50 |
| Top1 unique count | 1 |
| Top1 unique rate | 2.0% |
| Aperturas con el mismo Top1 | 100% |
| Héroes únicos dentro de Top3 | 3 |
| Ordenamientos Top3 distintos | 1 |
| Rankings Top5 distintos | 1 |

Top5 en los 50 estados:

1. Crystal Maiden
2. Pugna
3. Clockwerk
4. Dazzle
5. Tusk

Frecuencia Top1: Crystal Maiden **50/50**. Cada uno de Crystal Maiden, Pugna y Clockwerk apareció
en el Top3 **50/50**.

Con cuatro personal bans que sí cambiaron los 16 bans según seed, el orden inferior se movió, pero
Crystal Maiden siguió Top1 **10/10**. Por tanto, la repetición no se explica solo porque los bans
por defecto sean iguales.

## Sensibilidad

### Posición: FAIL

Producto V2, mismo estado:

| Posición elegida | Top5 |
|---|---|
| Pos 1 (carry) | Crystal Maiden, Clockwerk, Pugna, Dazzle, Tusk |
| Pos 2 (midlane) | Crystal Maiden, Clockwerk, Pugna, Dazzle, Tusk |
| Pos 3 (offlane) | Crystal Maiden, Clockwerk, Pugna, Dazzle, Tusk |
| Pos 4 (support) | Crystal Maiden, Clockwerk, Pugna, Dazzle, Tusk |
| Pos 5 (hard support) | Crystal Maiden, Clockwerk, Pugna, Dazzle, Tusk |

Los arrays completos —héroes, scores, signals y roleImpact— fueron idénticos.

Control del motor por `/api/suggestions/preview`, entregando el input que V2 pierde:

| Posición | Top3 del control |
|---|---|
| Pos 1 (carry) | Weaver, Gyrocopter, Io |
| Pos 2 (midlane) | Skywrath Mage, Zeus, Phoenix |
| Pos 3 (offlane) | Winter Wyvern, Undying, Phoenix |
| Pos 4 (support) | Crystal Maiden, Clockwerk, Pugna |
| Pos 5 (hard support) | Crystal Maiden, Clockwerk, Pugna |

El control produjo cinco rankings distintos. El motor tiene una ruta sensible a posición; el
producto V2 no la usa.

### Intención: FAIL

Producto V2: `none`, `push`, `teamfight`, `pickoff` y `scaling` devolvieron exactamente el mismo
Top5 y los mismos scores.

Control del motor:

- `none`: Crystal Maiden Top1.
- `push`: Pugna Top1.
- `teamfight`: cambió el Top6.
- `pickoff`: Tusk y Disruptor subieron.
- `scaling`: cambió el Top6.

Los cinco controles produjeron arrays distintos. La señal funciona; el control de producto está
desconectado.

### Enemy pick: PASS

Estado fijo: propios Juggernaut + Tusk; segundo rival fijo Crystal Maiden; cambia solo el primer
rival.

| Rival variable | Top recommendation conjunta | Score | Lectura Dota |
|---|---|---:|---|
| Phantom Lancer | Leshrac + Underlord | 157.37 | Buena respuesta de AoE/clear y frontline |
| Storm Spirit | Leshrac + Kunkka | 141.37 | Cambia el par; el counter directo a Storm es débil por falta de matchup data |
| Tidehunter | Leshrac + Timbersaw | 141.56 | Cambia el par y el perfil de daño/durabilidad |
| Huskar | Viper + Leshrac | 152.04 | Viper registra `counter.raw=0.12`, respuesta clara |
| Medusa | Outworld Destroyer + Kunkka | 146.90 | OD registra `counter.raw=0.12`, respuesta clara |

Veredicto experto: el motor no está totalmente sordo al contexto. Huskar y Medusa generan cambios
materiales y Dota-plausible. El límite es que esta batería dependió de counters curados porque la
tabla estadística estaba vacía.

## Autopsia: por qué gana Crystal Maiden

Estado: apertura Solo, bans por defecto, Pos 1 (carry) elegida en UI.

| Hero | position_fit | counter | patch_meta | team_synergy | archetype_fit | Score |
|---|---:|---:|---:|---:|---:|---:|
| Crystal Maiden | raw 1 / 77.576 | raw 0.06 / 36.747 | raw 0.5217 / **0** | null / 0 | null / 0 | **114.323** |
| Clockwerk | raw 1 / 73.505 | raw 0.06 / 34.818 | raw 0.4724 / **0** | null / 0 | null / 0 | 108.323 |
| Pugna | raw 1 / 69.735 | raw 0.04 / 29.362 | raw 0.4951 / **0** | null / 0 | null / 0 | 99.097 |
| Dazzle | raw 1 / 69.735 | raw 0.04 / 29.362 | raw 0.5063 / **0** | null / 0 | null / 0 | 99.097 |
| Tusk | raw 1 / 69.735 | raw 0.04 / 29.362 | raw 0.4670 / **0** | null / 0 | null / 0 | 99.097 |

Los números después de `/` son contribuciones finales tras el reescalado de `teamOpening`.
Crystal Maiden gana porque:

1. `position_fit.raw=1` la trata como flex segura de apertura, igual que otras supports.
2. Tres counters curados aparecen entre los bans por defecto: Juggernaut, Rubick y Pudge. El
   alivio de apertura le da seis puntos más que Clockwerk.
3. El 52.2% de winrate real del parche, sobre 277,664 picks, se calcula y se muestra pero aporta
   exactamente cero.
4. La Pos 1 seleccionada, la intención, el pool personal, matchups estadísticos y evidencia pro no
   participan.

Clasificación de causa: **J, combinación de A+B+C+G+H+I**. No es principalmente un problema que se
deba corregir cambiando weights.

## AP enemy bot realism: FAIL

En 10 openings con bans variables:

- Top1 humano: Crystal Maiden, 10/10.
- `opponentResponse` predicho: Crystal Maiden, 10/10.
- Selección real del bot: Crystal Maiden, 10/10.
- Resultado: Crystal Maiden añadida a `Conflict_Ban`, 10/10.

Collision rate: **100%**.

La ruta rival proyecta el estado desde Dire, llama al mismo `computeSuggestions` y toma la primera
sugerencia disponible. En una apertura simétrica y sin seed, la igualdad de Top1 es estructural,
no mala suerte.

## Full drafts AP Solo

Los cinco drafts se iniciaron lógicamente como Pos 1 (carry). Esa posición queda fuera del
request, que es precisamente el hallazgo.

| Draft | Decisión | Estado resumido | Top1 | Score | Label |
|---|---:|---|---|---:|---|
| D2K00001 | 1 | Apertura | Crystal Maiden Pos 5 | 114.32 | BAD — role mismatch |
|  | 2 | Clockwerk vs Tiny | Kunkka Pos 3 | 69.37 | BAD — role mismatch |
|  | 3 | Clockwerk+Kunkka vs Tiny+Dazzle | Troll Warlord Pos 1 | 72.02 | ACCEPTABLE |
|  | 4 | +Troll+Naga vs +Centaur+Puck | Huskar sin rol | 59.37 | BAD — farm distribution |
| D2K00002 | 1 | Apertura | Crystal Maiden Pos 5 | 114.32 | BAD — role mismatch |
|  | 2 | Clockwerk vs Kunkka | Timbersaw Pos 3 | 69.75 | BAD — role mismatch |
|  | 3 | Clockwerk+Timber vs Kunkka+Pugna | Anti-Mage Pos 1 | 75.07 | ACCEPTABLE |
|  | 4 | +Troll vs +Zeus | Tinker Pos 2 | 73.29 | ACCEPTABLE |
|  | 5 | +Tinker vs +Medusa | Nyx Assassin Pos 4 | 56.21 | ACCEPTABLE |
| D2K00003 | 1 | Apertura | Crystal Maiden Pos 5 | 114.32 | BAD — role mismatch |
|  | 2 | Pugna vs Tiny | Kunkka Pos 3 | 69.37 | BAD — role mismatch |
|  | 3 | Pugna+Kunkka vs Tiny+Nyx | Templar Assassin Pos 1 | 72.40 | ACCEPTABLE |
|  | 4 | +TA+AM vs +Timber+Dazzle | Zeus sin rol | 56.61 | BAD — farm distribution |
| D2K00004 | 1–4 | Repite patrón D2K00001 | CM → Kunkka → Troll → Huskar | — | BAD/BAD/ACCEPTABLE/BAD |
| D2K00005 | 1–4 | Igual, con Ringmaster rival | CM → Kunkka → Troll → Huskar | — | BAD/BAD/ACCEPTABLE/BAD |

Conteo: **0 EXCELLENT, 7 ACCEPTABLE, 14 BAD**. Cuatro de cinco drafts mostraron
`ROLE_ASSIGNMENT_IMPOSSIBLE` en la decisión final. Tres de cinco terminaron con la misma
composición propia: Clockwerk, Kunkka, Troll Warlord, Naga Siren, Huskar.

La causa adicional es semántica: en Solo, V2 declara `actionCount=1`, pero las dos primeras rondas
de la UI exigen dos picks locales. La shortlist de una acción contiene alternativas para el mismo
slot —cinco supports al abrir, cinco carries después—, no una pareja coherente. El segundo pick de
la ronda queda sin recomendación conjunta.

## Captain's Mode: FAIL

Se completaron FIRST y SECOND, 24 pasos cada uno.

Secuencia rival inicial con local FIRST:

`Anti-Mage → Axe → Bloodseeker → Drow Ranger → Earthshaker → Juggernaut → Mirana → Morphling → Shadow Fiend → Phantom Lancer → Puck → Pudge`

Secuencia rival inicial con local SECOND:

`Anti-Mage → Axe → Bane → Bloodseeker → Crystal Maiden → Drow Ranger → Earthshaker → Juggernaut → Mirana → Morphling → Shadow Fiend → Phantom Lancer`

Las **24/24** acciones enemigas tomaron el menor heroId elegible. El protocolo, turn order y
eligibilidad son correctos; la inteligencia del rival no existe.

## Party: PASS con limitación material

| Party | actionCount | Top recommendation | Role impact |
|---|---:|---|---|
| Solo | 1 | Crystal Maiden | Pos 5 |
| Party2 | 2 | Crystal Maiden + Clockwerk | Pos 5 + Pos 4 |
| Party3 | 2 | Crystal Maiden + Clockwerk | Pos 5 + Pos 4 |
| Party5 | 2 | Crystal Maiden + Clockwerk | Pos 5 + Pos 4 |

La recomendación conjunta sí cambia frente a Solo y la pareja 5+4 es plausible, sin duplicar farm
priority. Por eso pasa el criterio mínimo. La limitación es que Party2/3/5 son byte-equivalentes y
el builder no recibe `partyPreferredPositions` ni pools de miembros; el tamaño solo cambia cuántos
slots controla el kernel en esa ronda.

## Revisión histórica: TSK-214, TSK-216, TSK-217

### Qué se arregló

- **TSK-214:** arregló el transporte navegador→motor y el tablero congelado. El estado sí avanza
  en esta batería.
- **TSK-216:** impide que el bot vuelva a pickear un héroe ya tomado, incluso si el estado se
  congela. No hubo duplicados ilegales finales.
- **TSK-217:** añadió un E2E que confirma draft completo, cinco héroes únicos por lado y motor
  alcanzable.

### Qué no se arregló

- Diversidad entre drafts.
- Conectividad de `playerPosition` o `archetypeIntent` con V2.
- Independencia/inteligencia del rival AP.
- Inteligencia del rival CM.
- Calidad de composición al seguir recomendaciones en los dos slots de una ronda Solo.

### ¿Regresión o misma causa?

No es regresión del bug de tablero congelado: esa causa está corregida. Es otra causa con el mismo
síntoma visual de repetición. Sí hay una regresión funcional respecto del camino retirado
`/api/suggestions/preview`: ese camino aceptaba posición/intención; el nuevo camino canónico V2 no
las transporta.

### Por qué los tests no lo detectaron

- `simulator.spec.ts` verifica finalización/unicidad, no ranking.
- `copilot-intelligence.spec.ts` verifica que el panel tenga contenido y no filtre sentinels; no
  evalúa si el contenido sabe draftear.
- `ap-party-sizes.spec.ts` elige el primer botón habilitado y solo exige completar.
- `captains-mode.spec.ts` elige el primer botón habilitado y solo exige 14 bans, 10 picks y
  unicidad; esa prueba es compatible con lowest-ID.
- `ap-collision-and-s6.spec.ts` fuerza una collision para verificar el kernel; no mide la tasa de
  collisions naturales del bot.
- Los tests de `protocol-sessions.recommendations` usan `fakeSuggestions` y comprueban contrato,
  perspectiva y proyección, no calidad/sensibilidad.
- La suite no contiene metamorphic tests de “mismo estado, cambia solo posición/intención/enemy
  pick” ni un gate de diversidad/collision rate.

## Findings reproducibles

### D2K-PLAY-001

FINDING ID: `D2K-PLAY-001`  
SEVERITY: **P0**  
PRODUCT STATE: Ranked AP Solo, apertura.  
INPUT: mismo estado; cambiar solo Pos 1 (carry) → Pos 5 (hard support).  
ACTUAL OUTPUT: cinco rankings idénticos; Crystal Maiden Pos 5 Top1 en todos.  
EXPECTED DOTA BEHAVIOR: shortlist materialmente sensible a la posición seleccionada.  
WHY ACTUAL IS WRONG: el control visible promete consejo personal pero V2 draftea para un capitán
sin conocer la posición.  
RUNTIME EVIDENCE: producto 1/5 rankings distintos; preview control 5/5.  
SOURCE EVIDENCE: `ConfigPanel.tsx:277-321`; `use-random-draft-session.ts:299-301`;
`protocol-client.ts:117-142`; `protocol-sessions.ts:297-303`; `build.ts:147-158`;
`mix.ts:741-744`.  
LIKELY ROOT CAUSE: A+B+I — input faltante, contrato desconectado, `teamOpening` suprime posición.  
CONFIDENCE: **HIGH**  
MINIMAL REPAIR TARGET: metadata de ProtocolSession y cable V2→`targetPosition`; definir convivencia
con `teamOpening`.

### D2K-PLAY-002

FINDING ID: `D2K-PLAY-002`  
SEVERITY: **P1**  
PRODUCT STATE: selector de intención de Ranked AP.  
INPUT: none/push/teamfight/pickoff/scaling.  
ACTUAL OUTPUT: byte-identical.  
EXPECTED DOTA BEHAVIOR: cada intención debe mover héroes/señales acordes.  
WHY ACTUAL IS WRONG: el control es una affordance falsa.  
RUNTIME EVIDENCE: V2 1/5 rankings; preview 5/5, con `push` moviendo Top1 a Pugna.  
SOURCE EVIDENCE: `use-random-draft-session.ts:103-107,141-143`;
`protocol-sessions.ts:297-303`.  
LIKELY ROOT CAUSE: B — señal funcional pero desconectada.  
CONFIDENCE: **HIGH**  
MINIMAL REPAIR TARGET: intención en metadata/contrato V2 y builder.

### D2K-PLAY-003

FINDING ID: `D2K-PLAY-003`  
SEVERITY: **P1**  
PRODUCT STATE: 10 aperturas AP Solo.  
INPUT: 10 seeds por defecto; control adicional con cuatro personal bans.  
ACTUAL OUTPUT: mismo ranking 50/50; Crystal Maiden Top1 10/10 aun con bans variables.  
EXPECTED DOTA BEHAVIOR: alternativas reales entre seeds/bans equivalentes.  
WHY ACTUAL IS WRONG: produce exactamente la experiencia repetitiva reportada.  
RUNTIME EVIDENCE: Top1 unique rate 2%; same Top1 100%.  
SOURCE EVIDENCE: `ban-phase.ts:48-75`; `protocol-sessions.ts:297-303`;
`mix.ts:997-1029`.  
LIKELY ROOT CAUSE: G+I — seed no entra al ranking y el team opener es determinista.  
CONFIDENCE: **HIGH**  
MINIMAL REPAIR TARGET: semántica y transporte de diversidad para V2/teamOpening.

### D2K-PLAY-004

FINDING ID: `D2K-PLAY-004`  
SEVERITY: **P0**  
PRODUCT STATE: primera blind round AP.  
INPUT: humano sigue Top1 en 10 openings.  
ACTUAL OUTPUT: humano CM, bot CM, `Conflict_Ban` CM, 10/10.  
EXPECTED DOTA BEHAVIOR: oposición rival plausible e independiente.  
WHY ACTUAL IS WRONG: mide simetría del algoritmo, no drafting.  
RUNTIME EVIDENCE: collision rate 100%, sin forced hero.  
SOURCE EVIDENCE: `protocol-sessions.ts:237-258`; `build.ts:57-60`.  
LIKELY ROOT CAUSE: H+G — rival usa el mismo Top1 determinista.  
CONFIDENCE: **HIGH**  
MINIMAL REPAIR TARGET: política rival AP separada del Top1 humano.

### D2K-PLAY-005

FINDING ID: `D2K-PLAY-005`  
SEVERITY: **P0**  
PRODUCT STATE: CM FIRST y SECOND completos.  
INPUT: dos drafts de 24 pasos.  
ACTUAL OUTPUT: las 24 acciones enemigas eligieron el menor heroId.  
EXPECTED DOTA BEHAVIOR: picks/bans por meta, roles, denial, counters y plan.  
WHY ACTUAL IS WRONG: heroId no tiene significado estratégico.  
RUNTIME EVIDENCE: secuencias reproducibles listadas arriba.  
SOURCE EVIDENCE: `cm-simulator.ts:13-17`; `protocol-sessions.ts:212-220`.  
LIKELY ROOT CAUSE: H — estrategia de test conectada al producto.  
CONFIDENCE: **HIGH**  
MINIMAL REPAIR TARGET: selector rival CM, preservando kernel/eligibilidad.

### D2K-PLAY-006

FINDING ID: `D2K-PLAY-006`  
SEVERITY: **P1**  
PRODUCT STATE: AP Solo, rondas de dos picks.  
INPUT: seguir Top1 y la siguiente alternativa para completar los dos slots de UI.  
ACTUAL OUTPUT: `actionCount=1`; listas monorol; Troll+Naga→Huskar; 4/5 drafts con
`ROLE_ASSIGNMENT_IMPOSSIBLE`.  
EXPECTED DOTA BEHAVIOR: pareja conjunta o slot externo explícito.  
WHY ACTUAL IS WRONG: Solo del kernel y control de picks de UI tienen semánticas distintas.  
RUNTIME EVIDENCE: 14/21 decisiones BAD; tres composiciones finales idénticas.  
SOURCE EVIDENCE: `protocol-client.ts:123-140`; `constants.ts`; `recommendation/decision.ts`;
`use-random-draft-session.ts`.  
LIKELY ROOT CAUSE: I+A — contrato multi-slot desacoplado.  
CONFIDENCE: **HIGH**  
MINIMAL REPAIR TARGET: contrato BlindRoundPanel↔PartyContext↔RecommendationSet/v2.

### D2K-PLAY-007

FINDING ID: `D2K-PLAY-007`  
SEVERITY: **P1**  
PRODUCT STATE: runtime 7.41e recién sincronizado.  
INPUT: apertura real.  
ACTUAL OUTPUT: patch_meta raw real pero peso 0; matchups/pool/pro ausentes; solo dos señales votan;
confidence alta.  
EXPECTED DOTA BEHAVIOR: ranking y confianza honestos sobre cobertura real.  
WHY ACTUAL IS WRONG: sobrecomunica certeza e ignora datos frescos que sí calcula.  
RUNTIME EVIDENCE: 127 héroes, 1,016 patch rows, 0 matchup rows, 0 pool rows; CM recibe 114.32 de
position+counter solamente.  
SOURCE EVIDENCE: `mix.ts:288-312,869-880`; `recommendation/types.ts:13-15`.  
LIKELY ROOT CAUSE: C+B+E — datos ausentes/readiness desconectado/confidence condicionada.  
CONFIDENCE: **HIGH**  
MINIMAL REPAIR TARGET: readiness de patch, ingesta matchup y semántica de confidence/degradation.

### D2K-PLAY-008

FINDING ID: `D2K-PLAY-008`  
SEVERITY: **P2**  
PRODUCT STATE: Party2/3/5, apertura.  
INPUT: cambia solo partySize.  
ACTUAL OUTPUT: Party2=Party3=Party5, CM Pos5 + Clock Pos4.  
EXPECTED DOTA BEHAVIOR: cuando existan, usar posiciones/pools/preferencias de miembros.  
WHY ACTUAL IS WRONG: la superficie sugiere contexto de party; el runtime solo sabe slots.  
RUNTIME EVIDENCE: tres outputs byte-equivalentes; la pareja es plausible, de ahí P2.  
SOURCE EVIDENCE: `build.ts:83-85`; `protocol-sessions.ts:297-303`;
`protocol-client.ts:123-140`.  
LIKELY ROOT CAUSE: A+B — PartyContext estructural sin contexto de jugadores.  
CONFIDENCE: **HIGH**  
MINIMAL REPAIR TARGET: metadata/preferencias de party hacia el builder V2.

## Informe final

D2KIRO DOTA EXPERT PLAYTEST: **NOT_USABLE**

PATCH VERIFIED: **7.41e**, 127 héroes, sync fresco y exitoso.

REAL DATA STATUS: patch data disponible pero no vota; hero positions 126/127; counters curados
disponibles; statistical matchups no disponibles; personal pool no disponible; pro evidence no
disponible en V2.

TOTAL PLAYTEST STATES: **168 decision points** (144 recommendations + 24 bot CM actions).

FULL DRAFTS: **7** — 5 AP Solo + CM FIRST + CM SECOND.

TOP1 UNIQUE RATE: **2.0% (1/50)**.

TOP1 MOST COMMON HEROES: **Crystal Maiden 50/50 (100%)**.

POSITION SENSITIVITY: **FAIL**

INTENT SENSITIVITY: **FAIL**

ENEMY PICK SENSITIVITY: **PASS**

AP ENEMY BOT REALISM: **FAIL**

AP COLLISION RATE: **100% (10/10)**

CM ENEMY BOT REALISM: **FAIL**

PARTY RECOMMENDATIONS: **PASS**, limitado a pareja de apertura plausible; sin preferencias/pools
de miembros.

REPEATED PATTERN REPRODUCED: **YES**

CRYSTAL MAIDEN ROOT CAUSE: `position_fit.raw=1` + máximo alivio de counters curados baneados,
mientras posición/intención no llegan, patch_meta aporta 0 y el bot rival usa el mismo Top1.

P0 FINDINGS: **3** — posición ignorada; AP bot espejo/collisions; CM lowest-ID.

P1 FINDINGS: **4** — intención desconectada; diversidad/seed inefectivos; desacople Solo multi-slot;
datos/cobertura/confianza engañosos.

P2 FINDINGS: **1** — party sin preferencias/pools reales.

WHY EXISTING TESTS MISSED THIS: validan transporte, protocolo, unicidad, render y completion; no
evalúan sensibilidad metamórfica, calidad Dota, diversidad ni realismo del bot.

TOP 3 ROOT CAUSES:

1. Inputs de producto perdidos en el nuevo camino canónico V2: posición, intención, seed y contexto
   real de party.
2. Políticas rivales no plausibles: AP refleja Top1; CM toma el heroId más bajo.
3. Evidencia efectiva pobre/engañosa: patch_meta hard-disabled, 0 matchups, sin pool/pro y confidence
   alta sobre solo dos señales de apertura.

DO NOT FIX YET.

MINIMUM PRODUCT REPAIR ORDER:

1. Restaurar inputs en RecommendationSet/v2 y resolver la semántica Solo/teamOpening/multi-slot.
2. Separar y reemplazar las políticas rivales AP y CM.
3. Reparar readiness/cobertura de datos y confidence; volver a correr exactamente este corpus antes
   de considerar weights.

ESTIMATED NUMBER OF ENGINEERING AREAS TO TOUCH: **5** — transporte web; metadata/builder V2;
políticas AP/CM; meta/readiness/confidence; E2E de calidad.

READY FOR FIXER HANDOFF: **YES**

