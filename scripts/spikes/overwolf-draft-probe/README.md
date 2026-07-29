# Spike: sonda de draft sobre el GEP de Overwolf

Paso 0 del plan persistido en `docs/agents/architecture.md` ("Addendum (2026-07-28) —
Capturador real: Overwolf primero, OCR condicional"). **Esto no es producción**: no pasa por
`@redteam`/`@shipcheck`, no cuenta contra el límite de 3 archivos/200 líneas, y no se instala
como parte de dota2coach. Es un app mínimo de Overwolf, desechable, para responder dos preguntas
antes de construir el adapter `overwolf` real.

## Qué confirma (los 2 criterios de éxito ya documentados)

1. **Los datos llegan**: `roster.players` / `roster.bans` / `roster.draft` del GEP traen
   `heroId`/`team` poblados en vivo durante una partida propia — no solo en spectator.
2. **El revert es distinguible**: cuando cambiás de héroe antes de confirmar (o si el modo que
   uses permite corregir un pick), el log debe mostrar un **cambio en el mismo slot**
   (`[DIFF ... ] CAMBIÓ slot=...`), no una fila nueva sin relación con la anterior. Esa es la
   heurística de la que depende `pick_reverted` en el adapter real (Paso 1A) — si acá no se
   distingue con claridad, hay que rediseñarla antes de construir el adapter completo.

## 1. Preparar el icono

El manifest de Overwolf exige que `icon.png`/`icon_gray.png` existan. Poné cualquier PNG
cuadrado pequeño (16×16 o más) en esta misma carpeta como `icon.png` — no importa cuál, es solo
para que el modo desarrollador cargue el app.

## 2. Activar el modo desarrollador de Overwolf

Overwolf → ícono de la bandeja del sistema → menú → si no ves "Development options", andá a
Configuración → Acerca de, y hacé varios clics sobre el número de versión hasta que aparezca.

## 3. Cargar el app sin empaquetar

Ícono de la bandeja → **Development options** → **Load unpacked extension...** → seleccioná
esta carpeta (`scripts/spikes/overwolf-draft-probe`, la que contiene `manifest.json`).

Si el manifest falla al validar, es casi seguro `minimum-overwolf-version` — bajalo o quitalo, no
es relevante para el spike.

## 4. Abrir la consola en vivo

Ícono de la bandeja → **Development options** → tu app (`dota2coach-draft-probe`) → **Inspect**
sobre la ventana `background`. Ahí aparece cada línea del log en tiempo real (`console.log`). Es
la fuente confiable — el archivo (`overwolf-appdata:/draft-probe.log`, dentro de la carpeta de
datos local de Overwolf para este app) es solo respaldo best-effort, no hace falta encontrarlo si
la consola ya te alcanza.

## 5. Lanzar Dota 2 y entrar a una partida

**Recomendado primero**: lobby privado (Jugar → Crear lobby → modo All Pick → agregar bots, sin
rankeada) — control total del tiempo, cero riesgo de cuenta. Si el lobby con bots no puebla
`roster`/`bans`/`draft` (puede pasar, algunos campos solo se llenan en matchmaking real),
reintentar con una partida pública normal, **nunca rankeada**, para no arriesgar la cuenta.

**Troubleshooting si no ves nada después de 2-3 minutos** (todo vacío en el log): agregá
`-gamestateintegration` en Steam → Dota 2 → Propiedades → Opciones de lanzamiento, y reiniciá el
juego. Hay evidencia (no confirmada oficialmente) de que el GEP de Overwolf para Dota 2 podría
depender de esto — ver `architecture.md`, sección de tensión sin resolver. Si esto cambia el
resultado, es información valiosa por sí sola — anotalo.

## 6. Protocolo durante la partida

1. Con la consola abierta y vacía, esperá la fase de bans. Mirá si aparecen líneas
   `[DIFF roster.bans] NUEVO` con `heroId`/`team` a medida que se banean héroes.
2. En la fase de picks: elegí un héroe **A** (sin confirmar todavía, si el modo te deja
   previsualizar antes de bloquear). Buscá en el log la línea de `roster.players` con ese
   `heroId`.
3. **Antes de confirmar**, cambiá a un héroe **B** distinto. Esto es el intento de revert — mirá
   si el log muestra `CAMBIÓ slot=... <<< POSIBLE REVERT` (mismo slot, héroe distinto) o si en
   cambio aparece como una fila nueva sin relación. Anotá cuál de los dos pasó.
4. Si tu partida/modo no te deja cambiar antes de confirmar, confirmá A normalmente y probá si
   hay alguna forma de corregirlo después (algunos lobbies personalizados lo permiten). Si no hay
   ninguna forma de revertir un pick ya confirmado en tu build actual de Dota 2, **eso también es
   un resultado válido** — anotalo, porque significa que `pick_reverted` en la práctica solo lo
   dispara una corrección manual del usuario, nunca el propio juego.
5. No hace falta terminar el draft completo — en cuanto tengas señal clara de los 2 criterios,
   podés abandonar el lobby de bots.

## 7. Qué traer de vuelta

Pegá en la conversación con Claude Code (o guardá aparte) los fragmentos relevantes del log:
las líneas `[RAW roster]`/`[DIFF roster.bans]`/`[DIFF roster.draft]` alrededor del momento del
draft, y en particular la línea (o ausencia de ella) del intento de revert del paso 6.3. Con eso
se decide si el Paso 1A (adapter `overwolf`) sigue adelante tal como está diseñado, si su
heurística de revert necesita rediseño, o si se pivota al Paso 1B (`ocr`) — nada de esto se
decide solo, vuelve a la conversación para revisión.

## 8. Limpieza

Cuando termines: bandeja de Overwolf → Development options → tu app → **Unload**. No hace falta
dejarlo instalado ni commitear nada de esto al repo salvo que quieras conservar el spike.
