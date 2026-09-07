# R0.1 — Task 32: Canonical Bun Runtime Compatibility / TSK-098 Evidence Migration

- **Spec:** `.kiro/specs/r0-engineering-baseline-recovery/` (R0 — Engineering Baseline Recovery)
- **Task:** 32 — `[R0.1] Canonical Bun Runtime Compatibility / TSK-098 Evidence Migration`
- **Requisitos:** 1.1, T.1, T.2 · **Owner de** `TSK098_RUNTIME_SEMANTICS_CHANGED`
- **Classification:** **C — tooling/runtime compatibility.** Task 17 fue correcta bajo Bun 1.3.14;
  el cambio de runtime canónico a 1.4.2 (Task 31) invalidó la premisa técnica de su workaround
  test-only. No es clase A/producto ni clase B/spec.
- **Rol:** Claude Code = Writer / Executor
- **Fecha de la corrida:** 2026-09-06 / 2026-09-07 (UTC)
- **Commit observado (HEAD):** `d617ba5` en `master`
- **RESULTADO:** **PASS.** Sonda 1.4.2 consistente 3/3; workaround histórico evaluado y retirado;
  cleanup migrado a promesa awaitable; cero cambio de producto/toolchain/locks; TSK-098 GREEN;
  `app.test.ts` GREEN; engine 618/0; scripts 181/0; TypeScript GREEN; historia 1.3.14 preservada;
  sin flakiness. Sin commit ni push. Task 3 sigue BLOCKED (ahora sólo espera decisión de flujo, no
  una task previa).

## Seguridad

No se imprimió ni registró ningún secreto/token/API key. El `account_id` Steam32 no aparece: el
escenario TSK-098 usa `accountToken: "invalid"`, nunca un id real.

---

## 1. Contexto histórico — preservado como evidencia

### 1.1 Bun 1.3.14 — el bug observado y por qué Task 17 fue correcta

Bajo Bun 1.3.14, el describe `cuentas HTTP multi-tenant (TSK-098)` de
`apps/engine/src/server/app.test.ts` hacía **timeout de 5000 ms en `afterAll`**. Es el único
describe del archivo que pasa `internalAuthSecret`, o sea el único que puede alcanzar el
`ws.close(1008, "unauthorized")` de la ruta de auth (`apps/engine/src/server/app.ts:441`).

Comportamiento medido en 1.3.14 (repro sin nada de producto, documentado en el comentario de
`app.test.ts:734-742` que introdujo Task 17):

| # | Observable | Bun 1.3.14 |
|---|---|---|
| 1 | Cliente llegó a `CLOSED` | sí (`readyState` 3) |
| 2 | Código de cierre | `1008` |
| 3 | `server.pendingWebSockets` tras el cierre **iniciado por el servidor** | **1** (atascado) |
| 4 | `server.stop(true)` Promise | **PENDING** — no se asienta en este escenario |
| 5 | Listener realmente cerrado | sí (puerto abajo, `fetch` rechaza) |

Es decir: `server.stop(true)` **sí** cerraba el listener, pero su promesa nunca resolvía porque
`pendingWebSockets` no bajaba a 0 tras un close server-side. `afterAll` esperaba esa promesa →
timeout.

**Workaround test-only de Task 17 (válido y correcto bajo 1.3.14):**

- `stop` pasó a devolver `void`, **descartando** la promesa de `server.stop(true)`:
  `stop = () => { server.stop(true); };`
- `afterAll(() => { stop(); })` — sin `await`.
- Se añadió un candado de regresión
  (`test("stop(true) cierra el listener aunque el servidor haya cerrado un WS (promesa que no se asienta)")`)
  que probaba la propiedad de la que dependía el descarte: **aún con la promesa colgada, el puerto
  queda cerrado**, así que no esperarla no filtra ningún servidor vivo.

Task 17 **no** estaba equivocada. Descartar una promesa que el runtime no asienta era la respuesta
correcta a un bug real del runtime, y el candado protegía la única garantía observable que
quedaba.

### 1.2 Bun 1.4.2 — el comportamiento cambió

Task 31 (`task-31-canonical-bun-toolchain-truth.md`, §8 y §12) fijó Bun 1.4.2 como runtime
canónico (`package.json#packageManager = bun@1.4.2`, LOCAL == CI == DOCKER) y, al re-medir la sonda
TSK-098, observó que **dos** de los cinco observables cambiaron (#3 y #4). Task 31 se detuvo
correctamente (`TSK098_RUNTIME_SEMANTICS_CHANGED`) y el REPLAN movió la migración de evidencia a
esta Task 32.

---

## 2. PHASE 1 — Bounded semantic re-measurement (antes de editar)

Sonda throwaway (`apps/engine/src/server/_tsk098_probe_throwaway.ts`, creada → ejecutada 3× →
**borrada**). Reproduce el escenario exacto: `createApp({ internalAuthSecret })` →
`app.start("127.0.0.1", 0)` → WS a `/ws/draft` → `hello` con `accountToken: "invalid"` → el
servidor cierra con 1008. Supervisor externo duro de 15 s (+ `timeout 20` de shell); esperas de
apertura/cierre/listener de 2 s; carrera de `server.stop(true)` de 1 s.

Runtime: `bun --version` → **1.4.2** · `node -p "require('./package.json').packageManager"` →
`bun@1.4.2`.

### Resultado — 3 corridas independientes, idénticas

| Observable | run 1 | run 2 | run 3 | Esperado canónico |
|---|---|---|---|---|
| 1. Cliente llegó a `CLOSED` (`readyState` 3) | sí | sí | sí | CLOSED |
| 2. Código de cierre | `1008` | `1008` | `1008` | `1008` |
| 3. `server.pendingWebSockets` tras el cierre server-side | **0** | **0** | **0** | `0` |
| 4. `server.stop(true)` Promise | **RESOLVED** (< 1 s) | **RESOLVED** | **RESOLVED** | `RESOLVED` dentro del límite |
| 5. Listener realmente cerrado (`fetch` rechaza) | sí | sí | sí | cerrado |

Salida literal (run 1, representativa — las tres son byte-equivalentes salvo el mensaje de error
de `fetch`):

```
{"event":"BUN_VERSION","version":"1.4.2"}
{"event":"WS_OPEN","opened":true,"readyState":1}
{"event":"WS_CLOSE","clientClosed":true,"readyState":3,"closeCode":1008}
{"event":"PENDING_WEBSOCKETS","pendingWebSockets":0}
{"event":"STOP_PROMISE","state":"RESOLVED"}
{"event":"LISTENER_CLOSED","listenerClosed":true,"detail":"TypeError: Unable to connect. Is the computer able to access the url?"}
{"event":"PROBE_DONE"}   shell exit=0
```

**3/3 consistente ⇒ se procede a PHASE 2/3.** (Si una sola corrida hubiera diferido: STOP por
inconsistencia/flakiness, sin editar el harness.)

Cambios vs. Task 31 §8: ninguno — Task 31 ya había medido `pendingWebSockets = 0` y
`stop(true) = RESOLVED` en sus 3 corridas. Esta re-medición independiente lo confirma.

---

## 3. PHASE 2 — Clasificación del workaround actual de Task 17

Diff real de Task 17 sobre `app.test.ts` (dentro del describe `cuentas HTTP multi-tenant
(TSK-098)`), clasificado:

| Parte | Qué es | Estado bajo 1.4.2 | Acción de Task 32 |
|---|---|---|---|
| **A** — `stop = () => { server.stop(true); }` (devuelve `void`, descarta la promesa) + `afterAll(() => { stop(); })` | **Cleanup harness workaround específico de Bun 1.3.14** | Innecesario — la promesa ahora se asienta | Retirado: `stop` devuelve la promesa; `afterAll` la `await`ea |
| **A** — comentario `app.test.ts:734-742` ("la PROMESA no se asienta nunca…", "el descarte de la promesa es el contrato") | **Comentario runtime-specific 1.3.14** — afirma como verdad presente algo sólo cierto en 1.3.14 | Falso bajo 1.4.2 | Reescrito al contrato canónico + puntero a este artefacto para la historia |
| **B** — los 6 tests funcionales de TSK-098 (`sin x-account-token…`, `dos cuentas ven solo su pool…`, `las rutas settings retiradas…`, `equipos quedan aislados…`, `preview con token y sin usePersonalPool…`, `hello con token válido fija el dueño…`) | **Assertions funcionales de TSK-098** | Verdes, sin relación con el runtime | **Intactos, byte a byte** |
| **C** — `test("stop(true) cierra el listener aunque el servidor haya cerrado un WS (promesa que no se asienta)")` | **Regression lock añadido por Task 17** | El *observable* que protege (close 1008 server-side → cliente CLOSED → listener cerrado) sigue siendo válido y útil; su **premisa/título** ("promesa que no se asienta", "deliberadamente SIN await") es falsa bajo 1.4.2 | Retitulado + reescrito al contrato canónico, conservando el observable útil |
| **D** — comentario `app.test.ts:752-756` + inline `:777` | **Comentarios históricos/runtime-specific** | Falsos bajo 1.4.2 | Reescritos; la historia 1.3.14 se preserva aquí, no en el test |

No se tocó ninguna assertion funcional. No se cambió comportamiento de producto.

---

## 4. PHASE 3/4/5 — Migración del test harness al contrato canónico

Cambio **mínimo**, test-only, confinado al describe `cuentas HTTP multi-tenant (TSK-098)`:

1. **`let stop: () => void` → `let stop: () => Promise<void>`** — el cleanup es genuinamente
   awaitable, no un `void` con una promesa escondida.
2. **`beforeAll`:** `stop = () => server.stop(true)` (devuelve la promesa, igual que el describe
   hermano `servidor Bun (TSK-010)` en `app.test.ts:164`). Comentario reescrito: describe el
   contrato de Bun 1.4.2 (`stop(true)` se asienta cuando drenan las conexiones; tras un close
   server-side `pendingWebSockets` baja a 0 solo) y remite a este artefacto para el historial
   1.3.14 — no reintroduce el workaround.
3. **`afterAll(() => stop())` → `afterAll(async () => { await stop(); })`** — espera explícitamente
   el settle del teardown.
4. **Regression lock (parte C)** — retitulado
   `"un cierre 1008 iniciado por el servidor deja stop(true) asentado dentro del límite y el listener cerrado"`.
   Cuerpo:
   - abre WS, manda `hello` con `accountToken: "invalid"`, espera `close` con code `1008`;
   - `expect(ws.readyState).toBe(3)` (`3 = CLOSED`);
   - **espera `server.stop(true)` con un límite explícito** (`Promise.race` contra 5000 ms) y
     `expect(settled).toBe("settled")` — ya no se descarta la promesa;
   - `await expect(fetch(...)).rejects.toThrow()` — listener cerrado.
   Servidor propio y efímero (no toca el del `beforeAll`).

**No** se inventó un RED artificial: el before/after de esta migración de plataforma es la
evidencia aceptada de 1.3.14 (§1.1) contra la sonda 1.4.2 (§2), no un candado fabricado.

### Regression contract bajo Bun 1.4.2

El candado permanente protege observables **útiles y públicos**:

> cierre 1008 iniciado por el servidor → cliente `CLOSED` con code 1008 → `server.stop(true)` se
> asienta dentro de un límite explícito → listener queda cerrado → el `afterAll` termina.

**`pendingWebSockets = 0`** se midió y registró (§2) como evidencia, pero **NO** se congela como
assertion permanente: es un contador interno de Bun, y `settlement + listener cerrado + afterAll
que termina` ya demuestran la liberación sin acoplar el test a internals del runtime. El candado
**no** protege "`stop(true)` nunca resuelve" (eso ya es falso).

El candado se verificó **en rojo** contra el runtime histórico de forma documental: bajo 1.3.14 el
`await server.stop(true)` dentro del `race` habría dado `settled === "timeout"` →
`expect(settled).toBe("settled")` FALLA. Bajo 1.4.2 pasa. La distinción es real, no cosmética.

---

## 5. PHASE 6/7 — Verificación (Bun 1.4.2)

Todos los comandos con `bun@1.4.2` (`bun test v1.4.2 (744846f84)`).

### 5.1 Dirigida + repetida (anti-flakiness)

| Comando | Corridas | Resultado |
|---|---|---|
| `bun test apps/engine/src/server/app.test.ts -t "TSK-098"` | 5× | **7 pass / 0 fail** cada una (~80 ms) |
| `bun test apps/engine/src/server/app.test.ts` (archivo completo) | 5× | **56 pass / 0 fail** cada una (~1.0 s — sin el timeout de 5000 ms de antes) |

### 5.2 Revalidación de evidencia aceptada

| Comando | Baseline histórico | Resultado 1.4.2 |
|---|---|---|
| `bun test apps/engine` (suite completa) | 618 pass / 0 fail | **618 pass / 0 fail** (6554 expect() calls; +2 por las 2 assertions nuevas del candado) |
| `bunx tsc --noEmit` en `apps/engine` | limpio | **exit 0** |
| `bun test apps/engine/src/pipeline/run-pipeline.test.ts scripts/eval/benchmark-pro-agreement.test.ts` (candados Task 2) | verde | **24 pass / 0 fail** |
| `bun test scripts/hooks/hook-path-normalization.test.ts` (candado Task 4) | verde | **4 pass / 0 fail** |
| `bun test scripts` (suite completa) | 181 pass / 0 fail | **181 pass / 0 fail** |

Baseline **pre-migración** (medido en esta misma corrida, antes de editar, bajo 1.4.2): engine
618/0, scripts 181/0, tsc limpio — idéntico al post-migración salvo los +2 expect() calls
esperados. El delta es 100% atribuible a las 2 assertions nuevas del candado.

No se ejecutó la suite web ni Task 3.

---

## 6. Working tree al terminar

```
 M .github/workflows/ci.yml                         (Task 31, preexistente)
 M Dockerfile                                       (Task 31, preexistente)
 M package.json                                     (Task 31, preexistente)
 M scripts/verify-simplicity.sh                     (Task 31, preexistente)
 M apps/engine/src/pipeline/run-pipeline.test.ts    (Task 2, preexistente)
 M scripts/eval/benchmark-pro-agreement.test.ts     (Task 2/4, preexistente)
 M scripts/hooks/_hook_lib.py                       (Task 4, preexistente)
 M scripts/hooks/data-boundary-guard.py             (Task 4, preexistente)
 M apps/engine/src/server/app.test.ts               (Task 32 — ÚNICO archivo de código tocado)
 M docs/agents/hub.html                             (EFECTO LATERAL — ver abajo)
?? scripts/hooks/__pycache__/                       (EFECTO LATERAL / preexistente — ver abajo)
?? docs/agents/r0-discovery/task-32-bun-runtime-compatibility.md   (este artefacto, write scope de Task 32)
?? .kiro/specs/r0-engineering-baseline-recovery/    (preexistente)
?? docs/agents/harness-matrix.md                    (preexistente)
?? docs/agents/r0-discovery/                        (dir preexistente)
?? scripts/hooks/hook-path-normalization.test.ts    (Task 4, preexistente)
```

- **`apps/engine/src/server/app.test.ts`** es el único archivo de código en el write scope de Task
  32 que se modificó. Diff test-only, confinado al describe TSK-098 (37 líneas netas: 1 tipo, 1
  comentario reescrito, `afterAll` awaitable, candado retitulado/reescrito). Producto, manifests,
  CI, Docker, guards, lockfiles, datasets y baselines: **no tocados**.
- **`docs/agents/hub.html`** reapareció como modificado: es un artefacto **derivado y regenerable**
  que `scripts/sync-context.ts` reescribe (nuevo timestamp + Kanban regenerado desde los tickets)
  al correr la suite `scripts`. No lo tocó Task 32 directamente y está **fuera** de su write scope.
  **Reportado, no revertido** (mismo criterio que Task 31 §12.6).
- **`scripts/hooks/__pycache__/`** ya estaba presente (sin trackear) al inicio de la sesión —
  bytecode de Python de la ejecución de hooks. **Reportado, no arreglado.**
- La sonda throwaway `apps/engine/src/server/_tsk098_probe_throwaway.ts` fue **borrada** tras las 3
  corridas; `git status` de `apps/engine/src/server/` confirma que sólo `app.test.ts` quedó
  modificado.
- Ningún `bun.lock` ni `apps/web/package-lock.json` cambió. Sin mutación de entorno (Bun ya estaba
  en 1.4.2 desde Task 31). Sin imagen Docker nueva.

---

## 7. Veredicto

**TASK 32 RESULT: PASS.**

- Sonda 1.4.2 consistente 3/3: `CLOSED` · `1008` · `pendingWebSockets = 0` · `stop(true) RESOLVED`
  · listener cerrado.
- Workaround histórico de Task 17 **evaluado correctamente** (no se declara equivocado — fue
  correcto bajo 1.3.14) y **retirado** por caducidad de su premisa técnica.
- Cleanup migrado al contrato canónico: `afterAll` **espera** la promesa de `server.stop(true)`.
- **Cero** cambio de producto, toolchain, CI, Docker o lockfiles.
- Regression contract actual correcto: protege observables útiles, no la afirmación falsa "la
  promesa no se asienta"; no congela `pendingWebSockets` como internal de Bun.
- TSK-098 GREEN (7/7, 5×) · `app.test.ts` GREEN (56/56, 5×) · engine 618/0 · scripts 181/0 ·
  TypeScript exit 0 · candados Tasks 2/4/17 revalidados.
- Historia 1.3.14 preservada (§1 de este artefacto + Task 31 §8/§12).
- Sin flakiness observada. Circuit breaker: no disparado. Contradicción de spec: no.

**Downstream:** Task 3 permanece BLOCKED sólo por decisión de flujo (Task 31 y Task 32 ya en
PASS). Task 5 sigue bloqueada transitivamente por Task 3. **No** se ejecutó Task 3, Task 5, commit
ni push.
