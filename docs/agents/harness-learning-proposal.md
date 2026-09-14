# Harness Learning / Curation — PROPUESTA (no ejecuta nada)

> **Spec:** `.kiro/specs/r0-engineering-baseline-recovery/` — R0.4 Harness Truth, **Task 29**.
> **Requisito:** 4.7. **Fuente de diseño:** `design.md` §4.4 "Harness Learning / Curation".
> **REGLA DURA de este documento:** propone, no autoedita. Nada de lo que sigue modifica
> `CLAUDE.md`, crea un hook, un script ni una skill nueva. Es exactamente lo que exige el
> requisito 4.7 c3 cuando, como es el caso, **no existe hoy un mecanismo canónico** para esta
> responsabilidad y crear uno ampliaría la arquitectura (más, no menos).

## 1. El gap real (confirmado, no supuesto)

`docs/agents/harness-matrix.md` §4 ya lo nombró al pasar: **"harness learning / curation" no
tiene dueño hoy**. Todo lo que un agente aprende durante una tarea — una corrección que se repite,
un invariante que cambió, un comando canónico que cambió — termina, en la práctica, en
`journal.md` (correcto, es append-only y esa es su función) o directamente en la memoria de la
sesión (se pierde). No existe un paso que **pregunte** "¿esto debería vivir en algún lado
permanente?" de forma sistemática.

## 2. Taxonomía de disparadores → destino (la que exige el requisito 4.7)

| Disparador | Ejemplo real de esta misma sesión de R0 | Destino propuesto |
|---|---|---|
| **repeated correction** | La misma corrección aparece dos o más veces en `journal.md`/`ledger.md` sobre el mismo hecho | `Rule` (si es una restricción) o `CLAUDE.md` (si es orientación general) |
| **architecture invariant changed** | `SCORING_WEIGHTS_V6` reemplazó a V5 como activa | `RULE` (`invariantes.md` ya es el dueño correcto de esto — funcionando) |
| **canonical command changed** | `bun run test` reemplazó a `bun test` como comando canónico | `CLAUDE.md` + `RULE` (ya documentado en ambos — funcionando) |
| **repeated reusable procedure** | El patrón "extraer secciones con `sed` por rango de línea en vez de retipear contenido" (usado en esta misma Task 24 para mover `engine.md`) | `Skill` si se vuelve a necesitar 2+ veces más; por ahora **`nowhere`** — un solo uso no justifica una skill nueva |
| **new deterministic failure class** | `TSK098_RUNTIME_SEMANTICS_CHANGED` (Task 31→32: un workaround de test dejó de tener sentido bajo un runtime nuevo) | `Hook/Test/Permission` — ya resuelto en código real (`app.test.ts`, Task 32); **`nowhere`** hoy, el caso ya cerró |
| **Dota domain fact discovered** | (ninguno nuevo generado por R0 — R0 es infraestructura, no dominio de Dota) | `Dota Domain Pack` (destino declarado, no diseñado — ver design.md §4.4) |

## 3. Candidatos reales detectados durante la ejecución de R0 (clasificación de ejemplo)

Esta sección demuestra el mecanismo propuesto contra hechos reales de esta misma ejecución —
**no se actúa sobre ninguno de ellos aquí**, quedan para revisión humana:

1. **Contradicción de `chronicle.md`** (`harness-matrix.md` fila 27): el agente Chronicle recibe la
   instrucción de preservar `journal.md` como append-only ("nunca comprimas o elimines") y, en la
   misma instrucción, la de archivarlo y vaciarlo al superar ~500 entradas. Disparador: **repeated
   correction candidate** (ya lo señaló Task 23; ninguna task de R0.4 lo tenía en su write scope
   declarado — ni Task 25 ni Task 26 lo cubrían literalmente). Destino propuesto: `Rule` — corregir
   `chronicle.md` para que la partición por volumen archive **sin vaciar** `journal.md` (p.ej.
   copiar a `journal-YYYY-MM.md` y seguir agregando al mismo `journal.md`, nunca truncar). **Queda
   como candidato pendiente de aprobación humana, no autoeditado por este documento.**
2. **`sentinel.md` regla 5** ("verifica que `@depcheck` se ejecutó"): una skill no deja rastro
   mecánico de haber corrido; Sentinel no puede verificarlo, solo puede verificar el **efecto**
   (marca `// ALLOWED` en el diff, que sí es determinista). Disparador: **repeated correction
   candidate** (mismo tipo de brecha que ya motivó re-escribir la regla 5 de Warden en Task 25).
   Destino propuesto: `Rule` — reformular la regla 5 de Sentinel para que audite el efecto
   verificable (`// ALLOWED` presente), no la ejecución no verificable de una skill. **Pendiente de
   aprobación humana.**

## 4. Mecanismo canónico propuesto (para aprobación — no implementado aquí)

No existe hoy un lugar natural y ya-determinista donde enganchar esta responsabilidad sin crear
algo nuevo. Dos opciones, en orden de preferencia (ninguna se ejecuta en este documento):

- **Opción A (preferida — reutiliza lo que ya existe, cero mecanismo nuevo):** agregar un paso de
  checklist al cierre de tarea que ya hace `/helm` (`.claude/skills/helm/SKILL.md`) — "antes de
  marcar `done`, ¿algo de esto dispara la tabla del §2? Si sí, anotalo en `ledger.md` como
  candidato con su destino propuesto, no lo apliques todavía." Esto es **SKILL**, no un mecanismo
  nuevo — `/helm` ya existe y ya gestiona el ciclo de vida de la tarea.
- **Opción B (si A no alcanza):** ampliar la responsabilidad ya declarada de Chronicle
  (`.claude/agents/chronicle.md`, "Mantiene la documentación del proyecto, la memoria y las
  especificaciones actualizadas") para que, al cerrar una tarea, aplique la tabla del §2 y escriba
  la clasificación como propuesta en `ledger.md` — nunca autoeditando el destino final. Chronicle
  ya es un agente existente (no se crea uno nuevo, requisito 4.7/4.4 c3 intacto).

**Ninguna de las dos se activa por este documento.** Ambas quedan como propuesta explícita para que
un humano decida si vale la pena el costo de mantenimiento frente al beneficio — coherente con
"menos, no más": si el volumen real de candidatos resulta bajo (como en esta misma sesión: 2
candidatos en 29 tasks), puede que ni Opción A valga la pena todavía.

## 5. Cumplimiento de la regla dura

- Ningún hook, script o skill nuevo fue creado.
- `CLAUDE.md` no fue editado por este documento.
- Los 2 candidatos reales de §3 quedan como propuesta, no como cambio aplicado.
- Este documento en sí es la salida de "detecta + clasifica + propone" que exige el requisito —
  nada más se ejecuta desde acá.
