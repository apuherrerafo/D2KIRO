# Referencia de cobertura de la matriz de QA (R3.1)

`coverage-reference.json` es la linea base **observada** de la matriz del generador (`qa/scenarios/generate.ts`) en el commit
`6fbd8bd2`: 134 corridas, 652 checkpoints con humano abierto, 410 respuestas del Coach, 194 con tarjetas, 55 corridas distintas
con tarjetas, maximo 8 tarjetas en una sola corrida (4,1 %).

## Que protege (y que no)

- **A. Estructural** (`coverageRegressionProblems`): detecta que la matriz *pierda* cobertura respecto de esa linea base. No sabe si una
  shortlist vacia es correcta; por eso solo exige segmentos que en la referencia ya tenian tarjetas.
- **B. Semantica** (`semantic-coverage.test.ts`): con un fundamento **declarado por el fixture** (counter curado inyectado contra un ban)
  la tarjeta es obligatoria en las 5 posiciones; sin fundamento, `[]` es `VALID_ABSTENTION`. Es la unica parte que dice "debio haber tarjeta".

## Reglas y denominadores (todas relativas a la referencia)

| Regla | Denominador | Falla si |
|---|---|---|
| Matriz comparable | checkpoints con humano abierto | `< 0,5 x` referencia |
| Respuesta del Coach | humano abierto | tasa `< 0,5 x` referencia |
| Tarjetas | respuestas del Coach | tasa `< 0,5 x` referencia |
| Dispersion | corridas | corridas con tarjetas / corridas `< 0,5 x` referencia |
| Concentracion | tarjetas totales | una sola corrida aporta `> 10 %` |
| Segmentos (`round`, `step`, `partySize`, `side`, `openPosition`) | respuestas del segmento | tasa `< 0,5 x` referencia, solo si la referencia tenia `>= 5` respuestas y `> 0` tarjetas |

`rateFloor = 0,5` es una tolerancia de composicion, no un valor estadistico: absorbe que se dupliquen los escenarios con abstenciones
legitimas o que la curacion de counters de un parche mueva la tasa, y aun asi un colapso (194 -> 1) cae al 0,5 % de la tasa de referencia.
Un tope `maxRunShare = 0,10` da ~2,4x de margen sobre lo observado (0,041).

## Limites conocidos

- Las tarjetas de la matriz actual aparecen **solo en checkpoints donde la posicion 1 esta abierta**: el fixture de sugerencias del generador
  lista primero a los heroes de posicion 1 y esos ids (100-129) coinciden con heroes reales con counters curados. Un humano que solo tiene
  abiertas las posiciones 2-5 siempre recibe `[]` en esa matriz, y eso **no** es una abstencion demostrada sino un limite del fixture. La parte A
  no puede exigir tarjetas ahi (la referencia tiene cero); la parte B si lo hace, con fundamento declarado, para las 5 posiciones. (El segmento
  `openPosition=2..5` de la referencia si tiene tarjetas, pero solo en checkpoints donde tambien esta abierta la posicion 1.)
- Parte de la linea base depende, por esa coincidencia, de `hero-counters.json` real. Un cambio de curacion que mueva la tasa por debajo del
  piso hara fallar el guard: eso es una senal para **revisar**, no para regenerar automaticamente.

## Cuando se puede actualizar

Solo a mano y con revision humana, cuando (a) cambia el diseno de la matriz (escenarios, dimensiones) o (b) cambia a proposito la curacion de
datos que alimenta el fixture. **Nunca** porque una corrida haya salido distinta ni para conseguir PASS. Procedimiento: regenerar con
`buildCoverageReference(matriz, { commit, measuredOn, source })`, anotar el motivo en `docs/agents/journal.md` y en el commit, y confirmar que
las abstenciones nuevas tienen explicacion.
