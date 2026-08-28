# TSK-161 — Paquete de evidencia del Gate 3

Corrida reproducible: `bun scripts/evaluate-pro-drafter.ts --ban-sensitivity`  
Fecha: 2026-08-27 · semilla `1352026` · 50 drafts · 16 bans por variante.

## Comparación contra la línea base

| Métrica | Registrado 2026-08-26 | Corrida actual | Barra | Resultado |
|---|---:|---:|---:|---|
| Jaccard top-5 | 0.480 | **0.278** | ≤ 0.35 | ✅ |
| Cambio de rank 1 | 28.0% | **90.0%** | ≥ 60% | ✅ |
| Estabilidad ante bans irrelevantes | 27.3% | **27.3%** | ≥ 80% | ❌ |
| Cambio ante bans pivotales | 94.9% | **94.9%** | ≥ 50% | ✅ |

Cobertura medida: **124 héroes** en el corpus profesional actualmente cargado. La consulta
continúa siendo sensible a bans pivotales, pero no alcanza la estabilidad exigida para bans
irrelevantes. Por tanto, el Gate 3 **no pasa**: `ENABLE_PRO_DRAFTER` permanece apagado y el Gate 4
no arranca. Esta salida constituye evidencia válida para el segundo blueprint; no se modificaron
constantes, pesos ni umbrales.
