# ADR-002 — El pick profesional observado no es ground truth; el backtest es comparativo, no predictivo

**Estado**: aceptado (2026-08-29, Fase 9.0, `TSK-193`)
**Implementa**: `R1-9`, `C4` (`docs/specs/SPEC.md` §15.1)

## Contexto

Fase 9 monta dos benchmarks. Uno de ellos (Professional Pick Agreement) corre el motor sobre
2.164 drafts profesionales reales y mide si el héroe que el equipo profesional eligió cae en el
Top-K de las recomendaciones. Es tentador leer ese número como "precisión del motor". Dos hechos
lo impiden:

1. **El pick profesional es una decisión válida entre varias, no la única correcta.** Está
   influida por el hero pool del equipo, comfort de los jugadores, resultados de scrims,
   preparación específica contra el rival y estrategia de serie — todo información que el motor no
   observa. Un motor que recomienda una alternativa igual de buena "falla" el match sin estar
   equivocado.

2. **No existe un snapshot de meta point-in-time.** El `MetaSnapshot` disponible se sincronizó el
   2026-08-28 e incluye partidas jugadas *después* de los drafts del corpus (ventana
   2026-05-27 → 2026-08-25). No hay forma de reconstruir "qué sabía el meta el día de ese draft":
   `meta_sync` sólo tiene el snapshot actual. Por lo tanto el backtest **no simula una predicción
   histórica**.

## Decisión

- El benchmark sobre los 2.164 drafts se llama **"Professional Pick Agreement"**. **Nunca**
  "accuracy", "precisión" ni "qué tan bueno es el motor" — ni en código, ni en reportes, ni en
  comunicación.
- Su **valor absoluto no se reporta solo**. Sólo tiene sentido contra los baselines calculados en
  la misma corrida (aleatorio, `position_fit`-solo, `patch_meta`-solo, V6-sin-`counter`, V6). El
  número que importa es el *delta* de V6 sobre esos baselines, no el Recall@k crudo.
- El benchmark **principal** de calidad del motor es el otro: **Engine Quality** sobre un Golden
  Dataset etiquetado a mano con relevancia graduada (`excellent`/`acceptable`/`bad`), titular
  **NDCG@5**.
- El backtest se trata como un **instrumento de comparación relativa**: V6 y "V6 + cambio"
  consumen el mismo snapshot y el mismo split congelado, así que el *delta* entre ellos es justo y
  es la única lectura válida para decidir si un cambio entra.
- Todo reporte del benchmark secundario imprime esta advertencia arriba.

## Alternativas consideradas

- **Archivar snapshots de meta por fecha y reconstruir el histórico.** Correcto en teoría, pero
  no existe la data (nunca se guardaron snapshots datados) y adquirirla ahora no cubre los drafts
  ya pasados. Queda como trabajo futuro (`SPEC.md` §15.10); no bloquea Fase 9.
- **Usar sólo el Golden Dataset y descartar el backtest sobre drafts pro.** El backtest sobre
  2.164 drafts sigue siendo útil como señal de que un cambio no rompe el acuerdo con la práctica
  profesional a escala — sólo hay que leerlo bien. Se conserva como secundario.

## Consecuencias

- `gate.ts` (`TSK-205`) juzga PASS/FAIL principalmente por Engine Quality (NDCG@5, Bad Pick
  Rate@5); Professional Pick Agreement entra como métrica de contexto, no como barra.
- Ningún ticket de 9.x puede afirmar "el motor acierta X%" a partir del benchmark secundario.
- Si en el futuro se archivan snapshots datados, este ADR se supersede con uno que reclasifique el
  Benchmark B como predictivo.
