# F1 — cierre técnico (TSK-250 → TSK-255)

Estado: **listo para integración técnica; NO certificado como mejora estratégica global.**
Fuente del examen: `ENGINE_P1_EXAM_F1_FINAL.{md,json}` (código `ea997c3`, snapshot `W5-EMP-001`, 120 drafts, semillas `AUDIT001..`). Nada de este documento cambia scoring, datos curados ni el examen.

Todo lo de abajo se leyó de los artefactos publicados y del código del repo. La clave A/B privada **no se abrió**.

## 1. Qué está demostrado y qué no

- **Demostrado (técnico):** 0 violaciones en I1, I2, I3, I9, I11 (622 estados, 3.074 tarjetas); CRITICAL_GAP en 46 tarjetas, 0 sin prueba, 0 faltantes; el examen es byte-idéntico entre dos corridas; motor 2.346/0, scripts 705/0, `tsc` de motor y web limpios.
- **No demostrado:** que el consejo sea mejor jugando Dota. La revisión cualitativa (ChatGPT, 18 situaciones) dio 18/18 coincidencias con la regla de precedencia declarada y **0/18 pruebas de optimalidad estratégica**. Es consistencia funcional, no calidad.

## 2. Los tres casos cuestionables (#9, #13, #18): no hay defecto reproducible

Criterio: un defecto sería una invariante dura rota (héroe ilegal, rol inviable, counter duro sin aviso, hueco crítico sin mostrar). Las invariantes miden los 622 estados completos y dan 0; ninguno de los tres casos las rompe. Son recomendaciones defendibles con una limitación conocida detrás. No se cambia scoring por opiniones aisladas.

| Caso | Qué se objeta | Lectura con datos del repo | Clasificación |
| --- | --- | --- | --- |
| #9 `a05e55d37022` (ronda 3, Pos 2) | Necrophos #1 sobre Void Spirit / Earth Spirit | Necrophos tiene datos de posición repartidos (Pos 2: 33 % de sus partidas con posición conocida; 40 % en Pos 3, 26 % en Pos 1), mientras que Void Spirit es 83 % Pos 2. Lo ordena la señal de counter ("Fuerte contra Sven"), no la posición. La ausencia de aviso de exposición es **regla del diseño**: en ronda 3 el rival ya selló su pick (`card-evidence.ts`, `rivalCanStillReact`), así que "counters duros aún disponibles" se lista pero no se avisa. | Defendible; **hueco de explicación** (P3), no de ranking |
| #13 `7a8eeb5fe696` (ronda 2, Pos 1) | Anti-Mage / Kez / Spectre, carries lentos contra Sven | Manifestación del **sesgo a popularidad** documentado (§4). Además Kez no tiene capacidades curadas: el producto no puede evaluarlo contra un hueco, y su "riesgos: ninguno" es ausencia de dato, no de riesgo (D1). | Limitación conocida (popularidad + D1) |
| #18 `165a730850f2` (ronda 3, Pos 3) | Wraith King como Pos 3 | Wraith King es 61 % Pos 3 / 38 % Pos 1 en el dato curado: Pos 3 es legítimo. El equipo ya tiene iniciación (Earth Spirit, Sven), así que no hay hueco crítico. Axe y Night Stalker (≈ 95 % Pos 3, iniciadores) lo superan en el board. | Defendible; **hueco de explicación** (P3) |

Las tres comparten una causa que el examen ya mide: `position_fit` está saturado en 1 en el 86,1 % de los estados y explica el 0 % de la dispersión que ordena el top-6 de V6; dentro de la mitad más jugada explica 1,2 %. El orden fino lo deciden señales de volumen y counter, y las tarjetas dicen "funciona como [rol]" sin decir por qué ahora. Eso es trabajo de F2, no un bug de F1.

## 3. Las ocho situaciones con posición del Board ≠ posición de las tarjetas (#1–#5, #10–#12)

**Comportamiento intencional de la vista personal, no un bug del producto; sí una limitación del paquete.**

- Intencional: `resolveViewedPosition` (`current-human-decision.ts`, PSR-002) deja a la persona empezar en **su propia posición** si sigue abierta, "porque la recomendación puede ser un orden de hábito (Pos 5 primero) que no debe quitarle su vista personal". El examen asigna a cada sesión una posición humana distinta (`personalPositions: [1..5]`); el Board recomienda por equipo.
- Limitación del paquete: las preguntas C2/C4 se hacen sobre "los héroes para esa posición" (la del Board), pero el paquete imprime tarjetas con razón/base/riesgos **solo** de la posición personal; de la columna del Board imprime únicamente nombres. En esas ocho situaciones C4 no se puede juzgar sobre lo que el Board recomienda. Se marcó N/E, que es lo correcto.
- Hallazgo adicional, mismo origen: la cobertura "a card carries CRITICAL_GAP" se selecciona mirando **todas** las tarjetas V4 (hasta 5), pero el paquete imprime solo las tres primeras. En #6 y #7 la tarjeta con el hueco crítico es de rango 4 o 5 y no está en pantalla (verificado: las tres tarjetas mostradas cubren el hueco; en #8 es Puck, curado como `hasInitiation: false`, `hasCatch: true`, y sí aparece). El rótulo del caso es correcto y la evidencia visible es incompleta.
- Consecuencia: **no se regenera este paquete** (regenerarlo exige repetir el examen). Se corrige en el generador para el próximo conjunto reservado: imprimir tarjetas de la columna del Board y todas las tarjetas con CRITICAL_GAP.

## 4. Las 12 comparaciones A/B no son una validación independiente

Las 12 claves opacas (`f579422e7113`, `9118bc5128aa`, `a22692eafd76`, `d2efa9cbb017`, `4814d1ccb664`, `e4cfcae2a00d`, `9aeddbe26973`, `b682584fdf86`, `05acdbf6bc2e`, `4c39a75ff9ca`, `1fd3344b2fc1`, `e8b84d749418`) aparecen también en los reportes de TSK-253 (`ENGINE_P1_EXAM_T4_AFTER` / `T4_BASE`): son los mismos 12 estados, ya evaluados (7 mejoras / 1 empeoramiento / 4 equivalentes, ninguna dañina) con la clave de TSK-253 ya revelada. **No cuentan como 12 evaluaciones nuevas ni como cegamiento independiente.** Para una validación nueva hace falta un conjunto reservado distinto, elegido antes de ver respuestas, con su clave sin abrir hasta cerrar el juicio. La clave de TSK-255 sigue sin abrirse.

## 5. Problemas conocidos al cerrar F1

1. **Sesgo a popularidad.** El 100 % de los top-3 de ronda 1 cae en la mitad más jugada de su posición (1.815/1.815). Sobre todo el campo creíble: top-3 98,2 %, top-6 96,7 % (un corte neutro daría ≈ 50 %). Mitigante medido: el #1 de ronda 1 no se concentra en un solo héroe (10–11 primarios distintos por posición; el más común 23–36 %) y el top-3 reacciona al contexto (Jaccard entre drafts 0,22).
2. **Tres héroes sin capacidades curadas:** Ringmaster (131), Kez (145), Largo (155). En tarjetas aparecieron Kez ×35 y Ringmaster ×28. Con un pick propio sin curar el equipo no puede declarar un hueco crítico: en la ventana de cierre, 24 de 250 estados lo tienen y en 8 había un hueco abierto que el producto calla; 52/250 estados no son totalmente evaluables. Nunca se interpreta como "sin riesgo".
3. **Cobertura parcial de counters.** 466 de 1.231 tarjetas son de un héroe sin ningún counter duro curado (79/252 primeras tarjetas de ronda 1): ahí la tarjeta calla por falta de dato. "Sin aviso" no es "seguro". Aviso↔realidad: 0 inconsistencias. Además, en ronda 3 no se avisa exposición por diseño (§2).
4. **M1** (cubrir un hueco crítico frente a un counter estadístico adverso): sigue siendo **seguimiento no bloqueante**, sin cambio de scoring. Con 120 drafts: 32 estados aplicables, 6 con héroe promovido, 0 con counter adverso; con 200 drafts: 51 aplicables, 13 promovidos, 0 adversos, y ningún candidato adverso en el top-3 ni en el primer lugar. Dice con qué frecuencia existe el dilema, no si duele en una partida real.
5. **I6 tiene dos reglas no comparables** (original 2/2 vs revisada 0/0): pasar de una a otra es cambio de regla, no mejora.
6. **Curación discutible, fuera de este ticket:** Puck figura `hasInitiation: false`. Corregir `capabilities.json` cambia el `comparableKey`; si se decide, entra después de congelar F1 y se mide aparte.
7. **Datos:** el snapshot está etiquetado 7.41e sin verificar (`patchClaim.verified: false`); los números absolutos son líneas base comparativas, no verdad.

## 6. Integración ordenada

Pila lineal verificada contra `origin/preview/f4-canonical-light` (`2ef19e0`): cada rama contiene exactamente la punta de su base (0 commits de retraso).

| Orden | PR | Rama → base | Aporta |
| --- | --- | --- | --- |
| 1 | #56 | `chore/preview-protections-base` → `preview/f4-canonical-light` | hooks fail-closed + CLAUDE.md compacto (3 commits) |
| 2 | #58 | `feat/tsk-252-position-fit-credibility` → #56 | TSK-252 |
| 3 | #59 | `feat/tsk-253-composition-gaps` → #58 | TSK-253 |
| 4 | #57 | `feat/tsk-254-basis-risks` → #59 | TSK-254 |
| 5 | #60 | `feat/tsk-255-f1-final-exam` → #57 | TSK-255 (este) |

Procedimiento por paso: marcar el PR como listo → **merge commit (no squash)** → `gh pr edit <siguiente> --base preview/f4-canonical-light` (el repo no borra ramas al mergear, así que no se reasignan solas) → comprobar que el diff del siguiente PR sigue siendo solo lo suyo. No borrar ramas hasta terminar la pila.

Por qué merge commit: el examen registra el commit `ea997c3`; un squash lo vuelve inalcanzable. Con merge commit, `ea997c3` queda en el historial y el checkpoint puede apuntarlo.

Verificación hecha **antes** de ejecutar, sobre la punta de la pila (superconjunto de todos los pasos intermedios): motor 2.346/0, scripts 705/0, `tsc` motor y web sin errores, web 898 pasan + 8 fallos, todos de Companion con PowerShell real (timeouts preexistentes, intermitentes: 6 en una corrida, 8 en otra). Lint de web no se corrió.

**CI:** el workflow `ci.yml` solo corre en PRs hacia `master` y `staging/private-beta-1`. Los PRs hacia `preview/f4-canonical-light` **no tienen CI**: el único gate es el local, y el hook pre-push falla por los timeouts de Companion.

## 7. Congelar F1 como checkpoint inmutable (mecanismo mínimo)

El examen ya registra casi todo en `ENGINE_P1_EXAM_F1_FINAL.json` → `identity`, `config` y `reproduce` (código, hash de contenido, snapshot, datasets curados, semillas, comando, `comparableKey`). Falta solo fijarlo en git y poder verificarlo:

1. **Tag anotado** `checkpoint/f1-v1` sobre el commit de integración resultante (el mismo árbol que `da95f32` si `preview/f4-canonical-light` no avanza antes).
2. **Manifiesto** `docs/checkpoints/F1.json`, con: SHA del tag; `examCodeCommit: ea997c3`; `comparableKey`, `contentStateHash`, hash del snapshot y de `hero-counters.json`/`capabilities.json` (copiados de `identity`); `config` y semillas; comando de reproducción; SHA-256 de `ENGINE_P1_EXAM_F1_FINAL.json`, `…_M1_200.json` y `…_JUDGE.md`; SHA-256 de la clave privada (**solo el hash, nunca la ruta ni el contenido**).
3. **Verificación**, dos niveles:
   - Barata (siempre): el tag apunta a un commit; `git diff --name-only ea997c3 <tag>` toca solo `docs/`, `.gitignore`; los SHA-256 de los resultados coinciden con el manifiesto.
   - Completa (bajo demanda, repite los 120 drafts): crear un worktree en el tag, correr el comando de `reproduce` y comparar con `compareIdentities` (ya existe en `scripts/wave5/evidence-identity.ts`) y byte a byte los artefactos. Se corre una vez al congelar, no en cada commit.

No se implementó nada de esto todavía: el SHA final solo se conoce después de integrar. El laboratorio F1 / F1+F2 / F1+F2+F3 / F1+F2+F3+F4 consume este manifiesto como su primera fila.

## 8. Qué falta antes de congelar

1. Integrar la pila (§6) con merge commits.
2. Decidir si F1 se declara "referencia técnica" ahora o se espera a una segunda validación ciega independiente (§4). Recomendación: congelar ya como **referencia técnica** — el checkpoint sirve para comparar F2 aunque la calidad estratégica siga pendiente — y no llamarlo "certificado".
3. Implementar y correr el manifiesto + verificación barata (§7).
