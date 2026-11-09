# P0-05C — Saneamiento del conocimiento estratégico

Base: `preview/f4-canonical-light` @ `a2888650`. Solo datos curados (3 JSON). Cero cambios de código, pesos, `mix.ts`, reglas STRONG/WEAK, Live, Party, GSI ni frontend.

## 1. Cómo se verificó

La auditoría P0-05B **no se aceptó tal cual**. Cada afirmación se contrastó contra los archivos del Dota instalado (build 26466928, `ClientVersion=6972`, leídos del VPK en solo lectura):
`scripts/npc/heroes/npc_dota_hero_*.txt` y `resource/localization/abilities_english.txt`. Los archivos de Valve no se copian al repo.
Estadística de apoyo: `hero_matchups` del **mismo snapshot** de P0-05 (sync 2026-09-18), solo para el sentido de las direcciones.

## 2. Qué se corrigió (y qué NO)

| Relación | Archivo | Qué decía | Qué confirma el juego | Decisión |
|---|---|---|---|---|
| Grimstroke + Juggernaut | `hero-synergies.json` | "Soulbind repite Omnislash en el segundo rival" | Soulbind repite "cualquier habilidad con objetivo que reciba uno de los atados". El juego **no lista** una exclusión de Omnislash, así que la auditoría no la demuestra; pero Omnislash ya golpea a los enemigos cercanos, así que repetirlo aporta poco. Lo verificable: Soulbind ata y bloquea Blink; Ink Swell (aliado, pierce BKB) da velocidad y su aturdimiento crece con el tiempo de tinta cerca de héroes; Blade Fury da inmunidad a debuffs | Texto reescrito solo con lo verificable. **La pareja se conserva** (no hay dato para retirarla) y queda marcada para experto |
| Legion Commander vs Anti-Mage | `hero-counters.json` | "Counterspell no protege de nada contra Duel" | Duel es de objetivo, atraviesa BKB, impide habilidades (el Blink de AM es **habilidad**) e ítems. Counterspell activo "bloquea y refleja hechizos con objetivo" | Texto reescrito con el matiz del Counterspell activo. Nivel `medium` se mantiene (Duel sí fija a AM) |
| Templar Assassin vs Sven | `hero-counters.json` | Texto "justo lo que Sven necesita…" | Refraction absorbe **todo** el golpe si supera la barrera, hasta gastar cargas; Meld baja armadura. Estadística del snapshot (parche 7.41e, 79 partidas, TA 45/79): **orientativa, no concluyente** — no prueba que el matchup sea favorable en 7.41f | **No se invirtió el par.** Solo se corrigió el texto (describía el lado de Sven). El counter `medium` se mantiene provisionalmente, **pendiente de experto** |
| Riki vs Anti-Mage | `hero-counters.json` | "No le deja usar Blink ni Manta; Mana Void casi no daña" | Smoke Screen: silencia y falla ataques, **"no impide ítems"** → Manta sí se usa; el Blink de AM es habilidad → sí se apaga. Mana Void daña según el maná **faltante** del objetivo principal: depende de cuánto maná le hayan gastado o quemado a Riki. Con su reserva chica (int base 14) el techo es bajo, pero no es "siempre poco" ni "devastador" por defecto | Texto corregido: Blink sí, Manta no; se conserva la parte válida de Mana Void |
| Nyx vs Storm | `hero-counters.json` | "Carapace aturde en cada Ball Lightning o Remnant; Mana Burn vacía el recurso" | **La auditoría se equivocó**: Nyx tiene Mana Burn **innata** vigente (`nyx_assassin_neuro_sting`, nombre en pantalla "Mana Burn": quema maná como % del daño de sus ataques). Nyx también tiene **Mind Flare** vigente (`nyx_assassin_jolt`, activa: daño como % del maná máximo del objetivo, quema parte de ese maná y suma un eco del daño recibido de Nyx en 15 s); coexiste con la Mana Burn innata (la auditoría la presentaba como reemplazo, y no lo es). Fuentes: `scripts/npc/heroes/npc_dota_hero_nyx_assassin.txt` y `abilities_english.txt` del build 26466928. Carapace aturde a quien **le hace daño** a Nyx (no "en cada" Ball Lightning) | Se conservó Mana Burn; se corrigió la exageración de Carapace. Nivel `hard` intacto (la estadística está ~50/50, ver §6) |

**Auditoría rechazada o desactualizada:** "Mana Burn eliminado en 7.33 y sustituido por Mind Flare" (falso: Mana Burn innata y Mind Flare coexisten); "Ringmaster ausente" (ya curado en la base: `b9cc5819`); "Enigma sin catch" (ya `hasCatch: true`); exclusión de Omnislash en Soulbind (no demostrada).

## 3. Capacidades (`capabilities.json`)

| Héroe | Resultado |
|---|---|
| Enigma (33) | Sin cambio: ya `hasCatch: true` (Malefice). |
| Axe (2) | **Sin cambio.** Berserker's Call es taunt de área, sin objetivo; el repo agrega `hasCatch` solo con "habilidad normal, un objetivo, control real" o con analista citado. Contrafactual medido: marcarlo solo reordena 2 filas WEAK en S06. Pendiente de criterio del dueño. |
| Windranger (21) | **`magical` → `mixed`.** Powershot es `DAMAGE_TYPE_MAGICAL`; Focus Fire y el ataque son físicos. Mismo criterio que Mirana (9, `mixed`). Efecto contrafactual: solo S21 (ver §5). |
| Ringmaster (131), Kez (145) | Ya curados en la base. |
| Largo (155) | Sigue sin curar a propósito: falta una fuente para `hasWaveclear`. No se inventa. |
| `hero-positions.json` | No se tocó. |

## 4. Certificación contrafactual (30 escenarios, mismo snapshot)

El "antes" reproduce **idéntico** el resultado original de P0-05 (0 diferencias) → la comparación es válida. Mismo `meta-copy.sqlite`, mismas expectativas pre-registradas (`scenarios.ts`, sin tocar).

- **Evaluación de expectativas: idéntica** (26 CUMPLE / 4 DIVERGE, mismas filas antes y después).
- **ELIGE AHORA: 0 cambios** en los 30 escenarios (S12 Nyx, S15/S20 Grimstroke, S28 Legion Commander siguen).
- **Ranking/STRONG-WEAK: cambia solo S21** (por Windranger `mixed`): pos 1 `Spectre` STRONG→WEAK, `Phantom Assassin` sale del top 5, `Templar Assassin` STRONG→WEAK, entra `Kez` STRONG.
- **Texto distinto en 14 escenarios** (mismos héroes, explicación corregida): S06, S13, S14, S15, S16, S20 (Grimstroke); S07, S22, S26, S28 (Legion Commander); S12 (Nyx); S18, S29 (Templar Assassin); S21.
- Relaciones eliminadas: 0. Silencios nuevos: 0. Excepciones: 0.

**Lectura honesta:** S12, S15, S20 y S28 **siguen siendo STRONG** porque la relación sigue existiendo y el motor no cambió. Lo que cambió es que la explicación ya no miente. Si un experto concluye que la sinergia Grimstroke+Juggernaut o el counter Nyx→Storm no merecen STRONG, la corrección es retirar o bajar esa entrada (decisión de dato, no de código).

## 5. S21

Con Windranger como `mixed`, el equipo ya tiene los dos tipos de daño, por eso se apaga "falta segundo tipo de daño" para los carries físicos. Es consecuencia directa del dato corregido, no una regresión.

## 6. Hallazgos que necesitan criterio de un experto dotero

1. **Soulbind "repite X"** aparece en 13 entradas más (más una de "duplica") de `hero-synergies.json` (Unstable Concoction, Duel, Hex, Telekinesis, Viper Strike…). El texto del juego lo respalda en general, pero nadie probó en partida las excepciones. Hay que probarlo, no suponerlo.
2. **Grimstroke+Juggernaut**: ¿es sinergia realmente fuerte con lo que sí es verificable (leash + Ink Swell en Blade Fury)?
3. **Nyx→Storm `hard`**: el matchup está 49/51 en 76 partidas; ¿se sostiene `hard` por mecánica?
4. **Legion Commander vs Phantom Lancer** (P0-04 de la auditoría): el texto está escrito desde la perspectiva de PL, pero la estadística (LC 11/14) no lo contradice. No se tocó. Pesa en S09/S27.
5. **Axe `hasCatch`** y **Windranger `mixed`**: definición de catch / daño dominante.
6. Pendientes de texto de la auditoría que **no** eran parte de este alcance: Lich "stun" (Sinister Gaze es canalizado), Pudge "Rot usa maná", Tiny "poco daño".

## 7. F-01 (commit local `2006e45f`) — no se integra aquí

- Está en `r1/product-certification`, **no** en `preview`. No se hizo cherry-pick.
- Su cambio central (solo texto, z ≥ 2,58 y ≥ 100 partidas para decir "Fuerte") es independiente de los datos, pero **no aplica limpio**: parte de un `counter.ts` anterior al gate actual (`badgeMinGames=40`, `badgeMinDelta=0.04`) y arrastra scripts del benchmark `pro-analysis-v0` que no están en `preview`.
- **Evidencia nueva** (mismo snapshot, 30 escenarios): hay 12 afirmaciones únicas "Fuerte contra X (n%)" en tarjetas STRONG; **0 de 12** pasa z ≥ 2,58 con n ≥ 100 (z entre 0,91 y 2,94; Kez vs Sand King z=2,94 pero n=44).
- **Propuesta para un PR aparte:** (a) la etiqueta "Fuerte contra" por estadística solo si z ≥ 2,58 y n ≥ 100; si no, "Ventaja posible contra X (WR% en n partidas)"; (b) decidir en ese PR si el mismo criterio también endurece el gate de la insignia (hoy n ≥ 40), porque eso **sí** cambia STRONG/WEAK y exige su propio candado de regresión.

## 8. GO / NO-GO

- **Revisión y merge de este PR (solo datos): GO.** Sin cambios de código; tests del motor 2887/0; `verify-simplicity` OK; contrafactual explicado.
- **Pruebas Live con usuarios: NO-GO** hasta que un experto resuelva los puntos 1–3 y se atienda F-01.
