# ENGINE_P1_EXAM — línea base del examen de drafter (TSK-250)

Código: `c7e1af1` (árbol limpio) · estado `048f5ec205cf8b46` · snapshot `W5-EMP-001` · clave comparable `279ca94d7c900863`

Este reporte **mide, no juzga y no cambia comportamiento**. Camino medido: el del simulador (Team Coach Board + `?format=v4`) más la lista V3 que el juez de Wave 5 ya conocía.

Muestra: {"drafts":120,"completed":120,"decisionPoints":628,"round1":262,"round2":244,"round3":122,"harnessFailures":0,"harnessBadStatuses":0}

## Defectos duros (plan v2, tabla C)

| Invariante | Resultado |
| --- | --- |
| I1 nada ilegal | 0 violaciones |
| I2 factibilidad de roles | 0 violaciones |
| I3 conformidad: objetivo = precedencia declarada | 0/628 estados divergen (0.0%) |
| I3 toda columna abierta rankeada | 0 violaciones |
| I3 PHASE presentado como ventaja | 0 |
| I6-visible hueco de iniciación/catch | 4/4 estados con hueco abierto sin que ninguna tarjeta lo diga |
| I9-visible counter duro en top-3 | 0 apariciones en 0 estados; 0 sin riesgo visible |
| I11 honestidad de la base | NOT_MEASURABLE: No `basis` field exists on any card yet (it is created by T5/TSK-254); today a curated claim and a statistical claim look identical. |

## Observaciones (no son ley)

- **I3 apertura en cores:** 0/121 aperturas de ronda 1 recomiendan Pos 1/2 sin ventana de counter ni escasez de pool (0.0%).
- **I4 reactividad (Jaccard del top-3, misma posición entre drafts distintos):** global 0.2936; por posición {"pos1":0.3229,"pos2":0.2972,"pos3":0.2882,"pos4":0.2748,"pos5":0.2851}. 1.0 = siempre los mismos tres.
- **I5 peso de `position_fit`:** 59.4% del score (mediana; p10 54.6%, p90 64.8%) y 9.0% de la dispersión que ordena a los candidatos (mediana; p10 -3.5%, p90 66.3%); 628 estados, ~6 candidatos por estado; en 79.0% de ellos `position_fit` está saturado en 1 (suma la misma constante a todos). Es sobre lo que V6 conserva (TOP_N), no sobre todo el campo.
- **I6 relleno:** de 4 estados con hueco abierto, el top-3 lo llena en 4; existe un relleno en lo mostrado en 4.
- **I7 daño:** de 3 estados mono-daño, el top-3 diversifica en 2.
- **I8 exposición del primary de ronda 1:** 0.2066 counters duros disponibles en promedio (máx 1) sobre 121 aperturas.
- **I10 popularidad:** 100.0% de los top-3 de ronda 1 caen en la mitad más jugada de su posición (1815/1815).
- **Concentración del #1:** {"pos1":{"distinctPrimaries":6,"sample":121,"mostCommonShare":0.3306},"pos2":{"distinctPrimaries":9,"sample":121,"mostCommonShare":0.314},"pos3":{"distinctPrimaries":8,"sample":121,"mostCommonShare":0.4298},"pos4":{"distinctPrimaries":8,"sample":121,"mostCommonShare":0.3223},"pos5":{"distinctPrimaries":10,"sample":121,"mostCommonShare":0.3967}}
- **Mostrado pero no creíble en su columna:** 0.

## Cómo reproducir

- `bun scripts/p1-exam/exam.ts --out=ENGINE_P1_EXAM_T2_R2 --drafts=120`

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

### c2c44fe7f992 — round-1 opening recommends hard support / support

Ronda 1 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: — · rivales: —
- Posición recomendada por el board: Pos 5 · la precedencia declarada elegiría: pos5 (PHASE)
- Top-3 V3: Bounty Hunter, Techies, Mirana
- Board pos1: Terrorblade, Spectre, Phantom Lancer
- Board pos2: Earth Spirit, Outworld Destroyer, Invoker
- Board pos3: Underlord, Dawnbreaker, Timbersaw
- Board pos4: Bounty Hunter, Techies, Mirana
- Board pos5: Undying, Crystal Maiden, Disruptor

### d2efa9cbb017 — late open initiation/catch gap

Ronda 2 · bans: Wraith King, Earthshaker, Skywrath Mage, Shadow Fiend, Mirana, Sniper, Phantom Assassin, Lifestealer, Windranger, Spirit Breaker, Silencer, Ogre Magi, Lina, Slark, Zeus, Queen of Pain · propios: Io, Keeper of the Light, Razor · rivales: Techies, Spectre
- Posición recomendada por el board: Pos 4 · la precedencia declarada elegiría: pos4 (PHASE)
- Top-3 V3: Juggernaut, Morphling, Anti-Mage
- Board pos1: Juggernaut, Morphling, Anti-Mage
- Board pos4: Rubick, Lion, Pudge

### 55eb1a22cbac — mono-damage team

Ronda 3 · bans: Shadow Fiend, Rubick, Pudge, Legion Commander, Slark, Magnus, Queen of Pain, Invoker, Luna, Crystal Maiden, Earthshaker, Ogre Magi, Skywrath Mage, Bounty Hunter, Centaur Warrunner, Night Stalker · propios: Lion, Dark Willow, Tinker, Necrophos · rivales: Terrorblade, Ember Spirit, Techies, Treant Protector
- Posición recomendada por el board: Pos 1 · la precedencia declarada elegiría: pos1 (SINGLE_POSITION)
- Top-3 V3: Spectre, Lifestealer, Sven
- Board pos1: Spectre, Lifestealer, Sven

### af20d530f8d3 — round 2 after rival reveals

Ronda 2 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Undying · propios: Techies, Winter Wyvern · rivales: Sven, Oracle
- Posición recomendada por el board: Pos 3 · la precedencia declarada elegiría: pos3 (COUNTER_WINDOW)
- Top-3 V3: Axe, Slardar, Tidehunter
- Board pos1: Anti-Mage, Spectre, Luna
- Board pos2: Earth Spirit, Void Spirit, Pangolier
- Board pos3: Axe, Slardar, Tidehunter

### a05e55d37022 — round 3 closing pick

Ronda 3 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Undying, Axe · propios: Techies, Winter Wyvern, Anti-Mage, Slardar · rivales: Sven, Oracle, Bounty Hunter, Timbersaw
- Posición recomendada por el board: Pos 2 · la precedencia declarada elegiría: pos2 (SINGLE_POSITION)
- Top-3 V3: Earth Spirit, Storm Spirit, Tinker
- Board pos2: Earth Spirit, Storm Spirit, Tinker

