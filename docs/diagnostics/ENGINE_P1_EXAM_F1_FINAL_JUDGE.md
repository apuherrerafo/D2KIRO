# Paquete del juez de F1 — `ENGINE_P1_EXAM_F1_FINAL`

**Sin respuestas.** Este documento reúne situaciones reales del examen (120 drafts del simulador) para que una persona que sabe de Dota juzgue la **calidad estratégica**, que ningún número del examen puede medir. Nadie rellenó nada por ti.

Cómo responder: una respuesta corta por pregunta y, si dices "dañino", el motivo de Dota en una frase. "No sé" es una respuesta válida. La clave de las lecturas ciegas está en `ENGINE_P1_EXAM_F1_FINAL_JUDGE_KEY.json`: ábrela **después** de responder. (La clave NO está en el repositorio público: se entrega aparte, después de tu respuesta.)

## Preguntas por componente
- **C1-position** Position order: is the position the board recommends the right one to commit to NOW (and not just the lowest open one)?
- **C2-ranking** Hero ranking: are the heroes shown for that position the ones you would consider, or do they look chosen for being popular?
- **C3-composition** Composition: does the advice notice what the team still lacks (initiation / catch / damage mix)?
- **C4-exposure** Exposure: is any recommended hero a clear counter-target of what the rival has shown, and does the card say so?

## Preguntas de plan
- **P1-tempo** Does this team need to win early, or can it scale?
- **P2-objectives** Can this draft convert an advantage into objectives?
- **P3-plan** Does the recommendation improve the plan, or only the score?

## Parte 1 — Situaciones (C1–C4 y P1–P3)

Para cada situación: lo que el Coach muestra. Responde C1, C2, C3, C4 (¿bien / mal / no aplica?) y P1, P3.

### c2c44fe7f992 — round-1 opening recommends hard support / support

Ronda 1 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: — · rivales: —
- Posición recomendada por el board: Pos 5 · la precedencia declarada elegiría: pos5 (PHASE)
- Top-3 V3: Bounty Hunter, Techies, Mirana
- Board pos1: Terrorblade, Morphling, Ursa
- Board pos2: Earth Spirit, Outworld Destroyer, Invoker
- Board pos3: Underlord, Dawnbreaker, Timbersaw
- Board pos4: Bounty Hunter, Techies, Mirana
- Board pos5: Undying, Crystal Maiden, Disruptor
- Tarjetas que ve el jugador (Pos 1):
  - **Terrorblade** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Morphling** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: exposed_to_counter (Doom) · counters duros aún disponibles: Doom
  - **Ursa** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: exposed_to_counter (Shadow Demon) · counters duros aún disponibles: Shadow Demon

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### af20d530f8d3 — round 2 after rival reveals

Ronda 2 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Undying · propios: Techies, Winter Wyvern · rivales: Sven, Oracle
- Posición recomendada por el board: Pos 3 · la precedencia declarada elegiría: pos3 (COUNTER_WINDOW)
- Top-3 V3: Brewmaster, Axe, Slardar
- Board pos1: Anti-Mage, Kez, Spectre
- Board pos2: Pangolier, Void Spirit, Earth Spirit
- Board pos3: Axe, Brewmaster, Slardar
- Tarjetas que ve el jugador (Pos 1):
  - **Anti-Mage** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: exposed_to_counter (Axe) · counters duros aún disponibles: Axe
  - **Kez** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Spectre** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: exposed_to_counter (Viper) · counters duros aún disponibles: Viper

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### 49ac0b3f1872 — round-1 opening whose first card has a curated hard counter still available

Ronda 1 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Undying · propios: Techies · rivales: Sven
- Posición recomendada por el board: Pos 5 · la precedencia declarada elegiría: pos5 (COUNTER_WINDOW)
- Top-3 V3: Lich, Winter Wyvern, Shadow Shaman
- Board pos1: Anti-Mage, Spectre, Templar Assassin
- Board pos2: Void Spirit, Pangolier, Earth Spirit
- Board pos3: Brewmaster, Dawnbreaker, Underlord
- Board pos5: Winter Wyvern, Lich, Shadow Shaman
- Tarjetas que ve el jugador (Pos 1):
  - **Anti-Mage** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: exposed_to_counter (Axe) · counters duros aún disponibles: Axe
  - **Spectre** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: exposed_to_counter (Viper) · counters duros aún disponibles: Viper
  - **Templar Assassin** — Fuerte contra Sven · base: statistical · riesgos: exposed_to_counter (Venomancer, Viper) · counters duros aún disponibles: Viper, Venomancer

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### fd947d4e75a7 — round-1 opening whose first card has a curated hard counter still available

Ronda 1 · bans: Shadow Shaman, Crystal Maiden, Lifestealer, Spirit Breaker, Undying, Axe, Lich, Invoker, Ogre Magi, Hoodwink, Drow Ranger, Lion, Magnus, Witch Doctor, Jakiro, Shadow Fiend · propios: Dazzle · rivales: —
- Posición recomendada por el board: Pos 4 · la precedencia declarada elegiría: pos4 (PHASE)
- Top-3 V3: Snapfire, Techies, Zeus
- Board pos1: Juggernaut, Sven, Spectre
- Board pos2: Sniper, Earthshaker, Void Spirit
- Board pos3: Underlord, Dark Seer, Dawnbreaker
- Board pos4: Snapfire, Techies, Zeus
- Tarjetas que ve el jugador (Pos 2):
  - **Sniper** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: exposed_to_counter (Storm Spirit, Spectre) · counters duros aún disponibles: Storm Spirit, Spectre
  - **Earthshaker** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Void Spirit** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: exposed_to_counter (Night Stalker) · counters duros aún disponibles: Night Stalker

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### f4f5d8c6e011 — round-1 opening whose first card has a curated hard counter still available

Ronda 1 · bans: Pudge, Wraith King, Invoker, Juggernaut, Legion Commander, Vengeful Spirit, Lion, Rubick, Shadow Fiend, Phantom Assassin, Skywrath Mage, Ember Spirit, Queen of Pain, Bristleback, Venomancer, Dragon Knight · propios: — · rivales: —
- Posición recomendada por el board: Pos 5 · la precedencia declarada elegiría: pos5 (PHASE)
- Top-3 V3: Crystal Maiden, Lich, Tusk
- Board pos1: Templar Assassin, Morphling, Ursa
- Board pos2: Void Spirit, Earth Spirit, Outworld Destroyer
- Board pos3: Enigma, Magnus, Necrophos
- Board pos4: Nyx Assassin, Dark Willow, Spirit Breaker
- Board pos5: Crystal Maiden, Lich, Tusk
- Tarjetas que ve el jugador (Pos 4):
  - **Nyx Assassin** — Evidencia sólida de que funciona como support · base: statistical · riesgos: exposed_to_counter (Slardar) · counters duros aún disponibles: Slardar
  - **Dark Willow** — Evidencia sólida de que funciona como support · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Spirit Breaker** — Evidencia sólida de que funciona como support · base: statistical · riesgos: exposed_to_counter (Underlord) · counters duros aún disponibles: Underlord

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### f579422e7113 — a card carries CRITICAL_GAP

Ronda 2 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Undying, Axe · propios: Techies, Winter Wyvern, Anti-Mage · rivales: Sven, Oracle, Bounty Hunter
- Posición recomendada por el board: Pos 3 · la precedencia declarada elegiría: pos3 (COUNTER_WINDOW)
- Top-3 V3: Slardar, Tidehunter, Brewmaster
- Board pos2: Void Spirit, Storm Spirit, Earth Spirit
- Board pos3: Slardar, Tidehunter, Brewmaster
- Tarjetas que ve el jugador (Pos 3):
  - **Slardar** — Le ganás a Bounty Hunter · base: curated · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Tidehunter** — Evidencia sólida de que funciona como offlane · base: statistical · riesgos: exposed_to_counter (Elder Titan) · counters duros aún disponibles: Elder Titan
  - **Brewmaster** — Fuerte contra Sven · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### e4cfcae2a00d — a card carries CRITICAL_GAP

Ronda 2 · bans: Lina, Shadow Fiend, Phantom Lancer, Pudge, Shadow Shaman, Techies, Axe, Spirit Breaker, Invoker, Underlord, Luna, Witch Doctor, Wraith King, Crystal Maiden, Lion, Earthshaker · propios: Necrophos, Anti-Mage, Ancient Apparition · rivales: Undying, Sven
- Posición recomendada por el board: Pos 4 · la precedencia declarada elegiría: pos4 (COUNTER_WINDOW)
- Top-3 V3: Dawnbreaker, Slardar, Brewmaster
- Board pos3: Dawnbreaker, Slardar, Brewmaster
- Board pos4: Snapfire, Nyx Assassin, Dark Willow
- Tarjetas que ve el jugador (Pos 4):
  - **Snapfire** — Le ganás a Undying · base: curated · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Nyx Assassin** — Evidencia sólida de que funciona como support · base: statistical · riesgos: exposed_to_counter (Slardar) · counters duros aún disponibles: Slardar
  - **Dark Willow** — Evidencia sólida de que funciona como support · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### e8b84d749418 — a card carries CRITICAL_GAP

Ronda 2 · bans: Witch Doctor, Sniper, Lina, Pudge, Undying, Juggernaut, Lion, Ogre Magi, Wraith King, Invoker, Silencer, Spirit Breaker, Slark, Lifestealer, Earthshaker, Magnus · propios: Troll Warlord, Broodmother, Lich · rivales: Skywrath Mage, Ember Spirit
- Posición recomendada por el board: Pos 2 · la precedencia declarada elegiría: pos2 (COUNTER_WINDOW)
- Top-3 V3: Puck, Snapfire, Pangolier
- Board pos2: Puck, Snapfire, Pangolier
- Board pos5: Disruptor, Ringmaster, Grimstroke
- Tarjetas que ve el jugador (Pos 2):
  - **Puck** — Le ganás a Ember Spirit. 1 de sus counters está baneado: Silencer · base: curated · riesgos: exposed_to_counter (Night Stalker); CRITICAL_GAP · counters duros aún disponibles: Night Stalker
  - **Snapfire** — Fuerte contra Skywrath Mage · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Pangolier** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: exposed_to_counter (Bloodseeker) · counters duros aún disponibles: Bloodseeker

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### a05e55d37022 — round 3 closing pick

Ronda 3 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Undying, Axe · propios: Techies, Winter Wyvern, Anti-Mage, Slardar · rivales: Sven, Oracle, Bounty Hunter, Timbersaw
- Posición recomendada por el board: Pos 2 · la precedencia declarada elegiría: pos2 (SINGLE_POSITION)
- Top-3 V3: Necrophos, Void Spirit, Earth Spirit
- Board pos2: Necrophos, Void Spirit, Earth Spirit
- Tarjetas que ve el jugador (Pos 2):
  - **Necrophos** — Fuerte contra Sven · base: statistical · riesgos: ninguno · counters duros aún disponibles: Ancient Apparition, Muerta
  - **Void Spirit** — Fuerte contra Sven · base: statistical · riesgos: ninguno · counters duros aún disponibles: Night Stalker
  - **Earth Spirit** — Fuerte contra Timbersaw y Sven. 1 de sus counters está baneado: Legion Commander · base: mixed · riesgos: ninguno · counters duros aún disponibles: ninguno

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### 7ee777d62e2d — uniform sample, round 1

Ronda 1 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: Undying · rivales: —
- Posición recomendada por el board: Pos 4 · la precedencia declarada elegiría: pos4 (PHASE)
- Top-3 V3: Techies, Mirana, Bounty Hunter
- Board pos1: Terrorblade, Sven, Spectre
- Board pos2: Invoker, Void Spirit, Ember Spirit
- Board pos3: Underlord, Dawnbreaker, Slardar
- Board pos4: Techies, Mirana, Bounty Hunter
- Tarjetas que ve el jugador (Pos 1):
  - **Terrorblade** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Sven** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: exposed_to_counter (Winter Wyvern) · counters duros aún disponibles: Winter Wyvern
  - **Spectre** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: exposed_to_counter (Viper) · counters duros aún disponibles: Viper

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### 3db28f3750b1 — uniform sample, round 1

Ronda 1 · bans: Phantom Lancer, Rubick, Legion Commander, Axe, Juggernaut, Lion, Necrophos, Lina, Hoodwink, Shadow Shaman, Witch Doctor, Techies, Pudge, Skywrath Mage, Queen of Pain, Undying · propios: — · rivales: —
- Posición recomendada por el board: Pos 5 · la precedencia declarada elegiría: pos5 (PHASE)
- Top-3 V3: Crystal Maiden, Oracle, Dazzle
- Board pos1: Phantom Assassin, Anti-Mage, Morphling
- Board pos2: Outworld Destroyer, Earth Spirit, Sniper
- Board pos3: Slardar, Enigma, Mars
- Board pos4: Dark Willow, Nyx Assassin, Windranger
- Board pos5: Crystal Maiden, Oracle, Dazzle
- Tarjetas que ve el jugador (Pos 2):
  - **Outworld Destroyer** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: exposed_to_counter (Nyx Assassin) · counters duros aún disponibles: Nyx Assassin
  - **Earth Spirit** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Sniper** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: exposed_to_counter (Storm Spirit, Spectre) · counters duros aún disponibles: Storm Spirit, Spectre

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### dcf348593401 — uniform sample, round 1

Ronda 1 · bans: Spirit Breaker, Windranger, Lifestealer, Ogre Magi, Crystal Maiden, Shadow Shaman, Invoker, Magnus, Legion Commander, Techies, Pudge, Lina, Witch Doctor, Rubick, Hoodwink, Anti-Mage · propios: — · rivales: —
- Posición recomendada por el board: Pos 5 · la precedencia declarada elegiría: pos5 (PHASE)
- Top-3 V3: Skywrath Mage, Zeus, Bounty Hunter
- Board pos1: Ursa, Spectre, Phantom Lancer
- Board pos2: Earth Spirit, Storm Spirit, Tinker
- Board pos3: Centaur Warrunner, Enigma, Dark Seer
- Board pos4: Skywrath Mage, Zeus, Bounty Hunter
- Board pos5: Ringmaster, Lich, Winter Wyvern
- Tarjetas que ve el jugador (Pos 2):
  - **Earth Spirit** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Storm Spirit** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: exposed_to_counter (Nyx Assassin) · counters duros aún disponibles: Nyx Assassin
  - **Tinker** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: exposed_to_counter (Spectre) · counters duros aún disponibles: Spectre

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### 7a8eeb5fe696 — uniform sample, round 2

Ronda 2 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Undying · propios: Techies, Winter Wyvern, Axe · rivales: Sven, Oracle
- Posición recomendada por el board: Pos 1 · la precedencia declarada elegiría: pos1 (PHASE)
- Top-3 V3: Anti-Mage, Kez, Spectre
- Board pos1: Anti-Mage, Kez, Spectre
- Board pos2: Necrophos, Void Spirit, Pangolier
- Tarjetas que ve el jugador (Pos 1):
  - **Anti-Mage** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Kez** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Spectre** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: exposed_to_counter (Viper) · counters duros aún disponibles: Viper

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### 1e9a8fa43dda — uniform sample, round 2

Ronda 2 · bans: Phantom Lancer, Rubick, Legion Commander, Axe, Juggernaut, Lion, Necrophos, Lina, Hoodwink, Shadow Shaman, Witch Doctor, Techies, Pudge, Skywrath Mage, Queen of Pain, Undying · propios: Ogre Magi, Mirana, Mars · rivales: Windranger, Dawnbreaker
- Posición recomendada por el board: Pos 1 · la precedencia declarada elegiría: pos1 (PHASE)
- Top-3 V3: Spectre, Faceless Void, Lifestealer
- Board pos1: Spectre, Faceless Void, Lifestealer
- Board pos2: Void Spirit, Arc Warden, Ember Spirit
- Tarjetas que ve el jugador (Pos 1):
  - **Spectre** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: exposed_to_counter (Viper) · counters duros aún disponibles: Viper
  - **Faceless Void** — Evidencia sólida de que funciona como carry · base: statistical · riesgos: exposed_to_counter (Winter Wyvern) · counters duros aún disponibles: Winter Wyvern
  - **Lifestealer** — Fuerte contra Dawnbreaker. 1 de sus counters está baneado: Phantom Lancer · base: mixed · riesgos: exposed_to_counter (Razor) · counters duros aún disponibles: Razor

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### 0815ea5e2488 — uniform sample, round 2

Ronda 2 · bans: Lion, Legion Commander, Earthshaker, Lifestealer, Magnus, Windranger, Necrophos, Dawnbreaker, Phantom Lancer, Outworld Destroyer, Night Stalker, Snapfire, Sniper, Jakiro, Faceless Void, Techies · propios: Undying, Pudge, Underlord · rivales: Spirit Breaker, Queen of Pain
- Posición recomendada por el board: Pos 2 · la precedencia declarada elegiría: pos2 (COUNTER_WINDOW)
- Top-3 V3: Kez, Morphling, Tiny
- Board pos1: Kez, Morphling, Tiny
- Board pos2: Puck, Keeper of the Light, Earth Spirit
- Tarjetas que ve el jugador (Pos 2):
  - **Keeper of the Light** — Fuerte contra Queen of Pain y Spirit Breaker. 1 de sus counters está baneado: Faceless Void · base: mixed · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Puck** — Le ganás a Queen of Pain. 1 de sus counters está baneado: Night Stalker · base: curated · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Earth Spirit** — Fuerte contra Queen of Pain. 2 de sus counters están baneados: Legion Commander y Lifestealer · base: mixed · riesgos: ninguno · counters duros aún disponibles: ninguno

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### 32c0ab9beda0 — uniform sample, round 3

Ronda 3 · bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: Disruptor, Skywrath Mage, Enigma, Sven · rivales: Underlord, Mirana, Invoker, Lich
- Posición recomendada por el board: Pos 2 · la precedencia declarada elegiría: pos2 (SINGLE_POSITION)
- Top-3 V3: Outworld Destroyer, Void Spirit, Tinker
- Board pos2: Outworld Destroyer, Void Spirit, Tinker
- Tarjetas que ve el jugador (Pos 2):
  - **Outworld Destroyer** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: ninguno · counters duros aún disponibles: Nyx Assassin
  - **Void Spirit** — Fuerte contra Lich · base: statistical · riesgos: ninguno · counters duros aún disponibles: Night Stalker
  - **Tinker** — Fuerte contra Invoker · base: statistical · riesgos: ninguno · counters duros aún disponibles: Spectre, Anti-Mage

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### ed12d0ec5965 — uniform sample, round 3

Ronda 3 · bans: Phantom Lancer, Rubick, Legion Commander, Axe, Juggernaut, Lion, Necrophos, Lina, Hoodwink, Shadow Shaman, Witch Doctor, Techies, Pudge, Skywrath Mage, Queen of Pain, Undying · propios: Ogre Magi, Mirana, Mars, Faceless Void · rivales: Windranger, Dawnbreaker, Treant Protector, Phantom Assassin
- Posición recomendada por el board: Pos 2 · la precedencia declarada elegiría: pos2 (SINGLE_POSITION)
- Top-3 V3: Void Spirit, Arc Warden, Ember Spirit
- Board pos2: Void Spirit, Arc Warden, Ember Spirit
- Tarjetas que ve el jugador (Pos 2):
  - **Void Spirit** — Fuerte contra Dawnbreaker · base: statistical · riesgos: ninguno · counters duros aún disponibles: Night Stalker
  - **Arc Warden** — Evidencia sólida de que funciona como midlane · base: statistical · riesgos: ninguno · counters duros aún disponibles: Meepo
  - **Ember Spirit** — Fuerte contra Phantom Assassin y Windranger · base: statistical · riesgos: ninguno · counters duros aún disponibles: Puck

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

### 165a730850f2 — uniform sample, round 3

Ronda 3 · bans: Spirit Breaker, Windranger, Lifestealer, Ogre Magi, Crystal Maiden, Shadow Shaman, Invoker, Magnus, Legion Commander, Techies, Pudge, Lina, Witch Doctor, Rubick, Hoodwink, Anti-Mage · propios: Broodmother, Earth Spirit, Sven, Gyrocopter · rivales: Winter Wyvern, Zeus, Dark Seer, Luna
- Posición recomendada por el board: Pos 3 · la precedencia declarada elegiría: pos3 (SINGLE_POSITION)
- Top-3 V3: Axe, Night Stalker, Wraith King
- Board pos3: Axe, Night Stalker, Wraith King
- Tarjetas que ve el jugador (Pos 3):
  - **Axe** — Fuerte contra Winter Wyvern y Luna. 1 de sus counters está baneado: Lifestealer · base: mixed · riesgos: ninguno · counters duros aún disponibles: ninguno
  - **Night Stalker** — Fuerte contra Zeus · base: statistical · riesgos: ninguno · counters duros aún disponibles: Naga Siren
  - **Wraith King** — Fuerte contra Zeus · base: statistical · riesgos: ninguno · counters duros aún disponibles: ninguno

Respuestas: C1 _______________ · C2 _______________ · C3 _______________ · C4 _______________ · P1 _______________ · P2 _______________ · P3 _______________
Notas: _______________

## Parte 2 — Decisiones cambiadas por TSK-253 (lectura ciega)

¿Cuál de las dos ternas elegirías para esa posición? (A y B no indican cuál es la regla vieja.)

### f579422e7113 — Pos 3 · ronda 2

bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger, Undying, Axe · propios: Techies, Winter Wyvern, Anti-Mage · rivales: Sven, Oracle, Bounty Hunter
- A: Slardar, Tidehunter, Brewmaster
- B: Slardar, Tidehunter, Necrophos

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

### 9118bc5128aa — Pos 1 · ronda 2

bans: Earthshaker, Windranger, Legion Commander, Shadow Fiend, Pudge, Hoodwink, Zeus, Lion, Spirit Breaker, Magnus, Lina, Witch Doctor, Sniper, Ogre Magi, Snapfire, Drow Ranger · propios: Disruptor, Skywrath Mage, Enigma · rivales: Underlord, Mirana
- A: Kez, Sven, Juggernaut
- B: Kez, Sven, Necrophos

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

### a22692eafd76 — Pos 1 · ronda 2

bans: Shadow Fiend, Windranger, Luna, Undying, Mirana, Ogre Magi, Phantom Assassin, Lifestealer, Sniper, Necrophos, Spirit Breaker, Axe, Pudge, Zeus, Skywrath Mage, Razor · propios: Oracle, Techies, Enigma · rivales: Earth Spirit, Ringmaster
- A: Spectre, Anti-Mage, Slark
- B: Spectre, Slark, Ursa

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

### d2efa9cbb017 — Pos 4 · ronda 2

bans: Wraith King, Earthshaker, Skywrath Mage, Shadow Fiend, Mirana, Sniper, Phantom Assassin, Lifestealer, Windranger, Spirit Breaker, Silencer, Ogre Magi, Lina, Slark, Zeus, Queen of Pain · propios: Io, Chen, Razor · rivales: Techies, Spectre
- A: Lion, Pudge, Snapfire
- B: Rubick, Lion, Pudge

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

### 4814d1ccb664 — Pos 1 · ronda 3

bans: Wraith King, Earthshaker, Skywrath Mage, Shadow Fiend, Mirana, Sniper, Phantom Assassin, Lifestealer, Windranger, Spirit Breaker, Silencer, Ogre Magi, Lina, Slark, Zeus, Queen of Pain · propios: Io, Chen, Razor, Undying · rivales: Techies, Spectre, Outworld Destroyer, Ringmaster
- A: Faceless Void, Phantom Lancer, Anti-Mage
- B: Faceless Void, Tiny, Phantom Lancer

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

### e4cfcae2a00d — Pos 4 · ronda 2

bans: Lina, Shadow Fiend, Phantom Lancer, Pudge, Shadow Shaman, Techies, Axe, Spirit Breaker, Invoker, Underlord, Luna, Witch Doctor, Wraith King, Crystal Maiden, Lion, Earthshaker · propios: Necrophos, Anti-Mage, Ancient Apparition · rivales: Undying, Sven
- A: Snapfire, Nyx Assassin, Rubick
- B: Snapfire, Nyx Assassin, Dark Willow

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

### 9aeddbe26973 — Pos 4 · ronda 3

bans: Lina, Shadow Fiend, Phantom Lancer, Pudge, Shadow Shaman, Techies, Axe, Spirit Breaker, Invoker, Underlord, Luna, Witch Doctor, Wraith King, Crystal Maiden, Lion, Earthshaker · propios: Necrophos, Anti-Mage, Ancient Apparition, Death Prophet · rivales: Undying, Sven, Slardar, Windranger
- A: Dark Willow, Snapfire, Earth Spirit
- B: Mirana, Rubick, Dark Willow

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

### b682584fdf86 — Pos 2 · ronda 3

bans: Zeus, Windranger, Spectre, Invoker, Lion, Shadow Shaman, Ogre Magi, Skywrath Mage, Phantom Lancer, Magnus, Mirana, Slark, Witch Doctor, Wraith King, Jakiro, Disruptor · propios: Grimstroke, Techies, Timbersaw, Drow Ranger · rivales: Doom, Pudge, Sniper, Winter Wyvern
- A: Ember Spirit, Earth Spirit, Snapfire
- B: Ember Spirit, Outworld Destroyer, Storm Spirit

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

### 05acdbf6bc2e — Pos 4 · ronda 2

bans: Pudge, Wraith King, Invoker, Juggernaut, Legion Commander, Vengeful Spirit, Lion, Rubick, Shadow Fiend, Phantom Assassin, Skywrath Mage, Ember Spirit, Queen of Pain, Bristleback, Venomancer, Dragon Knight · propios: Ogre Magi, Keeper of the Light, Medusa · rivales: Anti-Mage, Outworld Destroyer
- A: Spirit Breaker, Nyx Assassin, Hoodwink
- B: Spirit Breaker, Nyx Assassin, Snapfire

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

### 4c39a75ff9ca — Pos 1 · ronda 2

bans: Lina, Pudge, Legion Commander, Sniper, Invoker, Hoodwink, Shadow Shaman, Outworld Destroyer, Drow Ranger, Lifestealer, Axe, Phantom Assassin, Skywrath Mage, Nature's Prophet, Night Stalker, Lich, Disruptor · propios: Techies, Undying, Wraith King · rivales: Anti-Mage, Winter Wyvern
- A: Slark, Morphling, Windranger
- B: Spectre, Slark, Morphling

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

### 1fd3344b2fc1 — Pos 1 · ronda 3

bans: Wraith King, Lifestealer, Zeus, Shadow Shaman, Spirit Breaker, Magnus, Skywrath Mage, Legion Commander, Rubick, Invoker, Phantom Lancer, Windranger, Techies, Snapfire, Undying, Venomancer · propios: Shadow Demon, Broodmother, Enchantress, Riki · rivales: Bounty Hunter, Outworld Destroyer, Dawnbreaker, Anti-Mage
- A: Spectre, Faceless Void, Tiny
- B: Spectre, Faceless Void, Phantom Assassin

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

### e8b84d749418 — Pos 2 · ronda 2

bans: Witch Doctor, Sniper, Lina, Pudge, Undying, Juggernaut, Lion, Ogre Magi, Wraith King, Invoker, Silencer, Spirit Breaker, Slark, Lifestealer, Earthshaker, Magnus · propios: Troll Warlord, Broodmother, Lich · rivales: Skywrath Mage, Ember Spirit
- A: Puck, Outworld Destroyer, Snapfire
- B: Puck, Snapfire, Pangolier

Mejor (A / B / equivalente): _______________ · ¿alguna es dañina? motivo de Dota: _______________

## Parte 3 — M1: cubrir el hueco crítico frente a un counter adverso

**Sin casos en esta muestra.** En ningún estado del examen el Coach puso primero a un héroe que cubre el hueco crítico teniendo un counter estadístico adverso contra un rival ya visible (ver la sección M1 del reporte). No hay nada que juzgar aquí; no significa que no pueda ocurrir, solo que no ocurrió.

