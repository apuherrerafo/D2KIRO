# R0.4 — Task 21 (Discovery): env vars reales en Railway; persistencia y migraciones (ALTO RIESGO)

- **Spec:** `.kiro/specs/r0-engineering-baseline-recovery/` (R0 — Engineering Baseline Recovery)
- **Task:** 21 — `[R0.4] Discovery: env vars reales en Railway; persistencia y migraciones (ALTO RIESGO)`
- **Requisitos cubiertos:** 4.6, 4.8, T.4 · **Precondiciones de diseño a resolver:** §9.1, §9.2, §9.4
- **Naturaleza:** DISCOVERY — read-only sobre el repo. Rol: Claude Code = Writer/Executor.
- **Corrida 1:** 2026-09-13 — sin acceso a Railway (entorno del agente). §9.1/§9.2/§9.4 quedaron
  `NOT CONFIRMED`.
- **Corrida 2 (esta actualización):** 2026-09-13, mismo día — el PO (dueño de la cuenta Railway)
  aportó evidencia real, obtenida directamente desde su dashboard/CLI de Railway, y la trasladó a
  esta sesión. Esta revisión incorpora esa evidencia y **reemplaza el veredicto de la Corrida 1**.
- **Commit observado (HEAD):** `48f66b30e956178b4e9a574432203ae56e3909a8`, branch `r0/task21`
- **Estado del working tree al momento de esta actualización:** limpio salvo este mismo reporte
  (`git status --short` → solo `?? docs/agents/r0-discovery/railway-env-persistence.md`, sin
  `hub.html` modificado ni `scripts/hooks/__pycache__/` presente — verificado antes de escribir)

## Convenciones de evidencia

| Marca | Significado |
|---|---|
| **CONFIRMED** | Respaldado por la salida literal de un comando o el contenido de un archivo, observado directamente por el agente en esta corrida. |
| **PO-CONFIRMED** | Respaldado por evidencia real reportada explícitamente por el PO (dueño de la cuenta Railway) desde su dashboard/CLI autenticado, y transcrita aquí. El agente **no** accedió directamente a Railway ni pudo re-verificar el dato por sí mismo — la confianza en este dato depende de la fidelidad de lo reportado por el PO, no de una observación independiente del agente. |
| **NOT CONFIRMED** | No hay evidencia suficiente. No se sustituye por una suposición. |
| **INFERENCE** | Conclusión razonable derivada de hechos CONFIRMED y/o PO-CONFIRMED. Marcada como inferencia, nunca presentada como hecho. |

**Seguridad:** no se imprimió ni se registró ningún secreto, token, API key, password ni valor real
de variable sensible — ni en la Corrida 1 ni aquí. El PO compartió **nombres** de variables, nunca
valores. Ningún `account_id`/Steam32 se inspeccionó ni se registró.

---

## 0. Limitación de acceso del agente (sigue vigente; no cambió por esta actualización)

**CONFIRMED en la Corrida 1, sin cambios:** este entorno de ejecución no tiene Railway CLI
instalado/autenticado, ni `RAILWAY_TOKEN`, ni ningún MCP de Railway disponible (ver detalle íntegro
en la Corrida 1, §0 original, preservado en el historial de este archivo vía `journal.md` si aplica
la disciplina append-only del proyecto). Esa limitación **no se resolvió técnicamente** — lo que
cambió es que el PO, que sí tiene acceso, ejecutó la consulta él mismo y trajo el resultado a esta
sesión. Esto se trata en este documento como **evidencia de segunda mano de una fuente autorizada y
directa** (`PO-CONFIRMED`), distinta de `CONFIRMED` (observación directa del agente) — la distinción
se mantiene explícita en cada afirmación de abajo, no se difumina.

---

## 1. §9.1 — ¿Railway tiene un volumen persistente montado para `apps/engine/data/`?

### Veredicto: **CONFIRMED** (evidencia PO-CONFIRMED + corroboración cruzada CONFIRMED en el repo)

**PO-CONFIRMED — datos del volumen real:**

```
project:    wonderful-embrace
service:    D2KIRO
environment: production
volume name: d2kiro-volume
mountPath:   /data
size:        500 MB
region:      sfo
```

**PO-CONFIRMED — el log del último deploy (SUCCESS) incluye la línea `"Mounting volume on: ..."`**
antes de arrancar el proceso — es decir, el volumen no solo está declarado, se monta efectivamente
en cada boot observado.

**PO-CONFIRMED — `ENGINE_DB_PATH` existe como variable configurada en el servicio.**

**Corroboración cruzada, CONFIRMED por lectura del repo (no depende del PO):**

```
apps/engine/src/db/client.ts:7
export const DB_PATH = process.env.ENGINE_DB_PATH ?? "./data/dota2coach.sqlite";

apps/engine/src/db/migrate.ts (último console.log)
console.log(`Migraciones aplicadas sobre ${DB_PATH}`);
```

**PO-CONFIRMED — la línea real del log de producción es:**
`"Migraciones aplicadas sobre /data/dota2coach.sqlite"`

Esto **encaja exactamente** con el código leído: `DB_PATH` sale de `ENGINE_DB_PATH`, y el valor
real en producción es `/data/dota2coach.sqlite` — es decir, **dentro** del `mountPath` del volumen
(`/data`), no en una ruta relativa efímera del contenedor. La cadena completa (variable configurada
→ valor apunta al volumen → volumen realmente montado según el log → deploy SUCCESS) es coherente
de punta a punta; no hay ningún eslabón contradictorio.

**Conclusión §9.1:** el riesgo de ALTO RIESGO original ("cada redeploy puede perder
`accounts`/`hero_pool`/`draft_feedback`") queda **descartado**. El volumen existe, está montado en
la ruta correcta, y `ENGINE_DB_PATH` apunta dentro de él — la base SQLite de producción **sobrevive
entre redeploys**, no se reconstruye vacía en cada boot como contemplaba la rama pesimista de la
Corrida 1 (§2.2, hipótesis ahora descartada por evidencia real, no solo por inferencia de ausencia
en `railway.json`).

---

## 2. §9.2 — ¿Qué env vars existen realmente en Railway?

### Veredicto: **CONFIRMED** (evidencia PO-CONFIRMED, lista de nombres — no de valores)

**PO-CONFIRMED — variables presentes (servicio D2KIRO, environment production):**

| Variable | Presente | Es secreto | Uso real en código (verificado en esta corrida) |
|---|---|---|---|
| `CAPTURE_TOKEN` | Sí | Sí | `apps/engine` — protege `POST /ingest/draft-event` |
| `DRAFT_LIVE_ENABLED` | Sí | No | `apps/web` — apaga `/draft` en la nube |
| `ENGINE_DB_PATH` | Sí | No (ruta, no secreto) | `apps/engine/src/db/client.ts` — confirmado §1 |
| `ENGINE_INTERNAL_URL` | Sí | No | `apps/web` — destino server-only del proxy/rewrites hacia el motor |
| `INTERNAL_AUTH_SECRET` | Sí | Sí | HMAC de `x-account-token`, `apps/web` + `apps/engine` |
| `PUBLIC_BASE_URL` | Sí | No | callback Steam OpenID, `apps/web` |
| `SESSION_SECRET` | Sí | Sí | cookie `d2k_session`, `apps/web` |
| `SITE_ACCESS_PASSWORD` | Sí | Sí | **ver hallazgo §2.1 — sin uso real en código actual** |
| `SITE_ACCESS_USER` | Sí | No (pero acompaña a un secreto) | **ver hallazgo §2.1 — sin uso real en código actual** |

Más las variables que Railway inyecta automáticamente (`RAILWAY_*`) y las asociadas al propio
volumen — **PO-CONFIRMED** por declaración explícita del PO, no enumeradas individualmente aquí
(no son parte del contrato de `.env.example` del proyecto).

**PO-CONFIRMED — variables explícitamente ausentes** (el PO trajo la enumeración real y completa de
`variableNames` del servicio `D2KIRO`/`production`, no una lista parcial — la ausencia de estas tres
se confirma por esa enumeración completa, no por omisión):

| Variable | Ausente | Consecuencia |
|---|---|---|
| `STEAM_WEB_API_KEY` | Sí | Resuelve 4.6 c1 con la respuesta real: **nunca se configuró en Railway**. Coincide con la inferencia de la Corrida 1 (§1.4 original: cero referencias en código a `STEAM_WEB_API_KEY`) — ahora confirmada también del lado de la infraestructura, no solo del código. |
| `NEXT_PUBLIC_ENGINE_WS_URL` | Sí | **Confirmada ausente**, no un default silencioso sin verificar: el código (`apps/web`, `.env.example`) usa el fallback documentado `ws://127.0.0.1:4000/ws/draft` cuando falta, que es exactamente coherente con que `DRAFT_LIVE_ENABLED`/el guard de `/draft` mantengan el draft en vivo deshabilitado en la nube (evt-20260801-041) — no hay una URL de WebSocket pública horneada en el bundle de producción. |
| `ENABLE_PRO_DRAFTER` | Sí | El flag dark del Pro-Drafter no está seteado en producción → Bun/Node lo evalúa como `undefined` (falsy) → **confirma que el motor Pro-Drafter sigue apagado en producción**, consistente con la regla inviolable de todas las fases 5–9 ("`ENABLE_PRO_DRAFTER` sigue apagado por defecto"). |

Con esto, **las seis variables que el diseño §9.2 exige resolver explícitamente quedan las seis
CONFIRMED** (3 presentes — `CAPTURE_TOKEN`, `ENGINE_DB_PATH`, `DRAFT_LIVE_ENABLED` — y 3 ausentes —
`STEAM_WEB_API_KEY`, `NEXT_PUBLIC_ENGINE_WS_URL`, `ENABLE_PRO_DRAFTER`).

**Nota de alcance (observación secundaria, no bloqueante para §9.2):** `ENGINE_PORT` y
`CONTEXT7_API_KEY` no forman parte del conjunto de seis variables que Task 21 debe resolver. No
aparecieron mencionadas por separado en el reporte del PO; dado que sí se cuenta con la enumeración
completa de `variableNames` del servicio, lo razonable (**INFERENCE**, no observación textual
directa del nombre) es que tampoco estén configuradas — ambas opcionales/dev-only, sin impacto en
4.6/4.8/T.4. Se registran aquí solo como dato colateral; no afectan el veredicto de §9.2.

### 2.1 Hallazgo nuevo (menor, fuera del contrato de Task 22): `SITE_ACCESS_USER`/`SITE_ACCESS_PASSWORD` — configuración muerta en Railway

**CONFIRMED por grep en esta corrida — cero referencias en código fuente actual:**

```
$ grep -rn "SITE_ACCESS_USER\|SITE_ACCESS_PASSWORD\|isValidBasicAuth" apps/
(sin resultados)
```

Las únicas menciones en todo el repo están en documentación histórica (`SPEC.md`,
`docs/agents/journal.md`, tickets `TSK-039/041/098/102/106`) y en `.claude/rules/web.md` §Fase 5,
que declara explícitamente: *"`proxy.ts` deja de hacer Basic Auth. Se retiran `isValidBasicAuth` y
las variables `SITE_ACCESS_USER`/`SITE_ACCESS_PASSWORD`"* — el Basic Auth de pre-Fase-5 fue
reemplazado por `iron-session` + login Steam real.

**Hallazgo (CONFIRMED + PO-CONFIRMED combinados):** `SITE_ACCESS_USER` y `SITE_ACCESS_PASSWORD`
**siguen configuradas en Railway** pese a que el código que las leía fue retirado deliberadamente
en Fase 5. Es configuración huérfana — no representa una superficie de ataque nueva (nada las lee),
pero es exactamente el tipo de deriva doc↔realidad que el requisito 4.8 (guardrail de secretos)
busca detectar. **No se elimina aquí** — el usuario pidió explícitamente no tocar variables de
Railway; se registra como hallazgo para una tarea de limpieza aparte (candidato natural: Harness
Responsibility Matrix, tarea 23, o una extensión menor de 4.6), **no para la tarea 22**, cuyo
contrato es persistencia/migración, no higiene de variables.

---

## 3. §9.4 — Estado real de las migraciones de producción

### Veredicto: **CONFIRMED** (evidencia PO-CONFIRMED del log real + mecanismo ya verificado en el repo)

**PO-CONFIRMED — secuencia literal del log del último deploy (SUCCESS):**

```
"Mounting volume on: ..."
"bun run src/db/migrate.ts"
"Migraciones aplicadas sobre /data/dota2coach.sqlite"
"bun run src/index.ts"
"apps/engine escuchando en http://127.0.0.1:4000"
"Next.js 16.2.12"
"Ready in 75ms"
```

Esta secuencia **confirma en producción real, no por inferencia**, el mecanismo que la Corrida 1 ya
había documentado leyendo `scripts/start-railway.sh` (migración en boot, antes de levantar
`apps/engine`, antes de `apps/web`, antes del healthcheck):

1. El volumen se monta primero.
2. Las migraciones (`drizzle-orm/bun-sqlite/migrator` sobre las 8 migraciones `0000`→`0007`
   existentes en `apps/engine/src/db/migrations/`) corren contra `/data/dota2coach.sqlite` — el
   archivo **dentro** del volumen persistente, no una ruta efímera.
3. El mensaje confirma que el paso de migración **terminó sin error** (de lo contrario
   `start-railway.sh` no habría continuado a `bun run start`, por el `set -eu` del script) y el
   deploy completo quedó en `SUCCESS`.
4. El motor y `apps/web` arrancaron correctamente después (`escuchando en http://127.0.0.1:4000`,
   `Ready in 75ms`).

**Conclusión §9.4:** el mecanismo de migración funciona correctamente contra almacenamiento
persistente real, en el último deploy observado. La rama pesimista de la Corrida 1 (§3.3 original:
"si no hay volumen, las migraciones se re-aplican desde cero sobre una base vacía en cada redeploy,
perdiendo datos") queda **descartada** — hay volumen, y las migraciones corren sobre el archivo
persistente dentro de él, como corresponde.

**Matiz que sigue sin ser observable desde este log (NOT CONFIRMED, alcance menor):** el log de un
único deploy exitoso no prueba por sí solo el historial completo de aplicaciones incrementales de
migración a lo largo del tiempo (p. ej. si hubo algún deploy previo donde `0004`→`0007` se aplicaron
por primera vez sobre datos reales sin incidente). Esto es un detalle histórico, no una duda
bloqueante: el mecanismo (migrator de Drizzle, idempotente por diseño — omite migraciones ya
aplicadas) y el estado actual (deploy en verde, sobre volumen persistente) están confirmados, que es
lo que el requisito T.4/§9.4 necesitaba para decidir si hace falta una acción correctiva **hoy**. No
hace falta.

---

## 4. Reevaluación de la tarea 22 (CONDITIONAL) contra su contrato real

El contrato de la tarea 22 (`tasks.md` líneas 1270–1307) exige, para ejecutarse: (a) que la tarea 21
entregue una **ACCIÓN PROPUESTA concreta**, y (b) aprobación humana explícita sobre esa acción
concreta. Su objetivo declarado es evitar perder `accounts`/`hero_pool`/`draft_feedback` entre
redeploys.

Con la evidencia de esta actualización:

- **§9.1 confirma que el volumen ya existe, ya está montado, y `ENGINE_DB_PATH` ya apunta dentro de
  él.** No hay una acción de "adjuntar volumen" o "redirigir la ruta de datos" que proponer — ya
  está hecho, y funcionando (deploy SUCCESS).
- **§9.4 confirma que las migraciones corren correctamente contra ese volumen**, sin error, en el
  último deploy observado. No hay una acción de "reparar migraciones" que proponer.
- **No hay ninguna ACCIÓN PROPUESTA concreta que emitir**, porque no hay ningún defecto de
  persistencia/migración detectado. El propio contrato de la tarea 22 contempla este desenlace
  explícitamente: *"se documenta que no era necesaria"* (Expected observable output, rama b).

**Conclusión: la tarea 22 NO es necesaria.** No por falta de información (como en la Corrida 1),
sino porque, con la información real ya disponible, **la precondición de riesgo que la motivaba no
existe** — el sistema ya está en el estado correcto. Ejecutar la tarea 22 ahora sería una acción sin
objeto: no hay nada que arreglar, y el propio diseño prohíbe ejecutarla como acción irreversible
"por si acaso" sin una ACCIÓN PROPUESTA concreta que la justifique (regla transversal (a): "ninguna
tarea modifica unilateralmente... para hacer pasar una implementación"; aquí ni siquiera hay una
implementación que hacer pasar).

El único hallazgo colateral (`SITE_ACCESS_USER`/`SITE_ACCESS_PASSWORD` huérfanas, §2.1) **no
pertenece al contrato de la tarea 22** (persistencia/migración) y no cambia esta conclusión.

---

## 5. Tareas desbloqueadas / bloqueadas (reemplaza la sección equivalente de la Corrida 1)

### Desbloqueadas

- **Tarea 4.6 c1** (documentar `STEAM_WEB_API_KEY` en `.env.example`): **desbloqueada.** Respuesta
  real: la variable no existe en Railway y no se lee en ningún código actual. La documentación en
  `.env.example` puede escribirse como "prevista/no usada en producción hoy", sin más discovery
  pendiente. (No se edita `.env.example` en esta task — eso es objeto de la tarea 4.6 misma, fuera
  del write scope de la 21.)
- **Tarea 4.8 criterio 2** (guardrail de secretos, mecanismo `Permission`/secret): **desbloqueada**
  en cuanto a la información que le faltaba — ya se conocen los nombres reales de los 4 secretos en
  Railway (`CAPTURE_TOKEN`, `INTERNAL_AUTH_SECRET`, `SESSION_SECRET`, `SITE_ACCESS_PASSWORD`, este
  último huérfano). La implementación del guardrail sigue siendo trabajo de la tarea 4.8, no de
  esta discovery.
- **Tarea 22**: **resuelta como "no necesaria"**, con motivo documentado (§4 arriba) — cumple
  exactamente la rama (b) de su propio "Expected observable output". Deja de estar bloqueada Y deja
  de estar pendiente: su resultado final es "no procede".

### Nuevo hallazgo, sin tarea asignada todavía

- **`SITE_ACCESS_USER`/`SITE_ACCESS_PASSWORD` huérfanas en Railway** (§2.1): candidato de limpieza
  de bajo riesgo para la Harness Responsibility Matrix (tarea 23) o una extensión menor de 4.6/4.8.
  No se ejecuta aquí (instrucción explícita: no tocar variables de Railway).

### Sigue sin resolver (menor, no bloqueante, y fuera de las seis variables exigidas por §9.2)

- Estado exacto de `ENGINE_PORT` / `CONTEXT7_API_KEY` en Railway: no confirmadas por nombre
  explícito (INFERENCE de ausencia, ver nota de alcance en §2). Ninguna tarea depende de esto hoy;
  ninguna de las dos pertenece al conjunto de seis variables que Task 21 debía resolver.
- Historial completo de aplicaciones incrementales de migración anteriores al último deploy: **NOT
  CONFIRMED** (matiz de §3), no bloqueante para T.4 con el estado actual ya verde.

---

## 6. Cumplimiento del write scope de esta actualización

- **Archivo modificado:** exactamente uno — `docs/agents/r0-discovery/railway-env-persistence.md`
  (este reporte), el mismo artefacto autorizado por el write scope de la tarea 21.
- **Ninguna variable de Railway leída, seteada ni modificada por el agente** — toda la evidencia de
  Railway en esta actualización es la que el PO trajo textualmente; el agente no ejecutó ningún
  comando contra Railway.
- **Ningún deploy, commit ni push ejecutado.**
- **`docs/agents/hub.html`:** verificado ANTES de escribir esta actualización — `git status --short`
  no lo mostraba modificado. Al guardar este mismo reporte, el hook `PostToolUse`/`Edit|Write` de
  `.claude/settings.json` volvió a regenerarlo como efecto colateral (mismo mecanismo documentado en
  la Corrida 1 y en `pre-push-gate.md` §7.1). Por pedido explícito del usuario en esta ronda, se
  restauró con `git checkout -- docs/agents/hub.html` — verificado limpio después.
- **`scripts/hooks/__pycache__/`:** por el mismo efecto colateral, reapareció con
  `_hook_lib.cpython-312.pyc`. Por pedido explícito del usuario, se eliminó con
  `rm -rf scripts/hooks/__pycache__/` — verificado ausente después.
- **Nada más se creó, modificó ni borró.** Estado final verificado:
  `git status --short` → solo `?? docs/agents/r0-discovery/railway-env-persistence.md`.

---

## 7. Veredicto consolidado (reemplaza el de la Corrida 1)

| Pregunta | Veredicto |
|---|---|
| §9.1 — ¿Hay volumen persistente para los datos del motor? | **CONFIRMED.** Volumen `d2kiro-volume`, `mountPath=/data`, 500 MB, región `sfo`, montado realmente (log de deploy) sobre el servicio `D2KIRO`/environment `production`, proyecto `wonderful-embrace`. `ENGINE_DB_PATH` apunta dentro de él (`/data/dota2coach.sqlite`), corroborado contra el código (`client.ts`, `migrate.ts`). |
| §9.2 — ¿Qué env vars existen realmente en Railway? | **CONFIRMED** (nombres, no valores; enumeración real y completa de `variableNames` del servicio `D2KIRO`/`production`, provista por el PO). De las 6 variables que el diseño exige resolver: presentes `CAPTURE_TOKEN`, `ENGINE_DB_PATH`, `DRAFT_LIVE_ENABLED`; ausentes `STEAM_WEB_API_KEY`, `NEXT_PUBLIC_ENGINE_WS_URL`, `ENABLE_PRO_DRAFTER`. Además presentes (fuera de las 6, pero relevantes para 4.8): `ENGINE_INTERNAL_URL`, `INTERNAL_AUTH_SECRET`, `PUBLIC_BASE_URL`, `SESSION_SECRET`, `SITE_ACCESS_PASSWORD`/`SITE_ACCESS_USER` (huérfana, sin uso en código — hallazgo §2.1), más `RAILWAY_*`/volumen inyectadas por la plataforma. `ENGINE_PORT`/`CONTEXT7_API_KEY`: observación secundaria, no forman parte de las 6 exigidas, no bloquean la aceptación. |
| §9.4 — ¿Estado real de las migraciones de producción? | **CONFIRMED.** Último deploy SUCCESS: volumen montado → `bun run src/db/migrate.ts` → `"Migraciones aplicadas sobre /data/dota2coach.sqlite"` sin error → motor y web arrancan correctamente. Migran contra almacenamiento persistente real, mecanismo idempotente (Drizzle migrator), sin incidente en el deploy observado. |
| ¿Se ejecutó alguna acción irreversible o cambio en Railway? | **NO.** Toda la evidencia de Railway es de solo lectura, reportada por el PO; el agente no tocó Railway. |
| ¿La tarea 22 es necesaria? | **NO.** La precondición de riesgo (posible pérdida de datos entre redeploys) que la motivaba **no existe** — volumen y migraciones ya están correctamente configurados y funcionando. Se documenta como "no necesaria", cumpliendo la rama (b) del propio contrato de la tarea 22. |
