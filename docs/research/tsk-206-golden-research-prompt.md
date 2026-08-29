# Golden Dataset — investigación de etiquetas (dota2coach, Fase 9.0 / TSK-206)

## Qué necesito de vos (modelo)

Estoy construyendo la CLAVE DE RESPUESTAS de un coach de draft de Dota 2 (parche actual ~7.4x, nivel pro / inmortal / Captains Mode). Para cada situación de draft abajo te doy: bans, picks de cada equipo, a qué lado le toca elegir, y qué recomienda hoy mi motor. Vos, con criterio de drafting competitivo ACTUAL, decís para cada caso:

- **excellent**: 1 a 3 héroes que serían picks muy fuertes EN ESE MOMENTO EXACTO (counter real a lo revelado, cubre un rol/necesidad que le falta al equipo, buen timing, sinergia concreta). No listes buenos héroes en abstracto.
- **acceptable**: 0 a 3 héroes razonables pero no óptimos ahí.
- **bad**: 1 a 3 héroes que serían un ERROR en ese momento (countereados por lo revelado, repiten un rol ya cubierto, mala fase de línea, se punishean fácil).
- Para CADA héroe: una frase de por qué, con mecánica concreta (nombre de habilidad, matchup de lane, timing de item).
- **tags**: 2 a 4 etiquetas de razonamiento (ej: counter, role-need, tempo, teamfight, splitpush, punishable, flexibility, scaling).
- **stratum**: exactamente UNA de: hard_counter, flexibility, role_scarcity, team_needs, composition, punishability, historical_failure.

Reglas: sé conservador — si no estás seguro de que un héroe sea claramente excellent o bad, no lo pongas o mandalo a acceptable. Un héroe NO puede aparecer en dos listas. Usá los nombres de héroe tal cual aparecen abajo.

## Formato de tu respuesta — exactamente esto, un bloque por caso:

```
CASO <n>
excellent: <Héroe> | <por qué>
excellent: <Héroe> | <por qué>
acceptable: <Héroe> | <por qué>
bad: <Héroe> | <por qué>
bad: <Héroe> | <por qué>
tags: <tag>, <tag>, <tag>
stratum: <uno de la lista>
```

Son 30 casos. Respondé los 30 bloques seguidos.

---

## CASO 1 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Radiant**
- Baneados: (ninguno)
- Radiant tiene: Crystal Maiden, Mars
- Dire tiene: Axe, Lion
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Monkey King, Outworld Destroyer, Gyrocopter, Meepo, Tinker, Tiny

## CASO 2 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Radiant**
- Baneados: (ninguno)
- Radiant tiene: Rubick, Tidehunter
- Dire tiene: Phantom Assassin, Grimstroke
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Warlock, Troll Warlord, Lifestealer, Ursa, Slark, Clinkz

## CASO 3 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Radiant**
- Baneados: (ninguno)
- Radiant tiene: Dazzle, Underlord
- Dire tiene: Nyx Assassin, Spirit Breaker
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Drow Ranger, Huskar, Arc Warden, Weaver, Meepo, Juggernaut

## CASO 4 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Radiant**
- Baneados: (ninguno)
- Radiant tiene: Warlock, Timbersaw
- Dire tiene: Nyx Assassin, Ancient Apparition
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Spectre, Weaver, Phantom Lancer, Bounty Hunter, Earth Spirit, Terrorblade

## CASO 5 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Radiant**
- Baneados: (ninguno)
- Radiant tiene: Enigma, Winter Wyvern
- Dire tiene: Zeus, Earthshaker
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Juggernaut, Sniper, Anti-Mage, Huskar, Luna, Void Spirit

## CASO 6 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Radiant**
- Baneados: (ninguno)
- Radiant tiene: Shadow Shaman, Beastmaster
- Dire tiene: Ember Spirit, Legion Commander
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Bloodseeker, Lifestealer, Sven, Troll Warlord, Puck, Juggernaut

## CASO 7 — APERTURA (todavía nadie pickeó)

- Tu lado: **Radiant**
- Baneados: Abaddon, Beastmaster, Magnus, Pangolier, Void Spirit, Sand King, Visage
- Radiant tiene: (ninguno)
- Dire tiene: (ninguno)
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Crystal Maiden, Mirana, Shadow Shaman, Pugna, Dazzle, Clockwerk
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Marci*.)

## CASO 8 — APERTURA (todavía nadie pickeó)

- Tu lado: **Dire**
- Baneados: Snapfire, Bane, Lone Druid, Clockwerk, Axe, Keeper of the Light, Shadow Fiend
- Radiant tiene: (ninguno)
- Dire tiene: (ninguno)
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Crystal Maiden, Mirana, Shadow Shaman, Witch Doctor, Lich, Warlock
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Treant Protector*.)

## CASO 9 — APERTURA (todavía nadie pickeó)

- Tu lado: **Dire**
- Baneados: Lone Druid, Slardar, Clockwerk, Snapfire, Beastmaster, Pangolier, Kez
- Radiant tiene: (ninguno)
- Dire tiene: (ninguno)
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Crystal Maiden, Mirana, Shadow Shaman, Warlock, Venomancer, Pugna
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Windranger*.)

## CASO 10 — APERTURA (todavía nadie pickeó)

- Tu lado: **Dire**
- Baneados: Kez, Treant Protector, Snapfire, Lone Druid, Weaver, Axe, Silencer
- Radiant tiene: (ninguno)
- Dire tiene: (ninguno)
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Bane, Mirana, Shadow Shaman, Lich, Venomancer, Pugna
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Windranger*.)

## CASO 11 — APERTURA (todavía nadie pickeó)

- Tu lado: **Radiant**
- Baneados: Clockwerk, Techies, Nyx Assassin, Primal Beast, Spirit Breaker, Queen of Pain, Ember Spirit
- Radiant tiene: (ninguno)
- Dire tiene: (ninguno)
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Bane, Crystal Maiden, Mirana, Shadow Shaman, Witch Doctor, Lich
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Bounty Hunter*.)

## CASO 12 — APERTURA (todavía nadie pickeó)

- Tu lado: **Dire**
- Baneados: Batrider, Nature's Prophet, Lone Druid, Treant Protector, Drow Ranger, Keeper of the Light, Shadow Fiend
- Radiant tiene: (ninguno)
- Dire tiene: (ninguno)
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Bane, Crystal Maiden, Mirana, Shadow Shaman, Witch Doctor, Lich
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Puck*.)

## CASO 13 — PICK CIEGO (sin ver rivales)

- Tu lado: **Radiant**
- Baneados: Snapfire, Drow Ranger, Lone Druid, Huskar, Shadow Fiend, Nature's Prophet, Clockwerk
- Radiant tiene: (ninguno)
- Dire tiene: Treant Protector
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Chen, Oracle, Elder Titan, Crystal Maiden, Phoenix, Enchantress
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Techies*.)

## CASO 14 — PICK CIEGO (sin ver rivales)

- Tu lado: **Radiant**
- Baneados: Treant Protector, Batrider, Lone Druid, Puck, Doom, Shadow Fiend, Keeper of the Light
- Radiant tiene: (ninguno)
- Dire tiene: Phoenix
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Oracle, Abaddon, Dazzle, Dark Willow, Bane, Silencer
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Nature's Prophet*.)

## CASO 15 — PICK CIEGO (sin ver rivales)

- Tu lado: **Radiant**
- Baneados: Huskar, Snapfire, Clockwerk, Kez, Beastmaster, Storm Spirit, Puck
- Radiant tiene: (ninguno)
- Dire tiene: Shadow Fiend
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Elder Titan, Venomancer, Ancient Apparition, Shadow Demon, Dark Willow, Witch Doctor
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Windranger*.)

## CASO 16 — PICK CIEGO (sin ver rivales)

- Tu lado: **Dire**
- Baneados: Tiny, Treant Protector, Abaddon, Brewmaster, Tusk, Viper, Nyx Assassin
- Radiant tiene: Weaver
- Dire tiene: (ninguno)
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Bane, Silencer, Elder Titan, Venomancer, Dark Willow, Shadow Demon
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Enchantress*.)

## CASO 17 — PICK CIEGO (sin ver rivales)

- Tu lado: **Radiant**
- Baneados: Beastmaster, Pangolier, Treant Protector, Clockwerk, Lone Druid, Puck, Hoodwink
- Radiant tiene: (ninguno)
- Dire tiene: Windranger
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Bane, Dazzle, Shadow Demon, Lich, Abaddon, Jakiro
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Storm Spirit*.)

## CASO 18 — PICK CIEGO (sin ver rivales)

- Tu lado: **Radiant**
- Baneados: Venomancer, Sand King, Tinker, Outworld Destroyer, Io, Medusa, Lone Druid
- Radiant tiene: (ninguno)
- Dire tiene: Rubick
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Abaddon, Witch Doctor, Tusk, Grimstroke, Clockwerk, Dazzle
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Undying*.)

## CASO 19 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Dire**
- Baneados: Undying, Shadow Fiend, Lone Druid, Terrorblade, Ember Spirit, Earth Spirit, Lina, Puck, Doom, Largo
- Radiant tiene: Treant Protector, Invoker
- Dire tiene: Hoodwink, Centaur Warrunner
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Riki, Oracle, Sniper, Elder Titan, Morphling, Huskar
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Bane*.)

## CASO 20 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Radiant**
- Baneados: Clockwerk, Largo, Lone Druid, Rubick, Batrider, Hoodwink, Lich, Treant Protector, Tusk, Puck
- Radiant tiene: Axe, Techies
- Dire tiene: Drow Ranger, Bane
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Monkey King, Meepo, Faceless Void, Queen of Pain, Bloodseeker, Riki
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Ember Spirit*.)

## CASO 21 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Radiant**
- Baneados: Ringmaster, Nyx Assassin, Venomancer, Sand King, Arc Warden, Marci, Beastmaster, Oracle, Enigma, Visage
- Radiant tiene: Lina, Ogre Magi
- Dire tiene: Lich, Hoodwink
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Naga Siren, Chaos Knight, Spirit Breaker, Luna, Spectre, Batrider
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Tiny*.)

## CASO 22 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Radiant**
- Baneados: Largo, Hoodwink, Treant Protector, Lone Druid, Ember Spirit, Shadow Fiend, Puck, Keeper of the Light, Bane, Invoker
- Radiant tiene: Undying, Pangolier
- Dire tiene: Storm Spirit, Techies
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Anti-Mage, Spectre, Medusa, Muerta, Juggernaut, Morphling
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Ringmaster*.)

## CASO 23 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Radiant**
- Baneados: Largo, Lina, Treant Protector, Bane, Ember Spirit, Earth Spirit, Nature's Prophet, Winter Wyvern, Io, Slardar
- Radiant tiene: Undying, Pangolier
- Dire tiene: Invoker, Hoodwink
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Sven, Naga Siren, Nyx Assassin, Faceless Void, Luna, Bounty Hunter
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Windranger*.)

## CASO 24 — RESPUESTA (ya hay rivales revelados)

- Tu lado: **Dire**
- Baneados: Centaur Warrunner, Bane, Treant Protector, Undying, Lone Druid, Shadow Fiend, Earth Spirit, Puck, Tiny, Lifestealer
- Radiant tiene: Mirana, Hoodwink
- Dire tiene: Lina, Tusk
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Batrider, Brewmaster, Mars, Lycan, Bristleback, Timbersaw
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Windranger*.)

## CASO 25 — CIERRE (casi todo pickeado)

- Tu lado: **Dire**
- Baneados: Centaur Warrunner, Keeper of the Light, Treant Protector, Invoker, Puck, Clinkz, Windranger, Undying, Hoodwink, Lycan, Dawnbreaker, Lina, Beastmaster, Sniper
- Radiant tiene: Drow Ranger, Dark Willow, Tusk, Viper
- Dire tiene: Clockwerk, Snapfire, Ringmaster, Nature's Prophet
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Enigma, Mars, Death Prophet, Brewmaster, Axe, Underlord
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Lone Druid*.)

## CASO 26 — CIERRE (casi todo pickeado)

- Tu lado: **Radiant**
- Baneados: Underlord, Techies, Treant Protector, Lone Druid, Pangolier, Clockwerk, Puck, Queen of Pain, Axe, Doom, Huskar, Enchantress, Tiny, Snapfire
- Radiant tiene: Kez, Shadow Demon, Largo, Storm Spirit
- Dire tiene: Necrophos, Winter Wyvern, Beastmaster, Hoodwink
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Abaddon, Spirit Breaker, Mars, Chen, Tusk, Pugna
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Rubick*.)

## CASO 27 — CIERRE (casi todo pickeado)

- Tu lado: **Dire**
- Baneados: Puck, Centaur Warrunner, Treant Protector, Shadow Fiend, Undying, Lone Druid, Invoker, Axe, Dawnbreaker, Lifestealer, Enchantress, Drow Ranger, Ringmaster, Tiny
- Radiant tiene: Hoodwink, Storm Spirit, Largo, Windranger
- Dire tiene: Lina, Bane, Muerta, Beastmaster
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Nyx Assassin, Dark Willow, Mirana, Spirit Breaker, Skywrath Mage, Techies
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Earth Spirit*.)

## CASO 28 — CIERRE (casi todo pickeado)

- Tu lado: **Dire**
- Baneados: Lion, Clockwerk, Dawnbreaker, Doom, Phoenix, Legion Commander, Snapfire, Shadow Fiend, Axe, Viper, Pangolier, Necrophos, Huskar, Drow Ranger
- Radiant tiene: Tusk, Bristleback, Dark Willow, Templar Assassin
- Dire tiene: Rubick, Lich, Undying, Slardar
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Muerta, Troll Warlord, Naga Siren, Morphling, Anti-Mage, Juggernaut
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Luna*.)

## CASO 29 — CIERRE (casi todo pickeado)

- Tu lado: **Dire**
- Baneados: Nyx Assassin, Axe, Lone Druid, Treant Protector, Meepo, Clockwerk, Keeper of the Light, Lion, Skywrath Mage, Underlord, Shadow Fiend, Timbersaw, Drow Ranger, Dawnbreaker
- Radiant tiene: Ember Spirit, Hoodwink, Doom, Lich
- Dire tiene: Puck, Largo, Snapfire, Kez
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Shadow Demon, Spirit Breaker, Ancient Apparition, Pugna, Enchantress, Jakiro
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Bane*.)

## CASO 30 — CIERRE (casi todo pickeado)

- Tu lado: **Dire**
- Baneados: Enigma, Timbersaw, Puck, Treant Protector, Lone Druid, Lina, Ember Spirit, Keeper of the Light, Nature's Prophet, Spectre, Slardar, Sven, Dragon Knight, Windranger
- Radiant tiene: Undying, Shadow Fiend, Dark Seer, Bounty Hunter
- Dire tiene: Centaur Warrunner, Clockwerk, Hoodwink, Invoker
- **Te toca pickear ahora.**
- Mi motor recomienda hoy: Alchemist, Troll Warlord, Muerta, Juggernaut, Medusa, Drow Ranger
- (Dato, NO es la respuesta correcta: en la partida pro real eligieron *Necrophos*.)
