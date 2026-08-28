# TSK-170 — Re-corrida del Gate 3

Comando ejecutado el 2026-08-27:

```text
bun scripts/evaluate-pro-drafter.ts --ban-sensitivity
```

La corrida usa la semilla determinista `1352026`, 50 drafts y 16 bans por variante. El corpus
disponible sigue siendo de 502 drafts (la ingesta de 3.000 aún es una tarea de fondo), por lo que
esta medición no sustituye la futura corrida ampliada.

| Métrica | Resultado | Barra | Estado |
|---|---:|---:|---|
| Jaccard Top-5 Pro-Drafter | 0.278 | ≤0.35 | ✅ |
| Cambio rank 1 | 90.0% | ≥60% | ✅ |
| Estabilidad bans irrelevantes | 27.3% | ≥80% | ❌ |
| Cambio bans pivotales | 94.9% | ≥50% | ✅ |

Conclusión: el Gate 3 continúa sin pasar por estabilidad insuficiente. `ENABLE_PRO_DRAFTER` sigue
en `false`; no se inicia integración al scoring. Debe repetirse esta misma corrida después de
TSK-168/169 con el corpus ampliado.
