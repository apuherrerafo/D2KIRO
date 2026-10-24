# ENGINE_P1_EXAM — examen de drafter de F1 (`ENGINE_P1_EXAM_F1_FINAL_M1_200`)

Código: `ea997c3` (árbol limpio) · estado `690c2ba510277ab0` · snapshot `W5-EMP-001` · clave comparable `51df8bbc5872bdd1`

Este reporte **mide, no juzga y no cambia comportamiento**. Camino medido: el del simulador (Team Coach Board + `?format=v4`) más la lista V3 que el juez de Wave 5 ya conocía.

Muestra: {"drafts":200,"completed":200,"decisionPoints":1032,"round1":417,"round2":412,"round3":203,"harnessFailures":0,"harnessBadStatuses":0}

## Defectos duros (plan v2, tabla C)

| Invariante | Resultado |
| --- | --- |
| I1 nada ilegal | 0 violaciones |
| I2 factibilidad de roles | 0 violaciones |
| I3 conformidad: objetivo = precedencia declarada | 0/1032 estados divergen (0.0%) |
| I3 toda columna abierta rankeada | 0 violaciones |
| I3 PHASE presentado como ventaja | 0 |
| I6-visible (definición ORIGINAL, comparable con T2..T4_AFTER) | 2/2 estados con hueco abierto sin que ninguna tarjeta lo diga |
| I6-visible (definición REVISADA T5, solo con todos los picks propios curados; NO comparable con la fila anterior ni con reportes previos) | 0/0 estados con hueco abierto sin que ninguna tarjeta lo diga |
| I9-visible counter duro en top-3 | 0 apariciones en 0 estados; 0 sin riesgo visible |
| I11 honestidad de la base | 0 violaciones en 5090 tarjetas V4 (bases {"statistical":4402,"mixed":614,"curated":74}; estadísticas sin muestra: 0) |
| I6c CRITICAL_GAP en la tarjeta | 70 tarjetas lo llevan (de 255 en estados con hueco crítico); sin prueba: 0; faltante donde era demostrable: 0 |

## Observaciones (no son ley)

- **I3 apertura en cores:** 0/201 aperturas de ronda 1 recomiendan Pos 1/2 sin ventana de counter ni escasez de pool (0.0%).
- **I4 reactividad (Jaccard del top-3, misma posición entre drafts distintos):** global 0.2186; por posición {"pos1":0.218,"pos2":0.2415,"pos3":0.2016,"pos4":0.2294,"pos5":0.2026}. 1.0 = siempre los mismos tres.
- **I5 peso de `position_fit`:** 58.8% del score (mediana; p10 53.9%, p90 63.8%) y 0.0% de la dispersión que ordena a los candidatos (mediana; p10 -8.4%, p90 28.3%); 1032 estados, ~6 candidatos por estado; en 86.0% de ellos `position_fit` está saturado en 1 (suma la misma constante a todos). Es sobre lo que V6 conserva (TOP_N), no sobre todo el campo.
- **I5 sobre todo el campo creíble (TSK-252):** 1032 estados con ≥6 creíbles (mediana 30). El top-3 cae en la mitad más jugada 98.6% de las veces y el top-6 96.8% (un corte neutro daría ~50%). `position_fit` explica 81.0% de la dispersión (mediana). Quitando su aporte, el top-3 se conserva en 36.7% (Jaccard) y el top-6 en 37.8%; 100% = no decide nada. Dentro de la mitad más jugada, `position_fit` explica 0.9% de la dispersión.
- **T3 misma decisión, dos reglas (volumen vs mediana de creíbles):** 1032 estados; el top-3 cambia en 772 (74.8%); Jaccard medio del top-3 0.5506, del top-6 0.6063; de los cambiados, 772 se apoyan en menos volumen (partidas medias del top-3: 4635.5992 → 3803.4086). Describe qué se movió, no si mejora. Empates exactos en el corte del top-3 (decide el id del héroe, no el draft): 0.0% → 0.0% de los estados.
- **T3 frente a los rivales ya revelados (solo capa curada "hard"):** en 630 estados con rival visible, héroes del top-3 que counterean a un rival: 0.119 → 0.1492; héroes del top-3 expuestos a un rival: 0.0111 → 0.0143.
- **I6 relleno:** de 0 estados con hueco abierto, el top-3 lo llena en 0; existe un relleno en lo mostrado en 0.
- **I6b iniciación sola (TSK-253):** de 41 estados con los últimos picks y sin ningún iniciador, el top-3 del board lo llena en 37; existe un iniciador creíble en la columna en 41.
- **T4 huecos críticos en la ventana de cierre (TSK-253):** 51 de 415 estados con ≤2 picks propios por delante tienen un hueco crítico {"initiation":41,"damage_mix":13,"catch":1}; en 18 más no se declara por un pick propio sin capacidades curadas. Fuera de la ventana la regla nueva puntúa idéntico a la vieja: 0/617 estados con scores distintos.
- **T4 misma decisión, dos reglas (team_synergy plano vs por etapa):** 51 estados comparables (ronda 2: 37, ronda 3: 14); el top-3 cambia en 33 (64.7%). Top-3 con al menos un héroe que llena lo crítico: 45 → 48 de 51 estados donde existe uno en el campo; promedio de rellenos en el top-3 1.7451 → 2.5098. Costo bajo el score viejo (top-3 cambiados): 76.7261 → 75.0542; partidas medias del top-3 3908.085 → 3728.6275.
- **T4 frente a los rivales ya revelados (capa curada "hard"):** en 51 estados con rival visible, héroes del top-3 que counterean a un rival 0.2353 → 0.1569; expuestos a un rival 0 → 0.0196.
- **I7 daño:** de 1 estados mono-daño, el top-3 diversifica en 1.
- **I8 exposición del primary de ronda 1:** 0.3781 counters duros disponibles en promedio (máx 1) sobre 201 aperturas.
- **I10 popularidad:** 100.0% de los top-3 de ronda 1 caen en la mitad más jugada de su posición (3015/3015).
- **Concentración del #1:** {"pos1":{"distinctPrimaries":11,"sample":201,"mostCommonShare":0.3234},"pos2":{"distinctPrimaries":11,"sample":201,"mostCommonShare":0.2537},"pos3":{"distinctPrimaries":12,"sample":201,"mostCommonShare":0.3483},"pos4":{"distinctPrimaries":11,"sample":201,"mostCommonShare":0.2289},"pos5":{"distinctPrimaries":12,"sample":201,"mostCommonShare":0.3383}}
- **Mostrado pero no creíble en su columna:** 0.


## M1 — cubrir un hueco crítico frente a un counter estadístico adverso (mide, no cambia el scoring)

Applicable = a critical gap in the closing window AND a revealed enemy. 'Promoted' = the stage-aware rule has a hero that fills the gap first where the legacy rule had somebody else. 'Adverse' = that hero's STATISTICAL counter against a revealed enemy is at or below the threshold with at least that many games, and no curated hard counter (RB-4 demotes those). It counts how often the trade-off exists; whether it hurts is the judge's call.

| Umbral de 'adverso' | Estados aplicables | Hueco-relleno primero (≠ regla vieja) | …con counter adverso | …y alternativa desplazada neutra o mejor | p=1 (adverso / aplicables) | Evidencia (partidas mín / mediana) | Tarjeta sin ningún riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| raw<=-0.03 y n>=30 | 51 | 13 | 0 (0.0%) | 0 | 0/17 | n/a / n/a | 0/0 |
| raw<=-0.05 y n>=30 | 51 | 13 | 0 (0.0%) | 0 | 0/17 | n/a / n/a | 0/0 |
| raw<=-0.075 y n>=100 | 51 | 13 | 0 (0.0%) | 0 | 0/17 | n/a / n/a | 0/0 |

Alcanzabilidad (raw<=-0.03 y n>=30): en 51 estados medidos hay 21 candidatos con counter adverso en todo el campo (8 además cubren el hueco); hay uno de esos en 7 estado(s), en el top-3 de 0 y en primer lugar de 0.

Alcanzabilidad (raw<=-0.05 y n>=30): en 51 estados medidos hay 11 candidatos con counter adverso en todo el campo (3 además cubren el hueco); hay uno de esos en 3 estado(s), en el top-3 de 0 y en primer lugar de 0.

Alcanzabilidad (raw<=-0.075 y n>=100): en 51 estados medidos hay 3 candidatos con counter adverso en todo el campo (1 además cubren el hueco); hay uno de esos en 1 estado(s), en el top-3 de 0 y en primer lugar de 0.

Héroes promovidos que RB-4 ya demociona (counter duro curado): 1. El campo medido coincide con el del producto en 1032/1032 estados (top-3 idéntico).

## Exposición de ronda 1 en la tarjeta (TSK-254)

- 417 aperturas de ronda 1 con tarjetas V4. Primera tarjeta: 158 con algún counter duro curado todavía disponible, 158 lo avisan (`exposed_to_counter`); media 0.4149 counters disponibles.
- Todas las tarjetas: 959/2029 expuestas, 959 avisadas. **Inconsistencias aviso↔realidad: 0** (debe ser 0).
- **Sin aviso no es sin riesgo:** 750/2029 tarjetas son de un héroe sin NINGÚN counter duro curado (127/417 primeras tarjetas); ahí la tarjeta calla porque no hay dato, no porque se haya descartado la exposición.
- Estados donde TODAS las tarjetas llevan el aviso: 14/417; estados donde la primera avisa y hay una alternativa sin aviso en pantalla: 144.
- Por posición en la lista: #1: 0.4149 counters, 158/417 avisadas · #2: 0.4436 counters, 177/417 avisadas · #3: 0.518 counters, 202/417 avisadas · #4: 0.559 counters, 213/415 avisadas · #5: 0.6143 counters, 209/363 avisadas.
- Primeras tarjetas más frecuentes: Techies ×26 (0 counters disponibles), Crystal Maiden ×21 (0 counters disponibles), Sniper ×19 (2 counters disponibles), Nyx Assassin ×17 (1 counters disponibles), Axe ×16 (0 counters disponibles), Oracle ×16 (1 counters disponibles), Juggernaut ×15 (1 counters disponibles), Phantom Lancer ×14 (1 counters disponibles).

## D1 — hueco crítico que no se puede evaluar por falta de capacidades curadas

'Not evaluable' = an own pick or the card's hero has no curated capabilities, so CRITICAL_GAP can neither be raised nor ruled out. The card then shows nothing, which looks the same as 'evaluated, no gap'. No card ever says 'no risk'.

- 124 héroes con capacidades curadas. En la ventana de cierre (≤2 picks): 415 estados; 50 con un pick propio sin curar (en 18 de ellos había un hueco abierto que el producto calla); 58/2071 tarjetas de un héroe sin curar; 103/415 estados no totalmente evaluables.
- Héroes sin curar que aparecieron en tarjetas (todas las rondas): Kez ×62, Ringmaster ×59.

## Cómo reproducir

- `bun scripts/p1-exam/exam.ts --out=ENGINE_P1_EXAM_F1_FINAL_M1_200 --drafts=200 --judge=t4`


## Paquete del juez

Va aparte, para que quien lo lea no vea la clave de la lectura ciega: `ENGINE_P1_EXAM_F1_FINAL_M1_200_JUDGE.md` (preguntas y situaciones; sin respuestas) y `ENGINE_P1_EXAM_F1_FINAL_M1_200_JUDGE_KEY.json` (qué lado es la regla vieja; **no abrir antes de responder**). **La clave no se publica en el repo (es público): vive fuera, y `.gitignore` la excluye.**
