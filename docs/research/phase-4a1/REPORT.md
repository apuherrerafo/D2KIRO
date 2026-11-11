# Fase 4A.1 — Certificación del Simulador Canonical Light (sobre c37194e7)

Sin cambios de producto, motor, capturador, datasets ni Live. Sin commit, push, merge ni deploy.
Arnés: `e2e/simulator-4a1-certification.spec.ts` + `e2e/support/simulator-start.ts` (nuevos, sin commit). Motor + web reales, base E2E determinista.
Datos crudos: `*.json` de esta carpeta; capturas en `captures/`.

## 1. ELIGE AHORA
- El motor E2E devuelve evidencia WEAK en todas las tarjetas, y el contrato prohíbe ELIGE AHORA con WEAK. Por eso en 4A nunca apareció.
- **Fixture explícito**: la respuesta REAL de `team-recommendations` pasa por `page.route`; solo se promueve UNA tarjeta real a STRONG + `currentDecision` STRATEGIC (razón rotulada "FIXTURE 4A.1"). Cada campo tocado queda en `elige-ahora-*.json`. V6 y el frontend no se tocan.
- Resultado: Party 2 (Pos5, `ELIGE AHORA`), Party 3 (Pos3, `ELIGE AHORA`), Party 5 (recomendada cae en Pos1 → sello `Para tu party`, correcto por contrato). Capturas A (recomendado), B (recomendado + pressed + análisis), C (otra tarjeta abierta: la recomendada conserva `data-state=recommended`, sin pressed). Reabrir/cerrar tampoco la pierde; abrir no elige.
- Solo: el motor devolvió 0 tarjetas en la corrida final (en una corrida previa sí hubo una). Es estado válido y variable por bans; no se fabrica nada. Cobertura de Solo con ELIGE AHORA: **incompleta**.
- Hallazgo: la **razón estratégica de la decisión no se muestra** en el Light (`Recommendation.reason` se calcula en `view-model.ts` y ningún componente la renderiza; el tablero anterior la mostraba en un banner). Es una regresión de contenido frente al tablero viejo → decisión del PO.

## 2. Retratos
No hay error de CDN. Todas las `<img>` terminan (`naturalWidth>0`), 0 rotas, 0 requests fallidos, todas HTTP 200 desde `cdn.cloudflare.steamstatic.com`. Lo que se veía en 4A (rectángulo blanco) era captura tomada con imágenes aún en vuelo: a t=0 quedaban 108–118 de ~130 pendientes. No hay fallback "Art pending" en ningún caso. Riesgo real: no hay estado de carga (placeholder) mientras llega la imagen, y el E2E de 4A capturaba sin esperar. Corregido en el arnés (espera `img.complete`).

## 3. axe (WCAG 2.0/2.1/2.2 A/AA, página completa, candidato abierto salvo Solo sin tarjetas)
Solo / Party 2 / 3 / 5: **1 violación en cada uno, `color-contrast` serious (18–25 nodos)**, **0 dentro del tablero Light**. Todos los nodos son del roster oscuro previo (`own-roster-pos-*`, `.font-mono`, `text-content-muted`), no tocado por 4A. 8 nodos `incomplete` de contraste por revisar a mano. Bloquea una certificación AA de la página completa, no del tablero.

## 4. Reflow (tablero y página por separado)
| ancho | página | NavBar | tablero |
|---|---|---|---|
| 1600 | sin scroll | 0 | 0 |
| 640 (200 %) | **scroll horizontal, 698 px** | 7 elementos fuera | 0 (Solo/P3/P5); **Party 2: 4 elementos** (esquinas `i`/`span` decorativas a 754–758 px) |
| 320 (400 %) | **scroll horizontal, 698 px** | 11 fuera ("Mi pool", "Meta", "Configuración", cuenta) | 0 (Solo/P3/P5); **Party 2: 6** |
- La NavBar causa el 100 % del scroll de página. No rediseñada.
- Nota: el E2E de 4A declaraba el tablero limpio; en Party 2 mi medición encuentra elementos decorativos (marco de esquinas/transfer) que sobresalen. Probable falso positivo visual (overlay `sl-transfer`, `aria-hidden`), pero **no verificado** si genera scroll propio: el scroll de página medido (698) coincide exactamente con la NavBar.

## 5. CompactBoard vs cuerpo Light
Inconsistencia clara (`encabezado-*.json`, captura `*-F-*`): CompactBoard `rgb(23,26,33)` + Geist sobre página `rgb(15,17,21)`; bloque Light `rgb(242,237,229)` + Plex/Syne. Un panel beige "pegado" bajo franja y banner "Ronda 1 de 3" oscuros. Propuesta mínima (no aplicada): envolver el CompactBoard y el banner de ronda en el mismo alcance `SimulatorLightScope` (solo tokens, sin rediseño), o darle al bloque Light un marco/margen que lo haga leer como panel. Requiere aprobación.

## 6. Cambio en TeamCoachBoard.test.tsx
- Se reemplazó "una sola implementación" por "exactamente dos tableros" + "el Light lee `TeamCoachBoardData`". Se perdió: la garantía de implementación única y que `/simulator` use el tablero con **pick desde el tablero** (tests 17/18/20 siguen cubriendo solo el tablero viejo, que ahora solo usa Live).
- Verificado a favor: el Light no tiene `sort(`, `.score` ni `reduce(` (no re-rankea); el orden viene del motor (`merge-candidates` lo prueba).
- Débil: la prueba "no inventa contrato" usa `not.toMatch(/score\s*[:=]/)`, fácil de eludir; mejor un guard contra `sort|reduce|Math.` en `simulator-light/`.
- Duplicación: la regla de elegibilidad (`isPrimary && evidenceStrength !== "WEAK"`) vive ahora en 2 sitios (`TeamCoachBoard.tsx:359`, `view-model.ts:37`). Presentación, no cálculo de motor, pero conviene un predicado compartido.
- Cambio de producto a confirmar: en el Simulador **ya no se elige desde el tablero** (elegir queda en `BlindRoundPanel`).

## 7. Plan de baselines CI/Linux
Los 8 baselines VRT del commit son `*-win32.png` (Playwright los nombra por plataforma); en `ci.yml` no hay job VRT y `visual-runtime.yml` es otra cosa. Plan: (1) job Linux con la imagen oficial de Playwright de la misma versión; (2) correr `canonical-visual.pw.ts` con `--update-snapshots=missing` (solo crea candidatos `*-linux.png`, regla ya escrita en el archivo); (3) revisar cada candidato frente al win32 a ojo (fuentes y antialias difieren; no se acepta diff automático); (4) subirlos en un commit propio aprobado por el PO; (5) recién entonces activar el job como gate. Ninguna diferencia se acepta sin revisión.

## 8. SQLite sin seguimiento
`data/dota2coach.sqlite`: 4096 bytes, **0 objetos** (sin tablas), `user_version=0`, creada 19:53 (antes del commit), sin ignorar por git; coincide con el default `./data/dota2coach.sqlite` de `db/client.ts` abierto por algún proceso lanzado desde la raíz. Es un archivo vacío generado, sin datos. Eliminado, junto a `-shm`/`-wal` que creó mi propia sonda de lectura. No identifiqué qué prueba exacta lo genera; se recomienda ignorarlo en `.gitignore`.

## Riesgos que bloquean integración
1. NavBar desborda a 640/320 px → falla reflow 1.4.10 de la página (preexistente, fuera del tablero).
2. `color-contrast` serious en el roster oscuro (preexistente) → sin AA de página completa.
3. Razón de la decisión no renderizada en el Light (regresión de contenido).
4. Elegir ya no se hace desde el tablero: decisión de producto sin confirmar.
5. Baselines solo win32; sin gate Linux.
6. CompactBoard/banner oscuros vs cuerpo Light: inconsistencia visual abierta.
7. ELIGE AHORA solo verificado con fixture (el motor E2E nunca emite STRONG) y Solo sin cobertura; Party 2 con elementos decorativos fuera de viewport sin descartar.
