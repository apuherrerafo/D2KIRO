# Fase 4A.3 — Cierre de Solo / Party 2, VRT Linux y regresión final (sobre c37194e7)

Sin commit, push, merge ni deploy. Motor, capturador, V6, pesos y datasets sin tocar (`git diff --name-only` no lista nada de `apps/engine`, `data/` ni `eval/`).
Entradas curadas = ENTRADAS DEL PRODUCTO (semilla del draft + «Tu Personal_Ban_List»), jugadas por la UI contra el motor real. Ninguna respuesta del motor se reescribe, salvo el caso WAITING (rotulado FIXTURE de interfaz).

## 1 · Solo y Party 2
| escenario | entradas | resultado del motor real | UI |
|---|---|---|---|
| solo-strong | semilla CURATED1 · bans Anti-Mage, Nyx Assassin, Riki, Disruptor | Leshrac (Pos2) **STRONG**, fundamento BAN_OPENS | ELIGE AHORA, análisis, axe 0, elegir recomendado OK |
| party2-strong | semilla CURATED3 · bans Doom, Ancient Apparition, Shadow Demon, Troll Warlord · jugador Pos5 | Oracle (Pos5) **STRONG** | ídem |
| solo-weak | semilla SCAN0005 | 1 tarjeta WEAK, sin decisión | sin ELIGE AHORA; panel marca «Evidencia limitada» y no inventa decisión de equipo |
| party2-weak | semilla SCAN0000 | tarjetas WEAK, sin decisión | ídem |
| solo-cero | semilla SCAN0000 | 0 tarjetas | columna vacía, sin ELIGE AHORA, «Buscar otro héroe» disponible |
| party2-waiting | FIXTURE de interfaz (solo el estado de la columna Pos2) | — | muestra el texto del motor, sin tarjetas ni ELIGE AHORA |

Evidencia: `scenario-*.json` (entradas, respuesta, decisión, razones, axe) y `captures/`.
**Solo y Party 2 quedan cubiertos con STRONG real.** Lo que NO se obtuvo: `targetBasis = STRATEGIC` real (ver §5).

## 2 · Diagnóstico de los cero candidatos
- No es un error de integración, datos ni configuración: el motor respondió 200, estado `RANKED`, con el catálogo de 127 héroes y los counters curados cargados.
- Es la ausencia legítima prevista por el contrato V6 (`recommendation-eligibility.ts`): un héroe se muestra solo si tiene un fundamento independiente. En ronda 1 el único fundamento disponible es «los bans abrieron al héroe», y Solo mira una sola posición (Mid), así que casi ningún héroe lo cumple.
- Medido (`scan-seeds.json`, 40 semillas sin bans curados): **Solo** 28/40 con cero tarjetas, 12/40 con 1 tarjeta WEAK, 0 STRONG · **Party 2** 1/40 con cero, 39/40 con tarjetas WEAK, 0 STRONG.
- STRONG por bans exige que lo baneado con porqué pese MÁS que lo que sigue libre y probable; con bans al azar no ocurre. Con bans curados (barrido de 762 combinaciones, `scan-curated.json`) aparece en 18.

## 3 · VRT Linux (`vrt/`)
Imagen `mcr.microsoft.com/playwright:v1.62.1-jammy` (digest fijado). Los 8 baselines Linux comparados uno a uno contra su par win32:
- Mismo tamaño y mismos colores medios en los 8. Layout y estados idénticos.
- 100 % de los píxeles con diferencia fuerte caen sobre bordes de glifos. Con tolerancia de ±2 px el residuo es ≤ 0,09 % de la imagen (grosor/hinting de fuente): **diferencia legítima de plataforma**.
- Revisados a ojo (hoja win | linux | diferencia): `statetarget-pressed`, `herodraftslot-showplate`. Los otros 6 se aprobaron por las métricas anteriores, no por inspección visual individual (`compare.json`, `structure.json`, `shift-tolerant.json`).
- **Veredicto: los 8 son aprobables.** Siguen sin aceptarse formalmente: son archivos sin seguimiento hasta que el Product Owner apruebe el commit. Ningún baseline anterior (win32) se tocó.
- Job: `.github/workflows/visual-regression.yml` (contenedor fijado por tag+digest, Bun del pin de package.json, verificación de que Playwright == 1.62.1, `--update-snapshots=none`, sube los diffs si falla).
- Regresión: réplica local de los pasos del job dentro de la misma imagen, con Storybook reconstruido desde cero → **10/10**. Candado verificado en rojo: con un bloque de 40×40 px alterado en un baseline falla (1600 px distintos).
- **No se pudo ejecutar el job en GitHub** (sin push). Solo corre `canonical-visual.pw.ts`; `visual.pw.ts` tiene baselines únicamente win32 (3) y queda fuera.

## 4 · Regresión final
- `apps/web`: `bun test` 1106 pass / 1 skip / 0 fail · `tsc --noEmit` limpio · lint 0 errores (5 warnings previos) · `verify-simplicity` OK.
- E2E Simulador (canonical-light, 4A.1, 4A.2, 4A.3, simulator, ap-party-sizes): 51 pass + 1 prueba ajustada (abajo) → 12/12.
- **Ajuste a una prueba de 4A** (`e2e/simulator-canonical-light.spec.ts`, ver `changes.diff`): la prueba de reflow fallaba en los 4 casos por `span.cm-light`. Medido en navegador a 1600/640/320: `scrollWidth == clientWidth` en Solo, P2, P3 y P5; el adorno es `aria-hidden`, `pointer-events:none` y está recortado por `overflow-x:hidden` (`reflow-decorativo-*.json`). La prueba ahora excluye solo adornos `aria-hidden` recortados y **añade** la exigencia de cero scroll horizontal del documento.
- Elegibilidad compartida: `eligibility.parity.test.ts` (matriz Live ↔ Light) verde; Live no cambió de comportamiento.
- Contraste `incomplete` (41 nodos por escenario, calculados a mano): 40/41 ≥ AA con ratio real, **0 fallan**; el nodo restante (nombre sobre el retrato) se midió sobre los píxeles reales: peor píxel 8,87:1 (mínimo 4,5). No esconde fallos. Muestra: un héroe por escenario (Leshrac, Oracle).
- Selección: analizar ≠ elegir, «Elegir a X · PosN» y buscador siguen funcionando (4A.2 + 4A.3 eligen el recomendado y la ronda avanza).

## 5 · Bloqueos reales restantes
1. **`targetBasis: STRATEGIC` real no se obtuvo.** El motor solo lo emite con ventana de counter o último héroe del pool; en todos los escenarios es `DETERMINISTIC_DEFAULT` y el panel muestra «Criterio del motor: orden por defecto» + las razones del héroe. La captura con razón estratégica completa es FIXTURE (4A.2, rotulada).
2. Los 8 baselines Linux esperan la aprobación formal del Product Owner; el job de CI no se ha corrido en GitHub.
3. `visual.pw.ts` sin baselines Linux.

## 6 · Observaciones para tu decisión (no son bloqueos)
- ELIGE AHORA puede caer en un héroe que NO es #1 del ranking (Leshrac #4 en Solo, Oracle #2 en Party 2): por contrato la fuerza de evidencia decide la acción principal, no el orden. Es coherente con V6, pero un jugador puede extrañarse.
- Con cero candidatos la columna queda vacía y el panel dice «Selecciona un héroe…» (contrato: no se dibuja nada). La única salida visible es «Buscar otro héroe».
- `data/dota2coach.sqlite` sigue sin estar en `.gitignore` (recomendación de 4A.1, no aplicada).

## Archivos
Nuevos: `.github/workflows/visual-regression.yml`, `e2e/simulator-4a3-{certification,contrast,portrait-contrast,reflow-check}.spec.ts`, `docs/research/phase-4a3/` (incluye `tools/` con los dos barridos de diagnóstico, fuera de `e2e/` porque leen `hero-counters.json`). Modificado: `e2e/simulator-canonical-light.spec.ts`. Capturas definitivas: `captures-definitivas/`.
