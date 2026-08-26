# Plan de evolución — Motor de decisiones para el Simulador All Pick

Fecha: 2026-08-25

## Decisión de producto

El **Simulador de Draft** es el producto prioritario y el banco de QA. El usuario controla los
cinco picks de su lado; el motor solo genera el rival simulado y recomienda decisiones para el
equipo del usuario. El Draft en Vivo consumirá este mismo motor en el futuro, pero no condiciona
el primer incremento.

El objetivo no es ordenar héroes por un score global. Es responder la decisión disponible en cada
momento de un All Pick, con datos observables en ese momento.

## Contrato de información del simulador

| Decisión propia | Picks rivales visibles | Información que puede influir |
| --- | --- | --- |
| Pick 1 | Ninguno | bans, meta, disponibilidad, flex, apertura, riesgo y evidencia de confort si aplica |
| Pick 2 | Ninguno | lo anterior + nuestro pick 1 y sinergia/flex propia |
| Pick 3 | Picks 1–2 rivales revelados | lo anterior + counters, composición rival observada y riesgos reales |
| Pick 4 | Picks 1–2 rivales revelados | lo anterior + complementar/ocultar posiciones restantes |
| Pick 5 | Picks 1–4 rivales revelados | cierre de roles, lanes, counters y condición de victoria |

Un pick rival no se usa antes de su revelación. Las hipótesis sobre su futuro quedan fuera del
primer incremento: nunca se presentan como un hecho ni contaminan la recomendación inicial.

## Bans: hechos, no lectura de intención en All Pick

Cada ban elimina un héroe del espacio de candidatos. Además, puede cambiar la evaluación de un
candidato propio de tres formas:

1. **Counter relief**: si un counter relevante de un candidato está baneado, baja su exposición.
2. **Synergy loss**: si un compañero relevante está baneado, baja el valor de ese candidato.
3. **Priority shift**: al salir héroes dominantes o muy disputados del parche, otras aperturas
   ganan prioridad relativa.

El simulador debe guardar la procedencia del ban para reproducibilidad y explicación:
`user_requested`, `meta_priority`, `simulated_opponent_strategy` o `random_fallback`.

En el primer incremento, la procedencia no infiere intención rival. La explicación solo afirma
disponibilidad y evidencia verificable: nunca "el rival planea X" por un ban aleatorio.

## Alcance del primer incremento: política de opener propio

Se implementa y valida primero la recomendación del **pick 1 del equipo del usuario después de la
fase de bans**.

- Muestra cinco opciones cuando existe diversidad estratégica genuina.
- No filtra por una posición global ni por el hero pool personal.
- El hero pool solo será evidencia cuando una decisión se marque explícitamente como pick personal
  o de confort; el usuario está drafteando para cinco jugadores, no necesariamente para sí mismo.
- Cada opción declara propósito principal, roles plausibles, valor de apertura, evidencia de bans,
  riesgo y confianza de evidencia.
- La recomendación no utiliza picks enemigos ni hipótesis de composición rival.

Ejemplo de contrato de explicación:

```text
Shadow Shaman — opener de control y presión de torres.
Sube de prioridad porque una respuesta relevante no está disponible en esta partida.
Mantiene dos asignaciones de support plausibles y encaja con una apertura de objetivo/torres.
Riesgo: requiere que picks posteriores aporten presión de lane o frontline.
Evidencia: parche, roles observados, relaciones de counter y capacidades versionadas.
```

La frase sobre un counter solo se muestra cuando la relación dispone de muestra, segmento y/o
fundamento mecánico suficiente. Un ban nunca convierte automáticamente a un héroe en seguro.

## Modelo de dominio objetivo

### Hechos canónicos

- `DraftEvent`: ban/pick/reveal y secuencia.
- `DraftState`: formato, patch, bans, picks por lado, fase y orden.
- `ParticipantSlot`: lado, dueño del slot y héroe asignado si existe.
- `BanRecord`: héroe, lado si se conoce y procedencia.

### Datos derivados y recalculables

- `DecisionRequest`: quién decide, para quién es el pick, objetivo y restricciones de rol.
- `RoleBelief`: distribución de posiciones con evidencia, nunca una certeza inventada.
- `CompositionState`: capacidades, riesgos y opciones aún abiertas.
- `EvidenceSnapshot`: versión de datos, patch, segmento, fuente, muestra y confianza.
- `Recommendation`: héroe, propósito principal, contribuciones secundarias, riesgos y procedencia.

Los hechos se pueden reproducir desde eventos. Las inferencias se recalculan cuando cambian el
patch, la evidencia o el modelo.

## Reglas técnicas no negociables

- Héroes baneados, escogidos o incompatibles se eliminan antes del scoring.
- `applicable: false` no equivale a un score neutral de cero.
- El motor no consulta APIs externas mientras el usuario decide.
- Una recomendación solo usa hechos disponibles para la ronda actual.
- Simulador y Live compartirán reducer, estado y motor; solo diferirán sus adaptadores de eventos.
- El bot no debe precalcular rondas futuras sin conocer los picks propios ya revelados. Después de
  cada reveal, la siguiente ronda del bot se calcula desde el estado visible actualizado.

## Estrategia de datos

En runtime se consumen artefactos precalculados y versionados. Cada evidencia debe incluir patch,
modo, bracket/segmento si aplica, tamaño de muestra, fuente y fecha de generación.

- OpenDota: base histórica y matchups, nunca dependencia del hot path.
- Ontología curada: capacidades, mecánicas y riesgos; versionada y revisable.
- Hero positions: prior de roles, no asignación definitiva del draft.
- STRATZ: posible enriquecimiento posterior tras un spike de cobertura, límites y licencia.
- LLM: redactor opcional de evidencia estructurada, nunca decisor.

## Validación antes de tuning

El baseline V5 se congela. El primer set golden debe cubrir, como mínimo:

1. Bans que liberan un opener viable.
2. Bans que eliminan una sinergia relevante.
3. Cambio de bans estratégicamente relevante que altera el slate.
4. Cambio irrelevante que no altera drásticamente el slate.
5. Héroe baneado/elegido nunca recomendado.
6. Hero pool personal no filtra un team opener.
7. Ningún pick enemigo usado antes del reveal.
8. Explicación con evidencia de ban y riesgo, sin afirmar intención rival.

Las métricas iniciales son invariantes (0 recomendaciones ilegales), sensibilidad contrafactual,
diversidad del slate, estabilidad ante cambios irrelevantes y revisión humana de coherencia.

## Orden de implementación

1. Reconciliar el árbol pendiente y congelar baseline + fixtures de los fallos actuales.
2. Crear los escenarios golden del opener sensible a bans (TDD rojo).
3. Introducir contratos mínimos: `DecisionRequest`, `BanRecord` y evidencia de relación de ban.
4. Implementar la `TeamOpenerPolicy` y el slate de cinco opciones con explicación estructurada.
5. Corregir el timing del bot para que solo calcule la siguiente ronda después del reveal anterior.
6. Repetir el mismo patrón para pick 2, luego pick 3/4 y finalmente cierre.
7. Añadir contrafactuales, telemetría, datos offline y lookahead solo cuando el baseline esté
   superado por los golden scenarios.

## Estado de implementación

El paso 6 se cerró con `TSK-120` a `TSK-122`: `DraftDecisionPolicy` deriva el contexto solo desde
los picks materializados. Pick 2 permanece ciego y prioriza composición/flex; Pick 3/4 habilita
contrapick únicamente contra dos rivales revelados; y el cierre usa cuatro rivales revelados y
declara riesgo cuando no existe ventaja de matchup o aporte de composición verificable. Los tres
casos tienen pruebas en `apps/engine`; ni el plan del bot ni sus picks ocultos intervienen.

## Fuera de alcance inicial

- Predicción de siguiente pick rival o intención rival por bans.
- MCTS, RL o un modelo de ML extremo a extremo.
- Dependencia online de STRATZ/OpenDota durante una ronda.
- Builds de top players, scouting personal o recomendaciones de ítems; son extensiones futuras
  sobre el mismo `EvidenceSnapshot` y no deben contaminar el motor de picks inicial.
