# ENGINE_P1_EXAM — re-corrida con la referencia corregida (TSK-250 / TSK-251)

**Qué pasó.** La corrida T2 original reportó `I3: 6/628` estados que divergían de la precedencia declarada. Eran falsos: la
referencia del examen aproximaba pools de equipo con el pool **personal** del Player en su posición, e inventaba una escasez de
pool que la sesión real no tiene (el lab no guarda pools de equipo). La referencia ahora lee `playerPoolsByPosition` y
`ownPositionOccupancy` de la sesión: estado de entrada, no el código bajo prueba.

**Trazabilidad.** Los reportes originales no se tocaron (`ENGINE_P1_EXAM_BASELINE.*`, `ENGINE_P1_EXAM_T2.*`). Las corridas
corregidas son `ENGINE_P1_EXAM_BASELINE_R2.*` y `ENGINE_P1_EXAM_T2_R2.*`: mismas 120 semillas, mismo snapshot `W5-EMP-001`.

| Métrica | Línea base R1 | Línea base R2 | T2 R1 | T2 R2 |
| --- | --- | --- | --- | --- |
| Decisiones medidas | 622 | 622 | 628 | 628 |
| I1 nada ilegal / I2 roles / I9 counter duro sin aviso | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| I3 el objetivo = la precedencia declarada (estados que divergen) | 432/622 | **436/622** | 6/628 | **0/628** |
| I3 aperturas que recomiendan core (Pos 1/2) sin ventana ni escasez | 46/120 | 48/120 | 0/121 | 0/121 |
| I3 toda columna abierta rankeada | 0 | 0 | 0 | 0 |
| I4 Jaccard del top-3 (1.0 = siempre los mismos) | 0.2939 | 0.2939 | 0.2936 | 0.2936 |
| I8 counters duros disponibles sobre el primary de ronda 1 | 0.325 | 0.325 | 0.2066 | 0.2066 |

## Lectura

- Los 6 falsos errores desaparecen: con la referencia corregida el simulador cumple la precedencia declarada en 628/628 estados.
  La línea base, en cambio, la incumplía en 436/622 (el simulador sugería la posición personal o la más baja).
- **Lo que mejoró es el orden en que se mira, no la calidad del ranking.** El ranking por posición no cambió (I4 idéntico) y la
  apertura ahora es Pos 5 en las ~121 aperturas porque es el orden habitual (`PHASE_FALLBACK`: "no hay prioridad estratégica
  clara"). Esto **no** es evidencia de que Pos 5 sea la mejor decisión estratégica; sólo se mide que cumple lo declarado.
- Sólo los estados con ventana de counter (STRATEGIC) llevan una afirmación estratégica. Falta el juez (T6) para saber si el
  orden ayuda.

Reproducir: `bun scripts/p1-exam/exam.ts --out=<NOMBRE> --drafts=120` (el examen se niega a sobrescribir evidencia).
