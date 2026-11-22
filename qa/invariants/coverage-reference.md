# Referencia de cobertura de la matriz de QA (R3.1 / R3.2)

`coverage-reference.json` es la linea base **observada** de la matriz del generador (`qa/scenarios/generate.ts`) medida en el commit
`6fbd8bd2`: 134 corridas, 652 checkpoints con humano abierto, 410 respuestas del Coach, 194 con tarjetas y 55 corridas distintas con
tarjetas. Trae tres bloques: `provenance` (commit, fecha, sha256 de `hero-counters.json`), `profile` (los conteos) e `integrity` (huella
de los dos anteriores). **No trae tolerancias.**

## Que protege (y que no)

- **A. Estructural** (`coverageRegressionProblems`): detecta que la matriz *pierda* cobertura respecto de esa linea base. No sabe si una
  shortlist vacia es correcta; por eso solo exige segmentos que en la referencia ya tenian tarjetas.
- **B. Semantica** (`semantic-coverage.test.ts`): con un fundamento **declarado por el fixture** (counter curado inyectado contra un ban)
  la tarjeta es obligatoria en las 5 posiciones; sin fundamento, `[]` es `VALID_ABSTENTION`. Es la unica parte que dice "debio haber tarjeta".

## Reglas activas (cada una con su codigo y su propia prueba de mutacion aislada)

| Codigo | Denominador | Se dispara si |
|---|---|---|
| `NOT_COMPARABLE` | checkpoints con humano abierto | `< 0,5 x` referencia |
| `COACH_ANSWER_RATE` | humano abierto | respuestas / humano abierto `< 0,5 x` referencia |
| `CARD_RATE` | respuestas del Coach | tarjetas / respuestas `< 0,5 x` referencia (tambien por dilucion con checkpoints sin tarjeta) |
| `SCENARIO_SPREAD` | corridas | corridas con tarjetas / corridas `< 0,5 x` referencia (cubre la concentracion en pocos escenarios) |
| `SEGMENT_LOSS` | respuestas del segmento (`round`, `step`, `partySize`, `side`, `openPosition`) | tasa `< 0,5 x` referencia, solo si la referencia tenia `>= 5` respuestas y `> 0` tarjetas |
| `REFERENCE_INVALID` | — | la referencia no tiene tarjetas/respuestas/humanos: no se puede exigir nada |
| `REFERENCE_TAMPERED` | — | la huella no coincide con el contenido, o el JSON trae una tolerancia propia |
| `REFERENCE_INCOMPATIBLE` | — | el sha256 de un dato curado real ya no coincide con el de la referencia (ver abajo) |

Se **elimino** el tope del 10 % de concentracion de un solo escenario: era matematicamente inalcanzable en la matriz real (cada corrida
tiene a lo sumo 8 checkpoints con humano abierto y cualquier matriz que pase `CARD_RATE` tiene `>= 97` tarjetas, es decir `<= 8,2 %`).

## Umbrales: PROVISIONALES, sin justificacion estadistica

`rateFloor = 0,5` y `minSegmentAnswered = 5` viven en codigo congelado (`COVERAGE_TOLERANCE`, `matrix-coverage.ts`) y estan fijados por
`coverage-reference.lock.test.ts`. Son una tolerancia de composicion elegida a criterio, **no** derivada de una distribucion: la matriz es
determinista, no hay ruido de muestreo que modelar. Limites conocidos y aceptados:

- Una perdida global de ~25 % de las tarjetas **pasa**; entre ~25 % y ~50 % solo la detecta algun segmento. El guard existe para detectar
  colapsos, no desgaste gradual.
- Con bases muy chicas (p. ej. `round=3`: 4 tarjetas en 48 respuestas) un cambio legitimo puede disparar `SEGMENT_LOSS`.
- No se endurecieron en R3.2 por no haber evidencia para hacerlo. Cambiarlos exige editar `COVERAGE_TOLERANCE`, la prueba de bloqueo y este
  documento en el mismo cambio, con revision humana.

## Datos curados (M1) — regresion tecnica vs cambio de datos

Con `heroCounters` vacios inyectados la matriz entera produce **0 tarjetas**: las 194 existen porque los ids de heroes del fixture
(100-129) coinciden con heroes reales que tienen counters curados en `apps/engine/src/signals/hero-counters.json`. Por eso la referencia
registra el sha256 de ese archivo (contenido con finales de linea normalizados a LF) en `provenance.curatedInputs`, y `ownership.test.ts`
lo compara con el actual:

- **Coincide**: el guard evalua regresion como siempre.
- **Cambio** (o archivo ilegible): se emite `[REFERENCE_INCOMPATIBLE]` — *no es una regresion del Coach, los datos curados son otros* — y la
  corrida **falla**. Si ademas hay regresion real, sus diagnosticos se listan despues, nunca se esconden. No se regenera sola ni se declara
  PASS por este motivo.
- Procedimiento: revisar el cambio de `hero-counters.json` (¿curacion deliberada?), y solo entonces, a mano, regenerar la referencia.

Solo `hero-counters.json` se registra: con counters vacios no hay tarjetas, asi que es el unico dato curado necesario; otros archivos
curados (p. ej. sinergias, capacidades) no producen tarjetas por si solos, pero no se verifico que no las modifiquen en combinacion.

## Cuando se puede actualizar la referencia

Solo a mano y con revision humana, cuando (a) cambia el diseno de la matriz (escenarios, dimensiones) o (b) cambia a proposito la curacion
de datos que alimenta el fixture. **Nunca** porque una corrida haya salido distinta ni para conseguir PASS. Procedimiento: regenerar con
`buildCoverageReference(matriz, { commit, measuredOn, source, curatedInputs })` usando `curatedInputHashes()`, actualizar
`PINNED_REFERENCE_SHA256` en `coverage-reference.lock.test.ts`, y anotar el motivo en el commit.

## Limites de cobertura registrados para R4 (B1)

- **Las posiciones 2–5 solas no se ejercitan en la matriz del generador.** Las tarjetas aparecen solo en checkpoints donde la posicion 1
  esta abierta: el fixture de sugerencias lista primero a los heroes de posicion 1 (ids 100-129, que coinciden con heroes reales con
  counters curados). Un humano que solo tiene abiertas las posiciones 2-5 recibe siempre `[]`, y eso **no** es una abstencion demostrada
  sino un limite del fixture. La parte A no puede exigir tarjetas ahi (la referencia tiene cero); solo la parte B las cubre.
  (`openPosition=2..5` de la referencia si tiene tarjetas, pero unicamente en checkpoints donde tambien esta abierta la posicion 1.)
- Las sondas semanticas cubren un solo tipo de fundamento (ban que abre al heroe), en solitario, ronda 1 y bando radiant. No cubren
  sinergia, counter a un rival revelado, steal ni composicion critica, ni parties de varios jugadores.
- El tamano de party 1 (4 respuestas del Coach) queda por debajo de `minSegmentAnswered` y no se exige.
- **Accion para R4 (no se hace en R3.2)**: separar los ids de los heroes sinteticos del generador de los ids reales con counters curados,
  y ampliar el fixture de sugerencias para que cada posicion reciba candidatos propios. Entonces la referencia deberia regenerarse con
  revision humana y la parte A podria exigir las posiciones 2-5.
