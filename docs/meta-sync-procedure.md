# Sincronización del meta en Preview: estado, impacto y procedimiento seguro

**Estado:** `META_SYNC` está apagado en Preview **a propósito** (P0-05F). Este documento NO lo enciende ni reinicia nada: describe cómo hacerlo después,
con respaldo y reversa, y qué esperar en la calidad de las recomendaciones. Encenderlo es decisión del propietario.

## Qué se observa hoy
- El log de arranque del motor en Preview dice: `sincronización de meta con OpenDota desactivada: sin autorización explícita (META_SYNC=on)`.
- La web muestra «Los datos de héroes/parche están desactualizados — Última actualización: *Sin sincronización previa*». O sea: en Preview **nunca hubo una
  sincronización exitosa**; el motor trabaja con el *seed* incluido en el repo (`apps/engine/src/meta/seed-*.json`) más lo que ya hubiera en el volumen.
- No es una falla de ingesta: no hay intento de ingesta. Es la regla `META_SYNC=on` (cualquier otro valor o ausencia = apagado, en todos los entornos).
- No pude leer la fecha de la última sincronización desde fuera: `/engine/api/meta/status` exige sesión (307 a login) y `railway ssh` pide una llave SSH que no
  voy a generar sin tu permiso. Con tu sesión, `GET /engine/api/meta/status` lo responde.

## Qué hace una sincronización (ya endurecida en P0-05F)
1. **Staging**: todo lo de OpenDota se valida y se junta en memoria; no toca la base.
2. **Quality gates** (`meta/quality-gates.ts`): ≥100 héroes, ≤2 % inválidos, ≥95 % de héroes con stats de parche y con matchups, 0 errores de fuente, 0 duplicados, y el
   snapshot nuevo no puede ser menor que el 90 % (héroes) / 80 % (filas de matchup) del anterior. Si algo falla: `meta_sync.status = 'failed'` y **se sigue sirviendo el
   snapshot anterior**.
3. **Publicación atómica** en una sola transacción (`publishAtomically`): nunca queda un snapshot a medias.
4. Reintentos ante 429: 1 s, 4 s, 16 s; máximo 3.
5. El **parche** lo estampa el proyecto (`CURRENT_PATCH = "7.41e"`, `UNVERIFIED_PATCH_BASIS`): OpenDota no reporta parche. Es el riesgo principal (abajo).

## Impacto esperado en las recomendaciones (análisis de código; sin medición en producción)
| Qué cambia al sincronizar | Señal afectada | Efecto esperado |
|---|---|---|
| `patchStats` (winrate/pickrate por héroe) | `patch_meta` | Se mueve el orden de héroes con poca evidencia posicional |
| `matchups` (counter estadístico) | `counter` | Cambian los counters estadísticos; los curados (`hero-counters.json`) no cambian |
| `isStale` pasa a `false` | confianza | Dejan de bajar a «media» por meta viejo; desaparece el aviso de datos desactualizados |
| *No cambia* | `position_fit`, `team_synergy`, `archetype_fit`, `hero_pool_fit` | Usan datos curados o de la sesión, no el meta sincronizado |

**Riesgo principal:** el rótulo de parche es manual. Si OpenDota ya mezcla datos de un parche posterior a `7.41e` (o de ventanas de partidas de varios parches) y el
proyecto lo estampa como `7.41e`, el motor presentará como vigente un meta que no lo es. Los gates comprueban *forma y tamaño*, **no frescura semántica**.
Por eso el paso 2 del procedimiento (comparar antes/después) es obligatorio y no se omite.

## Procedimiento seguro (para el propietario; nada de esto se ejecutó)
**0. Ventana.** Sin drafts en curso (la beta tiene invitados reales). Un reinicio corta los WebSocket unos segundos.

**1. Respaldo (obligatorio, antes de cualquier cambio).**
- Con acceso al servicio: `sqlite3 <ENGINE_DB_PATH> ".backup '/data/respaldo-AAAAMMDD.sqlite'"` y luego `sqlite3 <copia> "PRAGMA integrity_check;"` debe decir `ok`.
- Descargar una copia fuera de Railway (el volumen y su respaldo viven en el mismo proveedor). Si el plan lo ofrece, además un backup manual del volumen en Railway.
- Anotar el SHA servido (`/healthz`) y las cuentas activas: es el punto de retorno.

**2. Ensayo local con una copia (cero riesgo para Preview).**
- Copiar el respaldo a una carpeta local, levantar `apps/engine` con `META_SYNC=on` y `ENGINE_DB_PATH` apuntando a la copia (solo lectura/escritura sobre la copia).
- Verificar que `meta_sync` queda `ok` y que ningún gate falló.
- Medir impacto sobre los 30 escenarios de P0-05B (mismos drafts, snapshot anterior vs nuevo) y correr `bun run scripts/eval/gate.ts --enforce`. **Propuesta de criterio de
  aceptación** (a validar por el propietario; los números no están calibrados): top-5 casi igual en escenarios con `STRONG` (Jaccard@5 alto), ningún héroe baneado/ilegal,
  `ConstraintViolationRate = 0`, y revisión a mano de los héroes que entran/salen del top-5 por un jugador Legend (el propietario).
- Comprobar a mano que el parche de los datos nuevos corresponde a `CURRENT_PATCH`. Si no, **no se enciende**: primero se corrige el rótulo o se declara el parche real.

**3. Encender.** En Railway → servicio `d2kiro-f4-preview` → Variables → `META_SYNC=on`. Eso reinicia el servicio (el volumen persiste). El motor sincroniza al arrancar si
el meta está viejo y luego revisa cada hora (`GLOBAL_META_REFRESH_CHECK_MS`).

**4. Verificar.** Con sesión: `GET /engine/api/meta/status` → `status: ok`, `syncedAt` reciente, procedencia del parche; la web ya no muestra el aviso; `meta_sync` tiene la fila `ok`.
Correr de nuevo los 30 escenarios contra Preview y comparar con el ensayo.

**5. Reversa.**
- Si la sincronización *falla*: no hace falta nada, el snapshot anterior sigue sirviéndose.
- Si *funciona pero empeora* la calidad: poner `META_SYNC` en off (otro reinicio) y restaurar el respaldo del paso 1 (parar el servicio, reemplazar el archivo, arrancar).
- Dejarlo encendido de forma permanente o apagarlo tras la primera sincronización buena es una segunda decisión: encendido, refresca solo cada hora si el meta pasa de 24 h.

## Qué falta y quién lo decide
- **Medición real del impacto** (paso 2): bloqueada hasta que el propietario autorice el ensayo con la copia del volumen de Preview (contiene cuentas de beta: no la descargo yo).
- **Corrección del rótulo de parche** (`CURRENT_PATCH`) si el ensayo muestra desajuste.
- **Encender `META_SYNC`**: propietario.
