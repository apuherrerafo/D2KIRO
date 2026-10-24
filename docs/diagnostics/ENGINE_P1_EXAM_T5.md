# ENGINE_P1_EXAM — línea base del examen de drafter (TSK-250)

Código: `5ad8d63` (árbol limpio) · estado `cb375b5c2e714502` · snapshot `W5-EMP-001` · clave comparable `32cd1d1e2814136c`

Este reporte **mide, no juzga y no cambia comportamiento**. Camino medido: el del simulador (Team Coach Board + `?format=v4`) más la lista V3 que el juez de Wave 5 ya conocía.

Muestra: {"drafts":120,"completed":120,"decisionPoints":622,"round1":252,"round2":249,"round3":121,"harnessFailures":0,"harnessBadStatuses":0}

## Defectos duros (plan v2, tabla C)

| Invariante | Resultado |
| --- | --- |
| I1 nada ilegal | 0 violaciones |
| I2 factibilidad de roles | 0 violaciones |
| I3 conformidad: objetivo = precedencia declarada | 0/622 estados divergen (0.0%) |
| I3 toda columna abierta rankeada | 0 violaciones |
| I3 PHASE presentado como ventaja | 0 |
| I6-visible hueco de iniciación/catch (**definición REVISADA, ver nota**) | 0/0 estados con hueco abierto sin que ninguna tarjeta lo diga |
| I9-visible counter duro en top-3 | 0 apariciones en 0 estados; 0 sin riesgo visible |
| I11 honestidad de la base | 0 violaciones en 3074 tarjetas V4 (bases {"statistical":2668,"mixed":363,"curated":43}; estadísticas sin muestra: 0) |
| I6c CRITICAL_GAP en la tarjeta | 46 tarjetas lo llevan (de 160 en estados con hueco crítico); sin prueba: 0; faltante donde era demostrable: 0 |

> **Nota de comparabilidad (añadida a mano; este reporte NO se regeneró).** La fila `I6-visible` de arriba usa la definición **revisada** de TSK-254 (sólo aplica con todos los picks propios curados; un riesgo V4 también hace visible el hueco) bajo la etiqueta de siempre. `ENGINE_P1_EXAM_T4_AFTER` midió I6 con la definición **original** (2/2). **0/0 no es una mejora respecto de 2/2**: es otra regla con el denominador encogido (los 2 estados eran Ringmaster/Largo, sin curar). El valor de I6 original sobre el código de T5 no está medido. Desde el siguiente examen el generador emite las dos por separado (`I6_visible` original, `I6_visible_revised`).

## Observaciones (no son ley)

- **I3 apertura en cores:** 0/121 aperturas de ronda 1 recomiendan Pos 1/2 sin ventana de counter ni escasez de pool (0.0%).
- **I4 reactividad (Jaccard del top-3, misma posición entre drafts distintos):** global 0.2173; por posición {"pos1":0.2155,"pos2":0.2374,"pos3":0.1974,"pos4":0.2334,"pos5":0.2027}. 1.0 = siempre los mismos tres.
- **I5 peso de `position_fit`:** 59.0% del score (mediana; p10 54.0%, p90 64.1%) y 0.0% de la dispersión que ordena a los candidatos (mediana; p10 -8.4%, p90 29.7%); 622 estados, ~6 candidatos por estado; en 86.1% de ellos `position_fit` está saturado en 1 (suma la misma constante a todos). Es sobre lo que V6 conserva (TOP_N), no sobre todo el campo.
- **I5 sobre todo el campo creíble (TSK-252):** 622 estados con ≥6 creíbles (mediana 29). El top-3 cae en la mitad más jugada 98.2% de las veces y el top-6 96.7% (un corte neutro daría ~50%). `position_fit` explica 80.8% de la dispersión (mediana). Quitando su aporte, el top-3 se conserva en 36.1% (Jaccard) y el top-6 en 37.7%; 100% = no decide nada. Dentro de la mitad más jugada, `position_fit` explica 1.2% de la dispersión.
- **T3 misma decisión, dos reglas (volumen vs mediana de creíbles):** 622 estados; el top-3 cambia en 458 (73.6%); Jaccard medio del top-3 0.5605, del top-6 0.6112; de los cambiados, 458 se apoyan en menos volumen (partidas medias del top-3: 4646.6854 → 3823.2508). Describe qué se movió, no si mejora. Empates exactos en el corte del top-3 (decide el id del héroe, no el draft): 0.0% → 0.0% de los estados.
- **T3 frente a los rivales ya revelados (solo capa curada "hard"):** en 380 estados con rival visible, héroes del top-3 que counterean a un rival: 0.0974 → 0.1447; héroes del top-3 expuestos a un rival: 0.0105 → 0.0105.
- **I6 relleno:** de 0 estados con hueco abierto, el top-3 lo llena en 0; existe un relleno en lo mostrado en 0.
- **I6b iniciación sola (TSK-253):** de 25 estados con los últimos picks y sin ningún iniciador, el top-3 del board lo llena en 23; existe un iniciador creíble en la columna en 25.
- **T4 huecos críticos en la ventana de cierre (TSK-253):** 32 de 250 estados con ≤2 picks propios por delante tienen un hueco crítico {"initiation":25,"damage_mix":8,"catch":1}; en 8 más no se declara por un pick propio sin capacidades curadas. Fuera de la ventana la regla nueva puntúa idéntico a la vieja: 0/372 estados con scores distintos.
- **T4 misma decisión, dos reglas (team_synergy plano vs por etapa):** 32 estados comparables (ronda 2: 24, ronda 3: 8); el top-3 cambia en 20 (62.5%). Top-3 con al menos un héroe que llena lo crítico: 29 → 30 de 32 estados donde existe uno en el campo; promedio de rellenos en el top-3 1.8438 → 2.5313. Costo bajo el score viejo (top-3 cambiados): 77.308 → 75.3538; partidas medias del top-3 3976.6458 → 3589.4063.
- **T4 frente a los rivales ya revelados (capa curada "hard"):** en 32 estados con rival visible, héroes del top-3 que counterean a un rival 0.2188 → 0.1875; expuestos a un rival 0 → 0.
- **I7 daño:** de 0 estados mono-daño, el top-3 diversifica en 0.
- **I8 exposición del primary de ronda 1:** 0.3306 counters duros disponibles en promedio (máx 1) sobre 121 aperturas.
- **I10 popularidad:** 100.0% de los top-3 de ronda 1 caen en la mitad más jugada de su posición (1815/1815).
- **Concentración del #1:** {"pos1":{"distinctPrimaries":11,"sample":121,"mostCommonShare":0.2975},"pos2":{"distinctPrimaries":11,"sample":121,"mostCommonShare":0.2314},"pos3":{"distinctPrimaries":11,"sample":121,"mostCommonShare":0.3554},"pos4":{"distinctPrimaries":10,"sample":121,"mostCommonShare":0.2562},"pos5":{"distinctPrimaries":11,"sample":121,"mostCommonShare":0.2975}}
- **Mostrado pero no creíble en su columna:** 0.

## Cómo reproducir

- `bun scripts/p1-exam/exam.ts --out=ENGINE_P1_EXAM_T5 --drafts=120 --judge=t4`

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

## Decisiones cambiadas por TSK-253 (lectura ciega: A y B no indican cuál es la regla vieja)

Pregunta C3: ¿cuál de las dos ternas elegirías para esa posición dado lo que a este equipo le falta? (A / B / equivalente; "dañino" solo con un motivo de Dota escrito). La clave está en el JSON (`answerKey`).

### f579422e7113 — Pos 3 · ronda 2

bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Undying, Axe · propios: Techies, Winter Wyvern, Anti-Mage · rivales: Sven, Oracle, Bounty Hunter
- A: Slardar, Tidehunter, Brewmaster
- B: Slardar, Tidehunter, Necrophos

### 9118bc5128aa — Pos 1 · ronda 2

bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: Disruptor, Skywrath Mage, Enigma · rivales: Underlord, Mirana
- A: Kez, Sven, Juggernaut
- B: Kez, Sven, Necrophos

### a22692eafd76 — Pos 1 · ronda 2

bans: Shadow Fiend, Windranger, Luna, Undying, Mirana, Ogre Magi, Phantom Assassin, Lifestealer, Sniper, Necrophos, Spirit Breaker, Axe, Pudge, Zeus, Skywrath Mage, Razor · propios: Oracle, Techies, Enigma · rivales: Earth Spirit, Ringmaster
- A: Spectre, Anti-Mage, Slark
- B: Spectre, Slark, Ursa

### d2efa9cbb017 — Pos 4 · ronda 2

bans: Wraith King, Earthshaker, Skywrath Mage, Shadow Fiend, Mirana, Sniper, Phantom Assassin, Lifestealer, Windranger, Spirit Breaker, Silencer, Ogre Magi, Lina, Slark, Zeus, Queen of Pain · propios: Io, Chen, Razor · rivales: Techies, Spectre
- A: Lion, Pudge, Snapfire
- B: Rubick, Lion, Pudge

### 4814d1ccb664 — Pos 1 · ronda 3

bans: Wraith King, Earthshaker, Skywrath Mage, Shadow Fiend, Mirana, Sniper, Phantom Assassin, Lifestealer, Windranger, Spirit Breaker, Silencer, Ogre Magi, Lina, Slark, Zeus, Queen of Pain · propios: Io, Chen, Razor, Undying · rivales: Techies, Spectre, Outworld Destroyer, Ringmaster
- A: Faceless Void, Phantom Lancer, Anti-Mage
- B: Faceless Void, Tiny, Phantom Lancer

### e4cfcae2a00d — Pos 4 · ronda 2

bans: Lina, Shadow Fiend, Phantom Lancer, Pudge, Shadow Shaman, Techies, Axe, Spirit Breaker, Invoker, Underlord, Luna, Witch Doctor, Wraith King, Crystal Maiden, Lion, Earthshaker · propios: Necrophos, Anti-Mage, Ancient Apparition · rivales: Undying, Sven
- A: Snapfire, Nyx Assassin, Rubick
- B: Snapfire, Nyx Assassin, Dark Willow

### 9aeddbe26973 — Pos 4 · ronda 3

bans: Lina, Shadow Fiend, Phantom Lancer, Pudge, Shadow Shaman, Techies, Axe, Spirit Breaker, Invoker, Underlord, Luna, Witch Doctor, Wraith King, Crystal Maiden, Lion, Earthshaker · propios: Necrophos, Anti-Mage, Ancient Apparition, Death Prophet · rivales: Undying, Sven, Slardar, Windranger
- A: Dark Willow, Snapfire, Earth Spirit
- B: Mirana, Rubick, Dark Willow

### b682584fdf86 — Pos 2 · ronda 3

bans: Zeus, Windranger, Spectre, Invoker, Lion, Shadow Shaman, Ogre Magi, Skywrath Mage, Phantom Lancer, Magnus, Mirana, Slark, Witch Doctor, Wraith King, Jakiro, Disruptor · propios: Grimstroke, Techies, Timbersaw, Drow Ranger · rivales: Doom, Pudge, Sniper, Winter Wyvern
- A: Ember Spirit, Earth Spirit, Snapfire
- B: Ember Spirit, Outworld Destroyer, Storm Spirit

### 05acdbf6bc2e — Pos 4 · ronda 2

bans: Pudge, Wraith King, Invoker, Juggernaut, Legion Commander, Vengeful Spirit, Lion, Rubick, Shadow Fiend, Phantom Assassin, Skywrath Mage, Ember Spirit, Queen of Pain, Bristleback, Venomancer, Dragon Knight · propios: Ogre Magi, Keeper of the Light, Medusa · rivales: Anti-Mage, Outworld Destroyer
- A: Spirit Breaker, Nyx Assassin, Hoodwink
- B: Spirit Breaker, Nyx Assassin, Snapfire

### 4c39a75ff9ca — Pos 1 · ronda 2

bans: Lina, Pudge, Legion Commander, Sniper, Invoker, Hoodwink, Shadow Shaman, Outworld Destroyer, Drow Ranger, Lifestealer, Axe, Phantom Assassin, Skywrath Mage, Nature's Prophet, Night Stalker, Lich, Disruptor · propios: Techies, Undying, Wraith King · rivales: Anti-Mage, Winter Wyvern
- A: Slark, Morphling, Windranger
- B: Spectre, Slark, Morphling

### 1fd3344b2fc1 — Pos 1 · ronda 3

bans: Wraith King, Lifestealer, Zeus, Shadow Shaman, Spirit Breaker, Magnus, Skywrath Mage, Legion Commander, Rubick, Invoker, Phantom Lancer, Windranger, Techies, Snapfire, Undying, Venomancer · propios: Shadow Demon, Broodmother, Enchantress, Riki · rivales: Bounty Hunter, Outworld Destroyer, Dawnbreaker, Anti-Mage
- A: Spectre, Faceless Void, Tiny
- B: Spectre, Faceless Void, Phantom Assassin

### e8b84d749418 — Pos 2 · ronda 2

bans: Witch Doctor, Sniper, Lina, Pudge, Undying, Juggernaut, Lion, Ogre Magi, Wraith King, Invoker, Silencer, Spirit Breaker, Slark, Lifestealer, Earthshaker, Magnus · propios: Troll Warlord, Broodmother, Lich · rivales: Skywrath Mage, Ember Spirit
- A: Puck, Outworld Destroyer, Snapfire
- B: Puck, Snapfire, Pangolier

### c2c44fe7f992 — round-1 opening recommends hard support / support

Ronda 1 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: — · rivales: —
- Posición recomendada por el board: Pos 5 · la precedencia declarada elegiría: pos5 (PHASE)
- Top-3 V3: Bounty Hunter, Techies, Mirana
- Board pos1: Terrorblade, Morphling, Ursa
- Board pos2: Earth Spirit, Outworld Destroyer, Invoker
- Board pos3: Underlord, Dawnbreaker, Timbersaw
- Board pos4: Bounty Hunter, Techies, Mirana
- Board pos5: Undying, Crystal Maiden, Disruptor

### af20d530f8d3 — round 2 after rival reveals

Ronda 2 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Undying · propios: Techies, Winter Wyvern · rivales: Sven, Oracle
- Posición recomendada por el board: Pos 3 · la precedencia declarada elegiría: pos3 (COUNTER_WINDOW)
- Top-3 V3: Brewmaster, Axe, Slardar
- Board pos1: Anti-Mage, Kez, Spectre
- Board pos2: Pangolier, Void Spirit, Earth Spirit
- Board pos3: Axe, Brewmaster, Slardar

### a05e55d37022 — round 3 closing pick

Ronda 3 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Undying, Axe · propios: Techies, Winter Wyvern, Anti-Mage, Slardar · rivales: Sven, Oracle, Bounty Hunter, Timbersaw
- Posición recomendada por el board: Pos 2 · la precedencia declarada elegiría: pos2 (SINGLE_POSITION)
- Top-3 V3: Necrophos, Void Spirit, Earth Spirit
- Board pos2: Necrophos, Void Spirit, Earth Spirit

