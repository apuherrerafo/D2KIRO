# ENGINE_P1_EXAM — línea base del examen de drafter (TSK-250)

Código: `88460ac` (árbol limpio) · estado `976f63c3bf93516d` · snapshot `W5-EMP-001` · clave comparable `4a5a48279c537623`

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
- **I5 sobre todo el campo creíble (TSK-252):** 628 estados con ≥6 creíbles (mediana 29). El top-3 cae en la mitad más jugada 100.0% de las veces y el top-6 99.7% (un corte neutro daría ~50%). `position_fit` explica 82.5% de la dispersión (mediana). Quitando su aporte, el top-3 se conserva en 22.6% (Jaccard) y el top-6 en 26.4%; 100% = no decide nada. Dentro de la mitad más jugada, `position_fit` explica 52.8% de la dispersión.
- **T3 misma decisión, dos reglas (volumen vs mediana de creíbles):** 628 estados; el top-3 cambia en 464 (73.9%); Jaccard medio del top-3 0.5524, del top-6 0.6077; de los cambiados, 464 se apoyan en menos volumen (partidas medias del top-3: 4614.172 → 3782.698). Describe qué se movió, no si mejora. Empates exactos en el corte del top-3 (decide el id del héroe, no el draft): 0.0% → 0.0% de los estados.
- **T3 frente a los rivales ya revelados (solo capa curada "hard"):** en 386 estados con rival visible, héroes del top-3 que counterean a un rival: 0.1114 → 0.1684; héroes del top-3 expuestos a un rival: 0.0078 → 0.0052.
- **I6 relleno:** de 4 estados con hueco abierto, el top-3 lo llena en 4; existe un relleno en lo mostrado en 4.
- **I7 daño:** de 3 estados mono-daño, el top-3 diversifica en 2.
- **I8 exposición del primary de ronda 1:** 0.2066 counters duros disponibles en promedio (máx 1) sobre 121 aperturas.
- **I10 popularidad:** 100.0% de los top-3 de ronda 1 caen en la mitad más jugada de su posición (1815/1815).
- **Concentración del #1:** {"pos1":{"distinctPrimaries":6,"sample":121,"mostCommonShare":0.3306},"pos2":{"distinctPrimaries":9,"sample":121,"mostCommonShare":0.314},"pos3":{"distinctPrimaries":8,"sample":121,"mostCommonShare":0.4298},"pos4":{"distinctPrimaries":8,"sample":121,"mostCommonShare":0.3223},"pos5":{"distinctPrimaries":10,"sample":121,"mostCommonShare":0.3967}}
- **Mostrado pero no creíble en su columna:** 0.

## Cómo reproducir

- `bun scripts/p1-exam/exam.ts --out=ENGINE_P1_EXAM_T3_BASE --drafts=120`

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

### acd7718cd23d — Pos 4 · ronda 1

bans: Shadow Fiend, Rubick, Pudge, Legion Commander, Slark, Magnus, Queen of Pain, Invoker, Luna, Crystal Maiden, Earthshaker, Ogre Magi, Skywrath Mage, Bounty Hunter, Centaur Warrunner, Night Stalker · propios: Lion · rivales: —
- A: Mirana, Windranger, Techies
- B: Mirana, Snapfire, Windranger

### 7c34943a2715 — Pos 2 · ronda 3

bans: Sniper, Axe, Windranger, Lion, Pudge, Hoodwink, Skywrath Mage, Shadow Shaman, Undying, Phantom Lancer, Lina, Necrophos, Silencer, Spirit Breaker, Night Stalker, Spectre · propios: Witch Doctor, Mirana, Slardar, Anti-Mage · rivales: Disruptor, Underlord, Luna, Ember Spirit
- A: Outworld Destroyer, Tinker, Puck
- B: Outworld Destroyer, Tinker, Invoker

### be062b4b5110 — Pos 3 · ronda 2

bans: Lion, Shadow Shaman, Invoker, Juggernaut, Witch Doctor, Ogre Magi, Magnus, Earthshaker, Shadow Fiend, Rubick, Windranger, Mirana, Luna, Grimstroke, Bristleback, Viper · propios: Enchantress, Gyrocopter, Pangolier · rivales: Slardar, Lich
- A: Brewmaster, Dark Seer, Enigma
- B: Dark Seer, Enigma, Dawnbreaker

### 5cac71d924ad — Pos 3 · ronda 2

bans: Phantom Assassin, Invoker, Earthshaker, Ogre Magi, Undying, Hoodwink, Lifestealer, Axe, Luna, Mirana, Sniper, Crystal Maiden, Lich, Shadow Shaman, Lion, Night Stalker · propios: Disruptor, Techies · rivales: Windranger, Pudge
- A: Magnus, Mars, Timbersaw
- B: Magnus, Timbersaw, Legion Commander

### 84b9b8dff51e — Pos 3 · ronda 2

bans: Shadow Shaman, Lifestealer, Lina, Sniper, Crystal Maiden, Axe, Shadow Fiend, Phantom Lancer, Sven, Windranger, Necrophos, Invoker, Undying, Slark, Pudge, Wraith King · propios: Disruptor, Techies · rivales: Centaur Warrunner, Juggernaut
- A: Timbersaw, Night Stalker, Underlord
- B: Brewmaster, Timbersaw, Night Stalker

### c897965a5b33 — Pos 3 · ronda 2

bans: Earthshaker, Mirana, Magnus, Crystal Maiden, Vengeful Spirit, Lina, Juggernaut, Pudge, Witch Doctor, Necrophos, Dawnbreaker, Shadow Shaman, Phantom Assassin, Shadow Fiend, Sniper, Slardar, Disruptor · propios: Techies, Oracle · rivales: Keeper of the Light, Tusk
- A: Underlord, Timbersaw, Centaur Warrunner
- B: Primal Beast, Underlord, Timbersaw

### c22a81b693ab — Pos 5 · ronda 1

bans: Lifestealer, Mirana, Snapfire, Necrophos, Magnus, Witch Doctor, Wraith King, Hoodwink, Earthshaker, Shadow Fiend, Invoker, Night Stalker, Windranger, Outworld Destroyer, Phantom Lancer, Skywrath Mage · propios: — · rivales: —
- A: Undying, Ringmaster, Lich
- B: Undying, Shadow Shaman, Ogre Magi

### 9250ccbc94fd — Pos 4 · ronda 2

bans: Axe, Shadow Fiend, Lina, Lifestealer, Legion Commander, Lion, Shadow Shaman, Silencer, Snapfire, Drow Ranger, Mirana, Magnus, Vengeful Spirit, Queen of Pain, Invoker, Rubick · propios: Nyx Assassin, Sniper · rivales: Juggernaut, Techies
- A: Grimstroke, Pudge, Spirit Breaker
- B: Pudge, Spirit Breaker, Skywrath Mage

### 4c39a75ff9ca — Pos 1 · ronda 2

bans: Lina, Pudge, Legion Commander, Sniper, Invoker, Hoodwink, Shadow Shaman, Outworld Destroyer, Drow Ranger, Lifestealer, Axe, Phantom Assassin, Skywrath Mage, Nature's Prophet, Night Stalker, Lich, Disruptor · propios: Techies, Undying, Timbersaw · rivales: Anti-Mage, Winter Wyvern
- A: Slark, Spectre, Phantom Lancer
- B: Slark, Morphling, Windranger

### c370745c1056 — Pos 5 · ronda 1

bans: Lina, Windranger, Rubick, Phantom Lancer, Bounty Hunter, Spectre, Sniper, Phantom Assassin, Luna, Underlord, Snapfire, Axe, Spirit Breaker, Legion Commander, Earthshaker, Wraith King · propios: — · rivales: —
- A: Undying, Crystal Maiden, Mirana
- B: Undying, Shadow Shaman, Oracle

### 5aa711d7f2a5 — Pos 1 · ronda 2

bans: Windranger, Sniper, Techies, Crystal Maiden, Phantom Assassin, Drow Ranger, Mirana, Luna, Spirit Breaker, Axe, Legion Commander, Pudge, Invoker, Juggernaut, Phantom Lancer, Faceless Void · propios: Ringmaster, Dark Willow, Timbersaw · rivales: Anti-Mage, Dawnbreaker
- A: Spectre, Morphling, Slark
- B: Spectre, Slark, Shadow Fiend

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

