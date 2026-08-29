# ADR-003 — Frontera `data/curated/` vs `data/generated/`; lo generado nunca pisa lo curado

**Estado**: aceptado (2026-08-29, Fase 9.0, `TSK-193`)
**Implementa**: `R3-13`, `R1-6`, `R2-11` (`docs/research/fase9-research-consolidation.md`)

## Contexto

Fase 9 introduce datos derivados por script (percentiles de calibración, modelo Empirical Bayes de
matchups, perfil de señales). El proyecto ya tiene datos curados a mano (`hero-positions.json`,
`capabilities.json`, `hero-counters.json`). Los tres informes coinciden en un riesgo: que un
proceso de regeneración pise, en silencio, una curación humana revisada — o que nadie sepa, meses
después, con qué parche y qué ventana se generó un archivo.

## Decisión

Dos directorios con semántica distinta y una frontera mecánica entre ellos:

- **`data/curated/`** — JSON revisado por un humano. Fuente: criterio de dominio. Sólo lo edita
  una persona (o un agente actuando como tal, con revisión). **Ningún script de generación escribe
  acá.**
- **`data/generated/`** — salida reproducible de un script de `scripts/stats/**` o
  `scripts/eval/**`. Se puede borrar y regenerar. Se versiona (para auditar y para el candado de
  regresión), pero su autoridad es la del script que lo produjo, no la de una revisión humana.

**Frontera mecánica** (`TSK-194`): un hook `PreToolUse` rechaza cualquier `Edit`/`Write` sobre
`data/curated/**` cuyo origen sea un script bajo `scripts/stats/**` o `scripts/eval/**`.
Determinista, sin heurística de contenido.

**Procedencia obligatoria**: cada archivo de `data/generated/<nombre>.json` lleva su gemelo
`data/metadata/<nombre>.json` con `source`, `generatedAt`, `generatorVersion`, `sampleWindow`,
`patch`, `rowCount`, `schemaVersion`. Un archivo generado sin metadata es un error de revisión.

## Alternativas consideradas

- **Un solo directorio `data/` con un campo `"curated": true` en cada archivo.** Frágil: el campo
  se puede editar, y no da un punto claro donde un hook pueda bloquear. Rechazada.
- **Mantener los curados donde están (`apps/engine/src/signals/`) y sólo crear `data/generated/`.**
  Es lo que hace Fase 9.0 de hecho — mover los tres JSON existentes a `data/curated/` es un ticket
  aparte, posterior al gate de 9.0 (`SPEC.md` §15.10), para no tocar los loaders y sus tests en la
  misma fase que introduce la frontera. La frontera y el hook se montan ya; la migración de los
  archivos existentes espera.

## Consecuencias

- `data/curated/` nace con la frontera activa aunque todavía viva casi vacío.
- Los agentes `data-stat-engineer` y `evaluation-engineer` (`TSK-195`) tienen alcance de escritura
  limitado a `data/generated/**` y `eval/**` — nunca `data/curated/**`.
- `.gitignore` versiona `data/generated/` y `data/metadata/`; sólo `eval/reports/` se ignora.
- Regla operativa: si un script necesita "corregir" un dato curado, no lo hace — emite un reporte y
  la corrección la aplica un humano en `data/curated/`.
