# Referencia de cobertura de la matriz de QA (R3.1 / R3.2)

`coverage-reference.json` es la linea base **observada** de la matriz del generador (`qa/scenarios/generate.ts`) medida en R3.3 (sobre
`501289d3` + los cambios de R3.3): 134 corridas, 652 checkpoints con humano abierto, 434 respuestas del Coach, 225 con tarjetas y 66 corridas
distintas con tarjetas, con counters **sinteticos** (`qa/scenarios/synthetic-counters.ts`). Trae tres bloques: `provenance` (commit, fecha, sha256 del fixture sintetico de counters), `profile` (los conteos) e `integrity` (huella
de los dos anteriores). **No trae tolerancias.**

## Que protege (y que no)

- **A. Estructural** (`coverageRegressionProblems`): detecta que la matriz *pierda* cobertura respecto de esa linea base. No sabe si una
  shortlist vacia es correcta; por eso solo exige segmentos que en la referencia ya tenian tarjetas.
- **B. Semantica** (`semantic-coverage.test.ts`): con un fundamento **declarado por el fixture** (counter inyectado contra un ban)
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
| `REFERENCE_INCOMPATIBLE` | — | el sha256 de un fixture sintetico ya no coincide con el de la referencia, o hay un fixture no registrado (ver abajo) |

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

## Fixtures sinteticos (R3.3) — la matriz ya NO depende de `hero-counters.json`

Hasta R3.2 la matriz leia, sin decirlo, el `hero-counters.json` curado real: `createFixtureRoutes()` omitia `heroCounters` y el motor caia a su
default. Las tarjetas existian porque ids sinteticos (100-129) y los baneos de relleno (1-48) coincidian con heroes reales con counters curados,
y la referencia hasheaba ese archivo. Eso violaba `invariantes.md` ("ninguna prueba lee un dato curado real"): una curacion por parche ponia la
suite en rojo (o la dejaba midiendo otra cosa) sin que el Coach hubiera cambiado. Hallazgo ALTA de la revision independiente de R3 (Gemini).

Ahora el fixture es explicito, determinista y vive en el QA (`qa/scenarios/synthetic-counters.ts`, marcado `SYNTHETIC QA FIXTURE -- not Dota 2
knowledge`: **no es evidencia de ningun matchup real**). `createFixtureRoutes()` lo inyecta siempre; la referencia registra su sha256 en
`provenance.fixtureInputs` y `ownership.test.ts` lo compara (`fixture-input-hashes.ts`, sin I/O):

- **Coincide**: el guard evalua regresion como siempre.
- **Cambio, ausencia o fixture nuevo no registrado** (simetria): `[REFERENCE_INCOMPATIBLE]` — *no es una regresion del Coach, el fixture es otro* —
  y la corrida **falla**. No se regenera sola ni se da PASS por esto. Procedimiento: revisar el cambio del fixture y, solo con revision humana,
  regenerar la referencia.
- `curated-independence.test.ts` demuestra la independencia: corre la matriz en subprocesos con el modulo `hero-counters.json` sustituido (vacio y
  con otro contenido) y exige un perfil identico; ademas prohibe que cualquier archivo del QA lea ese JSON.

### Procedencia y diferencias frente a la referencia R3.2

Regla del fixture: 22 de los 30 heroes de posicion 1 (indice % 4 != 3) tienen 6 counters (1 `hard` + 5 `medium`) contra ids de relleno 1-48; los
8 restantes no tienen counters (abstencion legitima). Mismo alcance que el archivo real tenia en la matriz (solo posicion 1).

| Metrica | R3.2 (archivo real) | R3.3 (sintetico) |
|---|---|---|
| corridas | 134 | 134 |
| humano abierto | 652 | 652 |
| respuestas del Coach | 410 | 434 |
| con tarjetas | 194 | 225 |
| corridas con tarjetas | 55 | 66 |
| partySize=1 (respuestas / tarjetas) | 4 / 4 | 4 / 4 |

Los denominadores de estructura (corridas, humano abierto) no cambian: la matriz de escenarios es la misma. Cambia solo cuanto fundamento hay, y
por eso suben respuestas y tarjetas (~6 %-16 %). **No se retocaron el fixture ni las tolerancias para ocultar nada**: el fixture se fijo por regla
antes de medir (una primera version mas rala de counters entre heroes de posicion 1 dio 318/81 y se descarto por no ser representativa:
dejaba `partySize=1` sin respuestas; el motivo real era que los baneos son ids de relleno, no 100-129). Las tolerancias (`0,5` / `5`) no cambian.

## Cuando se puede actualizar la referencia

Solo a mano y con revision humana, cuando (a) cambia el diseno de la matriz (escenarios, dimensiones) o (b) cambia a proposito el fixture sintetico. **Nunca** porque una corrida haya salido distinta ni para conseguir PASS. Procedimiento: regenerar con
`buildCoverageReference(matriz, { commit, measuredOn, source, fixtureInputs })` usando `fixtureInputHashes()`, actualizar
`PINNED_REFERENCE_SHA256` en `coverage-reference.lock.test.ts`, y anotar el motivo en el commit.

## Limites de cobertura registrados para R4 (B1)

- **Las posiciones 2–5 solas no se ejercitan en la matriz del generador.** Las tarjetas aparecen solo en checkpoints donde la posicion 1
  esta abierta: el fixture de sugerencias lista primero a los heroes de posicion 1 (ids 100-129). Un humano que solo tiene abiertas las posiciones 2-5 recibe siempre `[]`, y eso **no** es una abstencion demostrada
  sino un limite del fixture. La parte A no puede exigir tarjetas ahi (la referencia tiene cero); solo la parte B las cubre.
  (`openPosition=2..5` de la referencia si tiene tarjetas, pero unicamente en checkpoints donde tambien esta abierta la posicion 1.)
- Las sondas semanticas cubren un solo tipo de fundamento (ban que abre al heroe), en solitario, ronda 1 y bando radiant. No cubren
  sinergia, counter a un rival revelado, steal ni composicion critica, ni parties de varios jugadores.
- El tamano de party 1 (4 respuestas del Coach) queda por debajo de `minSegmentAnswered` y no se exige.
- **Accion para R4 (no se hace en R3.3)**: ampliar el fixture de sugerencias y el de counters para que cada posicion reciba candidatos propios.
  Entonces la referencia deberia regenerarse con revision humana y la parte A podria exigir las posiciones 2-5. (R3.3 ya separo la matriz del
  dato curado real; los ids sinteticos siguen coincidiendo numericamente con ids reales, pero ya no importa: el motor no lee nada real.)
- **Fuera de alcance de R3.3**: `qa/mvp/matrix.test.ts` y `baseline-pos2-probe.test.ts` siguen cargando `hero-positions.json` real (otro dato
  curado, no `hero-counters.json`); ahora inyectan `heroCounters` vacio de forma explicita.
