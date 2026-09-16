# Probar el MVP de R1 a mano (sin saber programar)

Esta guía es para vos, no para un desarrollador. No necesitás saber qué es un "commit" ni abrir
ningún archivo de código. Sólo necesitás una terminal para escribir un comando, y un navegador.

## 1. Arrancar la aplicación

Abrí una terminal en la carpeta del proyecto y escribí:

```
bun run dev:mvp
```

Esperá hasta ver un mensaje como este:

```
[dev:mvp] Listo (si ambos procesos arrancaron sin error arriba).
[dev:mvp] Simulador:      http://127.0.0.1:3000/simulator
[dev:mvp] Motor (salud):  http://127.0.0.1:4000/api/health
[dev:mvp] Ctrl+C detiene los dos procesos.
```

Si en cambio ves un error (por ejemplo "port already in use" / "puerto ya en uso"), cerrá cualquier
otra ventana de terminal que haya quedado abierta de una prueba anterior y volvé a intentar.

**Para detener todo**: volvé a esta terminal y apretá `Ctrl+C`. Los dos procesos se cierran juntos.

## 2. Abrir el simulador

Abrí tu navegador en:

```
http://127.0.0.1:3000/simulator
```

La primera vez te va a pedir loguearte con Steam — es el login real, el mismo que en producción.
Es normal y esperado: no hay atajo que lo salte, ni siquiera en esta prueba local.

## 3. Configurar un draft

En la pantalla de configuración:

1. Elegí tu lado (Radiant o Dire) — cualquiera sirve para esta prueba.
2. Elegí la posición que vas a jugar (1 a 5).
3. Dejá la semilla del draft como está (o apretá "Generar" para una nueva).
4. Apretá **"Iniciar Draft"**.

## 4. Qué deberías ver durante el draft

- El tablero central muestra los héroes baneados y los picks confirmados de los dos lados.
- A la derecha aparece el panel **Copilot**. Ahí es donde vive toda la inteligencia de R1:
  - El héroe recomendado, con un resumen de por qué (por ejemplo "Fuerte contra X", "Rol
    flexible...").
  - Un nivel de confianza ("Confianza alta/media/baja").
  - Si el motor tiene algo que decir sobre el rival, vas a ver una caja chica que dice
    **"Lectura del rival (1 jugada)"** con texto como "Respuesta rival plausible: <héroe>" o "Este
    pick le quita <héroe> al rival". **No siempre aparece** — sólo cuando el motor tiene algo
    concreto que decir, nunca un número inventado tipo "72% de probabilidad".
  - Si tu héroe recomendado tiene una posición clara, vas a ver "Posición sugerida: ...".
  - Si el motor tiene poca evidencia para esa recomendación, vas a ver un aviso de riesgo, no un
    silencio.
- Apretá **"Ver señales"** en cualquier tarjeta para ver el desglose completo de por qué el motor
  sugirió ese héroe.

Elegí cualquier héroe habilitado para avanzar el draft (no hace falta seguir la recomendación).

## 5. Al terminar el draft

Vas a ver "Draft completo" y un resumen de los 5 héroes de cada lado. Podés apretar "Reiniciar
draft" para probar de nuevo con otra configuración.

## 6. Qué reportar si algo se ve raro

Si algo no se ve bien, lo más útil que podés hacer es:

1. Sacar una captura de pantalla del momento exacto.
2. Anotar qué estabas haciendo justo antes (qué botón apretaste, qué ronda era).
3. Si ves texto raro tipo `NOT_COMPUTED`, `undefined`, `[object Object]`, o un JSON crudo en
   pantalla — eso SIEMPRE es un bug, anotalo tal cual aparece.
4. Copiar lo que diga la terminal donde corriste `bun run dev:mvp` (ahí quedan los logs de los dos
   procesos).

## Checklist de prueba sugerido

No hace falta hacer los 8 puntos en un solo intento — cada uno es independiente:

1. **AP Solo** — un draft normal de punta a punta: ¿la recomendación se siente razonable? ¿la
   explicación tiene sentido?
2. **Posición/rol** — cuando el Copilot dice "Posición sugerida", ¿coincide con lo que jugarías vos?
3. **Momento oculto/revelación** — antes de que el rival revele un pick, ¿el Copilot muestra algo
   que "no debería saber todavía"? (no debería — avisá si lo ves).
4. **Colisión** — si en algún draft el tablero muestra que dos lados eligieron el mismo héroe a la
   vez, ¿el mensaje que aparece se entiende?
5. **Captain's Mode** — **no probable todavía**: el simulador de hoy sólo arma Ranked All Pick, no
   tiene un botón para Captain's Mode. Esto es un hueco conocido, no algo que rompiste vos.
6. **"Lectura del rival"** — ¿el texto se entiende sin ser un desarrollador? ¿alguna vez dice algo
   que suena a un porcentaje o una certeza que no debería tener?
7. **Steal** ("le quita X al rival") — ¿aparece con sentido, o aparece todo el tiempo aunque no
   parezca relevante?

Con eso alcanza — el objetivo de esta prueba es tu sensación de producto, no encontrar bugs de
código.
