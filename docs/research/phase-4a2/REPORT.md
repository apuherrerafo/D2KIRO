# Fase 4A.2 — Remediación y certificación del Simulador Canonical Light (sobre c37194e7)

Sin commit, push, merge ni deploy. c37194e7 y el checkpoint previo intactos. Motor, capturador, V6, pesos y datasets sin tocar (`git diff --name-only` no lista nada de `apps/engine`). Live no se tocó (solo se le cambió una línea para usar el predicado compartido, ver §8).
Datos crudos: `*.json` de esta carpeta · capturas: `captures/` · diff: `changes.diff` · arnés: `e2e/simulator-4a2-remediation.spec.ts`.

## Resultado en una línea
Siete riesgos: **6 cerrados, 1 BLOCKED con causa** (ELIGE AHORA real en Solo / Party 2). E2E 13/13, web 1106/0, tsc y lint limpios, `verify-simplicity` OK, VRT Windows 10/10, candidatos Linux creados y estables (pendientes de tu revisión).

## 1. Razón estratégica — CERRADO
- Hallazgo: el motor arma `currentDecision.reason` = razón de equipo (solo si es `STRATEGIC`) + razón del héroe primario. El Light solo pasaba la `STRATEGIC`, así que con `PHASE_FALLBACK` / `DETERMINISTIC_DEFAULT` se perdía hasta la parte del héroe (el tablero anterior sí la mostraba).
- Ahora, **solo al abrir un candidato**, el panel derecho tiene dos bloques separados: «Razones de <héroe>» (lo del candidato) y «Decisión del equipo» (verbatim del motor + «Criterio del motor: …»). Las tarjetas no cambian.
- Si la decisión apunta a otro héroe u otra posición, dice «El motor recomienda a X … Esta decisión es sobre X, no sobre Y» y la razón no se atribuye al abierto (`data-decision="other"`). Sin pick humano (posición null) muestra el aviso del motor tal cual. Evidencia limitada → no hay decisión que mostrar.
- Pruebas: `view-model.test.ts` (`decisionViewOf`, `recommendationOf`), `SimulatorLightBoard.test.tsx` (7 casos), E2E con captura `*-2-razon-estrategica-visible.png` y `*-4-otro-candidato-decision-atribuida.png`.

## 2. Analizar ≠ elegir — CERRADO (con un cambio mínimo en la ronda)
- Verificado: la rejilla solo abre el análisis; «Elegir» no existía visible para un candidato de la rejilla (solo «Buscar otro héroe», plegado), o sea se había perdido la operación de elegir un candidato recomendado.
- `BlindRoundPanel` ahora muestra **«Elegir a X · PosN»** para el candidato abierto, usando la **misma `onLockPick`** (sin lógica nueva; legalidad en `analyzed-pick.ts`, puro). Bloqueado con motivo si la posición ya está sellada, el héroe no está disponible o no hay acción humana.
- Sincronía: si el candidato abierto desaparece del tablero (se eligió/recalculó) el análisis se cierra solo y se avisa a la ronda. Pruebas `analyze-then-pick.test.tsx` (3), `analyzed-pick.test.ts` (6), `BlindRoundPanel.test.tsx` (+3); E2E: abrir no cambia `pending-human-positions`, el botón sí.
- Restablece lo que cubrían los tests 17/18/20 del tablero viejo (elegir con SU posición, estado tras el pick).

## 3. Encabezado Light — CERRADO
- Verificado que **envolver no bastaba**: CompactBoard/DraftTimer/banner usan `--surface-*`/`--content-*` (oscuros, no responden a `data-theme="light"`).
- Solución mínima: `SimulatorLightScope` ahora envuelve la franja fija y el banner de ronda, y `light.css` apunta *dentro del alcance* esos mismos nombres a los tokens `--r3-*` ya existentes. Cero colores ni tokens nuevos, primitivas canónicas intactas. Timer, picks/bans, equipos, estados y sticky se conservan.
- Hallazgo propio: `.r3-page` (laboratorio) trae `min-height:100vh` + padding; envolviendo abría huecos de ~100 vh. Corregido con `.sl-page{min-height:0;padding:0}`; el E2E exige franja < 260 px. (El tablero de 4A tenía el mismo hueco, ahora también corregido.)
- Medido en el navegador: franja `rgb(242,237,229)`, CompactBoard y banner `rgb(251,248,242)`, tipografía Plex (`encabezado-*.json`).

## 4. Contraste — CERRADO
- axe WCAG 2.0/2.1/2.2 A/AA, **página completa**, Solo / Party 2 / 3 / 5: **0 violaciones** (motor real) y 0 en los 3 casos con fixture (análisis + elegir abiertos). Pantalla de configuración: 0.
- Cambios: `text-content-muted` → `text-content-secondary` (token aprobado) en los paneles del Simulador, `RecommendationFeedback`, `OffPoolTag`, `DraftHeroSlot`, `HeroPicker`, `HeroIcon` y NavBar; `aria-label` a la semilla del draft (violación `label` crítica que apareció en la configuración). No se tocó el valor de ningún token.
- **No es certificación total de accesibilidad:** quedan nodos `incomplete` de contraste que axe no pudo decidir (7–49 por caso, ver `axe-*.json`); requieren revisión manual.

## 5. NavBar y reflow — CERRADO
- Causa: el nav (`flex` sin wrap) desbordaba. Cambio: `flex-wrap` (solo se nota si no cabe) + `min-w-0`; único consumidor es `layout.tsx`. No hay regresión de otras páginas: 1106 tests web verdes.
- Página completa a 1600 / 1280 / **640 (200 %)** / **320 (400 %)**: `scrollWidth == clientWidth` en Solo, P2, P3, P5 y en la configuración.
- Decorativos de Party 2: siguen existiendo (`span.cm-light`, `sl-transfer`, esquinas `i`) con `right` > viewport, pero **no generan scroll**: ocultando el overlay el `scrollWidth` es idéntico (`reflow-*.json`, campo `scrollWidthWithoutDecorativeOverlay`). Descartado como falso positivo; no se tocó.

## 6. VRT — Windows CERRADO · Linux CANDIDATOS, sin aceptar
- Windows: `canonical-visual.pw.ts` 10/10 con Storybook reconstruido.
- Linux: imagen oficial `mcr.microsoft.com/playwright:v1.62.1-jammy` (misma versión 1.62.1) + `design/serve-static.node.mjs` y `design/playwright.linux.config.ts` (nuevos; el config es igual al actual salvo el servidor estático, que no puede usar Bun en la imagen). `--update-snapshots=missing` creó 8 `*-linux.png` **sin sobrescribir nada**; una segunda corrida sin actualizar pasa 10/10 (estables).
- Revisión visual: comparé **solo `card-composed`** (Linux vs win32): mismo layout, solo cambia el antialias de la tipografía. **Los otros 7 candidatos NO están revisados por mí**; no los acepto, son archivos sin seguimiento a la espera de tu OK.
- Bloqueo de CI (declarado): `ci.yml` sigue **sin job VRT**; con los baselines aceptados faltaría agregar el job que use esa imagen. Requirió arrancar Docker Desktop en esta máquina.

## 7. ELIGE AHORA / Solo — dos niveles, separados
**A · UI con FIXTURE** (rotulado «FIXTURE 4A.2»; respuesta real del motor con UNA tarjeta promovida a STRONG): Party 2/3/5 ok (razón, recomendado + análisis + elegir, otro candidato, axe, elegir sincroniza la ronda). Solo: el motor devolvió 0 tarjetas en esa corrida → no se fabricó nada (`fixture-solo.json`); el caso Solo recomendado solo está cubierto por pruebas de componente (party `[1]`).

**B · MOTOR REAL** (sin `page.route`, draft completo jugado por la UI, `engine-real-*.json`):
| caso | respuestas | con tarjetas | con STRONG | con recomendación | ELIGE AHORA real capturado |
|---|---|---|---|---|---|
| Solo | 1 | 1 (1 tarjeta) | 0 | 0 | no |
| Party 2 | 2 | 1 | 0 | 0 | no |
| Party 3 | 3 | 3 | 2 | 2 | **sí** (`party3-7-MOTOR-REAL-…`) |
| Party 5 | 5 | 5 | 4 | 4 | **sí** (`party5-7-MOTOR-REAL-…`) |

- Causa leída en `recommendation-eligibility.ts`: STRONG exige un fundamento fuerte (counter *hard* a un rival ya revelado, pareja de sinergia, robo *hard*, hueco de composición crítico, o un ban que pese más que lo que queda libre). En la ronda 1 solo existe el fundamento de bans, y con los bans de la prueba suele quedar débil → todas las tarjetas «Evidencia limitada». Con rivales revelados (rondas 2–3 de Party 3/5) sí aparece STRONG.
- «Solo devuelve 0»: sin fundamento el héroe no se muestra (contrato V6). La cantidad cambia con los bans de cada sesión (en 4A.1 hubo 0, ahora 1 tarjeta WEAK).
- **BLOCKED (Solo y Party 2): sin evidencia STRONG real.** Solo/Party 2 de esta base solo tienen UN tablero (una sola decisión humana, sin rivales revelados) y con esos bans no hay fundamento fuerte. No se promovió nada ni se tocó V6/datasets.
- Propuesta para tu decisión: (a) aceptar que ELIGE AHORA en Solo depende de los bans y certificarlo con la evidencia de Party 3/5 + fixture; o (b) abrir una tarea aparte para un escenario de bans curados (hard counter baneado) que haga STRONG determinista en Solo, sin tocar V6.
- Nota: las razones reales de esas recomendaciones vinieron vacías (`targetBasis` DETERMINISTIC_DEFAULT / PHASE_FALLBACK sin razón de equipo); en esos casos el panel muestra solo la razón del héroe + «Criterio del motor».

## 8. Regresión arquitectónica — CERRADO
- Había dos copias de la regla «qué tarjeta se destaca» (`TeamCoachBoard.tsx:359` y `view-model.ts`) y encontré una **tercera** (`Columns.tsx` `data-primary`). Ahora una sola: `features/team-coach/eligibility.ts` (`hasLimitedEvidence`, `canHighlightAsRecommended`, `isPlannedCandidate`). Live la importa (1 línea cambiada por import; comportamiento idéntico) y el Light también.
- Una consecuencia a conocer: el Light dejó de exigir `isPrimary` para destacar al recomendado (igual que Live). El motor solo recomienda al primario, así que no hay cambio observable; queda cubierto por la matriz de paridad.
- Garantías automatizadas restauradas (`eligibility.parity.test.ts`): matriz de 4 casos con el mismo veredicto Live ↔ Light; ningún archivo de `simulator-light` compara `evidenceStrength` ni mira `isPrimary`; el Light no usa `sort(`/`reduce(`/`Math.` (no re-rankea). La prueba antigua «no inventa contrato» (`score:`) no se reemplazó porque era elusible; esta es más fuerte. No se introdujo una tercera implementación.

## Verificaciones
- `apps/web`: `bun test` 1106 pass / 0 fail · `tsc --noEmit` limpio · `bun run lint` 0 errores (5 warnings previos).
- E2E de la fase: 13/13 (4 fixture, 4 encabezado/axe/reflow, 1 configuración, 4 motor real). Corrido con `bun run e2e` de a uno.
- `scripts/verify-simplicity.sh`: superado.
- No se corrió la suite del motor (`apps/engine` no cambió).

## Riesgos
Cerrados: 1, 2, 3, 4, 5, 8 y VRT Windows.
Pendientes: (7) ELIGE AHORA real en Solo / Party 2 → decisión tuya; (6) aceptar/rechazar los 8 candidatos Linux y crear el job de CI; nodos de contraste `incomplete` por revisar a mano.
Observación nueva: la captura full-page de Playwright dibuja la franja *sticky* en medio de la página (artefacto de la captura, no del producto); las capturas con la franja arriba son las `*-5-encabezado-light.png`.
Archivos sin seguimiento a decidir: `docs/research/phase-4a1/`, `e2e/simulator-4a1-certification.spec.ts`, `e2e/support/simulator-start.ts` (arrastrados de 4A.1) y todo lo de esta fase. `data/dota2coach.sqlite` vacío: sigue sin ignorarse en `.gitignore` (recomendación de 4A.1, no aplicada).
