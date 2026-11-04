# Kit de evaluación humana — FRIENDS_FAMILY_READY

15 situaciones de draft del **motor actual**, para que 2–3 personas las juzguen **cada una por su lado**.
Sin esto no sabemos si el coach toma buenas decisiones de Dota; los tests y el gate solo detectan cambios y fallos técnicos.

## Para quien evalúa (≈ 45–60 min, una sola sentada)

1. Abre `situaciones.html` en tu navegador (funciona sin internet; se guarda solo mientras avanzas).
2. Escribe tu nombre o iniciales arriba.
3. En cada situación verás: tu lado, qué momento del draft es, baneos, tu equipo, los rivales ya revelados y el consejo del coach.
4. Califica **cada uno de los 5 héroes** y el **consejo principal**. Cuando algo no sea "bueno / correcto / bien", escribe **por qué con una mecánica concreta** (habilidad, línea, timing, rol, counter, composición). Los campos en rojo exigen razón.
5. Al terminar, pulsa **Descargar mis resultados** y manda ese archivo a quien organiza.

**Reglas de independencia:** no hables de las situaciones con otros evaluadores, no mires sus respuestas ni el archivo `manifest.json`, y no busques el motor ni sus pruebas. Si no estás seguro, dilo en la razón: preferimos "dudoso, no sé si…" a una certeza inventada. No uses winrate ni popularidad como argumento.

### Cómo leer lo que muestra el coach
- Los 5 héroes son **la lista para una sola posición**: el coach primero decide qué rol conviene mostrar ahora y luego propone héroes de ese rol. El **consejo principal** es esa decisión ("¿conviene pickear este rol ahora?"); los 5 héroes son las opciones dentro de ese rol.
- "Rol por definir" significa que el motor no fijó posición para ese héroe; "Probable: …" significa que la infiere.
- Las rondas son **a ciegas**: los picks rivales "sellados" no se ven todavía.
- Parche de referencia 7.41e; los baneos y el rival vienen del simulador (no son una partida real).

### Rúbrica (4 + 3 + 3 niveles)
| Campo | Valores | Cuándo |
|---|---|---|
| **Calidad del pick** | **Bueno**: lo jugaría o lo defendería aquí. **Aceptable**: razonable, no óptimo. **Malo**: se castiga o no encaja con lo que falta. **Error grave**: ningún jugador serio lo elegiría aquí (te hace perder el draft). | Cada héroe |
| **Explicación** | **Correcta**: el motivo es cierto. **Dudosa**: plausible pero vago o no comprobable. **Incorrecta**: afirma algo falso (habilidad, matchup, rol). | Cada héroe |
| **Posición sugerida** | **Bien / Dudosa / Mala**: ¿el rol que muestra el coach tiene sentido para ese héroe y ese momento? | Cada héroe |
| **Consejo principal** | **Razonable / Dudoso / Malo** | Cada situación |

Opcional por situación: "¿falta un héroe claramente bueno?" y un comentario libre.

## Para quien organiza

```
bun scripts/f-and-f/build-kit.ts          # regenera el kit (determinista: mismo motor+snapshot => mismos archivos)
bun scripts/f-and-f/consolidate.ts        # lee qa/friends-family/results/ff-eval-*.json
```
- Entrega **solo** `situaciones.html` a cada evaluador (no `manifest.json`: trae semillas y etiquetas de cobertura).
- Cada evaluador devuelve **un** `ff-eval-<nombre>.json`; guárdalos en `results/` (esa carpeta no se versiona).
- El consolidador **descarta** archivos de otra versión del kit, incompletos, sin razón obligatoria o con valores inventados, y avisa por qué. Rechaza dos archivos del mismo evaluador.
- Los hashes (`scenariosSha256`) ligan cada resultado a **esta** versión del kit: si regeneras el kit con otro motor, los resultados viejos dejan de valer.
- Cada archivo registra **qué recomendación** se evaluó (situación, posición en el top 5, héroe), **quién** (nombre) y **por qué** (razón), con fecha.

### Qué cubre (la cobertura exacta y las semillas están en `manifest.json`)
Primeros picks (3), respuesta a counters (3), necesidades de composición (2), rol faltante (3) y late draft (4). Incluye a propósito situaciones donde sospechamos problemas: **primeros picks de solo supports** y **varios carries cuando falta mid**. Los evaluadores no ven esas etiquetas.

### Veredicto propuesto (umbrales de arranque en `THRESHOLDS`, confírmalos antes de usarlos)
- **BLOQUEA**: error grave **por consenso** (mayoría de evaluadores) dentro del top 3 en **≥ 2 situaciones**; o > 20% de explicaciones "incorrectas" por consenso; o consejo principal "malo" por consenso en ≥ 3 situaciones.
- **REVISAR**: 1 situación con error grave por consenso, errores graves fuera del top 3, errores graves discutidos (uno dice grave, otros no) o menos de 2 evaluadores.
- **PASS**: ninguno de lo anterior con ≥ 2 evaluadores independientes.
- En empate de etiquetas gana la **peor** (criterio conservador). El informe lista cada razón con quién la dio, para decidir caso por caso.
- La **legalidad** (nada baneado, nada ya elegido, sin repetidos) se comprueba por máquina al generar el kit: una recomendación ilegal aborta la generación. No es trabajo de los evaluadores.

### Límites (leer antes de sacar conclusiones)
- 15 situaciones no son estadística; sirven para **encontrar errores graves y patrones**, no para medir un porcentaje de "inteligencia".
- Los estados vienen del simulador (bans y rival simulados, meta 7.41e con el snapshot congelado `W5-EMP-001`).
- El kit **no usa** el Golden antiguo ni sus etiquetas; tampoco decide nada: el consolidador solo agrega juicios humanos.
- Los datos de este directorio no contienen veredictos humanos reales hasta que alguien los llene y los entregue.
