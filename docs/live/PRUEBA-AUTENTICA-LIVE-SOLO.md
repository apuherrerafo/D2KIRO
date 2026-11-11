# Primera prueba auténtica de Live Solo — guía de una página

> Todo lo de `smoke:live` y `--rehearse` es **SIMULADO**. Dota real sigue **UNTESTED** hasta seguir esta guía.
> Cadena real: **Dota → Companion (127.0.0.1:53122) → HTTPS → sitio → motor V6 → /live-draft**.

## El día de la prueba: 5 acciones

1. **Cerrar tu stack viejo:** doble clic en `C:\Users\APU\d2kiro-local\D2KIRO-STOP.cmd`. Corre código viejo y un motor con capacidades de prueba; el preflight lo bloquea a propósito.
2. **Arrancar:** `bun run preflight:live -- --start` (en esta carpeta). Espera `Servicios arriba` y `Meta de héroes lista`. Déjalo abierto.
3. **Re-emparejar el Companion, sin reinstalarlo:** navegador → `https://localhost:3443/live-draft` → entrar con Steam → **Conectar Dota** → **Descargar instalador para Windows** → ejecutarlo. El Companion ya instalado adopta el enlace nuevo solo en ≤30 s (no hay que desinstalar nada). La primera carga de `/live-draft` puede tardar 1–2 min: espera, no recargues.
4. **Verificar:** en otra terminal, `bun run preflight:live` → debe decir `== LISTO ==` (si dice BLOQUEADO, cada línea trae su acción).
5. **Abrir Dota** y seguir desde la sección 3. Al terminar: `Ctrl+C` en la ventana de `--start`.

> `--start` usa el **motor real** (`index.ts`, el mismo de Railway): sin bot forzado, sin reloj de prueba, sin fixture de Captains Mode, sin recarga automática. En esta base nueva la primera sincronización del meta tarda unos minutos (con internet).

---

## Detalle (referencia)

## 0. Antes de sentarte (Dota cerrado, 2 min)

```
bun run preflight:live
```
Debe terminar en **`== LISTO ==`**. Si dice BLOQUEADO, cada línea roja trae su acción. Dos bloqueos esperados hoy:

| Bloqueo | Qué significa | Qué hacer |
|---|---|---|
| Puertos 3000/4000 ocupados | Tu stack "D2KIRO Local" corre código **viejo** (`integration-1b-b-2b`) | Cerrarlo con `C:\Users\APU\d2kiro-local\D2KIRO-STOP.cmd` |
| Companion emparejado al **preview de Railway** | Dota alimentaría otro despliegue, no este commit | Paso 2 |

## 1. Qué iniciar

```
bun run preflight:live -- --start
```
Levanta motor + web de **este** worktree y el HTTPS local (Caddy `:3443`). Déjalo abierto; **Ctrl+C lo detiene todo**.

## 2. Qué abrir tú (una sola vez)

1. Navegador: `https://localhost:3443/live-draft` → entrar con Steam.
2. "Conectar Dota" → **Descargar instalador del Companion** → ejecutarlo. (Re-empareja el Companion a local y reescribe el cfg. Si Dota estaba abierto, reiniciarlo.)
3. Repetir `bun run preflight:live` → **LISTO**.

## 3. Comprobar Companion y GSI reales (Dota abierto, en el menú)

- La pantalla `/live-draft` muestra **Companion conectado** (aunque Dota esté en el menú).
- Entrar a una partida y mirar el panel **Diagnóstico de conexión**: "último paquete" debe ser de pocos segundos.
- **Sesión vinculada ≠ captura recibida.** Vinculada = enlace válido; recibida = llegaron paquetes del draft. Solo la segunda cuenta.

## 4. Draft controlado (NO Ranked)

Lobby privado / partida personalizada con bots, modo All Pick, **sin picks automáticos**:
1. Declarar tu posición (Pos 1–5) **antes** del primer pick.
2. Banear y pickear con normalidad; observar si aparecen bans y picks de ambos lados.
3. Confirmar: ELIGE AHORA (si aparece) lleva motivo, y **la app nunca elige por ti**.
4. Anotar todo en `docs/live/EVIDENCIA-PRUEBA-LIVE.md` (copia de la plantilla).

> Un lobby **no** reproduce Ranked: las fases y revelaciones difieren y GSI no entrega todo. Lo que el lobby no muestre se anota como **no observado**, no como falla ni como éxito.

## 5. Antes de autorizar Ranked Solo — los 6 sí

- [ ] Preflight LISTO con Dota abierto.
- [ ] Picks **y** bans de ambos equipos coinciden con lo que ves en el juego.
- [ ] Tu posición declarada es la que aparece en el tablero.
- [ ] Una captura incompleta muestra el aviso (409), **no** recomienda nada.
- [ ] Cortar internet 10 s: aparece "reconectando" / datos desactualizados, y al volver se recupera.
- [ ] La evidencia está llena y sin Steam id ni tokens.

Si falta uno: **no** Ranked.

## 6. Cómo detener todo si falla

1. Ctrl+C en la ventana de `--start` (mata web, motor y Caddy; borra el registro de PIDs).
2. Cerrar Dota si hace falta. El Companion puede quedar corriendo (es inofensivo, solo reenvía a su sitio).
3. Para dejar de enviar datos a este sitio: Configuración de Windows → Aplicaciones → **D2KIRO Companion** → Desinstalar.
4. Verificar: `bun run preflight:live` debe mostrar puertos 3000/4000 libres.

## Hallazgos del preflight (2026-11-11)

| # | Hallazgo | Clase | Estado |
|---|---|---|---|
| 1 | Companion emparejado a Railway preview, no a este código | **P0** | Requiere acción tuya (paso 2); no se tocó el Companion |
| 2 | 3000/4000 ocupados por stack viejo (`index.e2e.ts`, otro worktree) | **P0** | Requiere cerrar tu stack (paso 0); no se tocó |
| 3 | HTTPS local (Caddy 3443) lo cubre `--start` | P0 → resuelto | `--start` lo levanta si falta |
| 4 | Specs e2e de Live mezclados en una corrida se pisan la cuenta | P1 | Resuelto: `smoke:live` corre cada archivo aparte |
| 5 | Primer `/live-draft` en frío puede pasar 60 s | P1 | `smoke:live` reintenta una vez; calentar abriendo la página |
| 6 | `dev:mvp` arranca el motor con `index.e2e.ts` (capacidades de prueba), no `index.ts` | P0 para sesión auténtica | **Resuelto 2026-11-11:** `--start`/`--rehearse` arrancan `index.ts` (modo `--live`); el preflight bloquea si el motor del puerto 4000 corre `index.e2e.ts` |
| 7 | README del Companion dice puerto 53120; el real es 53122 | POST-MVP | Solo documentación |
| 8 | `dev:live` es la ruta Overwolf antigua, no la del Companion | POST-MVP | No usar para esta prueba |
| 9 | Party 2/3 Live, Party real | POST-MVP | Fuera de alcance |
