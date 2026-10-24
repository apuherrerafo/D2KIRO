# ENGINE_P1_EXAM — examen de drafter de F1 (`ENGINE_P1_EXAM_F1_FINAL`)

Código: `ea997c3` (árbol limpio) · estado `690c2ba510277ab0` · snapshot `W5-EMP-001` · clave comparable `51df8bbc5872bdd1`

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
| I6-visible (definición ORIGINAL, comparable con T2..T4_AFTER) | 2/2 estados con hueco abierto sin que ninguna tarjeta lo diga |
| I6-visible (definición REVISADA T5, solo con todos los picks propios curados; NO comparable con la fila anterior ni con reportes previos) | 0/0 estados con hueco abierto sin que ninguna tarjeta lo diga |
| I9-visible counter duro en top-3 | 0 apariciones en 0 estados; 0 sin riesgo visible |
| I11 honestidad de la base | 0 violaciones en 3074 tarjetas V4 (bases {"statistical":2668,"mixed":363,"curated":43}; estadísticas sin muestra: 0) |
| I6c CRITICAL_GAP en la tarjeta | 46 tarjetas lo llevan (de 160 en estados con hueco crítico); sin prueba: 0; faltante donde era demostrable: 0 |

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


## M1 — cubrir un hueco crítico frente a un counter estadístico adverso (mide, no cambia el scoring)

Applicable = a critical gap in the closing window AND a revealed enemy. 'Promoted' = the stage-aware rule has a hero that fills the gap first where the legacy rule had somebody else. 'Adverse' = that hero's STATISTICAL counter against a revealed enemy is at or below the threshold with at least that many games, and no curated hard counter (RB-4 demotes those). It counts how often the trade-off exists; whether it hurts is the judge's call.

| Umbral de 'adverso' | Estados aplicables | Hueco-relleno primero (≠ regla vieja) | …con counter adverso | …y alternativa desplazada neutra o mejor | p=1 (adverso / aplicables) | Evidencia (partidas mín / mediana) | Tarjeta sin ningún riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| raw<=-0.03 y n>=30 | 32 | 6 | 0 (0.0%) | 0 | 0/10 | n/a / n/a | 0/0 |
| raw<=-0.05 y n>=30 | 32 | 6 | 0 (0.0%) | 0 | 0/10 | n/a / n/a | 0/0 |
| raw<=-0.075 y n>=100 | 32 | 6 | 0 (0.0%) | 0 | 0/10 | n/a / n/a | 0/0 |

Alcanzabilidad (raw<=-0.03 y n>=30): en 32 estados medidos hay 6 candidatos con counter adverso en todo el campo (1 además cubren el hueco); hay uno de esos en 1 estado(s), en el top-3 de 0 y en primer lugar de 0.

Alcanzabilidad (raw<=-0.05 y n>=30): en 32 estados medidos hay 3 candidatos con counter adverso en todo el campo (0 además cubren el hueco); hay uno de esos en 0 estado(s), en el top-3 de 0 y en primer lugar de 0.

Alcanzabilidad (raw<=-0.075 y n>=100): en 32 estados medidos hay 0 candidatos con counter adverso en todo el campo (0 además cubren el hueco); hay uno de esos en 0 estado(s), en el top-3 de 0 y en primer lugar de 0.

Héroes promovidos que RB-4 ya demociona (counter duro curado): 0. El campo medido coincide con el del producto en 622/622 estados (top-3 idéntico).

## Exposición de ronda 1 en la tarjeta (TSK-254)

- 252 aperturas de ronda 1 con tarjetas V4. Primera tarjeta: 93 con algún counter duro curado todavía disponible, 93 lo avisan (`exposed_to_counter`); media 0.4206 counters disponibles.
- Todas las tarjetas: 577/1231 expuestas, 577 avisadas. **Inconsistencias aviso↔realidad: 0** (debe ser 0).
- **Sin aviso no es sin riesgo:** 466/1231 tarjetas son de un héroe sin NINGÚN counter duro curado (79/252 primeras tarjetas); ahí la tarjeta calla porque no hay dato, no porque se haya descartado la exposición.
- Estados donde TODAS las tarjetas llevan el aviso: 6/252; estados donde la primera avisa y hay una alternativa sin aviso en pantalla: 87.
- Por posición en la lista: #1: 0.4206 counters, 93/252 avisadas · #2: 0.4524 counters, 110/252 avisadas · #3: 0.5238 counters, 123/252 avisadas · #4: 0.5538 counters, 126/251 avisadas · #5: 0.6027 counters, 125/224 avisadas.
- Primeras tarjetas más frecuentes: Axe ×14 (0 counters disponibles), Techies ×14 (0 counters disponibles), Nyx Assassin ×13 (1 counters disponibles), Crystal Maiden ×12 (0 counters disponibles), Sniper ×12 (2 counters disponibles), Pudge ×11 (1 counters disponibles), Terrorblade ×11 (0 counters disponibles), Snapfire ×11 (0 counters disponibles).

## D1 — hueco crítico que no se puede evaluar por falta de capacidades curadas

'Not evaluable' = an own pick or the card's hero has no curated capabilities, so CRITICAL_GAP can neither be raised nor ruled out. The card then shows nothing, which looks the same as 'evaluated, no gap'. No card ever says 'no risk'.

- 124 héroes con capacidades curadas. En la ventana de cierre (≤2 picks): 250 estados; 24 con un pick propio sin curar (en 8 de ellos había un hueco abierto que el producto calla); 30/1248 tarjetas de un héroe sin curar; 52/250 estados no totalmente evaluables.
- Héroes sin curar que aparecieron en tarjetas (todas las rondas): Kez ×35, Ringmaster ×28.

## Cómo reproducir

- `bun scripts/p1-exam/exam.ts --out=ENGINE_P1_EXAM_F1_FINAL --drafts=120 --judge=t4`


## Paquete del juez

Va aparte, para que quien lo lea no vea la clave de la lectura ciega: `ENGINE_P1_EXAM_F1_FINAL_JUDGE.md` (preguntas y situaciones; sin respuestas) y `ENGINE_P1_EXAM_F1_FINAL_JUDGE_KEY.json` (qué lado es la regla vieja; **no abrir antes de responder**). **La clave no se publica en el repo (es público): vive fuera, y `.gitignore` la excluye.**
