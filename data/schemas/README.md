# `data/schemas/`

El esquema (forma esperada) de cada dataset del proyecto. Un archivo por dataset, nombrado igual
que el dato: `data/schemas/<nombre>.schema.json`.

Sirve para dos cosas:

1. Documentar la forma sin tener que leer el loader.
2. Ser el contrato que el loader valida en el borde (costuras S17/S18): un archivo que no cumple
   el esquema se degrada (caso descartado o "sin datos"), **nunca tira el proceso**.

Ningún loader confía en la forma de un JSON de `data/` sin validarlo primero — mismo criterio que
`loadHeroPositions()` / `loadHeroCounters()` en `apps/engine/src/signals/`.
