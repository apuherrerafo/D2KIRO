# TSK-171 — Diagnóstico por señal

Comando reproducible:

```sh
bun scripts/pro/instability-report.ts
```

Resultado sobre 50 drafts deterministas y dos variantes de 16 bans:

| Señal | Delta medio | Contribución ponderada | Corridas sobre umbral |
|---|---:|---:|---:|
| `denial_score` | 0.279966 | 0.069992 | 43/50 |
| `lane_score` | 0 | 0 | 0/50 |
| `knn_similarity` | 0 | 0 | 0/50 |

La lectura es diagnóstica, no causal: las variantes mezclan bans pivotales e irrelevantes, por lo
que el siguiente ticket debe separar ambos grupos antes de ajustar pesos o umbrales. No se cambió
el scoring activo y `ENABLE_PRO_DRAFTER` continúa apagado.

La utilidad ahora devuelve también los grupos `irrelevant` y `pivotal`, usando la frontera de
presión de rol `<0.15`/`≥0.15` del benchmark. La salida JSON conserva ambos desgloses para que el
próximo ajuste pueda comparar cambios dinámicos esperados contra falsos positivos.
