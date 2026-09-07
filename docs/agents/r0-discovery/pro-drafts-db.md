# R0.2A — Task 7 (Discovery): ubicación / disponibilidad real de `pro-drafts.sqlite`

- **Spec:** `.kiro/specs/r0-engineering-baseline-recovery/` (R0 — Engineering Baseline Recovery)
- **Task:** 7 — `[R0.2A] Discovery: ubicación/disponibilidad de pro-drafts.sqlite`
- **Requisitos cubiertos:** 2A.1, 2B.1 · **Precondición de diseño que resuelve:** §9.3
- **Naturaleza:** DISCOVERY — read-only salvo este artefacto. Rol: Claude Code = Writer/Executor.
- **Fecha de la corrida:** 2026-09-06
- **Commit observado (HEAD):** `d617ba5` en `master`
- **Entorno:** Git Bash (MSYS2/MINGW64) sobre Windows 10 — `MINGW64_NT-10.0-19045`; `bun 1.4.2`.
- **Estado del working tree durante la corrida:** cambios acumulados aceptados de Tasks anteriores
  (10 archivos `M`, 4 entradas `??`). No se modificó ni revirtió ninguno. Ver §11.

## Convenciones de evidencia

| Marca | Significado |
|---|---|
| **CONFIRMED** | Respaldado por la salida literal de un comando o el contenido de un archivo observado en esta corrida. |
| **NOT CONFIRMED** | No hay evidencia suficiente desde esta máquina. No se sustituye por una suposición. |
| **INFERENCE** | Conclusión razonable derivada de hechos CONFIRMED. Marcada como inferencia, nunca como hecho. |

**Seguridad:** no se imprimió ni registró ningún secreto, token, API key ni `account_id`. No se
inspeccionó Railway (fuera de alcance; §9.1/§9.2 siguen abiertas). No se creó, copió, movió ni
descargó ninguna base de datos. Read-only sobre todo salvo este archivo.

---

## 1. Resumen ejecutivo

**`pro-drafts.sqlite` NO existe en el working tree de esta máquina.** Está doblemente gitignored,
nunca estuvo trackeado, y no hay ningún script que lo descargue: la única forma de obtenerlo es
**regenerarlo por ingesta desde OpenDota** (`bun run pro:sync`, lento y con tope de tasa) o
**copiarlo de una máquina que ya lo tenga**. La ubicación canónica está **implícita y es
consistente** en 9 scripts (`apps/engine/data/pro-drafts.sqlite`, override por env `D2K_PRO_DB`),
pero **no está declarada en ninguna doc, ADR, `.env.example` ni README**. Hoy, cuando falta, el
único gate automatizado que lo consume (`verify-simplicity.sh` §16.10, solo en el camino de
commit local) **se salta en silencio** — imprime "omitido" y no falla. Esto es exactamente el
riesgo que enuncia el diseño §9.3 ("el gate `--enforce` se salta sin este archivo").

Para Task 8 esto significa: el sub-check **Pro Agreement / Benchmark B** debe tratarse como
**dato ausente ⇒ `SKIPPED` (exit != 0 en enforce), nunca PASS** (Requisito 2A.1 c3/c6). El
sub-check **Engine Quality / Benchmark A** no depende de este archivo y avanza igual.

---

## 2. Preguntas del contrato, respondidas con evidencia

### A. ¿Existe físicamente `pro-drafts.sqlite` en el working tree?

**CONFIRMED — NO.**

```
$ find . -name "*.sqlite" -not -path "*/node_modules/*"
./apps/engine/data/dota2coach.sqlite

$ ls -la apps/engine/data/
-rw-r--r-- 1 Julio 197121  778240 Jul 29 17:06 dota2coach.sqlite
-rw-r--r-- 1 Julio 197121   32768 Sep  5 23:10 dota2coach.sqlite-shm
-rw-r--r-- 1 Julio 197121 4128272 Aug 21 15:02 dota2coach.sqlite-wal
```

El directorio `apps/engine/data/` existe y contiene **solo** la SQLite del motor
(`dota2coach.sqlite` + WAL/SHM). No hay `pro-drafts.sqlite` ni ningún `.sqlite` con otro nombre en
todo el árbol (fuera de `node_modules/`).

### B. ¿Está trackeado por Git?

**CONFIRMED — NO, y nunca lo estuvo.**

```
$ git ls-files | grep -i sqlite      -> (sin salida)
$ git ls-files apps/engine/data/     -> (sin salida)
$ git status --porcelain | grep -i "sqlite\|pro-draft"   -> (sin salida)
$ git log --all --oneline -- apps/engine/data/pro-drafts.sqlite   -> (sin salida)
```

Ningún archivo bajo `apps/engine/data/` está trackeado. No hay historial de commits que haya
tocado nunca esa ruta.

### C. ¿Está gitignored?

**CONFIRMED — SÍ, por dos reglas independientes.**

```
$ git check-ignore -v apps/engine/data/pro-drafts.sqlite
apps/engine/.gitignore:7:data/	apps/engine/data/pro-drafts.sqlite
```

1. **`apps/engine/.gitignore:7` → `data/`** — ignora el directorio `apps/engine/data/` **entero**
   (esta es la regla que gana el match). Refuerzo en las líneas 8–11 del mismo archivo:
   `*.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`, `*.sqlite-journal`.
2. **`.gitignore:7` (raíz) → `apps/engine/data/pro-drafts.sqlite`** — regla explícita, redundante
   con la anterior, que nombra el archivo exacto. INFERENCE: se agregó para dejar constancia
   deliberada de que este archivo en particular es un artefacto local esperado, no un olvido.

`dota2coach.sqlite` también cae bajo `data/` — por eso tampoco aparece en `git status`.

### D. ¿Algún script lo genera?

**CONFIRMED — SÍ: la cadena de ingesta de `scripts/pro/`, contra OpenDota (red).**

| Script | Rol | Default path |
|---|---|---|
| `scripts/pro/ingest-tournaments.ts` | Cataloga torneos: cruza `/leagues` (tier+nombre) con `/proMatches` paginado. Crea la tabla `tournaments`. | `apps/engine/data/pro-drafts.sqlite` |
| `scripts/pro/ingest-drafts.ts` | Ingesta cruda de drafts: `GET /matches/{id}`, retención total del `raw_json`, `picks_bans` ordenados, slots por posición. Crea `pro_drafts` / `pro_draft_turns` / `pro_draft_slots`. | `apps/engine/data/pro-drafts.sqlite` |
| `scripts/pro/backfill-slots.ts` | Reconstruye `pro_draft_slots` desde `raw_json` (idempotente, offline). Fix TSK-178 (slots Dire). | `apps/engine/data/pro-drafts.sqlite` |

- **Comando canónico:** `package.json` → `"pro:sync": "bun run scripts/pro/ingest-drafts.ts"`.
- **Esquema:** `scripts/pro/schema.sql` (`CREATE TABLE IF NOT EXISTS …`), aplicado por el propio
  `ingest-drafts.ts` (`SCHEMA_PATH = new URL("./schema.sql", import.meta.url)`).
- **Es una operación cara y con red:** `DAILY_REQUEST_CAP = 2_000`, `SESSION_REQUEST_CAP = 500`,
  `DEFAULT_REQUEST_DELAY_MS = 2_500`. OpenDota sin API key, ~60 req/min / ~2000/día
  (`docs/research/pro-data-sources.md` §2.1). INFERENCE: regenerar los ~2.1k drafts desde cero
  son varios días de ingesta respetando el tope de tasa.
- **Corpus real ya ingerido (medido en Fase 9, `docs/agents/PROGRESS.md:121`):** 2.164 drafts con
  shape válido (de 2.179 crudos; 826 `tier_not_accepted` entran igual como covariable), 29
  torneos, mono-parche `patch=60`. El diseño §9.3 lo llama "el activo de dato más caro" del
  proyecto.

### E. ¿Algún script lo descarga?

**CONFIRMED — NO.** No existe ningún `curl`/`wget`/`fetch`/`rsync`/artifact-download que traiga
`pro-drafts.sqlite` prearmado. La búsqueda de referencias al nombre en todo el repo
(`grep -rn "pro-drafts.sqlite"`) devuelve únicamente: definiciones de path por defecto en scripts
`scripts/{eval,stats,pro}/`, el guard de `verify-simplicity.sh`, comentarios, tests con SQLite
`:memory:`, y menciones en docs. Ninguna es una descarga.

### F. ¿Existe una ubicación canónica declarada?

**CONFIRMED — canónica *de facto*, consistente en el código; NO declarada en documentación.**

Ruta por defecto **idéntica** en 9 archivos, con el mismo override de entorno `D2K_PRO_DB`:

```
scripts/pro/ingest-drafts.ts:7        const DEFAULT_DB_PATH = "apps/engine/data/pro-drafts.sqlite";
scripts/pro/ingest-tournaments.ts:7   const DEFAULT_DB_PATH = "apps/engine/data/pro-drafts.sqlite";
scripts/pro/backfill-slots.ts:9       const DEFAULT_DB_PATH = "apps/engine/data/pro-drafts.sqlite";
scripts/pro/aggregate-from-db.ts:32   const DEFAULT_DB_PATH = "apps/engine/data/pro-drafts.sqlite";
scripts/eval/run.ts:30               PRO_DB: process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite",
scripts/eval/benchmark-pro-agreement.ts   (recibe dbPath; el default lo pone run.ts)
scripts/eval/null-perturbation.ts:136    process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite"
scripts/eval/propose-golden-cases.ts:166 process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite"
scripts/stats/profile-signals.ts:267     process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite"
scripts/stats/build-percentiles.ts:123   process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite"
scripts/verify-simplicity.sh:297     EVAL_PRO_DB="${D2K_PRO_DB:-apps/engine/data/pro-drafts.sqlite}"
```

**NOT CONFIRMED / drift:** `.env.example` declara `ENGINE_DB_PATH=` pero **no** `D2K_PRO_DB`.
Ningún ADR (`docs/adr/ADR-001..005`), ningún README, ninguna regla `.claude/rules/*` ni
`docs/specs/SPEC.md` fija esta ruta como contrato. La convención vive solo en los literales de
los scripts.

### G. ¿Código y documentación coinciden sobre esa ubicación?

**Parcialmente. CONFIRMED:**

- **Código ↔ código:** coinciden al 100% (§F).
- **Código ↔ docs de referencia:** las docs que mencionan el archivo lo hacen con la **misma**
  ruta (`docs/agents/tasks/TSK-179.md:28` usa `sqlite3 pro-drafts.sqlite …`; `scripts/eval/*.ts`
  headers; `.claude/rules/{engine,testing-seams,security}.md` lo citan como "se abre `readonly`,
  ninguna prueba lo toca"). No hay contradicción de ruta.
- **Gap (no contradicción):** ninguna doc dice *dónde debe estar* ni *cómo obtenerlo*. El único
  lugar que reconoce explícitamente que está "gitignored, ausente" es el propio diseño §9.3 y
  `docs/agents/harness-matrix.md:117` (que apunta a este artefacto como pendiente).
- **`.env.example`:** drift menor — falta `D2K_PRO_DB` (§F).

### H. ¿CI dispone actualmente de ese archivo?

**CONFIRMED — NO, y CI no lo necesita hoy.**

```
$ grep -niE "eval|run\.ts|gate\.ts|pro-draft|sqlite|intelligence|stats" .github/workflows/ci.yml
(sin salida)
```

- `.github/workflows/ci.yml` tiene 2 jobs: `test` (matriz engine/web/root: `bun install`
  `--frozen-lockfile` por árbol, `tsc --noEmit`, `bun run lint` solo web, `bun test`) y
  `verify-simplicity` (`bash scripts/verify-simplicity.sh`).
- **Ningún job hace checkout de datos, monta un volumen, ni referencia `pro-drafts.sqlite` /
  `D2K_PRO_DB` / `scripts/eval` / `scripts/stats`.**
- El bloque de eval-gate de `verify-simplicity.sh` (§16.10) está dentro de
  `if [ "${VERIFY_COMMIT_GATE:-0}" = "1" ]` (línea 221), variable que fija `pretooluse-guard.sh`
  solo en `git commit` **local**. El job `verify-simplicity` de CI corre el script **sin** esa
  variable ⇒ ese bloque (y todo el sub-bloque tsc+test+eval) **no se ejecuta en CI**. INFERENCE:
  el "INTELLIGENCE CI" del diseño §5 todavía **no existe** como workflow — es trabajo de las
  Tasks 10/20/27, no de Task 7.

### I. ¿Docker / producción disponen actualmente de él?

**CONFIRMED — NO.**

```
$ grep -niE "pro-draft|sqlite|data/|D2K_PRO_DB|ENGINE_DB" Dockerfile     -> (sin salida)
$ cat railway.json    -> builder DOCKERFILE, startCommand ./scripts/start-railway.sh,
                          healthcheck /healthz. SIN sección "volumes".
$ grep -n "pro-draft\|sqlite\|D2K_PRO_DB\|migrate" scripts/start-railway.sh
19: bun run db:migrate
```

- El `Dockerfile` no copia `apps/engine/data/` (está gitignored; el build context no lo tiene) ni
  instala/genera `pro-drafts.sqlite`.
- `scripts/start-railway.sh` solo corre `bun run db:migrate` — eso es la SQLite **del motor**
  (`dota2coach.sqlite` / migraciones Drizzle), **no** el corpus pro.
- `railway.json` no declara volumen persistente (esto es la precondición abierta §9.1, fuera de
  alcance de Task 7 — se anota, no se resuelve).
- **Y no debe:** `ENABLE_PRO_DRAFTER=false` en producción; el corpus pro es un instrumento de
  evaluación **offline**, nunca runtime. `.claude/rules/*` y SPEC §15 son explícitos: `scripts/eval/**`
  y `scripts/stats/**` nunca se importan desde `apps/`, y las SQLite se abren `readonly:true`.

### J. ¿Qué comportamiento tiene el sistema cuando falta?

**CONFIRMED, tres caminos:**

1. **`scripts/verify-simplicity.sh` §16.10 (gate de commit local) → se salta en silencio.**
   ```
   EVAL_PRO_DB="${D2K_PRO_DB:-apps/engine/data/pro-drafts.sqlite}"
   if [ -f "$EVAL_ENGINE_DB" ] && [ -f "$EVAL_PRO_DB" ] && [ -f eval/baselines/v6-measured.json ]; then
     … corre run.ts + gate.ts --enforce …
   else
     echo "⚠️  gate de evaluación (§16.10) omitido: falta una SQLite del motor o el baseline de referencia."
   fi
   ```
   Guardado por `-f`. Falta el archivo ⇒ **no corre, no falla, `ERRORS` no se incrementa**, el
   commit pasa. Este es el "PASS silencioso" que R0.2A viene a eliminar (diseño §9.3;
   `harness-matrix.md:1.6`).

2. **`bun run scripts/eval/run.ts` invocado directamente → crash duro.**
   `run.ts` llama `loadReplayCasesFromDb(P.PRO_DB, …)` **sin** guard `existsSync` (a diferencia
   del Golden Dataset, que sí lo tiene en `run.ts:113`). `loadReplayCasesFromDb` hace
   `new Database(dbPath, { readonly: true })`. Verificado en esta corrida:
   ```
   $ bun -e 'new (require("bun:sqlite").Database)("apps/engine/data/pro-drafts.sqlite",{readonly:true})'
   THROWS: Error  unable to open database file
   ```
   ⇒ excepción no capturada ⇒ `run.ts` termina con exit != 0 y **no escribe `v6-measured.json`**.
   Es un fallo ruidoso, pero es un *crash*, no un veredicto `SKIPPED` estructurado.

3. **`scripts/eval/gate.ts` (política PASS/FAIL) → no toca el archivo.** `gate.ts` compara dos
   JSON (`v6-current.json` vs `eval/baselines/v6-measured.json`). Hoy corre en modo informativo
   (`return 0` siempre; `--enforce` sin uso real). Si `run.ts` no produjo el `current`, el gate no
   tiene qué comparar. **No distingue "ausente" de "vacío" de "incomparable"** — ese es
   precisamente el trabajo de Tasks 8–9.

**INFERENCE:** el `eval/baselines/v6-measured.json` **sí está versionado** y trackeado
(`git ls-files eval/baselines/` → `.gitkeep`, `split.json`, `v6-measured.json`) y registra
`"corpusSize":{"drafts":2157,"goldenCases":30,"tournaments":29}`. Es decir: **el corpus existió y
estuvo disponible en la máquina que congeló el baseline** (commit `0130e9f` según
`PROGRESS.md`), pero el `.sqlite` que lo produjo no viaja con el repo. Baseline presente + corpus
ausente = exactamente el escenario que Task 8 debe clasificar como "Benchmark B `SKIPPED`,
Benchmark A ejecutable".

### K. ¿Puede Task 8 distinguir AVAILABLE / MISSING / UNAVAILABLE / ERROR?

**Hoy NO. Con esta discovery, SÍ tiene lo necesario para construirlo.** Estado actual y lo que
Task 8 debe añadir:

| Estado (Spec 2A.1) | Señal observable disponible hoy | Qué falta (trabajo de Task 8) |
|---|---|---|
| **AVAILABLE** (`PASS`/`FAIL` real) | `[ -f "$D2K_PRO_DB" ]` verdadero **y** `new Database(path,{readonly:true})` abre **y** tiene filas en `pro_drafts` | Chequeo positivo explícito antes de invocar el benchmark; no asumir que "existe el archivo" == "corpus válido". |
| **MISSING** (`SKIPPED`, exit != 0 en enforce) | `[ -f "$D2K_PRO_DB" ]` falso — detectable hoy con `existsSync(PRO_DB)` en `run.ts` **antes** de `loadReplayCasesFromDb` | Devolver `GateStatus=SKIPPED` para el sub-check Benchmark B (clase `optional`/`informational` por ADR-002) en vez de crashear o saltar en silencio. |
| **UNAVAILABLE / BLOCKED** | `eval/baselines/v6-measured.json` ausente ⇒ no hay `ReferenceBaseline` ⇒ `BLOCKED` (2A.1 c4). Presente hoy (trackeado). | Separar "no hay baseline" (`BLOCKED`) de "no hay corpus" (`SKIPPED`). Son causas distintas. |
| **ERROR** | Archivo presente pero corrupto / esquema viejo / `new Database` lanza por otra razón / 0 filas | `try/catch` alrededor de la apertura + validación mínima de esquema (`pro_drafts`, `pro_draft_turns` existen). Distinto de MISSING. |

Clase por sub-check (2A.1 c5, ADR-002): **Benchmark B = `optional`/`informational`** ⇒ su
`SKIPPED`/`BLOCKED` se **reporta sin bloquear**. **Benchmark A (Engine Quality) = `required`** y
**no depende de este archivo** ⇒ su ausencia nunca justifica saltar A.

---

## 3. Ubicación canónica esperada (consolidado)

- **Ruta:** `apps/engine/data/pro-drafts.sqlite` (relativa a la raíz del repo).
- **Override:** variable de entorno `D2K_PRO_DB` (todos los scripts de `eval`/`stats`), o
  `--db=<path>` en los scripts de `scripts/pro/` que aceptan flags.
- **Formato:** SQLite; esquema en `scripts/pro/schema.sql` (tablas `tournaments`, `pro_drafts`,
  `pro_draft_turns`, `pro_draft_slots`, `ingest_checkpoint`).
- **Naturaleza:** artefacto **local, gitignored, no distribuible con el repo**. Se abre siempre
  `readonly:true`. Nunca lo lee `apps/`.

---

## 4. Qué desbloquea / qué NO desbloquea esta discovery

**Desbloquea (con la respuesta "ausente en esta máquina, canónico = `apps/engine/data/pro-drafts.sqlite`,
regenerable por `bun run pro:sync`, no descargable"):**

- **Task 8** — puede construir `GateStatus ∈ {PASS, FAIL, SKIPPED, BLOCKED}` sabiendo que el
  camino "corpus ausente" es real y frecuente (CI, checkout limpio, máquina nueva), y que la
  respuesta correcta es `SKIPPED` para el sub-check B, nunca PASS, nunca crash.
- **Task 13** (eval en INTELLIGENCE CI, si aplica) — sabe que el corpus **no** está en CI hoy y
  que llevarlo ahí es una decisión aparte (montar artefacto / volumen / regenerar), no un
  supuesto.

**NO desbloquea / explícitamente fuera de alcance:**

- Engine Quality / Benchmark A (Task 8 lado `required`) — **no** depende de este archivo.
- §9.1 (volumen persistente de Railway) y §9.4 (estado de migraciones) — siguen abiertas, son de
  R0.2 (datos) / §8, no de R0.2A.
- No se decide aquí si el corpus debe versionarse, subirse como artefacto, o regenerarse en CI.

---

## 5. Lo que Task 8 PUEDE asumir con seguridad

1. La ruta canónica es `apps/engine/data/pro-drafts.sqlite`, override `D2K_PRO_DB`. Es estable y
   consistente en 11 call sites.
2. En un checkout limpio (CI, máquina nueva) el archivo **no está**. "Ausente" es el caso normal,
   no el excepcional.
3. `eval/baselines/v6-measured.json` y `eval/baselines/split.json` **sí** están versionados y
   presentes ⇒ hay `ReferenceBaseline` ⇒ el estado por ausencia de corpus es `SKIPPED`, no
   `BLOCKED`.
4. El sub-check Pro Agreement / Benchmark B es `optional`/`informational` (ADR-002): su
   `SKIPPED`/`BLOCKED` se reporta sin bloquear el gate.
5. Engine Quality / Benchmark A es `required` y **no** necesita `pro-drafts.sqlite`.
6. `new Database(path,{readonly:true})` lanza `unable to open database file` si el archivo falta
   (verificado en esta corrida) — hay que hacer `existsSync` **antes** de llamar a
   `loadReplayCasesFromDb`, o envolver en `try/catch`.
7. Regenerar el corpus es `bun run pro:sync` (+ `ingest-tournaments.ts` + `backfill-slots.ts`),
   contra OpenDota, sin API key, con tope de ~2000 req/día y 2.5 s entre requests. Es caro.
8. El corpus real ya ingerido (en la máquina que lo tiene) es ~2.164 drafts válidos / 29 torneos
   / mono-parche `patch=60` (`PROGRESS.md`).

## 6. Lo que Task 8 NO DEBE asumir

1. **Que el archivo estará presente** en cualquier entorno automatizado. No lo está en CI hoy.
2. **Que "archivo presente" == "corpus válido".** Puede estar vacío, con esquema viejo, o a medio
   ingerir (`ingest_checkpoint`). Validar filas + esquema mínimo antes de declarar AVAILABLE.
3. **Que puede descargarse.** No hay ningún mecanismo de provisión automática. Solo regeneración
   por ingesta o copia manual.
4. **Que la ausencia de corpus afecta a Benchmark A.** No lo afecta.
5. **Que crashear `run.ts` es aceptable como "SKIPPED".** Un crash no es un veredicto
   estructurado; Task 8 debe emitir `GateStatus` explícito.
6. **Que existe un "INTELLIGENCE CI" donde el corpus vive.** Ese workflow no existe todavía
   (Tasks 10/20/27).
7. **Que puede tocar `evaluateGate()`, los baselines aceptados, o el esquema de `schema.sql`.**
   Son artefactos protegidos (regla transversal (a)).

---

## 7. Drift documentación ↔ código detectado (no reparado — solo se reporta)

| # | Drift | Evidencia | Severidad |
|---|---|---|---|
| D1 | `D2K_PRO_DB` no está en `.env.example` (sí `ENGINE_DB_PATH`) | `grep D2K_PRO_DB .env.example` → sin salida | Menor — la ruta por defecto funciona sin la variable. |
| D2 | Ninguna doc/ADR/README declara la ubicación canónica ni el procedimiento de obtención de `pro-drafts.sqlite` | Búsqueda en `docs/`, `docs/adr/`, `.claude/rules/`, `README` | Media — es "el activo de dato más caro" (§9.3) y su provisión es conocimiento tribal. |
| D3 | `run.ts` guarda el Golden Dataset con `existsSync` pero **no** el corpus pro antes de `loadReplayCasesFromDb` | `scripts/eval/run.ts:113` vs `:188` | Media — causa crash en vez de SKIPPED. Lo repara Task 8. |
| D4 | `harness-matrix.md:117` ya referencia este artefacto como "NO EXISTE aún" | `docs/agents/harness-matrix.md` (archivo `??`, de R0.4) | Ninguna — se resuelve al aceptar este doc. |

**No hay contradicción spec ↔ código.** El diseño §9.3 y los requisitos 2A.1/2B.1 describen
correctamente la situación ("gitignored, ausente"). Ver §10.

---

## 8. Comandos ejecutados en esta discovery (todos read-only)

```
git rev-parse --short HEAD ; git symbolic-ref --short HEAD
git ls-files | grep -i sqlite
git ls-files apps/engine/data/
git ls-files eval/baselines/
git status --porcelain
git check-ignore -v apps/engine/data/pro-drafts.sqlite
git log --all --oneline -- apps/engine/data/pro-drafts.sqlite
find . -name "*.sqlite" -not -path "*/node_modules/*"
ls -la apps/engine/data/ docs/agents/r0-discovery/ eval/baselines/
cat .gitignore apps/engine/.gitignore railway.json
grep -rn "pro-drafts.sqlite" (repo)
grep -niE "eval|sqlite|pro-draft|stats|gate\.ts" .github/workflows/ci.yml
grep -niE "pro-draft|sqlite|data/|D2K_PRO_DB|ENGINE_DB" Dockerfile
grep -n "migrate|sqlite|pro-draft" scripts/start-railway.sh
sed -n '215,312p' scripts/verify-simplicity.sh
sed -n '1,70p;180,300p' scripts/eval/run.ts
sed -n '150,205p' scripts/eval/benchmark-pro-agreement.ts
sed -n '1,90p' scripts/eval/gate.ts
cat scripts/pro/schema.sql
grep -n "corpusSize" eval/baselines/v6-measured.json
bun -e 'new (require("bun:sqlite").Database)("apps/engine/data/pro-drafts.sqlite",{readonly:true})'   # → THROWS: unable to open database file
uname -a ; bun --version
```

---

## 9. Efectos secundarios / working tree

- **Único archivo creado:** este mismo (`docs/agents/r0-discovery/pro-drafts-db.md`), dentro de la
  entrada ya sin trackear `docs/agents/r0-discovery/`.
- **No** se creó, copió, movió ni descargó ninguna base de datos.
- **No** se modificó código, config, env vars, CI, Docker, tests ni ninguna otra Task.
- **`docs/agents/hub.html`:** trackeado, **sin cambios** en esta corrida (no aparece en
  `git status --porcelain`). Nada que reportar.
- **`scripts/hooks/__pycache__/`:** **no existe** en esta corrida
  (`find scripts/hooks -name "__pycache__" -o -name "*.pyc"` → sin salida). Nada que reportar.
- Cambios acumulados de Tasks anteriores presentes e intactos: `M` en `.github/workflows/ci.yml`,
  `.husky/pre-push`, `Dockerfile`, `apps/engine/src/pipeline/run-pipeline.test.ts`,
  `apps/engine/src/server/app.test.ts`, `package.json`,
  `scripts/eval/benchmark-pro-agreement.test.ts`, `scripts/hooks/_hook_lib.py`,
  `scripts/hooks/data-boundary-guard.py`, `scripts/verify-simplicity.sh`; `??` en
  `.kiro/specs/r0-engineering-baseline-recovery/`, `docs/agents/harness-matrix.md`,
  `docs/agents/r0-discovery/`, `scripts/hooks/hook-path-normalization.test.ts`,
  `scripts/install-git-hooks.sh`.

---

## 10. Contradicción con la Spec

**NO.** El diseño §9.3 (`"gitignored, ausente; los 2179 drafts ingeridos son el activo de dato
más caro"`) y los requisitos 2A.1 c3 / 2B.1 (`"§9.3 bloquea SOLO el sub-check Pro Agreement /
Benchmark B"`) coinciden con lo observado. Esta discovery **confirma** la premisa de la Spec y le
agrega: ubicación canónica exacta, mecanismo de regeneración, ausencia de vía de descarga,
comportamiento exacto ante ausencia (skip silencioso en el gate de commit / crash en `run.ts`
directo), y presencia del `ReferenceBaseline` versionado.

---

## 11. Veredicto

**TASK 7 RESULT: PASS**

`pro-drafts.sqlite` exists:
- **NO** (en esta máquina — Windows 10 / Git Bash / HEAD `d617ba5`)
- location: canónica esperada = `apps/engine/data/pro-drafts.sqlite`; presente en el working tree = ninguna

Git status:
- tracked: **NO** (nunca; sin historial que toque esa ruta)
- ignored: **SÍ** — `apps/engine/.gitignore:7` (`data/`, gana el match) + refuerzo `*.sqlite*`
  líneas 8–11; y regla explícita redundante en `.gitignore` raíz línea 7

Canonical expected location:
- `apps/engine/data/pro-drafts.sqlite` (override env `D2K_PRO_DB`; flag `--db=` en `scripts/pro/*`)
- consistente en 11 call sites de `scripts/{pro,eval,stats}/` + `verify-simplicity.sh`
- NO declarada en ninguna doc/ADR/README/`.env.example` (drift D2)

Code references:
- Generación: `scripts/pro/ingest-drafts.ts`, `scripts/pro/ingest-tournaments.ts`,
  `scripts/pro/backfill-slots.ts` (esquema `scripts/pro/schema.sql`); comando `bun run pro:sync`
- Consumo (todos `readonly:true`): `scripts/eval/run.ts` → `scripts/eval/benchmark-pro-agreement.ts`
  (`loadReplayCasesFromDb`), `scripts/eval/null-perturbation.ts`, `scripts/eval/propose-golden-cases.ts`,
  `scripts/stats/profile-signals.ts`, `scripts/stats/build-percentiles.ts`,
  `scripts/pro/aggregate-from-db.ts`
- Gate: `scripts/verify-simplicity.sh:297` (`EVAL_PRO_DB`, guardado por `-f`)

Generation path:
- `bun run pro:sync` (= `scripts/pro/ingest-drafts.ts`) + `ingest-tournaments.ts` + `backfill-slots.ts`,
  contra OpenDota (red, sin API key). Caro: ~2000 req/día, 2.5 s/req. Corpus real ~2.164 drafts / 29 torneos.

Download/provision path:
- **NINGUNA.** No hay script de descarga, artefacto de CI, ni volumen. Solo regeneración por
  ingesta o copia manual desde una máquina que ya lo tenga.

Local availability:
- **AUSENTE** en esta máquina. (INFERENCE: presente en la máquina que congeló
  `eval/baselines/v6-measured.json` — `corpusSize.drafts=2157`.)

CI availability:
- **NO.** `.github/workflows/ci.yml` no referencia el archivo, no monta datos, y el bloque de
  eval-gate de `verify-simplicity.sh` está tras `VERIFY_COMMIT_GATE=1` (solo commit local), que CI
  no fija. No existe "INTELLIGENCE CI" todavía.

Docker/production availability:
- **NO.** El `Dockerfile` no lo copia ni lo genera; `railway.json` no declara volumen;
  `start-railway.sh` solo migra `dota2coach.sqlite`. Correcto por diseño: `ENABLE_PRO_DRAFTER=false`,
  el corpus es instrumento offline, nunca runtime.

Behavior when missing:
- Gate de commit local (`verify-simplicity.sh` §16.10): **se salta en silencio** ("⚠️ omitido"),
  el commit pasa — el "PASS silencioso" que R0.2A elimina.
- `bun run scripts/eval/run.ts` directo: **crash duro** — `new Database(path,{readonly:true})`
  lanza `unable to open database file` (verificado); no hay guard `existsSync` para el corpus pro
  en `run.ts` (sí para el Golden). Exit != 0, no escribe baseline.
- `gate.ts`: no toca el archivo; hoy informativo (`return 0`). No distingue ausente/vacío/incomparable.

Documentation/code drift:
- D1: falta `D2K_PRO_DB` en `.env.example`. D2: ninguna doc declara ubicación/obtención del corpus.
  D3: `run.ts` no hace `existsSync` del corpus antes de abrirlo (crash en vez de SKIPPED).
  D4: `harness-matrix.md:117` ya apunta a este artefacto como pendiente. Sin contradicción spec↔código.

What Task 8 may safely assume:
- Ruta canónica `apps/engine/data/pro-drafts.sqlite` / `D2K_PRO_DB`; "ausente" es el caso normal
  en CI/checkout limpio; `ReferenceBaseline` (`v6-measured.json`) SÍ está versionado ⇒ ausencia de
  corpus = `SKIPPED`, no `BLOCKED`; Benchmark B es `optional`/`informational` (ADR-002) y su skip
  no bloquea; Benchmark A es `required` y no depende del corpus; abrir la DB puede lanzar ⇒
  `existsSync` + `try/catch` antes de `loadReplayCasesFromDb`.

What Task 8 must NOT assume:
- Que el archivo estará presente en entornos automatizados; que "presente" == "válido"; que puede
  descargarse; que su ausencia afecta a Benchmark A; que un crash de `run.ts` equivale a
  `SKIPPED`; que existe un INTELLIGENCE CI donde el corpus vive; que puede tocar `evaluateGate()`,
  los baselines aceptados o `schema.sql`.

Files modified:
- `docs/agents/r0-discovery/pro-drafts-db.md` (este archivo — creado; dentro de la ruta ya `??`).
- Ningún otro. Cero cambios de código/config/CI/Docker/tests/env/otras Tasks.

Unexpected side effects:
- Ninguno. `docs/agents/hub.html`: sin cambios. `scripts/hooks/__pycache__/`: no existe. Cambios
  acumulados de Tasks previas: intactos.

Task 8 unlocked:
- **YES** (para su lado dependiente: el sub-check Pro Agreement / Benchmark B. Engine Quality /
  Benchmark A ya estaba desbloqueado, no depende de esta discovery.)

Spec contradiction:
- **NO.**
