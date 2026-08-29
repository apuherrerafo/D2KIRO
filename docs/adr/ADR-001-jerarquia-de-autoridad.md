# ADR-001 — Jerarquía de autoridad de las fuentes de verdad (L0–L6)

**Estado**: aceptado (2026-08-29, Fase 9.0, `TSK-193`)
**Implementa**: `R3-4`, `R3-2` (`docs/research/fase9-research-consolidation.md`)

## Contexto

El proyecto acumuló ~10 fases. Las decisiones viven repartidas entre `CLAUDE.md`, `.claude/rules/`,
`docs/agents/architecture.md`, `docs/specs/SPEC.md`, comentarios de código y `docs/agents/journal.md`.
Cuando dos de esas fuentes se contradicen, no había una regla escrita de cuál gana — se resolvía
por criterio de quien lo notara. El informe #3 (AI Engineering Harness) propone una jerarquía
explícita y numerada para que la resolución de conflictos sea determinista, no de criterio.

## Decisión

Se adopta esta jerarquía. Ante un conflicto, **gana la fuente de nivel más bajo (número menor)**:

| Nivel | Fuente | Qué es |
|---|---|---|
| **L0** | Contratos duros | `scripts/verify-simplicity.sh`, los hooks de `.claude/settings.json`, los invariantes que un gate bloquea. No se discuten: se cumplen o el commit no entra. |
| **L1** | ADR (`docs/adr/`) | Decisiones arquitectónicas puntuales, inmutables. Una ADR sólo se revierte con otra ADR que la supersede. |
| **L2** | `docs/agents/architecture.md` | La arquitectura viva del sistema, por fase. |
| **L3** | `docs/specs/SPEC.md` | El contrato de desarrollo por fase — comportamiento, entradas/salidas, costuras, criterios de aceptación. |
| **L4** | Código y sus comentarios | La implementación real. Si contradice a L3, es un bug o L3 quedó viejo — se resuelve subiendo el conflicto, no ignorándolo. |
| **L5** | Investigación (`docs/research/`) | Insumo de planificación. Deja de tener autoridad una vez que L2/L3 la absorbieron (con su ID de trazabilidad). |
| **L6** | Memoria de agente (`.claude/projects/*/memory/`, `MEMORY.md`) | Contexto de fondo, regenerable. Nunca gana contra nada de arriba. Refleja lo que era cierto cuando se escribió. |

`docs/agents/journal.md` es **append-only y ortogonal** a esta jerarquía: es el registro histórico
de qué pasó, no una fuente de verdad sobre qué debe pasar.

## Alternativas consideradas

- **Sin jerarquía formal, resolver caso por caso.** Es el estado actual. Funciona mientras haya
  una sola persona con el contexto completo; se degrada en cuanto entra otra herramienta o pasa el
  tiempo. Rechazada.
- **`SPEC.md` como única fuente de verdad.** Demasiado grueso: mezcla decisiones que no cambian
  nunca (una ADR) con contrato de una fase concreta. Rechazada a favor de separar L1 de L3.

## Consecuencias

- Toda decisión arquitectónica nueva de Fase 9 en adelante se registra como una ADR en
  `docs/adr/`, no como un párrafo en `journal.md` ni un bloque nuevo en `CLAUDE.md`.
- `CLAUDE.md` se adelgaza (`TSK-196`): los bloques `REGLAS DE FASE X` se mueven a
  `.claude/rules/fase-N.md` (L2/L3), y `CLAUDE.md` queda como índice + L0.
- Cuando el código (L4) y el SPEC (L3) discrepan de forma seria y confirmada, eso es un gatillo
  documentado de Opus (`CLAUDE.md` § Política de Modelos) — la jerarquía dice quién gana, el
  gatillo dice con qué modelo se re-sintetiza.
