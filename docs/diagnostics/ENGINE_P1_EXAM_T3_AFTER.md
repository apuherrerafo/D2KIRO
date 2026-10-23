# ENGINE_P1_EXAM — línea base del examen de drafter (TSK-250)

Código: `b1a7eff` (árbol limpio) · estado `c6af69946cfb19f2` · snapshot `W5-EMP-001` · clave comparable `8d5e9ae7e66a0363`

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
| I6-visible hueco de iniciación/catch | 2/2 estados con hueco abierto sin que ninguna tarjeta lo diga |
| I9-visible counter duro en top-3 | 0 apariciones en 0 estados; 0 sin riesgo visible |
| I11 honestidad de la base | NOT_MEASURABLE: No `basis` field exists on any card yet (it is created by T5/TSK-254); today a curated claim and a statistical claim look identical. |

## Observaciones (no son ley)

- **I3 apertura en cores:** 0/121 aperturas de ronda 1 recomiendan Pos 1/2 sin ventana de counter ni escasez de pool (0.0%).
- **I4 reactividad (Jaccard del top-3, misma posición entre drafts distintos):** global 0.2173; por posición {"pos1":0.2155,"pos2":0.2374,"pos3":0.1974,"pos4":0.2334,"pos5":0.2027}. 1.0 = siempre los mismos tres.
- **I5 peso de `position_fit`:** 59.1% del score (mediana; p10 54.6%, p90 64.1%) y 0.0% de la dispersión que ordena a los candidatos (mediana; p10 -8.4%, p90 28.2%); 622 estados, ~6 candidatos por estado; en 86.2% de ellos `position_fit` está saturado en 1 (suma la misma constante a todos). Es sobre lo que V6 conserva (TOP_N), no sobre todo el campo.
- **I5 sobre todo el campo creíble (TSK-252):** 622 estados con ≥6 creíbles (mediana 29). El top-3 cae en la mitad más jugada 98.5% de las veces y el top-6 96.8% (un corte neutro daría ~50%). `position_fit` explica 81.0% de la dispersión (mediana). Quitando su aporte, el top-3 se conserva en 35.9% (Jaccard) y el top-6 en 37.5%; 100% = no decide nada. Dentro de la mitad más jugada, `position_fit` explica 1.2% de la dispersión.
- **T3 misma decisión, dos reglas (volumen vs mediana de creíbles):** 622 estados; el top-3 cambia en 452 (72.7%); Jaccard medio del top-3 0.5638, del top-6 0.6098; de los cambiados, 452 se apoyan en menos volumen (partidas medias del top-3: 4655.1227 → 3843.3173). Describe qué se movió, no si mejora. Empates exactos en el corte del top-3 (decide el id del héroe, no el draft): 0.0% → 0.0% de los estados.
- **T3 frente a los rivales ya revelados (solo capa curada "hard"):** en 380 estados con rival visible, héroes del top-3 que counterean a un rival: 0.0974 → 0.1474; héroes del top-3 expuestos a un rival: 0.0079 → 0.0079.
- **I6 relleno:** de 2 estados con hueco abierto, el top-3 lo llena en 2; existe un relleno en lo mostrado en 2.
- **I7 daño:** de 0 estados mono-daño, el top-3 diversifica en 0.
- **I8 exposición del primary de ronda 1:** 0.3306 counters duros disponibles en promedio (máx 1) sobre 121 aperturas.
- **I10 popularidad:** 100.0% de los top-3 de ronda 1 caen en la mitad más jugada de su posición (1815/1815).
- **Concentración del #1:** {"pos1":{"distinctPrimaries":11,"sample":121,"mostCommonShare":0.2975},"pos2":{"distinctPrimaries":11,"sample":121,"mostCommonShare":0.2314},"pos3":{"distinctPrimaries":11,"sample":121,"mostCommonShare":0.3554},"pos4":{"distinctPrimaries":10,"sample":121,"mostCommonShare":0.2562},"pos5":{"distinctPrimaries":11,"sample":121,"mostCommonShare":0.2975}}
- **Mostrado pero no creíble en su columna:** 0.

## Cómo reproducir

- `bun scripts/p1-exam/exam.ts --out=ENGINE_P1_EXAM_T3_AFTER --drafts=120`

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

## Decisiones cambiadas por TSK-252 (lectura ciega: A y B no indican cuál es la regla vieja)

Pregunta C2: ¿cuál de las dos ternas elegirías para esa posición? (A / B / equivalente; "dañino" solo con un motivo de Dota escrito). La clave está en el JSON (`answerKey`).

### c2c44fe7f992 — Pos 5 · ronda 1

bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: — · rivales: —
- A: Undying, Crystal Maiden, Mirana
- B: Undying, Techies, Crystal Maiden

### 2236a7d77003 — Pos 2 · ronda 3

bans: Wraith King, Earthshaker, Skywrath Mage, Shadow Fiend, Mirana, Sniper, Phantom Assassin, Lifestealer, Windranger, Spirit Breaker, Silencer, Ogre Magi, Lina, Slark, Zeus, Queen of Pain · propios: Ringmaster, Techies, Anti-Mage, Underlord · rivales: Storm Spirit, Tusk, Phantom Lancer, Bounty Hunter
- A: Necrophos, Puck, Ember Spirit
- B: Necrophos, Puck, Dragon Knight

### f690f984adc4 — Pos 2 · ronda 3

bans: Sniper, Axe, Windranger, Lion, Pudge, Hoodwink, Skywrath Mage, Shadow Shaman, Undying, Phantom Lancer, Lina, Necrophos, Silencer, Spirit Breaker, Night Stalker, Spectre · propios: Oracle, Snapfire, Brewmaster, Phantom Assassin · rivales: Juggernaut, Crystal Maiden, Void Spirit, Timbersaw
- A: Puck, Earth Spirit, Ember Spirit
- B: Earth Spirit, Ember Spirit, Queen of Pain

### 439c7976003d — Pos 2 · ronda 3

bans: Lion, Shadow Shaman, Invoker, Juggernaut, Witch Doctor, Ogre Magi, Magnus, Earthshaker, Shadow Fiend, Rubick, Windranger, Mirana, Luna, Grimstroke, Bristleback, Viper · propios: Disruptor, Techies, Dawnbreaker, Lifestealer · rivales: Legion Commander, Pudge, Anti-Mage, Lich
- A: Outworld Destroyer, Sniper, Ember Spirit
- B: Sniper, Outworld Destroyer, Necrophos

### 309268713c4a — Pos 5 · ronda 1

bans: Phantom Assassin, Invoker, Earthshaker, Ogre Magi, Undying, Hoodwink, Lifestealer, Axe, Luna, Mirana, Sniper, Crystal Maiden, Lich, Shadow Shaman, Lion, Night Stalker · propios: — · rivales: —
- A: Oracle, Dazzle, Disruptor
- B: Disruptor, Ringmaster, Tusk

### bfe25c7b9f7b — Pos 2 · ronda 2

bans: Shadow Shaman, Crystal Maiden, Lifestealer, Spirit Breaker, Undying, Axe, Lich, Invoker, Ogre Magi, Hoodwink, Drow Ranger, Lion, Magnus, Witch Doctor, Jakiro, Shadow Fiend · propios: Bane, Earth Spirit · rivales: Phantom Lancer, Ember Spirit
- A: Necrophos, Puck, Dragon Knight
- B: Queen of Pain, Necrophos, Puck

### c897965a5b33 — Pos 3 · ronda 2

bans: Earthshaker, Mirana, Magnus, Crystal Maiden, Vengeful Spirit, Lina, Juggernaut, Pudge, Witch Doctor, Necrophos, Dawnbreaker, Shadow Shaman, Phantom Assassin, Shadow Fiend, Sniper, Slardar, Disruptor · propios: Bounty Hunter, Lion · rivales: Keeper of the Light, Tusk
- A: Underlord, Timbersaw, Dark Seer
- B: Underlord, Timbersaw, Primal Beast

### c22a81b693ab — Pos 5 · ronda 1

bans: Lifestealer, Mirana, Snapfire, Necrophos, Magnus, Witch Doctor, Wraith King, Hoodwink, Earthshaker, Shadow Fiend, Invoker, Night Stalker, Windranger, Outworld Destroyer, Phantom Lancer, Skywrath Mage · propios: — · rivales: —
- A: Undying, Ringmaster, Lich
- B: Undying, Shadow Shaman, Ogre Magi

### 67263f8f32a7 — Pos 4 · ronda 1

bans: Axe, Shadow Fiend, Lina, Lifestealer, Legion Commander, Lion, Shadow Shaman, Silencer, Snapfire, Drow Ranger, Mirana, Magnus, Vengeful Spirit, Queen of Pain, Invoker, Rubick · propios: Keeper of the Light · rivales: —
- A: Spirit Breaker, Pudge, Windranger
- B: Spirit Breaker, Pudge, Nyx Assassin

### 4c39a75ff9ca — Pos 1 · ronda 2

bans: Lina, Pudge, Legion Commander, Sniper, Invoker, Hoodwink, Shadow Shaman, Outworld Destroyer, Drow Ranger, Lifestealer, Axe, Phantom Assassin, Skywrath Mage, Nature's Prophet, Night Stalker, Lich, Disruptor · propios: Techies, Undying, Wraith King · rivales: Anti-Mage, Winter Wyvern
- A: Slark, Spectre, Phantom Lancer
- B: Slark, Morphling, Windranger

### 31b099c7fbfa — Pos 4 · ronda 1

bans: Lifestealer, Shadow Fiend, Spectre, Spirit Breaker, Juggernaut, Invoker, Ogre Magi, Sniper, Witch Doctor, Rubick, Snapfire, Wraith King, Luna, Outworld Destroyer, Undying, Techies · propios: Crystal Maiden · rivales: —
- A: Nyx Assassin, Pudge, Zeus
- B: Pudge, Dark Willow, Mirana

### 13f23864b467 — Pos 5 · ronda 1

bans: Windranger, Sniper, Techies, Crystal Maiden, Phantom Assassin, Drow Ranger, Mirana, Luna, Spirit Breaker, Axe, Legion Commander, Pudge, Invoker, Juggernaut, Phantom Lancer, Faceless Void · propios: — · rivales: —
- A: Oracle, Lion, Witch Doctor
- B: Lion, Undying, Disruptor

### c2c44fe7f992 — round-1 opening recommends hard support / support

Ronda 1 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: — · rivales: —
- Posición recomendada por el board: Pos 5 · la precedencia declarada elegiría: pos5 (PHASE)
- Top-3 V3: Bounty Hunter, Techies, Mirana
- Board pos1: Terrorblade, Morphling, Ursa
- Board pos2: Earth Spirit, Outworld Destroyer, Invoker
- Board pos3: Underlord, Dawnbreaker, Timbersaw
- Board pos4: Bounty Hunter, Techies, Mirana
- Board pos5: Undying, Crystal Maiden, Disruptor

### 449d0e9ea730 — late open initiation/catch gap

Ronda 2 · bans: Wraith King, Earthshaker, Skywrath Mage, Shadow Fiend, Mirana, Sniper, Phantom Assassin, Lifestealer, Windranger, Spirit Breaker, Silencer, Ogre Magi, Lina, Slark, Zeus, Queen of Pain · propios: Ringmaster, Techies, Anti-Mage · rivales: Storm Spirit, Tusk
- Posición recomendada por el board: Pos 3 · la precedencia declarada elegiría: pos3 (PHASE)
- Top-3 V3: Underlord, Dawnbreaker, Mars
- Board pos2: Puck, Ember Spirit, Pangolier
- Board pos3: Underlord, Dawnbreaker, Mars

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

