# product — dota2coach, Fase 1 (Draft Coach)

Espejo de `docs/specs/SPEC.md` y `docs/agents/architecture.md` (Bloque 1) para lectura nativa en
Kiro. `CLAUDE.md` sigue siendo la fuente canónica si hay discrepancia.

## Problema y usuario
Tomar decisiones de pick/ban correctas en Dota 2 es difícil por tiempo e ignorancia del meta —
dirigido a jugadores de nivel bajo/medio, no a pro players. Usuario en fase 1: el propio
desarrollador, jugando sus partidas (pubs y/o Captain Mode). Visión futura: servicio a otros
jugadores, con cuentas/login (no en fase 1).

## Qué hace fase 1
- Reconoce el tipo de partida (pública vs. Captain Mode) y captura el draft en tiempo real.
- Sugiere picks/bans/contrapicks en tiempo real, basado en meta del parche actual y winrates
  generales de OpenDota — **sin personalización de hero pool** (eso es fase 1b).
- Capturadores de primera clase en fase 1: `simulator` y `manual`. `overwolf`/`ocr` quedan
  especificados como contrato, se construyen después.

## Fuera de alcance de fase 1 (no cierra puertas arquitectónicas)
Personalización de hero pool, itemización, timings, plugin/bot de voz en Discord, servicio
multiusuario con cuentas.

## Criterios de aceptación (SPEC §6)
1. **Captura correcta**: simulador reproduce Captain Mode y All Pick sin perder ningún pick/ban;
   `format: 'unknown'` no rompe la vista; luego se repite contra una partida real.
2. **Sugerencias con sentido**: sobre ≥5 drafts, coherentes cualitativamente — y cada sugerencia
   debe poder explicarse mirando su desglose de señales.
3. **Velocidad**: `computedInMs` bajo 300ms p95, <2s extremo a extremo.
4. **Simulador independiente**: un draft completo se reproduce sin Dota 2 abierto.

**Estado (2026-07-28)**: fase 1 completa (TSK-001 a TSK-016), MVP validado contra sus 4 criterios.

## Fase 1b — Personalización de hero pool (SPEC.md §9)
Espejo de `docs/specs/SPEC.md` §9 y el addendum "Fase 1b" de `architecture.md`.

- **Qué agrega**: el usuario guarda hasta 5 héroes de comodidad (a mano, o calculados desde sus
  últimas partidas de OpenDota con un mínimo de 10 partidas en 90 días). Las sugerencias del motor
  ganan una quinta señal ponderada (`hero_pool_fit`) que refleja esa comodidad — nunca filtra en
  duro, solo pondera (máximo 16 puntos sobre 100 del score final).
- **Fuera de alcance de 1b**: hero pool de compañeros de equipo (necesita identidad de slot y
  login), predicción de rol/posición del rival (documentada, depende de STRATZ, no se construye).
- **Regresión cero, demostrable**: con el pool sin configurar, el comportamiento de fase 1 no
  cambia — verificado por prueba unitaria, no solo declarado.
- **Primer dato personal del proyecto**: el `account_id` de Steam del usuario (para calcular el
  pool). Tratamiento en `.claude/rules/security.md`.
