# TSK-162 — Spike de embeddings (Gate 4)

Evaluación realizada sobre los artefactos y benchmarks disponibles el 2026-08-27. Este ticket no
implementa embeddings.

| Criterio | Umbral | Medición actual | Resultado |
|---|---:|---:|---|
| Cobertura de evidencia explícita | ≥80% | **0% medible** — TSK-160 aún no expone una corrida de cobertura por candidato | ❌ |
| Estabilidad temporal de patrones pro | ≥0.70 | **0.273** (estabilidad ante bans irrelevantes, corrida TSK-161) | ❌ |
| Residuo Top-3 frente al óptimo del corpus | ≥10 pp | **No medible (0 pp registrados)** — no existe todavía una dimensión 6 calibrada contra óptimo | ❌ |
| Tamaño del corpus | ≥3.000 drafts | **502 drafts** | ❌ |

El spike se cierra correctamente sin código: fallan varios criterios y el problema prioritario es
cobertura/estabilidad/datos, no representación vectorial. Reabrirlo requiere primero ampliar el
corpus, medir cobertura y pick-order con el analyzer y demostrar estabilidad temporal ≥0.70.

Si en el futuro se construyen embeddings, serán una señal adicional y auditable con fuente separada;
nunca sustituirán matchups, sinergias, roles, patrones profesionales ni evidencia explícita.
