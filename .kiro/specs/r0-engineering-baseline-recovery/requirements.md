# Requirements Document

_Documento de Requisitos: R0 — Restablecimiento del Baseline de Ingeniería_

## Introduction

R0 es una fase de **recuperación** (brownfield) sobre D2KIRO / dota2coach, un sistema existente y en
producción (Railway, auto-deploy sobre `master`). R0 **no** agrega funcionalidad de Dota ni mejora la
inteligencia de drafting. Su único objetivo es restablecer un baseline de ingeniería confiable:

> **Cuando el sistema diga GREEN, debe existir evidencia reproducible de que realmente está GREEN.**

**Definición operativa de GREEN** (diseño §2.1): un estado se declara verde solo si existe un
artefacto determinista (salida de script / test / reporte con exit code) que cualquiera puede
regenerar y que produce el mismo veredicto en la máquina real del desarrollador (Windows) y en CI
(Ubuntu).

**Alcance y no-objetivos (resumen; el detalle canónico vive en el diseño §1.2 y §7):** R0 **no**
reescribe componentes probados, **no** agrega señales nuevas al motor, **no** rediseña `DraftState`,
**no** rediseña las métricas ni benchmarks de la Fase 9 (se reparan, no se rehacen), **no** enciende
`patch_meta` ni ninguna señal con `dataReady=false`, **no** activa el segundo motor
(`ENABLE_PRO_DRAFTER=false`), **no** adopta una librería PBT nueva, **no** borra `.kiro/` y **no**
crea agentes nuevos. Cada requisito de este documento se deriva del diseño aprobado
(`design.md`, misma carpeta) y no agrega alcance.

Los requisitos se organizan en cinco grupos que espejan los cuatro workstreams del diseño (con la
verdad de la evaluación dividida en R0.2A y R0.2B), en el orden de dependencia acíclico
`R0.1 → R0.2A → R0.3 → R0.2B` y `R0.1 → R0.4`:

- **R0.1 Environment Truth** (requisitos `1.x`)
- **R0.2A Evaluation Instrument Recovery** (requisitos `2A.x`)
- **R0.3 Engine Truth** (requisitos `3.x`)
- **R0.2B Candidate Evaluation / Promotion** (requisitos `2B.x`)
- **R0.4 Harness Truth** (requisitos `4.x`)

Además, una sección **Transversal** (requisitos `T.x`) recoge la definición de GREEN, la arquitectura
de verificación por niveles, el bucle de replanificación y los riesgos irreversibles (diseño §2, §5,
§6, §8).

**Clase de cada requisito / criterio:** siguiendo el diseño §5, los criterios de aceptación que actúan
como gate se marcan como **required**, **optional** o **informational**. Dentro del Evaluation Gate,
**cada sub-check declara su propia clase** (el default no es "todo required"). P1 (ningún gate
obligatorio devuelve PASS si no ejecutó) **solo obliga sobre los sub-checks `required`**: un sub-check
`required` en estado `SKIPPED`/`BLOCKED` bloquea (exit != 0 en enforce); un sub-check
`optional`/`informational` skipped no bloquea, se reporta.

## Glossary

- **R0_System**: el conjunto del sistema de ingeniería de D2KIRO bajo recuperación (motor, gates de
  evaluación, hooks, harness de contexto y tooling), tomado como el sistema al que se refieren los
  requisitos.
- **Engine**: el motor de sugerencias (`apps/engine/src/signals/`), tubería de señales → mezcla →
  orden → explicación.
- **Evaluation_Gate**: el gate de evaluación de Fase 9 (`scripts/eval/gate.ts`) que compara un
  `Candidate` contra un `ReferenceBaseline`.
- **Hook_Path_Normalizer**: el helper compartido de normalización de rutas en hooks
  (`scripts/hooks/_hook_lib.py`: `to_repo_relative` / `matches_any`).
- **Data_Boundary_Guard**: el guard PreToolUse `data-boundary-guard.py` que protege los datos curados.
- **Write_Scope_Guard**: el guard PreToolUse `write-scope-guard.py` que limita la escritura al
  `write_scope` de la tarea.
- **GateStatus**: veredicto del `Evaluation_Gate`, uno de `PASS | FAIL | SKIPPED | BLOCKED`.
- **ReferenceBaseline**: el último baseline aceptado contra el que se compara un candidate nuevo
  (incluye `identity`, resultados y `acceptedAtCommit`).
- **Candidate**: lo que se mide ahora (HEAD), aún no promovido a baseline.
- **EvaluationIdentity**: identidad de comparabilidad = `datasetVersion` + `evaluationProtocolVersion`
  + `scoringModelFamily`.
- **structural applicability (`A(S)`)**: si una señal aplica a la estructura del estado del draft,
  independiente de datos y de calibración.
- **dataReady**: flag explícito por señal — si los datos que la señal necesita son confiables, frescos
  y completos.
- **calibration**: transformación de normalización de una señal; nunca es interruptor de
  disponibilidad.
- **votes / voting**: una señal vota (participa en el score) solo si `structurallyApplicable AND
  dataReady`.
- **raw: null**: hueco de datos; valor sagrado (`applicable:false ≠ raw:null`, `invariantes.md`).
- **AvailableSignalsReport**: reporte observable que expone, por decisión, los tres estados de cada
  señal (structurallyApplicable / dataReady / calibrated), si vota y por qué no.
- **Reconciliation_Procedure**: procedimiento de 5 pasos (vía jerarquía de autoridad ADR-001 L0–L6)
  para decidir, caso por caso, quién es la fuente de verdad cuando documento y código se contradicen.
- **Harness_Responsibility_Matrix**: tabla que asigna a cada mecanismo existente un veredicto
  KEEP / MERGE / MOVE / DELETE / REFACTOR.
- **required / optional / informational**: clase de un check de verificación (diseño §5); determina si
  P1 obliga (bloquea) o solo se reporta.
- **comando canónico**: `bun run test` (nunca `bun test` crudo en la raíz, que miente por el
  registrator global de happy-dom).
- **canonical dependency-management procedure**: el procedimiento de gestión de dependencias que
  sobrevive a la `Harness_Responsibility_Matrix` (R0.4). Su nombre concreto se resuelve en R0.4 al
  racionalizar los mecanismos existentes (p.ej. `/gear-up`, `@depcheck`); los requisitos referencian
  su **resultado canónico**, no un comando específico actual.
- **nonVotingReason**: motivo explícito por el que una señal no vota, presente cuando `votes=false`;
  uno de `"data_not_ready"` (structurallyApplicable=true pero dataReady=false) o
  `"not_structurally_applicable"` (structurallyApplicable=false). Nunca se infiere de `raw:null`.

## Requirements

---

## R0.1 — Environment Truth

_(Deriva de diseño §4.1. Precondición para confiar en cualquier otra medición de R0.)_

### Requisito 1.1 — Suites verdes reproducibles por el comando canónico en Windows y CI

**User Story:** Como desarrollador de D2KIRO, quiero que las tres suites (engine, web, scripts) estén
verdes de forma reproducible en mi máquina Windows real y en CI corriendo el **mismo** comando
canónico, para que un veredicto GREEN sea evidencia reproducible y no una afirmación local que solo se
cumple en CI.

#### Acceptance Criteria

1. WHEN se ejecuta el comando canónico `bun run test` en Windows, THE R0_System SHALL ejecutar las tres
   suites (engine, web, scripts) y producir un veredicto con exit code. **Clase: required**
2. WHEN se ejecuta el comando canónico `bun run test` en CI (Ubuntu), THE R0_System SHALL producir el
   mismo veredicto de PASS/FAIL que en Windows para el mismo commit (convergencia P3). **Clase:
   required**
3. IF una suite falla por una ruta POSIX hardcodeada o por un assert de separador (`/` vs `\`), THEN
   THE R0_System SHALL tratar la divergencia como un defecto de tooling (clase C) reparable en el
   borde del test con helpers de `node:path`, no como un estado aceptable. **Clase: required**

**NO debe cambiar:** el comando canónico es `bun run test`; el `bun test` crudo en la raíz miente
(diseño §2.2, §4.1) y no debe usarse como fuente de verdad.

### Requisito 1.2 — Reconciliar dependencias faltantes de `apps/web`

**User Story:** Como desarrollador, quiero que las dependencias de test de `apps/web` estén presentes,
para que la suite web deje de fallar por errores de resolución de módulos.

#### Acceptance Criteria

1. WHEN se ejecuta la suite de `apps/web` bajo el comando canónico, THE R0_System SHALL resolver
   `iron-session` y `@testing-library/react` sin errores de resolución. **Clase: required**
2. THE R0_System SHALL reconciliar cualquier dependencia faltante de `apps/web` a través del
   **canonical dependency-management procedure** que sobreviva a la Harness Responsibility Matrix
   (R0.4, requisito 4.3), no a través de un comando específico nombrado. **Clase: required**

**Nota:** el nombre concreto del procedimiento canónico de dependencias se resuelve en R0.4 (la
`Harness_Responsibility_Matrix` puede racionalizar mecanismos hoy existentes como `/gear-up` o
`@depcheck`). Este requisito referencia el **resultado canónico** de esa racionalización, no un
comando actual concreto.

**Preconditions / Discovery:** ninguna adicional a las de este documento.

### Requisito 1.3 — Normalización de ruta OS-independiente en hooks, con fail-closed

**User Story:** Como desarrollador que trabaja en Windows, quiero que la normalización de rutas de los
hooks produzca el mismo resultado en Windows y en Ubuntu, para que los guards de escritura y de datos
se comporten igual en ambos sistemas operativos.

#### Acceptance Criteria

1. WHEN `Hook_Path_Normalizer.to_repo_relative` recibe una ruta (absoluta o relativa, con separador
   `/` o `\`), THE R0_System SHALL devolver siempre una ruta relativa al repo con separador `/`,
   idéntica independientemente del sistema operativo donde corre. **Clase: required**
2. WHEN `Hook_Path_Normalizer.matches_any` recibe una ruta ya normalizada, THE R0_System SHALL producir
   un resultado idéntico en Windows y en Ubuntu para el mismo input lógico. **Clase: required**
3. IF `Data_Boundary_Guard` no puede decidir por ambigüedad de normalización, THEN THE R0_System SHALL
   fallar cerrado (bloquear la escritura), nunca fallar abierto. **Clase: required**

**NO debe cambiar:** la lógica de normalización se centraliza en un solo lugar
(`scripts/hooks/_hook_lib.py`); no se dispersa la responsabilidad.

**Preconditions / Discovery:** el diseño verificó que el helper usa `Path.resolve().relative_to()` y
regex con clase `[^/]` (sensible al separador de SO); la línea exacta que falla es confirmación en
tiempo de tarea (§4.1), no una suposición.

### Requisito 1.4 — Comandos documentados == comandos que existen

**User Story:** Como desarrollador, quiero que los comandos documentados coincidan con los que
realmente existen en `package.json`, para no depender de comandos inexistentes (`dev`, `lint`).

#### Acceptance Criteria

1. WHERE la documentación (CLAUDE.md y espejos) referencia un comando `dev` o `lint`, THE R0_System
   SHALL alinear la documentación con `package.json`: crear el script si debe existir, o eliminar la
   referencia si no. **Clase: required**
2. THE R0_System SHALL asegurar que todo comando documentado como canónico exista y sea ejecutable.
   **Clase: required**

**Preconditions / Discovery:** la decisión de crear o eliminar `dev`/`lint` depende de descubrimiento
en tiempo de tarea (§4.1, "decisión de tarea, tras descubrimiento").

### Requisito 1.5 — PRE-PUSH gate determinístico y verificable

**User Story:** Como desarrollador, quiero que exista un PRE-PUSH gate determinístico y verificable
que ejecute el software correctness antes de que un commit salga de la máquina, para que el nivel
PRE-PUSH de la arquitectura de verificación tenga un punto de anclaje real y no dependa de una
implementación concreta.

#### Acceptance Criteria

1. THE R0_System SHALL disponer de un PRE-PUSH gate **local y determinístico** que ejecute el
   software correctness (`bun run test` + sanity pequeño, diseño §5) **en la máquina, antes de que el
   código salga de ella** hacia el remoto. El PRE-PUSH es por definición una barrera **local**: corre
   antes del push efectivo, en el entorno del desarrollador. **Clase: required**
2. THE R0_System SHALL considerar Husky **una** implementación posible del gate local, **no
   obligatoria**; cualquier mecanismo **local** equivalente y verificable satisface el requisito — p.ej.
   `core.hooksPath` cableado, un git `pre-push` hook nativo, o un wrapper local equivalente. **Clase:
   required**
3. THE R0_System SHALL NO considerar un gate de CI/PR como satisfacción del PRE-PUSH: CI/PR pertenece a
   una **capa posterior** de verificación (corre DESPUÉS de que el código salió de la máquina) y por lo
   tanto NO es equivalente ni sustituto de la barrera local. CI/PR SHALL mantenerse como **defensa
   adicional posterior**, nunca en lugar del gate local. **Clase: required**
4. WHEN se verifica el estado del PRE-PUSH gate, THE R0_System SHALL exponer de forma verificable si el
   gate **local** está activo y qué mecanismo local lo implementa (p.ej. `core.hooksPath` / `.git/hooks`
   apuntando a `.husky`, un `pre-push` nativo, o el wrapper local en uso). **Clase: required**
5. IF no existe ningún mecanismo **local** equivalente verificable en su lugar, THEN THE R0_System SHALL
   NO tratar la sola documentación de la ausencia de Husky como satisfacción del requisito; documentar
   la ausencia solo es aceptable WHERE existe otro PRE-PUSH gate **local** equivalente verificable que
   cumpla el criterio 1. La sola presencia de un gate de CI/PR SHALL NO contar como cumplimiento del
   PRE-PUSH. **Clase: required**

**NO debe cambiar:** el objeto del requisito es la **existencia de un PRE-PUSH gate local y
determinístico**, no la existencia de Husky; Husky es una implementación local intercambiable. CI/PR es
una capa posterior adicional, nunca un sustituto del gate local.

**Preconditions / Discovery (informan la IMPLEMENTACIÓN del gate, no la existencia del requisito):**
- §9.7 — Si git está realmente cableado a `.husky` no es verificable solo desde el working tree;
  informa **cómo** se implementa el gate (Husky vs mecanismo equivalente), no si el requisito aplica.
- §9.6 — Si los tests en rojo también fallan en la máquina donde se hacen los commits reales (WSL vs
  Windows) informa el alcance real de la convergencia (P3) que el gate debe ejecutar.

---

## R0.2A — Evaluation Instrument Recovery

_(Deriva de diseño §4.2, estado objetivo R0.2A + LLD. Restaura el instrumento de evaluación; **no**
depende de R0.3. No rediseña métricas ni benchmarks de Fase 9: `evaluateGate()` queda intacto.)_

### Requisito 2A.1 — Gate que falla fuerte cuando no puede correr

**User Story:** Como responsable de la calidad del sistema, quiero que el gate de evaluación falle
fuerte cuando no puede correr, para que "no corrió" nunca se declare como "pasó" (invariante rector
P1).

#### Acceptance Criteria

1. THE Evaluation_Gate SHALL producir un veredicto `GateStatus ∈ {PASS, FAIL, SKIPPED, BLOCKED}` en
   lugar de un binario PASS/FAIL. **Clase: required**
2. IF el Golden Dataset está vacío, THEN THE Evaluation_Gate SHALL devolver `SKIPPED` y, en modo
   enforce, exit code != 0 — nunca PASS. **Clase: required**
3. IF `pro-drafts.sqlite` (o el dato requerido por el sub-check de Pro Agreement / Benchmark B) está
   ausente, THEN THE Evaluation_Gate SHALL marcar **ese sub-check** como `SKIPPED` — nunca PASS — y,
   como Benchmark B es `optional`/`informational` por ADR-002 (criterio 7), SHALL **reportarlo sin
   bloquear el gate completo**: su `SKIPPED` NO fuerza exit code != 0, el sub-check de Engine Quality /
   Benchmark A se evalúa igual y `gate --enforce` PUEDE PASS si Benchmark A pasa. La regla "SKIPPED de
   un sub-check `required` ⇒ exit != 0" (criterios 2 y 6) se mantiene intacta para el Golden Dataset
   vacío y para cualquier sub-check `required`. **Clase: required**
4. IF el `ReferenceBaseline` está ausente, THEN THE Evaluation_Gate SHALL devolver `BLOCKED` y, en modo
   enforce, exit code != 0 — nunca PASS. **Clase: required**
5. THE Evaluation_Gate SHALL asignar a CADA sub-check del gate (p.ej. Engine Quality / Benchmark A,
   Professional Pick Agreement / Benchmark B) su propia clase `required | optional | informational`; el
   DEFAULT SHALL NOT ser "todo required". **Clase: required**
6. WHEN un sub-check `required` queda en estado `SKIPPED` o `BLOCKED` en modo enforce, THE
   Evaluation_Gate SHALL bloquear con exit code != 0 (SKIPPED nunca equivale a PASS); WHERE un sub-check
   es `optional` o `informational` y queda `SKIPPED`/`BLOCKED`, THE Evaluation_Gate SHALL reportarlo sin
   bloquear. **Clase: required**
7. WHERE un sub-check evalúa acuerdo con el pick profesional (Professional Pick Agreement / Benchmark
   B), THE Evaluation_Gate SHALL clasificarlo como `optional` o `informational` por defecto (derivado de
   ADR-002, "el pick pro no es ground truth"), mientras que Engine Quality / Benchmark A puede
   clasificarse `required`; la clase concreta por sub-check se fija en R0.2A. **Clase: required**

**NO debe cambiar:** `evaluateGate()` (la comparación NDCG@5 / BadPickRate / Agreement) no se toca; se
preserva la Fase 9 (§7). Solo cambia la envoltura de política PASS/FAIL/SKIPPED/BLOCKED y la
clasificación por sub-check (sin inventar métricas nuevas).

**Preconditions / Discovery (BLOQUEANTE):**
- §9.3 — Dónde vive `pro-drafts.sqlite` (gitignored, ausente); bloqueante SOLO para el sub-check de Pro
  Agreement / Benchmark B bajo `--enforce`. El sub-check de Engine Quality / Benchmark A no depende de
  este archivo.

### Requisito 2A.2 — Modelo de baseline con identidad de comparabilidad y regla `isComparable`

**User Story:** Como responsable de la evaluación, quiero que un candidate se compare contra el último
baseline aceptado usando una identidad de comparabilidad explícita, para que la comparación sea válida
por compatibilidad de dataset y protocolo, y nunca por diferencia de hash de commit.

#### Acceptance Criteria

1. THE Evaluation_Gate SHALL modelar explícitamente `referenceBaseline`, `candidate`, `datasetVersion`,
   `evaluationProtocolVersion` y `scoringModelFamily`. **Clase: required**
2. WHEN se evalúa un candidate, THE Evaluation_Gate SHALL compararlo contra el `ReferenceBaseline`
   aceptado, no contra sí mismo. **Clase: required**
3. IF `isComparable(candidate, referenceBaseline)` es falso por mismatch de `datasetVersion` o
   `evaluationProtocolVersion` (o familia de scoring no comparable), THEN THE Evaluation_Gate SHALL
   devolver `BLOCKED` con motivo "baseline incomparable: dataset/protocol mismatch". **Clase:
   required**
4. THE Evaluation_Gate SHALL determinar la comparabilidad por compatibilidad de dataset + protocolo (y
   familia de scoring), nunca por diferencia de hash de commit. **Clase: required**

**NO debe cambiar:** la familia de scoring (`scoringModelFamily`, p.ej. `SCORING_WEIGHTS_V6`) es una
constante de pesos activa, no un hash de HEAD; no se rediseñan métricas ni benchmarks de Fase 9.

### Requisito 2A.3 — Cablear `--enforce` a INTELLIGENCE CI

**User Story:** Como responsable de operaciones, quiero que el modo `--enforce` del gate corra en un
gate real (INTELLIGENCE CI), para que el eval obligatorio no dependa solo de una sesión de Claude Code.

#### Acceptance Criteria

1. THE R0_System SHALL cablear la ejecución del `Evaluation_Gate --enforce` al nivel INTELLIGENCE CI
   (diseño §3.2 / §5), donde vive el eval pesado. **Clase: required**
2. WHILE el gate corre en modo `--enforce`, THE Evaluation_Gate SHALL producir exit code != 0 ante
   `FAIL`, `SKIPPED` o `BLOCKED` de un **sub-check `required`**; un sub-check `optional`/`informational`
   en esos estados SHALL reportarse sin forzar exit != 0. **Clase: required**

**NO debe cambiar:** el eval pesado no corre en pre-push; en pre-push queda como mucho un sanity
pequeño (diseño §5).

---

## R0.3 — Engine Truth

_(Deriva de diseño §4.3 y de las interfaces del motor. Cambia un mecanismo que afecta la salida visible
del producto; por eso su candidate HEAD se mide en R0.2B.)_

### Requisito 3.1 — Cálculo único: score, reason, comparison y evidence de una sola fuente

**User Story:** Como desarrollador del motor, quiero que `score`, `reason`, `comparison` y `evidence`
deriven de un único cálculo de contribuciones ponderadas por estado, para que la explicación que ve el
usuario sea coherente con el ranking real.

#### Acceptance Criteria

1. THE Engine SHALL derivar `score`, `reason`, `comparison` y `evidence` de una sola estructura de
   contribución ponderada por estado (`StateWeightedContribution`), retirando `weightedContributions`
   legacy del camino activo. **Clase: required**
2. WHEN se calcula `comparison.delta` para un par `(top, second)`, THE Engine SHALL computarlo como la
   diferencia de contribuciones `weighted` reales sobre señales comparables en ambos candidatos, no
   sobre un cálculo paralelo. **Clase: required**
3. THE Engine SHALL garantizar que `Σ contribution.weighted == score` en todos los caminos, incluido el
   camino `teamOpening`. **Clase: required**
4. IF una señal aparece citada en `reason` o `comparison`, THEN THE Engine SHALL garantizar que esa
   señal tiene `weighted > 0` en el `score` del candidato. **Clase: required**

**NO debe cambiar:** no se agregan señales, no hay lookahead, no se rediseña `DraftState`, no se reabre
la Fase 3 y no se toca `SCORING_WEIGHTS_V6` (congelada por nombre, §7).

### Requisito 3.2 — Tres conceptos ortogonales: applicability, data readiness y calibration

**User Story:** Como desarrollador del motor, quiero separar structural applicability, data readiness y
calibration en tres conceptos ortogonales, para que la disponibilidad de una señal sea independiente de
la calibración y esté explícita y observable.

#### Acceptance Criteria

1. THE Engine SHALL calcular `structurallyApplicableSignals` (`A(S)`) dependiendo solo de la estructura
   del estado del draft, nunca de la calibración ni de la presencia de datos. **Clase: required**
2. THE Engine SHALL evaluar `dataReady` por señal como un flag explícito y verificable, independiente
   de la structural applicability y de la calibración. **Clase: required**
3. WHEN se determina qué señales votan, THE Engine SHALL definir `votes == (structurallyApplicable AND
   dataReady)`; THE Engine SHALL derivar la no-participación EXPLÍCITAMENTE de
   `structurallyApplicable=false` OR `dataReady=false`, y SHALL NOT inferir la no-participación de
   `raw=null` ni usar la calibración como interruptor de disponibilidad. **Clase: required**
4. THE Engine SHALL tratar `raw` como ortogonal a `votes`: una señal puede tener `raw=null` (hueco de
   dato) tanto con `votes=true` como con `votes=false`, y `raw=null` SHALL NOT implicar ni causar
   `votes=false` (`applicable:false ≠ raw:null`). **Clase: required**
5. IF una señal tiene `votes=false`, THEN THE Engine SHALL fijar `weighted=0` y presentar
   `nonVotingReason ∈ {"data_not_ready", "not_structurally_applicable"}`, sin representar la
   no-participación como `raw: null`. **Clase: required**
6. THE Engine SHALL producir un `AvailableSignalsReport` observable por decisión que exponga, por señal,
   `structurallyApplicable`, `dataReady`, `calibrated`, `votes` y, cuando `votes=false`,
   `nonVotingReason`. **Clase: required**

**Definición formal de la relación entre los cinco campos observables por señal** (aplica a 3.2 y 3.3):

| Campo | Semántica | Regla |
|---|---|---|
| `structurallyApplicable` | ¿la señal aplica a la estructura del estado del draft? | Independiente de datos y de calibración |
| `dataReady` | ¿los datos que la señal necesita son confiables/frescos/completos? | Flag explícito por señal |
| `votes` | ¿la señal participa en el score? | `votes == (structurallyApplicable AND dataReady)` |
| `raw` | valor crudo de la señal (`number \| null`) | **Ortogonal** a `votes`; `raw=null` NO implica ni causa `votes=false` |
| `weighted` | contribución final al score | `votes=false ⇒ weighted=0` |
| `nonVotingReason` | motivo de no-participación | Presente sii `votes=false`; uno de `"data_not_ready"` \| `"not_structurally_applicable"` |

- La no-participación se deriva **únicamente** de `structurallyApplicable=false` OR `dataReady=false`,
  **nunca** de `raw=null`.
- `raw` es ortogonal: una señal puede tener `raw=null` por falta de dato aunque `votes` sea `true` o
  `false`.

**NO debe cambiar:** la calibración es una transformación de normalización, nunca un interruptor de
disponibilidad; no se agregan señales.

### Requisito 3.3 — `patch_meta` con `dataReady=false`: no vota, producción idéntica a pre-R0

**User Story:** Como responsable de producto, quiero que `patch_meta` (y cualquier señal cuyos datos no
estén listos) no vote y no cambie el comportamiento observable de producción respecto a pre-R0, para
que R0 elimine el acoplamiento accidental a la calibración sin encender señales con datos no
confiables.

#### Acceptance Criteria

1. THE Engine SHALL modelar `patch_meta` en R0 con este contrato EXACTO: `structurallyApplicable=true`,
   `dataReady=false`, `raw=null` aceptable por falta de dato, `votes=false`, `weighted=0` y
   `nonVotingReason="data_not_ready"`. **Clase: required**
2. WHILE `dataReady(patch_meta)=false`, THE Engine SHALL mantener `patch_meta.weighted == 0`,
   `patch_meta.votes == false` y `patch_meta.nonVotingReason == "data_not_ready"`. **Clase: required**
3. THE Engine SHALL producir una salida observable de producción para `patch_meta` idéntica a la de
   pre-R0 (que ya era `raw=null weighted=0.00`). **Clase: required**

**Contrato R0 de `patch_meta` (tabla explícita):**

| Campo | Valor R0 |
|---|---|
| `structurallyApplicable` | `true` |
| `dataReady` | `false` |
| `raw` | `null` (aceptable por falta de dato) |
| `votes` | `false` |
| `weighted` | `0` |
| `nonVotingReason` | `"data_not_ready"` |

Nótese que `raw=null` aquí coexiste con `structurallyApplicable=true`: la no-participación se deriva de
`dataReady=false`, **no** de `raw=null`.

**NO debe cambiar (explícito, no-objetivo del diseño §1.2):** R0 **no** enciende `patch_meta` ni
ninguna señal con `dataReady=false`; el único cambio es eliminar el acoplamiento a
`calibration.signals.patch_meta`. La activación real queda para una fase posterior validada.

**Preconditions / Discovery:** la data de parche está stale/mezclada/incompleta según el audit
(contexto §4.2/§4.3); su reparación es una fase posterior, fuera de R0.

### Requisito 3.4 — Estado degenerado marcado, sin ranking fingido

**User Story:** Como usuario del Copilot, quiero que cuando ninguna señal vota el sistema lo marque
como estado degenerado en lugar de fingir un ranking, para no recibir una recomendación falsa
ordenada por el orden de iteración de las claves.

#### Acceptance Criteria

1. IF ninguna señal vota (conjunto `voting` vacío), THEN THE Engine SHALL devolver `suggestions == []`
   AND añadir `"no_signal_available"` a `degraded`. Este es el ÚNICO contrato de estado degenerado en
   R0 (no existe la alternativa "suggestions marcadas con confianza baja"). **Clase: required**
2. THE Engine SHALL NOT ordenar los candidatos por `Object.keys(meta.heroes)` en el estado degenerado.
   **Clase: required**
3. WHEN el estado es degenerado, THE Engine SHALL exponer `decisionContext` comunicando que **no hay
   señales disponibles para votar** (puede haber señales estructuralmente aplicables con
   `dataReady=false`), y SHALL referenciar el `AvailableSignalsReport` para la causa por señal. **Clase:
   required**

**NO debe cambiar:** no se finge un top-1 con score 0 como si fuera una recomendación real. El
`decisionContext` NO debe afirmar "no hay señales estructuralmente aplicables al estado actual", porque
el estado degenerado también ocurre con señales aplicables pero `dataReady=false`.

### Requisito 3.5 — `openingStrategy` respeta `raw: null`

**User Story:** Como desarrollador del motor, quiero que `openingStrategy` devuelva `null` para un héroe
sin dato, para respetar el invariante "sin dato, nunca un valor".

#### Acceptance Criteria

1. IF un héroe no tiene entrada en `capabilities.json`, THEN THE Engine SHALL devolver `null` desde
   `openingStrategy`, nunca un valor fabricado (p.ej. `"scaling"`). **Clase: required**
2. WHEN `openingStrategy` procesa un héroe con entrada válida, THE Engine SHALL derivar la estrategia de
   esa entrada. **Clase: required**

**NO debe cambiar:** `raw: null` es sagrado (`invariantes.md`); `openingStrategy` respeta `raw:null` en
el camino de apertura.

### Requisito 3.6 — Preservar el candado de suma de pesos de la versión activa

**User Story:** Como responsable de la calidad del motor, quiero preservar el candado de que los pesos
de la versión activa suman 1.0, para que la constante de pesos activa se mantenga consistente.

#### Acceptance Criteria

1. THE Engine SHALL preservar el candado existente en `mix.test.ts` que verifica `Σ SCORING_WEIGHTS_V6
   == 1.0` para la versión activa. **Clase: required**

**NO debe cambiar:** el candado ya existe y no se toca; `SCORING_WEIGHTS_V1..V6` y el patrón
freeze-by-name se preservan (§7).

---

## R0.2B — Candidate Evaluation / Promotion

_(Deriva de diseño §4.2, estado objetivo R0.2B + `promoteCandidate`. Depende de R0.3 completado y de
R0.2A — instrumento restaurado.)_

### Requisito 2B.1 — Evaluar el candidate HEAD contra el baseline aceptado

**User Story:** Como responsable de la evaluación, quiero evaluar el candidate HEAD resultante de R0.3
contra el `ReferenceBaseline` aceptado, para medir si el cambio del motor mantiene o mejora la calidad.

#### Acceptance Criteria

1. WHEN R0.3 ha producido un candidate HEAD, THE R0_System SHALL evaluar ese candidate contra el
   `ReferenceBaseline` aceptado usando el `Evaluation_Gate` restaurado (R0.2A). **Clase: required**
2. THE R0_System SHALL ejecutar este eval pesado en el nivel INTELLIGENCE CI (diseño §5), no en
   pre-push. **Clase: required**
3. WHEN `pro-drafts.sqlite` está ausente pero el Golden Dataset y `dota2coach.sqlite` están presentes,
   THE eval producer (`bun run eval`) SHALL emitir un candidate **válido y comparable** en el que
   Benchmark A / Engine Quality queda **medido** y Benchmark B / Professional Pick Agreement queda **no
   medido**: `corpus` de drafts/tournaments en 0, `perBaseline` vacío, `bootstrap` vacío y ninguna
   métrica profesional sintetizada. THE eval producer SHALL NOT abortar la generación del candidate por
   la ausencia del corpus, y THE Evaluation_Gate SHALL reportar Benchmark B como `SKIPPED`
   informational (no PASS, no bloqueo); `gate --enforce` PUEDE PASS si Benchmark A pasa. **Clase:
   required**
4. WHERE el shape del candidate exige un valor estructural neutro para serializar el benchmark no
   medido (p.ej. `constraintViolationRate: 0`), THE R0_System SHALL tratar ese valor como un
   **SENTINEL de shape técnico de un benchmark NO MEDIDO**, no como una observación medida ("0
   violaciones"); la fuente de verdad de "no disponible" es `corpus == 0` + `perBaseline` vacío + gate
   status `SKIPPED`, y ese `0` SHALL NOT presentarse como evidencia medida en ningún reporte. **Clase:
   required**
5. WHEN `pro-drafts.sqlite` está presente, THE eval producer SHALL preservar el comportamiento previo:
   ejecutar `loadReplayCasesFromDb` / `runProAgreement` y calcular el Benchmark B real. THE eval
   producer SHALL NOT deshabilitar Benchmark B; solo hace **opcional la AUSENCIA** del corpus.
   **Clase: required**
6. THE R0_System SHALL generar el candidate desde un HEAD **limpio y trazable** que contenga todos los
   cambios R0 aceptados: antes de evaluar, `git status --porcelain` sin cambios pendientes en
   `apps/engine/src/**` ni en `scripts/eval/**`, y el campo `commit` del candidate identifica el commit
   que realmente contiene el código medido. IF el working tree está sucio en esas áreas, THEN THE
   R0_System SHALL detenerse y NO evaluar el candidate. THE R0_System SHALL NOT agregar metadata de
   dirty-working-tree al producto (la trazabilidad es una precondición del proceso, no un campo del
   candidate). **Clase: required**

**Preconditions / Discovery (granular):** depende de R0.3 completado, de R0.2A (instrumento
restaurado) y de la tarea 33 (productor de eval corpus-opcional en PASS). §9.3 (`pro-drafts.sqlite`)
bloquea **solo** el sub-check de Pro Agreement / Benchmark B de este eval, que queda **`SKIPPED`
informational** por ADR-002; el sub-check de Engine Quality / Benchmark A puede evaluar el candidate
HEAD sin ese archivo. Entre la tarea 33 y la evaluación, el PO realiza un **checkpoint commit** de
todo el estado R0 aceptado (acción humana de trazabilidad/reproducibilidad, no una operación
irreversible/sensible).

### Requisito 2B.2 — Promoción a nuevo baseline solo tras aceptación explícita

**User Story:** Como responsable de la evaluación, quiero que la promoción de un candidate a nuevo
baseline requiera aceptación explícita, para que ningún baseline se promueva automáticamente solo por
estar en HEAD.

#### Acceptance Criteria

1. IF no hay aceptación explícita, THEN THE R0_System SHALL NO promover el candidate y SHALL devolver el
   motivo "sin aceptación explícita". **Clase: required**
2. WHEN existe aceptación explícita (criterio explícito + acción deliberada), THE R0_System SHALL
   promover el candidate a nuevo `ReferenceBaseline` (congelándolo como baseline). **Clase: required**
3. THE R0_System SHALL NOT promover un candidate a nuevo baseline de forma automática por estar en HEAD.
   **Clase: required**

**NO debe cambiar:** la promoción de baseline es una decisión sensible; se comporta como acción
irreversible/sensible bajo approval explícito (§8, ver T.4).

---

## R0.4 — Harness Truth

_(Deriva de diseño §4.4. Independiente de R0.2A/R0.3; depende solo de R0.1. Objetivo: menos, no más —
racionalizar lo existente, no crear agentes nuevos.)_

### Requisito 4.1 — Una sola fuente de verdad por hecho, vía Reconciliation Procedure

**User Story:** Como mantenedor del harness, quiero una sola fuente de verdad por hecho y que las
contradicciones documento↔código se resuelvan con un procedimiento explícito, para no depender de
"el código siempre gana" ni de espejos manuales divergidos.

#### Acceptance Criteria

1. WHEN un documento y el código se contradicen, THE R0_System SHALL aplicar el `Reconciliation_Procedure`
   de 5 pasos (detectar, clasificar por autoridad ADR-001 L0–L6, determinar canónico, resolver,
   registrar) para decidir caso por caso quién es la fuente de verdad. **Clase: required**
2. IF el artefacto canónico es el código, THEN THE R0_System SHALL corregir o regenerar el documento
   divergido; IF el artefacto canónico es el documento/spec/ADR, THEN THE R0_System SHALL abrir un
   hallazgo (defecto clase A/B del bucle §6) y corregir el código. **Clase: required**
3. WHEN se resuelve la contradicción V5-vs-V6, THE R0_System SHALL derivar "converger a V6" del hecho de
   que `invariantes.md` (autoridad alta) dice V6, no de una regla ciega de que el código gana. **Clase:
   required**
4. THE R0_System SHALL eliminar o regenerar los espejos manuales divergidos (AGENTS.md y
   `.kiro/steering/{tech,product,structure}.md`) que quedaron desactualizados (dicen V5). **Clase:
   required**
5. THE R0_System SHALL registrar SOLO las reconciliaciones **materiales** — las que cambian
   source-of-truth, una decisión, la arquitectura, un invariante o un comportamiento — en un ÚNICO
   destino canónico (`ledger.md`, el registro append-only de decisiones/tareas resueltas), evitando la
   duplicación innecesaria journal/ledger; THE R0_System SHALL NOT exigir registrar cada sincronización
   trivial. **Clase: required**

**NO debe cambiar:** `invariantes.md`, `journal.md`, `ledger.md` y los ADRs se conservan intactos;
`.kiro/` se conserva (Kiro IDE es el IDE principal confirmado, §9.5); solo se elimina la duplicación
manual de source-of-truth.

**Preconditions / Discovery:** ninguna adicional para la reconciliación V5/V6.

### Requisito 4.2 — Taxonomía del harness sin solapamiento

**User Story:** Como mantenedor del harness, quiero una taxonomía explícita de mecanismos, para que una
misma responsabilidad no esté implementada por múltiples mecanismos.

#### Acceptance Criteria

1. THE R0_System SHALL definir la taxonomía del harness con categorías sin solape: `CLAUDE.md`, `RULE`,
   `SKILL`, `AGENT/SUBAGENT`, `HOOK`, `PERMISSION`, `SPEC`, `ADR`, `TEST`, `EVAL`. **Clase:
   informational**
2. THE R0_System SHALL asegurar que cada categoría respete su regla de no-solapamiento (p.ej. un AGENT
   nunca corre un chequeo determinista; TEST y EVAL quedan separados). **Clase: required**

### Requisito 4.3 — Harness Responsibility Matrix aplicada a los mecanismos existentes

**User Story:** Como mantenedor del harness, quiero aplicar un veredicto KEEP/MERGE/MOVE/DELETE a cada
mecanismo existente, para racionalizar lo que hay sin multiplicar mecanismos.

#### Acceptance Criteria

1. THE R0_System SHALL aplicar la `Harness_Responsibility_Matrix` (veredicto por mecanismo:
   KEEP / MERGE / MOVE / DELETE / REFACTOR) a los mecanismos existentes del harness. **Clase: required**
2. THE R0_System SHALL mover la narrativa de fase cerrada (`engine.md`, `fase-9*.md`) a
   `docs/rules-archive/`, conservando lo imperativo como RULE. **Clase: required**
3. THE R0_System SHALL consolidar los wrappers de `.claude/commands/` sobre las skills subyacentes.
   **Clase: optional**

**NO debe cambiar:** se conservan intactos `invariantes.md`, `journal.md`/`ledger.md`, los ADRs y los
agentes `evaluation-engineer` / `data-stat-engineer` (bien acotados).

### Requisito 4.4 — Agentes defectuosos reparados o retirados (determinismo por código, P2)

**User Story:** Como mantenedor del harness, quiero que ningún agente corra chequeos deterministas y que
los agentes con dependencias inexistentes se reparen o retiren, para cumplir P2 (determinismo por
código, no por juicio de LLM).

#### Acceptance Criteria

1. THE R0_System SHALL mover el chequeo determinista que hoy corre el agente Warden (tests/lint) a un
   HOOK/CI; el agente, si sobrevive, SHALL solo interpretar. **Clase: required**
2. THE R0_System SHALL reparar o retirar los agentes con dependencias inexistentes (Artisan requiere un
   design system inexistente; Tracer requiere un MCP inexistente). **Clase: required**
3. THE R0_System SHALL NOT crear agentes nuevos. **Clase: required**

**NO debe cambiar:** menos, no más; no se multiplican agentes.

### Requisito 4.5 — Separar escaneo barato del regenerador; mover trabajo pesado

**User Story:** Como desarrollador, quiero que el escaneo estático barato no tenga efectos secundarios y
que el trabajo pesado se mueva a su nivel correcto, para que la verificación cerca de la edición sea
barata y sin efectos colaterales.

#### Acceptance Criteria

1. THE R0_System SHALL separar el escaneo estático barato (nivel AFTER EDIT) de la regeneración de
   `hub.html`, de modo que el escaneo no tenga efectos secundarios. **Clase: required**
2. THE R0_System SHALL convertir la regeneración de `hub.html` en una acción explícita, no un colateral
   de un gate. **Clase: required**
3. THE R0_System SHALL mover el trabajo pesado (`tsc` + suites completas + backtest) del commit gate
   PreToolUse a PRE-PUSH / PR / CI, y el eval `--enforce` completo a INTELLIGENCE CI. **Clase:
   required**

**NO debe cambiar:** el eval pesado no corre en pre-push (§5).

### Requisito 4.6 — Documentar `STEAM_WEB_API_KEY` y eliminar código muerto

**User Story:** Como mantenedor del harness, quiero documentar las variables de entorno faltantes y
eliminar el código muerto, para que la documentación de entorno sea completa y el árbol quede limpio.

#### Acceptance Criteria

1. THE R0_System SHALL documentar `STEAM_WEB_API_KEY` en `.env.example` (regla de `web.md`). **Clase:
   required**
2. THE R0_System SHALL eliminar el código muerto: `verify-claude-md-split.sh`, `analisis-arquitectura.sh`,
   el directorio vacío `.agents/` y `CHECKPOINT.json` (todo null). **Clase: required**
3. THE R0_System SHALL corregir el estado inválido de `TSK-174` (`state:in_progress`) a un valor válido
   del esquema. **Clase: required**

**Preconditions / Discovery (BLOQUEANTE, granular):**
- §9.2 — Qué env vars existen realmente en Railway; bloquea **solo** el criterio 1 de este requisito
  (documentar `STEAM_WEB_API_KEY` en `.env.example`). Los criterios 2 y 3 (código muerto, TSK-174) no
  dependen del entorno Railway y pueden avanzar.

### Requisito 4.7 — Harness Learning / Curation (propone, no autoedita)

**User Story:** Como mantenedor del harness, quiero un mecanismo que detecte candidatos de conocimiento
durable y los clasifique hacia un destino, proponiendo sin autoeditar, para cerrar el gap de que hoy
todo termina en `journal.md` / `engine.md` sin regla de enrutamiento.

#### Acceptance Criteria

1. WHEN termina una tarea, THE R0_System SHALL detectar candidatos de conocimiento durable a partir de
   los disparadores (repeated correction, architecture invariant changed, canonical command changed,
   repeated reusable procedure, new deterministic failure class, Dota domain fact discovered). **Clase:
   informational**
2. WHEN se detecta un candidato, THE R0_System SHALL clasificarlo hacia un destino único (`CLAUDE.md` |
   `Rule` | `Skill` | `ADR` | `Hook/Test/Permission` | `Dota Domain Pack` | `nowhere`). **Clase:
   informational**
3. THE R0_System SHALL proponer los candidatos y SHALL NOT autoeditar `CLAUDE.md` ni ningún artefacto de
   gobernanza; una revisión humana SHALL validar antes de persistir. **Clase: required**

**NO debe cambiar:** coherente con P2 (determinismo por código, no autoedición por LLM) y con el
human-in-the-loop del proyecto.

### Requisito 4.8 — Agent Guardrail Architecture con mecanismo canónico determinista

**User Story:** Como responsable de gobernanza, quiero formalizar los ocho guardrails sobre los roles
confirmados con un mecanismo canónico determinista, para que las restricciones críticas no dependan
solo de instrucciones en lenguaje natural.

#### Acceptance Criteria

1. THE R0_System SHALL declarar los ocho guardrails (scope, tool/permission, write-scope, protected
   evidence, action, verification, loop/circuit-breaker, auditability) sobre los roles confirmados, sin
   agregar agentes nuevos. **Clase: informational**
2. WHERE una restricción crítica pueda imponerse determinísticamente, THE R0_System SHALL usar como
   mecanismo canónico un `Permission`, `Hook`, `Test`, `CI` o `schema/invariant`, no una instrucción en
   prosa a un agente. **Clase: required**
3. IF una restricción NO puede imponerse determinísticamente, THEN THE R0_System SHALL imponerla como
   `Policy/Rule` acompañada de **independent verification** y de un **residual risk explícito**
   documentado; THE R0_System SHALL usar discovery SOLO cuando falta información, no simplemente porque
   una regla sea semántica. **Clase: required**
4. WHEN el guardrail de loop/circuit-breaker está activo, THE R0_System SHALL aplicar esta política de
   proceso verificable: tras un fix y su re-verificación, IF vuelve a ocurrir un FAIL atribuible a la
   MISMA root cause, THEN THE R0_System SHALL NO permitir otro ciclo automático de reparación y SHALL
   detenerse y escalar a REPLAN/HUMAN. **Clase: required**
5. WHEN ocurre un FAIL atribuible a una root cause DISTINTA de la anterior, THE R0_System SHALL iniciar
   su propia clasificación A/B/C/D (bucle §6 / P5) y SHALL NOT contarlo contra el circuit-breaker de la
   causa anterior; este criterio se conecta con el campo `attempts → Tracer` del proyecto. **Clase:
   required**
6. THE R0_System SHALL referenciar los mecanismos deterministas ya existentes (write-scope-guard,
   data-boundary-guard, required-skip ≠ PASS, path-normalization de R0.1) en vez de duplicarlos.
   **Clase: required**

**NO debe cambiar:** no se agregan agentes nuevos; los guardrails se apoyan en la Harness Responsibility
Matrix sin reemplazarla.

**Preconditions / Discovery (BLOQUEANTE, granular):**
- §9.2 — Env vars reales en Railway (compartida con 4.6); bloquea **solo** el guardrail de secretos
  (criterio 2, mecanismo `Permission`/secret) de este requisito. Los criterios de declaración de
  guardrails, circuit-breaker y referencia a mecanismos existentes no dependen del entorno Railway.

---

## Transversal (definición de GREEN, verificación, bucle, riesgos)

_(Deriva de diseño §2, §5, §6, §8.)_

### Requisito T.1 — Definición de GREEN y principios P1–P5

**User Story:** Como responsable del baseline de ingeniería, quiero que GREEN signifique evidencia
reproducible y que rijan los principios P1–P5, para que ningún estado se declare verde sin un artefacto
determinista regenerable.

#### Acceptance Criteria

1. THE R0_System SHALL declarar GREEN solo cuando exista un artefacto determinista (salida de
   script/test/reporte con exit code) que cualquiera pueda regenerar y que produzca el mismo veredicto
   en Windows y en CI. **Clase: required**
2. THE R0_System SHALL sostener P1 (ningún gate obligatorio devuelve PASS si no ejecutó), P2
   (determinismo por código, no por juicio de LLM), P3 (convergencia Windows↔Ubuntu), P4 (causa, no
   síntoma) y P5 (detenerse ante una suposición falsa). **Clase: required**

### Requisito T.2 — Arquitectura de verificación por niveles con clase por nivel

**User Story:** Como desarrollador, quiero una arquitectura de verificación por niveles donde el trabajo
caro se mueve a pre-push/CI y cada nivel tiene una clase, para que la verificación barata quede cerca de
la edición y P1 obligue solo sobre lo `required`.

#### Acceptance Criteria

1. THE R0_System SHALL definir los niveles de verificación AFTER EDIT (informational), TASK COMPLETION
   (required), PRE-PUSH (required, software + sanity pequeño, sin eval pesado), PR/CI (required,
   software completo), INTELLIGENCE CI (required, eval completo de draft), E2E (optional) y RELEASE
   (required). **Clase: required**
2. WHEN un check `required` queda `SKIPPED`/`BLOCKED`, THE R0_System SHALL bloquear (exit != 0); WHERE un
   check es `optional`/`informational`, THE R0_System SHALL reportarlo sin bloquear. **Clase: required**
3. THE R0_System SHALL mantener el eval pesado (`eval --enforce` completo) en INTELLIGENCE CI y fuera de
   pre-push. **Clase: required**
4. WHILE se corre PRE-PUSH, THE R0_System SHALL ejecutar el mismo software correctness (`bun run test`)
   en Windows y en Ubuntu (convergencia P3). **Clase: required**

### Requisito T.3 — Bucle PLAN → IMPLEMENT → VERIFY con clasificación A/B/C/D

**User Story:** Como equipo de ejecución de R0, quiero un bucle PLAN → IMPLEMENT → VERIFY con
clasificación de causa raíz A/B/C/D, para que un FAIL se enrute a su causa y no se parchee un síntoma.

#### Acceptance Criteria

1. WHEN un nivel de verificación devuelve FAIL, THE R0_System SHALL clasificar la causa raíz en A
   (implementación), B (spec/diseño), C (entorno/tooling) o D (datos/evaluación) y enrutar según el
   bucle §6. **Clase: informational** _(requisito de proceso/metodología)_
2. IF la causa es B (spec/diseño), THEN THE R0_System SHALL volver al diseño/requirements, actualizar el
   Spec y regenerar las tareas afectadas antes de re-implementar (P5). **Clase: informational**

### Requisito T.4 — Approval explícito para acciones irreversibles/sensibles

**User Story:** Como responsable de operaciones, quiero que las acciones irreversibles o sensibles
requieran aprobación explícita, para no ejecutar cambios de alto riesgo detrás de un descubrimiento sin
confirmación.

#### Acceptance Criteria

1. IF una acción es una migración de datos, un cambio en la persistencia de Railway (volumen), un cambio
   de auth/permisos, un cambio de motor de base de datos, una promoción de baseline o una promoción de
   patch, THEN THE R0_System SHALL requerir aprobación explícita antes de actuar y SHALL bloquear la
   acción detrás del descubrimiento correspondiente (§9). **Clase: required**
2. WHEN se desacopla la disponibilidad de señal (R0.3), THE R0_System SHALL medir el candidate HEAD en
   R0.2B con el eval de Fase 9 contra el baseline aceptado antes de promover cualquier cambio; sin eval
   verde reproducible, THE R0_System SHALL NO promover el cambio. **Clase: required**

**Preconditions / Discovery (BLOQUEANTE):** §9.1 (volumen Railway), §9.4 (estado de migraciones) — ver
sección "Preconditions / Discovery Items".

---

## Correctness Properties Traceability

Las propiedades de correctitud del diseño (§10, CP1–CP10 + CP3b/Property 11) se trazan aquí a los
requisitos concretos que las validan, reemplazando los IDs provisionales por workstream (`R0.x`) del
diseño por los IDs concretos de este documento.

| Propiedad (diseño §10) | Descripción breve | Workstream | Traza a requisito(s) |
|---|---|---|---|
| **CP1** / Property 1 | Ningún sub-check `required` skipped cuenta como PASS (SKIPPED/BLOCKED ⇒ no-PASS, exit != 0 en enforce; optional/informational skipped no bloquea; clase por sub-check) | R0.2A | **2A.1** (y T.2 nivel/clases) |
| **CP2** / Property 2 | `score` y `comparison` derivan de las mismas contribuciones ponderadas | R0.3 | **3.1** |
| **CP3** / Property 3 | Tres estados por señal con `votes == (structurallyApplicable AND dataReady)`; no-participación NUNCA inferida de `raw:null`; cada no-votante etiquetado con `nonVotingReason` | R0.3 | **3.2** |
| **CP3b** / Property 11 | Señal con `dataReady=false` no contribuye (`weighted=0`, `votes=false`, `nonVotingReason="data_not_ready"`) y no cambia el comportamiento observable de producción (p.ej. `patch_meta`) | R0.3 | **3.3** (y 3.2) |
| **CP4** / Property 4 | Toda señal citada en `reason`/`comparison` tiene `weighted > 0` en el score | R0.3 | **3.1** (criterio 4) |
| **CP5** / Property 5 | Los pesos de la versión activa suman 1.0 (candado existente, se preserva) | R0.3 | **3.6** |
| **CP6** / Property 6 | Normalización de ruta en hooks OS-independiente (`to_repo_relative(win) == to_repo_relative(posix)`) | R0.1 | **1.3** |
| **CP7** / Property 7 | Estado degenerado no produce ranking fingido (`voting == ∅` ⇒ `suggestions == []` + `no_signal_available`; no `Object.keys`) | R0.3 | **3.4** |
| **CP8** / Property 8 | Compatibilidad dataset/protocol (BLOCKED por mismatch, no por hash) + promoción solo tras aceptación explícita | R0.2 | **2A.2** (compatibilidad/BLOCKED) y **2B.2** (promoción) |
| **CP9** / Property 9 | `openingStrategy` respeta `raw: null` (héroe ausente ⇒ null) | R0.3 | **3.5** |
| **CP10** / Property 10 | `Σ weighted == score` en todos los caminos, incluido `teamOpening` | R0.3 | **3.1** (criterio 3) |

Nota (diseño §10 / Testing Strategy): CP2, CP3, CP6, CP10 se verifican como tests deterministas sobre
el harness/PRNG existente (`batch-harness`, Mulberry32/SeededRng), **sin** adoptar una librería PBT
nueva en R0. CP2/CP5/CP10 llevan un candado de regresión cero que se verifica en rojo antes de darlo
por bueno.

---

## Preconditions / Discovery Items

Consolidación del diseño §9 (la auditoría **no pudo** resolver lo siguiente; aparecen como precondición
de descubrimiento, nunca como suposición de diseño). Las respuestas **no se inventan**.

Cada discovery item bloquea **únicamente** los requisitos/acciones concretos que realmente necesitan
esa respuesta — **no** workstreams completos por asociación indirecta.

| # | Pregunta abierta | Bloquea a (granular) | ¿Bloqueante? |
|---|---|---|---|
| §9.1 | ¿Railway tiene un volumen persistente montado para `apps/engine/data/`? (`railway.json` no declara ninguno) | Solo las acciones que tocan persistencia/durabilidad de datos y **T.4** (§8); NO todo R0.2 | **BLOQUEANTE** — riesgo de perder `accounts`/`hero_pool`/`draft_feedback` en cada redeploy |
| §9.2 | ¿Qué env vars existen realmente en Railway? (`STEAM_WEB_API_KEY`, `CAPTURE_TOKEN`, `ENGINE_DB_PATH`, `DRAFT_LIVE_ENABLED`, `NEXT_PUBLIC_ENGINE_WS_URL`, `ENABLE_PRO_DRAFTER`) | Solo **4.6** (documentar `STEAM_WEB_API_KEY`) y el guardrail de secretos de **4.8**; 1.4 solo si depende realmente del entorno Railway | **BLOQUEANTE** — no se puede alinear doc↔realidad sin conocer el entorno real |
| §9.3 | ¿Dónde vive `pro-drafts.sqlite`? (gitignored, ausente; 2179 drafts ingeridos, activo de dato más caro) | Solo el sub-check de Pro Agreement / Benchmark B de **2A.1** y el eval que lo use en **2B.1** (tarea 33 hace opcional su ausencia); NO todo R0.2A ni todo R0.2B (Engine Quality / Benchmark A avanza) | **BLOQUEANTE (solo sub-check B)** — sin este archivo, Benchmark B queda `SKIPPED` informational (ADR-002), no bloquea el gate; Benchmark A se mide igual y `gate --enforce` puede PASS |
| §9.4 | Estado real de las migraciones de producción (dev local en 0003, sin tabla `accounts`; 0004–0007 nunca aplicadas localmente; supervivencia entre redeploys desconocida) | Solo las acciones de migración/persistencia y **T.4** (§8); NO todo R0.2 | **BLOQUEANTE** — decisión irreversible, ALTO RIESGO |
| ~~§9.5~~ | **RESUELTA:** Kiro IDE es el IDE principal; Claude Code Writer dentro de Kiro; Kiro puede actuar como Planner; Codex reviewer independiente. `.kiro/` se conserva; solo se elimina la duplicación manual de source-of-truth | — | **NO BLOQUEANTE** (resuelta) |
| §9.6 | ¿Los tests en rojo también fallan en la máquina donde se hacen los commits reales? (WSL vs Windows) | Solo el alcance de convergencia (P3) de **1.1** y **T.2**, y el software correctness que ejecuta el gate de **1.5** | **BLOQUEANTE** — determina el alcance real de la convergencia (P3) |
| §9.7 | ¿Está git realmente cableado a `.husky`? (`core.hooksPath` / `.git/hooks`) | Solo la **implementación** del PRE-PUSH gate de **1.5** y su anclaje en **T.2** (§5); no la existencia del requisito 1.5 | **BLOQUEANTE (implementación)** — informa qué mecanismo implementa el gate |

Regla (diseño §9): donde la auditoría no pudo confirmar algo, se marca como precondición de
descubrimiento, nunca como suposición de diseño.
---

## Changelog (revisión de requirements)

Correcciones aplicadas sobre la versión derivada del diseño aprobado. Se preservó el resto de los
requisitos y la trazabilidad CP1–CP10 (+CP3b), salvo los ajustes de naming/semántica que estas
correcciones exigieron.

1. **Requisito 1.5 — PRE-PUSH gate determinístico y verificable.** Se reescribió: el objeto del
   requisito es ahora la existencia de un PRE-PUSH gate determinístico y verificable, no "Husky debe
   existir". Husky pasa a ser una implementación posible; cualquier mecanismo equivalente verificable
   satisface el requisito. Documentar la ausencia de Husky ya no cumple por sí solo si no hay un gate
   equivalente en su lugar. §9.6/§9.7 pasan a informar la implementación del gate, no su existencia.
2. **Requisitos 1.2 y dependency workflow desacoplados de `/gear-up`/`@depcheck`.** 1.2 referencia
   ahora el "canonical dependency-management procedure" que sobreviva a la Harness Responsibility
   Matrix (R0.4); el nombre concreto se resuelve en R0.4. Añadido el término al Glosario.
3. **Requisitos 3.2/3.3 — semántica formal de los cinco campos.** Se documentó `votes ==
   (structurallyApplicable AND dataReady)`; la no-participación se deriva de
   `structurallyApplicable=false OR dataReady=false`, NUNCA de `raw=null` (ortogonal). Se introdujo
   `nonVotingReason ∈ {"data_not_ready","not_structurally_applicable"}` (reemplaza `reason`/
   `unavailableReason` genérico) y `votes=false ⇒ weighted=0 + nonVotingReason`. En 3.3 se fijó el
   contrato EXACTO de `patch_meta` (structurallyApplicable=true, dataReady=false, raw=null aceptable,
   votes=false, weighted=0, nonVotingReason="data_not_ready") con producción idéntica a pre-R0.
4. **Requisito 3.4 — contrato único de estado degenerado.** Se eliminó la alternativa "suggestions:
   [] OR marcadas con confianza baja"; el único contrato es `voting==∅ ⇒ suggestions==[] AND
   "no_signal_available" ∈ degraded`. `decisionContext` cambia a "no hay señales disponibles para
   votar" + referencia al `AvailableSignalsReport` (ya no "no estructuralmente aplicables").
5. **Requisito 2A.1/2A.3 — clasificación por sub-check dentro del Evaluation Gate.** Cada sub-check
   declara su clase `required | optional | informational`; SKIPPED nunca es PASS; solo un sub-check
   `required` SKIPPED/BLOCKED bloquea. Professional Pick Agreement / Benchmark B por defecto
   `optional`/`informational` (ADR-002); Engine Quality / Benchmark A puede ser `required`. El default
   no es "todo required".
6. **Requisito 4.8 — circuit-breaker como criterio verificable de proceso.** Tras un fix y su
   re-verificación, misma root cause repetida ⇒ stop + escalate a REPLAN/HUMAN, sin otro ciclo
   automático. Una root cause DISTINTA inicia su propia clasificación A/B/C/D y no cuenta contra el
   circuit-breaker anterior; conectado con `attempts → Tracer` y el bucle §6/P5.
7. **Requisito 4.8 — guardrails no deterministas, regla de dos ramas.** Se reemplazó "no determinista
   ⇒ discovery" por: determinista ⇒ `Permission | Hook | Test | CI | schema/invariant`; no
   determinista ⇒ `Policy/Rule` + independent verification + residual risk explícito. Discovery solo
   por falta de información, no por que una regla sea semántica.
8. **Requisito 4.1 — reconciliation logging solo material, destino único.** Se registran solo las
   reconciliaciones materiales (cambian source-of-truth, decisión, arquitectura, invariante o
   comportamiento) en un único destino canónico (`ledger.md`), evitando duplicación journal/ledger; no
   se exige registrar sincronizaciones triviales.
9. **Discovery blockers granulares.** Cada §9.x bloquea únicamente los requisitos concretos que
   necesitan esa respuesta, no workstreams completos: §9.1/§9.4 → persistencia/migración + T.4; §9.3 →
   solo sub-check Pro Agreement de 2A.1 y su eval en 2B.1; §9.2 → solo 4.6 + guardrail de secretos de
   4.8; §9.6/§9.7 → implementación del PRE-PUSH gate (1.5) y convergencia (1.1/T.2). Actualizadas la
   tabla consolidada y las líneas "Preconditions / Discovery" de 4.6, 4.8 y 2B.1.
10. **Trazabilidad CP1–CP10 (+CP3b) preservada.** La tabla "Correctness Properties Traceability" se
    mantiene con cada CP mapeada a su(s) requisito(s), actualizada para el naming/semántica nuevos
    (`nonVotingReason`, `votes = structurallyApplicable AND dataReady`, sub-check `required`,
    `decisionContext`).
11. **Productor de eval corpus-opcional + HEAD trazable (replan R0.2B aceptado por el PO).**
    - **2B.1** gana criterios 3–6: el productor `bun run eval` SHALL emitir un candidate válido y
      comparable cuando `pro-drafts.sqlite` está ausente (Benchmark A medido; Benchmark B no medido —
      `corpus=0`, `perBaseline={}`, `bootstrap=[]`, sin métricas pro sintetizadas — reportado como
      `SKIPPED` informational); cualquier neutro estructural del shape (p.ej. `constraintViolationRate:
      0`) es un **sentinel**, no evidencia medida; con el corpus presente, el Benchmark B real se
      preserva; el candidate se genera desde un **HEAD limpio y trazable** (`git status --porcelain`
      sin cambios en `apps/engine/src/**` ni `scripts/eval/**`; `commit` del candidate = commit
      medido), sin metadata de dirty-working-tree en el producto.
    - **2A.1** criterio 3: se resolvió la tensión preexistente — la ausencia de `pro-drafts.sqlite`
      marca **solo** el sub-check Benchmark B como `SKIPPED` (informational por ADR-002), **no**
      bloquea el gate completo ni fuerza exit != 0; la regla "sub-check `required` SKIPPED ⇒ exit != 0"
      queda intacta para el Golden Dataset vacío.
    - Nueva tarea **33** (R0.2B) prerequisito de la tarea 19; entre ambas, el PO hace un checkpoint
      commit del estado R0 aceptado (acción humana de trazabilidad, no approval de acción sensible).
      `evaluateGate()`, `GateStatus`, `EvaluationIdentity`, `ReferenceBaseline`, ADR-002, Golden
      Dataset y `SCORING_WEIGHTS` intactos.
