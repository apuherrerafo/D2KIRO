# ENGINE_P1_EXAM — línea base del examen de drafter (TSK-250)

Código: `f84d0fc` (árbol limpio) · estado `deb573ab5a622123` · snapshot `W5-EMP-001` · clave comparable `c117baac7b861579`

Este reporte **mide, no juzga y no cambia comportamiento**. Camino medido: el del simulador (Team Coach Board + `?format=v4`) más la lista V3 que el juez de Wave 5 ya conocía.

Muestra: {"drafts":120,"completed":120,"decisionPoints":622,"round1":254,"round2":247,"round3":121,"harnessFailures":0,"harnessBadStatuses":0}

## Defectos duros (plan v2, tabla C)

| Invariante | Resultado |
| --- | --- |
| I1 nada ilegal | 0 violaciones |
| I2 factibilidad de roles | 0 violaciones |
| I3 conformidad: objetivo = precedencia declarada | 436/622 estados divergen (70.1%) |
| I3 toda columna abierta rankeada | 0 violaciones |
| I3 PHASE presentado como ventaja | 0 |
| I6-visible hueco de iniciación/catch | 1/1 estados con hueco abierto sin que ninguna tarjeta lo diga |
| I9-visible counter duro en top-3 | 0 apariciones en 0 estados; 0 sin riesgo visible |
| I11 honestidad de la base | NOT_MEASURABLE: No `basis` field exists on any card yet (it is created by T5/TSK-254); today a curated claim and a statistical claim look identical. |

## Observaciones (no son ley)

- **I3 apertura en cores:** 48/120 aperturas de ronda 1 recomiendan Pos 1/2 sin ventana de counter ni escasez de pool (40.0%).
- **I4 reactividad (Jaccard del top-3, misma posición entre drafts distintos):** global 0.2939; por posición {"pos1":0.3243,"pos2":0.2976,"pos3":0.2881,"pos4":0.2733,"pos5":0.2864}. 1.0 = siempre los mismos tres.
- **I5 peso de `position_fit`:** 60.0% del score (mediana; p10 55.5%, p90 63.5%) y 0.0% de la dispersión que ordena a los candidatos (mediana; p10 -2.9%, p90 53.8%); 622 estados, ~6 candidatos por estado; en 83.1% de ellos `position_fit` está saturado en 1 (suma la misma constante a todos). Es sobre lo que V6 conserva (TOP_N), no sobre todo el campo.
- **I6 relleno:** de 1 estados con hueco abierto, el top-3 lo llena en 1; existe un relleno en lo mostrado en 1.
- **I7 daño:** de 1 estados mono-daño, el top-3 diversifica en 0.
- **I8 exposición del primary de ronda 1:** 0.325 counters duros disponibles en promedio (máx 2) sobre 120 aperturas.
- **I10 popularidad:** 100.0% de los top-3 de ronda 1 caen en la mitad más jugada de su posición (1800/1800).
- **Concentración del #1:** {"pos1":{"distinctPrimaries":6,"sample":120,"mostCommonShare":0.3333},"pos2":{"distinctPrimaries":9,"sample":120,"mostCommonShare":0.3167},"pos3":{"distinctPrimaries":8,"sample":120,"mostCommonShare":0.4333},"pos4":{"distinctPrimaries":8,"sample":120,"mostCommonShare":0.325},"pos5":{"distinctPrimaries":9,"sample":120,"mostCommonShare":0.4}}
- **Mostrado pero no creíble en su columna:** 0.

## Cómo reproducir

- `bun scripts/p1-exam/exam.ts --out=ENGINE_P1_EXAM_BASELINE_R2 --drafts=120`

## Paquete del juez (se rellena en T6)

Preguntas por componente:
- **C1-position** Position order: is the position the board recommends the right one to commit to NOW (and not just the lowest open one)?
- **C2-ranking** Hero ranking: are the heroes shown for that position the ones you would consider, or do they look chosen for being popular?
- **C3-composition** Composition: does the advice notice what the team still lacks (initiation / catch / damage mix)?
- **C4-exposure** Exposure: is any recommended hero a clear counter-target of what the rival has shown, and does the card say so?

Preguntas de plan (línea base que decide la prioridad de F2):
- **P1-tempo** Does this team need to win early, or can it scale?
- **P2-objectives** Can this draft convert an advantage into objectives?
- **P3-plan** Does the recommendation improve the plan, or only the score?

### c2c44fe7f992 — round-1 opening recommends a core without a window

Ronda 1 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: — · rivales: —
- Posición recomendada por el board: Pos 1 · la precedencia declarada elegiría: pos5 (PHASE)
- Top-3 V3: Bounty Hunter, Techies, Mirana
- Board pos1: Terrorblade, Spectre, Phantom Lancer
- Board pos2: Earth Spirit, Outworld Destroyer, Invoker
- Board pos3: Underlord, Dawnbreaker, Timbersaw
- Board pos4: Bounty Hunter, Techies, Mirana
- Board pos5: Undying, Crystal Maiden, Disruptor

### 0cd5f0ce676c — round-1 opening recommends hard support / support

Ronda 1 · bans: Juggernaut, Undying, Shadow Fiend, Invoker, Rubick, Legion Commander, Phantom Lancer, Zeus, Pudge, Lion, Magnus, Drow Ranger, Anti-Mage, Hoodwink, Techies, Dark Willow · propios: — · rivales: —
- Posición recomendada por el board: Pos 4 · la precedencia declarada elegiría: pos5 (PHASE)
- Top-3 V3: Crystal Maiden, Lich, Winter Wyvern
- Board pos1: Spectre, Lifestealer, Sven
- Board pos2: Storm Spirit, Outworld Destroyer, Tinker
- Board pos3: Slardar, Enigma, Underlord
- Board pos4: Mirana, Bounty Hunter, Skywrath Mage
- Board pos5: Crystal Maiden, Lich, Winter Wyvern

### 7ee777d62e2d — simulator target differs from the declared precedence

Ronda 1 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: Terrorblade · rivales: —
- Posición recomendada por el board: Pos 2 · la precedencia declarada elegiría: pos5 (PHASE)
- Top-3 V3: Undying, Disruptor, Crystal Maiden
- Board pos2: Earth Spirit, Invoker, Ember Spirit
- Board pos3: Underlord, Dawnbreaker, Night Stalker
- Board pos4: Mirana, Bounty Hunter, Techies
- Board pos5: Undying, Disruptor, Crystal Maiden

### d2efa9cbb017 — late open initiation/catch gap

Ronda 2 · bans: Wraith King, Earthshaker, Skywrath Mage, Shadow Fiend, Mirana, Sniper, Phantom Assassin, Lifestealer, Windranger, Spirit Breaker, Silencer, Ogre Magi, Lina, Slark, Zeus, Queen of Pain · propios: Io, Keeper of the Light, Razor · rivales: Techies, Spectre
- Posición recomendada por el board: Pos 4 · la precedencia declarada elegiría: pos4 (PHASE)
- Top-3 V3: Juggernaut, Morphling, Anti-Mage
- Board pos1: Juggernaut, Morphling, Anti-Mage
- Board pos4: Rubick, Lion, Pudge

### 60ee3769982d — mono-damage team

Ronda 3 · bans: Rubick, Anti-Mage, Zeus, Invoker, Necrophos, Lina, Phantom Assassin, Earthshaker, Mirana, Lifestealer, Spectre, Axe, Hoodwink, Snapfire, Ogre Magi, Winter Wyvern · propios: Venomancer, Queen of Pain, Nature's Prophet, Phoenix · rivales: Terrorblade, Lion, Techies, Legion Commander
- Posición recomendada por el board: Pos 2 · la precedencia declarada elegiría: pos2 (SINGLE_POSITION)
- Top-3 V3: Storm Spirit, Outworld Destroyer, Keeper of the Light
- Board pos2: Storm Spirit, Outworld Destroyer, Keeper of the Light

### 49ac0b3f1872 — round 2 after rival reveals

Ronda 2 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: Terrorblade, Earth Spirit · rivales: Undying, Sven
- Posición recomendada por el board: Pos 3 · la precedencia declarada elegiría: pos5 (COUNTER_WINDOW)
- Top-3 V3: Winter Wyvern, Lich, Ringmaster
- Board pos3: Dawnbreaker, Tidehunter, Slardar
- Board pos4: Bounty Hunter, Techies, Rubick
- Board pos5: Winter Wyvern, Lich, Ringmaster

### f579422e7113 — round 3 closing pick

Ronda 3 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Bounty Hunter · propios: Terrorblade, Earth Spirit, Dawnbreaker, Techies · rivales: Undying, Sven, Axe, Mirana
- Posición recomendada por el board: Pos 5 · la precedencia declarada elegiría: pos5 (SINGLE_POSITION)
- Top-3 V3: Lich, Winter Wyvern, Disruptor
- Board pos5: Lich, Winter Wyvern, Disruptor

