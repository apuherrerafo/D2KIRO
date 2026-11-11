# 4B.2 · Cierre de certificación visual (Live Draft Canonical Light V1.1)

Evidencia: motor V6 real + web real; **Dota SIMULADO** (observaciones directas + POST GSI/Companion de prueba). No es una sesión de un cliente Dota auténtico.
Capturas y medidas: `cert/` (`medidas.json`). Pruebas: `e2e/live-canonical-4b2.spec.ts` (7) y `e2e/live-canonical-4b2-cert.spec.ts` (4).

## Resultados
- **VRT canónico** (`canonical-visual.pw.ts`, baselines win32): 10/10, incluidos los 4 «Legacy sin props nuevas». Limitación: no existe story VRT de `ActionPrimary`/`ActionQuiet`; su retrocompatibilidad se sostiene por tipos (`testId?` opcional → `data-testid={undefined}` no emite atributo), tsc y las 1168 pruebas web, y por las capturas de /simulator, landing y team-groups, que los consumen.
- **tsc** 0 errores · **lint** 0 errores (5 warnings previos) · **web** 1168 pass / 0 fail · **verify-simplicity** OK · motor/datos/scripts sin cambios.
- **Suite 4B.2 real**: 7/7 (sin enlace, Solo, Party 5, 409, página completa axe+teclado+reflow+movimiento reducido, reconexión, vigencia del Companion).
- **GoldenCardView / FreeThreatsView**: se alcanzan en `/live-draft` (LiveLightBoard → AuxViews). Sin migración adicional: fondo efectivo blanco (luminancia 1.0), axe 0 violaciones sobre ambas vistas y sobre la página, sin desborde a 800 y 400 px, y desaparecen al terminar el draft. El board se enriqueció en el navegador (page.route) porque el motor no produce card dorada en este fixture; el pick de la card dorada no se ofrece en Live.
- **Party 5 con nombres largos y razones de ~600 caracteres**: el análisis abierto muestra la razón completa; sin scroll horizontal a 800/400 px; axe 0. El nombre largo se ve completo en el selector de preset. Las columnas no muestran nombre de integrante (sólo «PosN»).
- **Accesibilidad**: axe WCAG A/AA/22AA 0 violaciones en todas las páginas medidas; teclado y movimiento reducido en la suite 4B.2.
- **409 / instalación / reconexión / draft terminado**: funcionan como antes (409 → aviso de captura parcial sin tablero; recarga conserva posición y recomendación; terminado → «Draft terminado», sin card dorada ni amenazas).
- **Alias de warning**: `.ll-page .sl-light { --signal-warning: var(--r3-spec-pink) }` está acotado a /live-draft (otras rutas: 0 marcos Live, nav sin cambio). Dentro de Live recolorea todo lector de `--signal-warning`: «Ojo» de la card dorada, título de ADVERTIR y la marca «Evidencia limitada». Distinguible de `bad` por texto/peso/subrayado; no es un cambio de significado, sí de color. Pendiente de decisión de producto si se prefiere otro token.

## Indicadores (procedencia)
| Indicador | Fuente |
|---|---|
| COMPANION | latido del Companion (vigente si < 45 s; luego «sin señal») |
| CONNECTION | sólo eventos GSI/capturador (`lastEventAt`) |
| PHASE | Companion si Dota=connected; si no, fase GSI; si no «—» |
| CAPTURE | `draftPhase` = hechos de draft de CUALQUIER fuente (GSI, helper visual, observación manual) |

Medido: sin eventos → «Esperando Dota…/Esperando selección»; solo Companion → PHASE «Hero Selection» (Companion) pero CAPTURE aún en espera; **solo observaciones (sin GSI) → CONNECTION «Esperando Dota…» + CAPTURE «Hero Selection» + 16 bans** (`indicadores-observaciones-sin-gsi.png`); con GSI → «Dota conectado». **Diagnóstico**: la combinación «Esperando Dota» + «Hero Selection» + bans es real y coherente con el motor (el draft lo alimenta otra fuente que GSI: helper visual/manual), no un estado inventado ni un error de render. Es ambigua para el jugador, porque «Esperando Dota» suena a «Dota no existe» mientras hay un draft. No se alteró la semántica; una etiqueta más precisa («Sin datos GSI · draft por lectura visual») queda como propuesta.

## Bloqueos reales para usar Live con Dota auténtico
1. Nada de esta evidencia es de un cliente real: GSI real (cfg instalado + Dota reiniciado), Companion real y helper visual deben verificarse con Dota 2 auténtico.
2. Con GSI real el draft puede quedar «captura parcial» (el fixture de prueba lo mostró): requiere ver qué bloque `draft` envía el cliente real.
3. No hay baseline VRT para `ActionPrimary`/`ActionQuiet` ni de Linux regenerado para esta fase.
